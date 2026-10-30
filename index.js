// Host 半：DeepSeek 余额与花费。
//
// 余额 / 今日 / 本周 / 本月 / 累计 全部来自官网账号接口（official.js）：
//   get_user_summary        → 钱包余额 + total_costs（账号累计消费）
//   usage/by_api_key/cost   → 按时间桶的消费金额
// 官网没有「当前轮次」这种粒度，所以本轮由本地折叠会话事件 + 官方价目表估算。
// 未登录官网账号时，余额回退到 API Key 的 /user/balance，其余项不可用（如实显示）。
import z from "@deepseek-ai/schemastery";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { buildPriceTable, convert, priceFor } from "./pricing.js";
import { foldEvents, startOfMonth, startOfWeek, summarize } from "./ledger.js";
import {
  clientHeaders,
  fetchSummary,
  fetchUsageCost,
  localDayStartSeconds,
  normalizeTimezone,
} from "./official.js";
import { collectKeyRefs, parseApiBalance } from "./balance.js";

const DEFAULT_REFRESH_MS = 30000;
const DEFAULT_CACHE_MS = 60000;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CNY_TO_USD = 0.139;
const DEFAULT_BASE_URL = "https://api.deepseek.com";
/** 只有官方路由会扣 DeepSeek 余额。 */
const OFFICIAL_PROVIDERS = ["deepseek-official", "deepseek-account"];

export const Config = z.object({
  /** 客户端轮询间隔（毫秒）。 */
  refreshMs: z.number().default(DEFAULT_REFRESH_MS),
  /** 官网数据缓存时间（毫秒）。 */
  cacheMs: z.number().default(DEFAULT_CACHE_MS),
  /** 拿不到余额时的展示货币。 */
  currency: z.string().default("CNY"),
  /** 展示货币为美元时，1 元人民币折合多少美元。 */
  cnyToUsd: z.number().default(DEFAULT_CNY_TO_USD),
  /** 本轮估算的价目表覆盖（每 1M tokens，人民币）。 */
  prices: z.any(),
  /** 官方 API 端点（仅未登录账号时回退余额用）。 */
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  /** 单次 HTTP 超时（毫秒）。 */
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  /** 发给官网的客户端版本号（x-client-version）。 */
  clientVersion: z.string().default("1.0.0"),
});

/** 读取 settings.describe() 的活跃表单；服务不可用时返回空数组。 */
function describeForms(ctx) {
  try {
    const settings = typeof ctx.get === "function" ? ctx.get("settings") : undefined;
    if (settings === undefined || typeof settings.describe !== "function") return [];
    const forms = settings.describe();
    return Array.isArray(forms) ? forms : [];
  } catch {
    return [];
  }
}

/** 数值兜底。 */
function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 从「整月每日桶」里切出 >= from 的部分，并收集出现的模型。 */
function sliceUsage(usage, from) {
  let cost = 0;
  const models = [];
  for (const row of usage.series ?? []) {
    let hit = false;
    for (const bucket of row.buckets ?? []) {
      if (bucket.time >= from) {
        cost += bucket.cost;
        hit = true;
      }
    }
    if (hit && row.model !== "" && !models.includes(row.model)) models.push(row.model);
  }
  return { cost, models };
}

/** 官网数据不可用时的空桶。 */
function emptyBucket(source) {
  return { cost: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, models: [], source };
}

export class DeepSeekCostGateway extends TypertRemoteService {
  static inject = ["credentials"];
  static Config = Config;

  constructor(ctx, config) {
    super(ctx, "deepseekCost");
    this.config = config ?? {};
    /** @type {Map<string, object>} 账本：sessionId#seq → 记录（只用于本轮） */
    this.entries = new Map();
    /** @type {Map<string, number>} 活跃会话已折叠到的事件下标 */
    this.liveCursor = new Map();
    this.officialCache = null;
    this.officialInflight = null;
    this.keyBalanceCache = null;
  }

  /** 客户端读一次：官网数据 + 本地本轮。 */
  async read() {
    this.foldLive();
    const official = await this.readOfficial();
    const catalog = buildPriceTable(this.config.prices);
    const now = Date.now();
    const summary = summarize(this.entries, (model, time) => priceFor(catalog, model, time), now);

    const currency =
      (official.balance && official.balance.currency) ||
      (official.totalCost && official.totalCost.currency) ||
      this.displayCurrency();
    const rate = this.displayRate(currency);
    const usage = official.usage;

    return {
      fetchedAt: now,
      refreshMs: Math.max(5000, numberOr(this.config.refreshMs, DEFAULT_REFRESH_MS)),
      currency,
      rate,
      balance: official.balance,
      balanceError: official.error,
      status: official.status,
      day: usage ? this.officialBucket(usage.day) : emptyBucket("unavailable"),
      week: usage ? this.officialBucket(usage.week) : emptyBucket("unavailable"),
      month: usage ? this.officialBucket(usage.month) : emptyBucket("unavailable"),
      total: official.totalCost
        ? { ...emptyBucket("official"), cost: convert(official.totalCost.amount, rate) }
        : emptyBucket("unavailable"),
      turns: this.turnMap(summary.turns, rate),
      scan: { done: true, sessions: 0, events: this.entries.size },
    };
  }

  /** 强制刷新：清缓存后重读。 */
  async refresh() {
    this.officialCache = null;
    this.officialInflight = null;
    this.keyBalanceCache = null;
    return this.read();
  }

  /** 展示货币（没有官网数据时的兜底）。 */
  displayCurrency() {
    const currency = typeof this.config.currency === "string" ? this.config.currency.toUpperCase() : "CNY";
    return currency === "USD" ? "USD" : "CNY";
  }

  /** 价目表与本轮金额是人民币；展示美元时按汇率折算。 */
  displayRate(currency) {
    return currency === "USD" ? numberOr(this.config.cnyToUsd, DEFAULT_CNY_TO_USD) : 1;
  }

  /** 官网桶：只有金额与模型，没有 token 明细。 */
  officialBucket(entry) {
    return {
      ...emptyBucket("official"),
      cost: entry ? entry.cost : 0,
      models: entry && Array.isArray(entry.models) ? entry.models : [],
    };
  }

  turnMap(turns, rate) {
    const out = {};
    for (const [sessionId, turn] of Object.entries(turns)) {
      out[sessionId] = {
        cost: convert(turn.cost, rate),
        input: turn.input,
        cacheRead: turn.cacheRead,
        cacheWrite: turn.cacheWrite,
        output: turn.output,
        calls: turn.calls,
        models: [...turn.models],
        source: "local",
        turn: turn.turn,
      };
    }
    return out;
  }

  /** 折叠所有活跃会话里新追加的事件（同步、幂等，只用于本轮）。 */
  foldLive() {
    let sessions;
    try {
      const service = this.ctx.get("sessions");
      sessions = service && typeof service.list === "function" ? service.list() : [];
    } catch {
      sessions = [];
    }
    for (const session of sessions) {
      try {
        const events = session.snapshotEvents();
        if (!Array.isArray(events)) continue;
        let cursor = this.liveCursor.get(session.id);
        if (cursor === undefined) {
          const inherited =
            typeof session.inheritedEventCount === "number" ? session.inheritedEventCount : 0;
          cursor = Math.max(0, Math.min(inherited, events.length));
          this.liveCursor.set(session.id, cursor);
        }
        if (cursor >= events.length) continue;
        for (const entry of foldEvents(session.id, events.slice(cursor))) {
          if (!OFFICIAL_PROVIDERS.includes(entry.p)) continue;
          if (!this.entries.has(entry.id)) this.entries.set(entry.id, entry);
        }
        this.liveCursor.set(session.id, events.length);
      } catch {
        // 单个会话读取失败不影响其余会话。
      }
    }
  }

  /** 官网数据：带缓存与并发合流。 */
  async readOfficial() {
    const cacheMs = Math.max(5000, numberOr(this.config.cacheMs, DEFAULT_CACHE_MS));
    if (this.officialCache !== null && Date.now() - this.officialCache.at < cacheMs) {
      return this.officialCache.value;
    }
    if (this.officialInflight !== null) return this.officialInflight;
    this.officialInflight = this.collectOfficial()
      .then((value) => {
        this.officialCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        this.officialInflight = null;
      });
    return this.officialInflight;
  }

  /** 一次读全：账号汇总 + 日/周/月消费。任一步失败都降级但不抛错。 */
  async collectOfficial() {
    const platform = await this.platformSession();
    if (platform === null) {
      const fallback = await this.keyBalance();
      return {
        status: "signed-out",
        balance: fallback.balance,
        error: fallback.error,
        totalCost: null,
        usage: null,
      };
    }

    const headers = {
      ...platform.requestHeaders,
      ...clientHeaders({
        version: typeof this.config.clientVersion === "string" ? this.config.clientVersion : "1.0.0",
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }),
      "x-dsh-auth-token": platform.token,
      accept: "application/json",
    };
    const timeoutMs = Math.max(1000, numberOr(this.config.timeoutMs, DEFAULT_TIMEOUT_MS));

    let summary;
    try {
      summary = await fetchSummary({ origin: platform.origin, headers, timeoutMs });
    } catch (error) {
      return {
        status: "error",
        balance: null,
        error: error && error.code ? error.code : "network",
        totalCost: null,
        usage: null,
      };
    }

    const usage = await this.collectUsage(platform.origin, headers, timeoutMs);
    return {
      status: "official",
      balance: summary.balance,
      error: summary.balance === null ? "account-empty" : null,
      totalCost: summary.totalCost,
      usage,
    };
  }

  /** 一次取「本月 1 日 → 今天」的每日桶，再在本地切出日/周/月。 */
  async collectUsage(origin, headers, timeoutMs) {
    const now = Date.now();
    const tz = normalizeTimezone(-new Date().getTimezoneOffset() * 60);
    const dayStart = localDayStartSeconds(now);
    const end = dayStart + 86400;
    const weekStart = Math.floor(startOfWeek(now) / 1000);
    const monthStart = Math.floor(startOfMonth(now) / 1000);

    let usage;
    try {
      usage = await fetchUsageCost({ origin, headers, start: monthStart, end, tz, timeoutMs });
    } catch {
      return null;
    }
    if (usage === null) return null;
    return {
      day: sliceUsage(usage, dayStart),
      week: sliceUsage(usage, weekStart),
      month: sliceUsage(usage, monthStart),
    };
  }

  /** 官网登录态（Host-only）：origin + token + 部署头。 */
  async platformSession() {
    let account;
    try {
      account = this.ctx.get("deepseekAccount");
    } catch {
      account = undefined;
    }
    if (!account || typeof account.getPlatformSession !== "function") return null;
    try {
      const session = await account.getPlatformSession();
      if (!session || typeof session.token !== "string" || typeof session.origin !== "string") return null;
      return {
        origin: session.origin,
        token: session.token,
        requestHeaders:
          session.requestHeaders !== null && typeof session.requestHeaders === "object"
            ? session.requestHeaders
            : {},
      };
    } catch {
      return null;
    }
  }

  /** 未登录账号时的余额回退：DSH 配置里的 API Key → /user/balance。 */
  async keyBalance() {
    const cacheMs = Math.max(5000, numberOr(this.config.cacheMs, DEFAULT_CACHE_MS));
    if (this.keyBalanceCache !== null && Date.now() - this.keyBalanceCache.at < cacheMs) {
      return this.keyBalanceCache.value;
    }
    const key = await this.resolveKey();
    if (key === null) return { balance: null, error: "no-key" };
    const value = await this.requestBalance(key);
    this.keyBalanceCache = { at: Date.now(), value };
    return value;
  }

  /** 从 DSH 配置解析 API Key（先凭据服务，再启动环境变量）。 */
  async resolveKey() {
    const refs = collectKeyRefs(describeForms(this.ctx));
    const credentials = (() => {
      try {
        return this.ctx.get("credentials");
      } catch {
        return undefined;
      }
    })();
    if (credentials && typeof credentials.resolve === "function") {
      for (const ref of refs) {
        try {
          const found = await credentials.resolve(credentialRef(ref));
          if (found && typeof found.value === "string" && found.value.length > 0) return found.value;
        } catch {
          // 未配置的引用继续看下一个。
        }
      }
    }
    for (const ref of refs) {
      const value = process.env[ref];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return null;
  }

  /** GET /user/balance 并按状态码映射错误。 */
  async requestBalance(key) {
    const baseUrl = typeof this.config.baseUrl === "string" ? this.config.baseUrl : DEFAULT_BASE_URL;
    const timeoutMs = Math.max(1000, numberOr(this.config.timeoutMs, DEFAULT_TIMEOUT_MS));
    let response;
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/, "")}/user/balance`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { balance: null, error: "network" };
    }
    if (response.status === 401) return { balance: null, error: "unauthorized" };
    if (response.status === 403) return { balance: null, error: "forbidden" };
    if (!response.ok) return { balance: null, error: `http-${response.status}` };
    let body;
    try {
      body = await response.json();
    } catch {
      return { balance: null, error: "bad-json" };
    }
    const parsed = parseApiBalance(body);
    return parsed ? { balance: parsed, error: null } : { balance: null, error: "empty" };
  }
}

export default DeepSeekCostGateway;

// 官网（Platform）数据读取：余额、账号累计、按天/周/月的消费。
//
// 用的是 DSH 账号服务已经验证过的同一组接口与凭据：
//   GET {origin}/api/v0/users/get_user_summary      → 钱包 + total_costs（账号累计）
//   GET {origin}/api/v0/usage/by_api_key/cost?...   → 按时间桶的消费金额
// 只有登录了官网账号才可用；未登录时由调用方回退到 API Key 余额接口。

/** Platform 客户端身份头（与 DSH 账号提供方一致）。 */
export function clientHeaders(options = {}) {
  const version = typeof options.version === "string" ? options.version : "1.0.0";
  const offset = Number.isFinite(options.timezoneOffsetSeconds)
    ? Math.trunc(options.timezoneOffsetSeconds)
    : -new Date().getTimezoneOffset() * 60;
  return {
    "x-client-bundle-id": "",
    "x-client-platform": process.platform === "win32" ? "desktop-win" : "desktop-mac",
    "x-client-version": version,
    "x-client-locale": "zh_CN",
    "x-client-timezone-offset": String(offset),
  };
}

/**
 * 平台上允许的时区偏移：整 15 分钟、范围 ±14 小时。
 * 不合法时退回 0（UTC），避免接口报 INVALID_PARAM。
 * @param {number} seconds 东八区为 28800
 * @returns {number} 合法偏移
 */
export function normalizeTimezone(seconds) {
  const value = Number.isFinite(seconds) ? Math.trunc(seconds) : 0;
  if (value % 900 !== 0 || value < -43200 || value > 50400) return 0;
  return value;
}

/** 十进制字符串 → 数字。 */
export function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 取出 biz_data；业务码非 0 视为失败。 */
export function bizData(json) {
  const envelope = json && typeof json === "object" ? json.data ?? json : null;
  if (!envelope || typeof envelope !== "object") return null;
  if (envelope.biz_code !== undefined && envelope.biz_code !== 0) return null;
  const payload = envelope.biz_data ?? envelope;
  return payload && typeof payload === "object" ? payload : null;
}

/** 钱包里挑展示货币：优先 CNY，其次 USD，再次第一个。 */
function pickCurrency(wallets) {
  const names = [];
  for (const wallet of wallets ?? []) {
    if (wallet && typeof wallet === "object" && typeof wallet.currency === "string") {
      if (!names.includes(wallet.currency)) names.push(wallet.currency);
    }
  }
  if (names.includes("CNY")) return "CNY";
  if (names.includes("USD")) return "USD";
  return names[0] ?? null;
}

/** 汇总某一货币的钱包余额。 */
function sumWallets(wallets, currency) {
  let total = 0;
  let seen = false;
  for (const wallet of wallets ?? []) {
    if (!wallet || wallet.currency !== currency) continue;
    const amount = parseAmount(wallet.balance);
    if (amount === null) continue;
    total += amount;
    seen = true;
  }
  return seen ? total : null;
}

/**
 * 解析账号汇总：充值/赠送钱包 + 账号累计消费。
 * @param {unknown} json 原始响应
 * @returns {{balance: object|null, totalCost: {amount: number, currency: string}|null}}
 */
export function parseSummary(json) {
  const payload = bizData(json);
  if (payload === null) return { balance: null, totalCost: null };

  const normal = Array.isArray(payload.normal_wallets) ? payload.normal_wallets : [];
  const bonus = Array.isArray(payload.bonus_wallets) ? payload.bonus_wallets : [];
  const costs = Array.isArray(payload.total_costs) ? payload.total_costs : [];

  const currency = pickCurrency([...normal, ...bonus]);
  let balance = null;
  if (currency !== null) {
    const toppedUp = sumWallets(normal, currency) ?? 0;
    const granted = sumWallets(bonus, currency) ?? 0;
    balance = { total: toppedUp + granted, toppedUp, granted, currency, source: "account" };
  }

  const costCurrency = pickCurrency(costs);
  let totalCost = null;
  if (costCurrency !== null) {
    const row = costs.find((item) => item && item.currency === costCurrency);
    const amount = row ? parseAmount(row.amount) : null;
    if (amount !== null) totalCost = { amount, currency: costCurrency };
  }
  return { balance, totalCost };
}

/**
 * 解析一份用量响应：保留每个模型的每日桶，便于在本地切日/周/月。
 * @param {unknown} json 原始响应
 * @param {string} [preferredCurrency] 优先统计的货币
 * @returns {{cost: number, currency: string|null, models: string[],
 *            series: Array<{model: string, buckets: Array<{time: number, cost: number}>}>}|null}
 */
export function parseUsage(json, preferredCurrency) {
  const payload = bizData(json);
  if (payload === null) return null;
  const blocks = Array.isArray(payload.data) ? payload.data : [];
  if (blocks.length === 0) return { cost: 0, currency: preferredCurrency ?? null, models: [], series: [] };

  const currency =
    preferredCurrency !== undefined && blocks.some((block) => block && block.currency === preferredCurrency)
      ? preferredCurrency
      : pickCurrency(blocks) ?? preferredCurrency ?? null;
  const block = blocks.find((item) => item && item.currency === currency) ?? blocks[0];

  let cost = 0;
  const models = [];
  const series = [];
  for (const row of block.series ?? []) {
    if (!row) continue;
    const model = typeof row.model === "string" ? row.model : "";
    if (model !== "" && !models.includes(model)) models.push(model);
    const buckets = [];
    for (const bucket of row.buckets ?? []) {
      const amount = parseAmount(bucket && bucket.cost);
      if (amount === null) continue;
      buckets.push({ time: Number(bucket.time) || 0, cost: amount });
      cost += amount;
    }
    series.push({ model, buckets });
  }
  return { cost, currency, models, series };
}

/** 本地 0 点对应的 epoch 秒（与接口的 start/end 约定一致）。 */
export function localDayStartSeconds(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/** 带超时的一次 GET，失败抛出带 code 的错误。 */
async function getJson(url, headers, timeoutMs, signal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    headers,
    signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
  });
  if (!response.ok) {
    const error = new Error(`platform http ${response.status}`);
    error.code = response.status === 401 ? "unauthorized" : `http-${response.status}`;
    throw error;
  }
  let json;
  try {
    json = await response.json();
  } catch {
    const error = new Error("platform bad json");
    error.code = "bad-json";
    throw error;
  }
  return json;
}

/**
 * 读取账号汇总（余额 + 累计消费）。
 * @param {{origin: string, token: string, headers: object, timeoutMs?: number, signal?: AbortSignal}} options
 * @returns {Promise<{balance: object|null, totalCost: object|null}>}
 */
export async function fetchSummary(options) {
  const url = `${options.origin.replace(/\/+$/, "")}/api/v0/users/get_user_summary`;
  const json = await getJson(url, options.headers, options.timeoutMs ?? 15000, options.signal);
  return parseSummary(json);
}

/**
 * 读取一段时间内的官方消费金额。
 * @param {{origin: string, headers: object, start: number, end: number, tz: number,
 *          timeoutMs?: number, signal?: AbortSignal, currency?: string}} options
 * @returns {Promise<{cost: number, currency: string|null, models: string[]}|null>}
 */
export async function fetchUsageCost(options) {
  const base = options.origin.replace(/\/+$/, "");
  const url = `${base}/api/v0/usage/by_api_key/cost?start=${options.start}&end=${options.end}&tz=${options.tz}`;
  const json = await getJson(url, options.headers, options.timeoutMs ?? 15000, options.signal);
  return parseUsage(json, options.currency);
}

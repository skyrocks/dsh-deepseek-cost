// 纯逻辑回归：不依赖 DSH 运行时，直接 `node test/smoke.mjs`。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPriceTable, costOf, convert, isPeak, priceFor } from "../pricing.js";
import { entryOf, foldEvents, startOfDay, startOfMonth, startOfWeek, summarize } from "../ledger.js";
import { collectKeyRefs, parseAccountBalance, parseApiBalance } from "../balance.js";
import { normalizeTimezone, parseSummary, parseUsage } from "../official.js";
import { TYPERT } from "../typert.host.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

/** 北京时间 → 时间戳。 */
const bj = (y, m, d, hh, mm = 0) => Date.UTC(y, m - 1, d, hh - 8, mm);

const CATALOG = buildPriceTable({});

test("高峰时段：周一至周五 9-12 / 14-18（北京时间）", () => {
  assert.equal(isPeak(bj(2026, 10, 30, 10, 0)), true); // 周五 10:00
  assert.equal(isPeak(bj(2026, 10, 30, 8, 59)), false);
  assert.equal(isPeak(bj(2026, 10, 30, 12, 0)), false); // 右开区间
  assert.equal(isPeak(bj(2026, 10, 30, 14, 0)), true);
  assert.equal(isPeak(bj(2026, 10, 30, 18, 0)), false);
  assert.equal(isPeak(bj(2026, 10, 31, 10, 0)), false); // 周六
  assert.equal(isPeak(bj(2026, 11, 1, 10, 0)), false); // 周日
});

test("官方价目表：高峰/空闲双档，旧模型名走 Flash 价", () => {
  const peak = bj(2026, 10, 30, 10, 0);
  const off = bj(2026, 10, 30, 22, 0);
  assert.deepEqual(priceFor(CATALOG, "deepseek-flash", peak), {
    input: 2,
    output: 8,
    cacheRead: 0.04,
  });
  assert.equal(priceFor(CATALOG, "deepseek-flash", off).input, 1);
  assert.equal(priceFor(CATALOG, "deepseek-v4-flash-vision-exp", peak).input, 2);
  assert.equal(priceFor(CATALOG, "deepseek-v4.1-flash", off).cacheRead, 0.02);
  assert.equal(priceFor(CATALOG, "deepseek-v4-pro", peak).output, 27);
  assert.equal(priceFor(CATALOG, "deepseek-v4-pro", off).output, 13.5);
  // 未识别模型：前缀匹配不到时用兜底价（Flash 空闲档）
  assert.equal(priceFor(CATALOG, "glm-5.3-flash", peak).input, 1);
});

test("价目表可覆盖：单档写法同时用于高峰与空闲", () => {
  const custom = buildPriceTable({ "my-model": { input: 3, output: 9 }, fallback: { input: 5, output: 10 } });
  assert.equal(priceFor(custom, "my-model", bj(2026, 10, 30, 10, 0)).input, 3);
  assert.equal(priceFor(custom, "my-model", bj(2026, 10, 30, 22, 0)).input, 3);
  assert.equal(priceFor(custom, "zzz", bj(2026, 10, 30, 10, 0)).input, 5);
});

test("费用：四个 token 桶分别计价，缓存写入按未命中价", () => {
  const price = { input: 2, cacheRead: 0.04, cacheWrite: 0, output: 8 };
  assert.equal(costOf({ i: 1_000_000 }, price), 2);
  assert.equal(costOf({ r: 1_000_000 }, price), 0.04);
  assert.equal(costOf({ o: 1_000_000 }, price), 8);
  assert.equal(costOf({ w: 1_000_000 }, price), 2);
  assert.equal(costOf({}, price), 0);
  assert.equal(costOf({ i: -5, o: "x" }, price), 0);
});

test("汇率折算：非正数不折算", () => {
  assert.equal(convert(1, 0.139), 0.139);
  assert.equal(convert(1, 0), 1);
  assert.equal(convert(1, NaN), 1);
});

test("事件 → 账本记录：优先 data.usage", () => {
  const entry = entryOf("s1", {
    type: "assistant/message",
    seq: 12,
    time: 1000,
    data: {
      turn: 3,
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 },
      message: { source: { provider: "deepseek-official", model: "deepseek-v4-pro" } },
    },
  });
  assert.equal(entry.id, "s1#12");
  assert.equal(entry.u, 3);
  assert.equal(entry.m, "deepseek-v4-pro");
  assert.equal(entry.p, "deepseek-official");
  assert.equal(entry.i, 100);
  assert.equal(entry.r, 30);
  assert.equal(entry.o, 20);
  assert.equal(entry.w, 0);
});

test("事件 → 账本记录：回退到 stream 里的 usage", () => {
  const entry = entryOf("s1", {
    type: "assistant/message",
    seq: 2,
    time: 1000,
    data: {
      turn: 1,
      stream: [
        { type: "chunk", chunk: { type: "text", text: "hi" } },
        { type: "chunk", chunk: { type: "usage", usage: { inputTokens: 5, outputTokens: 1 } } },
      ],
      message: { source: { provider: "p", model: "m" } },
    },
  });
  assert.equal(entry.i, 5);
  assert.equal(entry.o, 1);
});

test("没有用量或没有 token 时不计价", () => {
  assert.equal(entryOf("s", { type: "assistant/message", seq: 1, data: {} }), null);
  assert.equal(entryOf("s", { type: "user/message", seq: 1, data: {} }), null);
  assert.equal(
    entryOf("s", {
      type: "assistant/message",
      seq: 1,
      data: { usage: { inputTokens: 0, outputTokens: 0 } },
    }),
    null,
  );
  assert.equal(foldEvents("s", [{ type: "turn/start" }]).length, 0);
});

test("时间分桶：日 / 周 / 月 / 累计，本轮只算最新 turn", () => {
  const now = new Date(2026, 9, 30, 15, 0, 0).getTime(); // 2026-10-30 周五
  const today = startOfDay(now) + 10 * 3600_000;
  const yesterday = today - 24 * 3600_000;
  const monthOnly = startOfMonth(now) + 6 * 3600_000;
  const lastMonth = startOfMonth(now) - 5 * 3600_000;
  const base = { p: "x", m: "test", i: 1_000_000, r: 0, w: 0, o: 0 };
  const entries = [
    { ...base, id: "a#1", s: "a", q: 1, t: today, u: 2 },
    { ...base, id: "a#2", s: "a", q: 2, t: today + 1000, u: 3 },
    { ...base, id: "b#1", s: "b", q: 1, t: yesterday, u: 1 },
    { ...base, id: "c#1", s: "c", q: 1, t: monthOnly, u: 1 },
    { ...base, id: "d#1", s: "d", q: 1, t: lastMonth, u: 1 },
  ];
  assert.ok(startOfWeek(now) <= yesterday);
  // 固定单价，专注验证分桶边界
  const out = summarize(entries, () => ({ input: 1, cacheRead: 0, cacheWrite: 0, output: 0 }), now);
  assert.equal(out.day.cost, 2);
  assert.equal(out.week.cost, 3);
  assert.equal(out.month.cost, 4);
  assert.equal(out.total.cost, 5);
  assert.equal(out.day.calls, 2);
  // 会话 a 的最新 turn 是 3，只统计 u=3 的那条。
  assert.equal(out.turns.a.cost, 1);
  assert.equal(out.turns.a.turn, 3);
  assert.equal(out.turns.b.cost, 1);
  assert.equal(out.turns.a.input, 1_000_000);
});

test("分桶会按调用时刻取高峰/空闲价", () => {
  const now = bj(2026, 10, 30, 10, 0); // 周五 10:00 高峰
  const peakTime = bj(2026, 10, 30, 10, 0);
  const offTime = bj(2026, 10, 30, 22, 0);
  const base = { s: "a", m: "deepseek-flash", i: 1_000_000, r: 0, w: 0, o: 0, u: 1 };
  const entries = [
    { ...base, id: "a#1", q: 1, t: peakTime },
    { ...base, id: "a#2", q: 2, t: offTime },
  ];
  const out = summarize(entries, (model, time) => priceFor(CATALOG, model, time), now);
  assert.equal(out.total.cost, 2 + 1); // 高峰 ¥2 + 空闲 ¥1
});

test("空账本不产生 NaN", () => {
  const out = summarize([], (model, time) => priceFor(CATALOG, model, time), Date.now());
  assert.equal(out.day.cost, 0);
  assert.equal(out.total.calls, 0);
  assert.deepEqual(out.turns, {});
});

test("账号余额：充值 + 赠送，优先 CNY，支持透支", () => {
  const parsed = parseAccountBalance({
    status: "ready",
    value: [{ currency: "CNY", balance: "12.34" }],
    bonusWallets: [{ currency: "CNY", balance: "2.00" }],
  });
  assert.equal(parsed.total, 14.34);
  assert.equal(parsed.toppedUp, 12.34);
  assert.equal(parsed.granted, 2);
  assert.equal(parsed.currency, "CNY");
  assert.equal(parsed.source, "account");
  assert.equal(parseAccountBalance({ status: "failed" }), null);
  assert.equal(parseAccountBalance(null), null);

  const overdrawn = parseAccountBalance({
    status: "ready",
    value: [{ currency: "CNY", balance: "-0.49" }],
    bonusWallets: [],
  });
  assert.equal(overdrawn.total, -0.49);
  assert.equal(overdrawn.toppedUp, -0.49);
});

test("API 余额：解析 balance_infos", () => {
  const parsed = parseApiBalance({
    is_available: true,
    balance_infos: [
      { currency: "USD", total_balance: "1.00", granted_balance: "0", topped_up_balance: "1.00" },
      { currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" },
    ],
  });
  assert.equal(parsed.total, 110);
  assert.equal(parsed.granted, 10);
  assert.equal(parsed.currency, "CNY");
  assert.equal(parsed.available, true);
  assert.equal(parseApiBalance({}), null);
});

test("凭据引用：只收 llm-deepseek* 且合法", () => {
  const refs = collectKeyRefs([
    { ns: "llm-deepseek", value: { apiKeyEnv: "DSH_DEEPSEEK_KEY" } },
    { ns: "llm-deepseek-api-key", value: { apiKeyEnv: "bad-name" } },
    { ns: "llm-pi-ai", value: { apiKeyEnv: "OTHER" } },
  ]);
  assert.equal(refs[0], "DSH_DEEPSEEK_KEY");
  assert.ok(refs.includes("DEEPSEEK_API_KEY"));
  assert.ok(!refs.includes("OTHER"));
  assert.ok(!refs.includes("bad-name"));
});

test("官网汇总：余额 + 账号累计", () => {
  const parsed = parseSummary({
    code: 0,
    msg: "",
    data: {
      biz_code: 0,
      biz_msg: "",
      biz_data: {
        normal_wallets: [{ currency: "CNY", balance: "-0.4944273500000000", token_estimation: "0" }],
        bonus_wallets: [{ currency: "CNY", balance: "0", token_estimation: "0" }],
        total_costs: [{ currency: "CNY", amount: "129.6502765000000000" }],
      },
    },
  });
  assert.equal(parsed.balance.total, -0.49442735);
  assert.equal(parsed.balance.granted, 0);
  assert.equal(parsed.balance.currency, "CNY");
  assert.equal(parsed.totalCost.amount, 129.6502765);
  assert.equal(parsed.totalCost.currency, "CNY");

  const rejected = parseSummary({ data: { biz_code: 1, biz_msg: "INVALID_PARAM", biz_data: null } });
  assert.equal(rejected.balance, null);
  assert.equal(rejected.totalCost, null);
});

test("官网用量：按时间桶汇总金额与模型", () => {
  const payload = {
    data: {
      biz_code: 0,
      biz_data: {
        start: 1790784000,
        end: 1793376000,
        bucket: 86400,
        models: ["deepseek-flash"],
        data: [
          {
            currency: "CNY",
            series: [
              {
                api_key: { tracking_id: "t", name: "first" },
                model: "deepseek-flash",
                buckets: [{ time: 1790784000, cost: "0.0009936000000000" }, { time: 1790870400, cost: "0.0245198200000000" }],
              },
              {
                api_key: { tracking_id: "t", name: "first" },
                model: "deepseek-v4-pro",
                buckets: [{ time: 1790956800, cost: "0.0139215000000000" }],
              },
            ],
            function_series: [],
          },
        ],
      },
    },
  };
  const parsed = parseUsage(payload, "CNY");
  assert.ok(Math.abs(parsed.cost - (0.0009936 + 0.02451982 + 0.0139215)) < 1e-12);
  assert.deepEqual(parsed.models, ["deepseek-flash", "deepseek-v4-pro"]);
  assert.equal(parsed.currency, "CNY");
  assert.equal(parsed.series.length, 2);
  assert.equal(parsed.series[0].buckets.length, 2);
  assert.equal(parsed.series[1].buckets[0].time, 1790956800);
  assert.equal(parseUsage({ data: { biz_code: 1 } }), null);
});

test("时区参数必须是 15 分钟的整数倍且在 ±14 小时内", () => {
  assert.equal(normalizeTimezone(28800), 28800);
  assert.equal(normalizeTimezone(-43200), -43200);
  assert.equal(normalizeTimezone(28801), 0);
  assert.equal(normalizeTimezone(54000), 0);
  assert.equal(normalizeTimezone(NaN), 0);
});

test("Typert codec 可脱离 zod 加载并校验结果", () => {
  assert.equal(TYPERT.invocations.length, 2);
  const parser = TYPERT.invocations[0].result.create();
  const bucket = { cost: 1, input: 2, cacheRead: 3, cacheWrite: 0, output: 4, calls: 5, models: ["m"] };
  const value = {
    fetchedAt: 1,
    refreshMs: 30000,
    currency: "CNY",
    rate: 1,
    balance: { total: 1, toppedUp: 1, granted: 0, currency: "CNY", source: "account" },
    balanceError: null,
    day: bucket,
    week: bucket,
    month: bucket,
    total: bucket,
    turns: { s1: { ...bucket, turn: 2 } },
    scan: { done: true, sessions: 1, events: 2 },
  };
  assert.equal(parser.parse(value), value);
  assert.throws(() => parser.parse({ ...value, fetchedAt: "x" }));
  assert.throws(() => parser.parse({ ...value, balance: { total: 1 } }));
  assert.throws(() => parser.parse({ ...value, day: { ...bucket, cost: Infinity } }));
});

test("模块 id / typert 包名与 package.json 一致（scoped 安装的关键）", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  const typert = readFileSync(new URL("../typert.host.js", import.meta.url), "utf8");
  assert.match(client, new RegExp(`id: "${pkg.name.replace(/[/@]/g, "\\$&")}"`));
  assert.ok(client.includes(`package: "${pkg.name}"`));
  assert.ok(typert.includes(`package: "${pkg.name}"`));
  assert.ok(client.includes(`typeSymbol: "${pkg.name}#DeepSeekCostResult"`));
  assert.ok(typert.includes(`id: \`${pkg.name}#deepseekCost/`));
});

test("客户端：官方路由才显示，金额支持负数", () => {
  const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  assert.match(client, /conversation\.composer\.dock/);
  assert.match(client, /OFFICIAL_PROVIDERS = \["deepseek-official", "deepseek-account"\]/);
  assert.match(client, /if \(!visible\) return null;/);
  assert.match(client, /const sign = value < 0 \? "-" : "";/);
  assert.match(client, /\.dsh-dc-row-value\{text-align:right/);
  assert.match(client, /function bucketValue\(bucket, currency\)/);
  assert.doesNotMatch(client, /@ts-nocheck/);
});

console.log(`\n${passed} passed`);

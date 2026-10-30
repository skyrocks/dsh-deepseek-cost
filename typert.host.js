// Typert Host 清单：声明 deepseekCost/read 与 deepseekCost/refresh 两个 direct 调用。
// 0.2.1 的 strict codec 必须是 `{ mode, typeSymbol, create() }`；缺 create 会让
// gateway 撤回全部 strict 定义。这里不依赖 zod，目录安装也不会缺包。

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function fail(field, expected) {
  throw new Error(`dsh-deepseek-cost result: ${field} must be ${expected}`);
}

function finite(field, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(field, "a finite number");
  return value;
}

function count(field, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(field, "a non-negative number");
  return value;
}

function parseBucket(field, value) {
  if (!isRecord(value)) fail(field, "an object");
  finite(`${field}.cost`, value.cost);
  for (const key of ["input", "cacheRead", "cacheWrite", "output", "calls"]) {
    count(`${field}.${key}`, value[key]);
  }
  if (!Array.isArray(value.models)) fail(`${field}.models`, "an array");
}

function parseBalance(value) {
  if (value === null) return;
  if (!isRecord(value)) fail("balance", "an object or null");
  for (const key of ["total", "toppedUp", "granted"]) finite(`balance.${key}`, value[key]);
  if (typeof value.currency !== "string") fail("balance.currency", "a string");
  if (value.source !== "account" && value.source !== "api-key") fail("balance.source", "account or api-key");
}

/** `create()` 返回的 parser：校验 Host 结果的 wire 形状。 */
function parseResult(value) {
  if (!isRecord(value)) fail("result", "an object");
  finite("fetchedAt", value.fetchedAt);
  finite("refreshMs", value.refreshMs);
  if (typeof value.currency !== "string") fail("currency", "a string");
  finite("rate", value.rate);
  if (value.balanceError !== null && typeof value.balanceError !== "string") {
    fail("balanceError", "a string or null");
  }
  parseBalance(value.balance);
  for (const key of ["day", "week", "month", "total"]) parseBucket(key, value[key]);
  if (!isRecord(value.turns)) fail("turns", "an object");
  for (const [key, turn] of Object.entries(value.turns)) parseBucket(`turns.${key}`, turn);
  if (!isRecord(value.scan)) fail("scan", "an object");
  return value;
}

const resultCodec = {
  mode: "strict",
  typeSymbol: "dsh-deepseek-cost#DeepSeekCostResult",
  create: () => ({ parse: parseResult }),
};

const invocation = (method) => ({
  id: `dsh-deepseek-cost#deepseekCost/${method}`,
  service: "deepseekCost",
  namespace: "deepseekCost",
  method,
  invocation: { kind: "direct" },
  parameters: [],
  result: resultCodec,
});

export const TYPERT = {
  package: "dsh-deepseek-cost",
  face: "host",
  schemas: [],
  invocations: [invocation("read"), invocation("refresh")],
  model: { services: [], events: [], objects: [] },
};

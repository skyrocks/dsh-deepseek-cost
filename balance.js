// 纯函数：余额来源识别与响应解析。
// 两种来源：DSH 登录账号（Platform 钱包）与官方 API Key（/user/balance）。

/** 与 DSH 凭据引用一致的 POSIX shell 标识符。 */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 官方 API Key 的默认环境变量名。 */
export const DEFAULT_KEY_REF = "DEEPSEEK_API_KEY";

/** 默认 DeepSeek 推理端点。 */
export const DEFAULT_BASE_URL = "https://api.deepseek.com";

/**
 * 从 `settings.describe()` 的表单里收集 DeepSeek API Key 的凭据引用。
 * 覆盖 `llm-deepseek` / `llm-deepseek-api-key` 等条目；账号登录路由不含 Key，自然被忽略。
 * @param {unknown[]} forms describe() 结果
 * @returns {string[]} 去重后的引用名，优先默认值
 */
export function collectKeyRefs(forms) {
  const refs = [];
  const push = (value) => {
    if (typeof value === "string" && REF_PATTERN.test(value) && !refs.includes(value)) {
      refs.push(value);
    }
  };
  for (const form of forms ?? []) {
    if (form === null || typeof form !== "object") continue;
    const record = /** @type {Record<string, unknown>} */ (form);
    if (typeof record.ns !== "string" || !record.ns.startsWith("llm-deepseek")) continue;
    const value = record.value;
    if (value === null || typeof value !== "object") continue;
    const config = /** @type {Record<string, unknown>} */ (value);
    push(config.apiKeyEnv);
    if (Array.isArray(config.models)) continue;
  }
  // 默认值放最后：配置里显式写的引用优先。
  push(DEFAULT_KEY_REF);
  return refs;
}

/** 解析一个十进制余额字符串，失败返回 null（Platform 允许 0E-16 这类写法）。 */
export function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 汇总同一货币的钱包数组。 */
function sumWallets(wallets, currency) {
  let total = 0;
  let seen = false;
  for (const wallet of wallets ?? []) {
    if (!wallet || typeof wallet !== "object") continue;
    if (wallet.currency !== currency) continue;
    const amount = parseAmount(wallet.balance);
    if (amount === null) continue;
    total += amount;
    seen = true;
  }
  return seen ? total : null;
}

/** 挑出要展示的货币：优先 CNY，其次 USD，再次第一个出现过的。 */
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

/**
 * 解析 DSH 账号（Platform）的余额结果。
 * `normal_wallets` 是充值余额，`bonus_wallets` 是赠送余额。
 * @param {{value?: unknown, bonusWallets?: unknown}} result account.getBalance() 的返回值
 * @returns {{total: number, toppedUp: number, granted: number, currency: string, source: string}|null}
 */
export function parseAccountBalance(result) {
  if (!result || typeof result !== "object" || result.status !== "ready") return null;
  const normal = Array.isArray(result.value) ? result.value : [];
  const bonus = Array.isArray(result.bonusWallets) ? result.bonusWallets : [];
  const currency = pickCurrency([...normal, ...bonus]);
  if (currency === null) return null;
  const toppedUp = sumWallets(normal, currency) ?? 0;
  const granted = sumWallets(bonus, currency) ?? 0;
  return { total: toppedUp + granted, toppedUp, granted, currency, source: "account" };
}

/**
 * 解析官方 `/user/balance` 的返回体。
 * @param {unknown} body 响应 JSON
 * @returns {{total: number, toppedUp: number, granted: number, currency: string, available: boolean, source: string}|null}
 */
export function parseApiBalance(body) {
  if (body === null || typeof body !== "object") return null;
  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : [];
  const usable = infos.filter(
    (info) =>
      info &&
      typeof info === "object" &&
      parseAmount(info.total_balance) !== null,
  );
  if (usable.length === 0) return null;
  const currency = pickCurrency(usable);
  const info = usable.find((item) => item.currency === currency) ?? usable[0];
  const total = parseAmount(info.total_balance) ?? 0;
  const granted = parseAmount(info.granted_balance) ?? 0;
  const toppedUp = parseAmount(info.topped_up_balance) ?? Math.max(0, total - granted);
  return {
    total,
    granted,
    toppedUp,
    currency: typeof info.currency === "string" ? info.currency : "CNY",
    available: body.is_available === true,
    source: "api-key",
  };
}

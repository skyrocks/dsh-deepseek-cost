// 纯函数：DeepSeek 官方价目表与单次调用费用。
// 价格来自官方文档「模型 & 价格」（人民币 / 每百万 tokens），分高峰与空闲两档：
//   高峰：北京时间 周一至周五 9:00–12:00、14:00–18:00（不含法定节假日）
//   空闲：其余时段（价格为高峰的一半）
// 官方价目表变动后可用插件配置 prices 覆盖，无需改代码。

/** 价格分母：每 100 万 tokens。 */
export const PRICE_PER_TOKENS = 1_000_000;

/** 高峰时段（北京时间，单位：分钟）。 */
const PEAK_WINDOWS = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
];

/** 官方人民币价目表（每 1M tokens）。 */
export const DEFAULT_PRICES = {
  "deepseek-flash": {
    peak: { cacheRead: 0.04, input: 2, output: 8 },
    offPeak: { cacheRead: 0.02, input: 1, output: 4 },
  },
  "deepseek-v4-pro": {
    peak: { cacheRead: 0.3, input: 9, output: 27 },
    offPeak: { cacheRead: 0.15, input: 4.5, output: 13.5 },
  },
};

/** 旧模型名仍可调用，按 Flash 价格计费（官方说明）。 */
const ALIASES = {
  "deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4.1-flash": "deepseek-flash",
  "deepseek-v4-flash-vision-exp": "deepseek-flash",
};

/** 未识别模型按 Flash 空闲价估，避免高估。 */
export const DEFAULT_FALLBACK_PRICE = { cacheRead: 0.02, input: 1, output: 4 };

/**
 * 判断一次调用是否落在高峰时段。
 * 按北京时间（UTC+8，无夏令时）计算；法定节假日无法本地判断，按高峰处理。
 * @param {number} time 调用时间（毫秒时间戳）
 * @returns {boolean} 是否高峰
 */
export function isPeak(time) {
  const beijing = new Date(time + 8 * 3600_000);
  const day = beijing.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  return PEAK_WINDOWS.some(([start, end]) => minutes >= start && minutes < end);
}

/** 规范化一档价格：input/output 必填，缓存两档缺省为 0。 */
export function normalizePrice(value) {
  if (value === null || typeof value !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  const input = Number(record.input);
  const output = Number(record.output);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
  const cacheRead = Number(record.cacheRead ?? 0);
  const cacheWrite = Number(record.cacheWrite ?? 0);
  return {
    input,
    output,
    cacheRead: Number.isFinite(cacheRead) && cacheRead >= 0 ? cacheRead : 0,
    cacheWrite: Number.isFinite(cacheWrite) && cacheWrite >= 0 ? cacheWrite : 0,
  };
}

/** 把一条配置项规范成 { peak, offPeak } 两档；单档写法会同时用于两档。 */
function normalizeTier(value) {
  if (value === null || typeof value !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  if (record.peak !== undefined || record.offPeak !== undefined) {
    const peak = normalizePrice(record.peak) ?? normalizePrice(record.offPeak);
    const offPeak = normalizePrice(record.offPeak) ?? normalizePrice(record.peak);
    return peak === null || offPeak === null ? null : { peak, offPeak };
  }
  const single = normalizePrice(value);
  return single === null ? null : { peak: single, offPeak: single };
}

/**
 * 合并默认表与用户配置。键为小写模型名；`fallback`/`default` 为兜底价。
 * @param {unknown} overrides 配置里的 prices
 * @returns {{table: Record<string, {peak: object, offPeak: object}>, fallback: {peak: object, offPeak: object}}}
 */
export function buildPriceTable(overrides) {
  /** @type {Record<string, {peak: object, offPeak: object}>} */
  const table = {};
  for (const [model, tiers] of Object.entries(DEFAULT_PRICES)) {
    table[model] = { peak: { ...tiers.peak }, offPeak: { ...tiers.offPeak } };
  }
  for (const [alias, target] of Object.entries(ALIASES)) table[alias] = table[target];
  let fallback = { peak: { ...DEFAULT_FALLBACK_PRICE }, offPeak: { ...DEFAULT_FALLBACK_PRICE } };

  if (overrides !== null && typeof overrides === "object" && !Array.isArray(overrides)) {
    for (const [model, raw] of Object.entries(overrides)) {
      const tiers = normalizeTier(raw);
      if (tiers === null) continue;
      const key = String(model).toLowerCase();
      if (key === "fallback" || key === "default") fallback = tiers;
      else table[key] = tiers;
    }
  }
  return { table, fallback };
}

/**
 * 按模型名与调用时刻查价：精确 → 最长前缀 → 兜底，再按高峰/空闲取档。
 * @param {{table: Record<string, object>, fallback: object}} catalog buildPriceTable() 的结果
 * @param {string} model 事件里记录的模型名
 * @param {number} [time] 调用时间，缺省视为高峰（更保守）
 * @returns {object} 该次调用的四档价格
 */
export function priceFor(catalog, model, time) {
  const key = typeof model === "string" ? model.toLowerCase() : "";
  let tiers;
  if (key === "") {
    tiers = catalog.fallback;
  } else {
    tiers = catalog.table[key];
    if (tiers === undefined) {
      let bestKey = "";
      for (const name of Object.keys(catalog.table)) {
        if (key.startsWith(name) && name.length > bestKey.length) bestKey = name;
      }
      tiers = bestKey === "" ? catalog.fallback : catalog.table[bestKey];
    }
  }
  const peak = typeof time === "number" && Number.isFinite(time) ? isPeak(time) : true;
  return peak ? tiers.peak : tiers.offPeak;
}

/** 非负数字化。 */
function toCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 一次调用（或一条账本记录）的费用，单位与价目表一致（人民币）。
 * 缓存写入按未命中价计（DeepSeek 不单列缓存写入价）。
 * @param {{i?: number, r?: number, w?: number, o?: number}} usage 四个 token 桶
 * @param {object} price 该次调用使用的价格
 * @returns {number} 费用
 */
export function costOf(usage, price) {
  const input = toCount(usage && usage.i);
  const cacheRead = toCount(usage && usage.r);
  const cacheWrite = toCount(usage && usage.w);
  const output = toCount(usage && usage.o);
  const cost =
    input * price.input +
    cacheRead * price.cacheRead +
    cacheWrite * (price.cacheWrite || price.input) +
    output * price.output;
  return cost / PRICE_PER_TOKENS;
}

/**
 * 按汇率折算到展示货币。汇率为正数才折算。
 * @param {number} value 价目表货币（人民币）下的金额
 * @param {number} rate 1 人民币 = rate 展示货币
 * @returns {number} 展示货币下的金额
 */
export function convert(value, rate) {
  if (!Number.isFinite(value)) return 0;
  return Number.isFinite(rate) && rate > 0 ? value * rate : value;
}

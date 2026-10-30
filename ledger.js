// 纯函数：把 DSH 的会话事件折叠成「一条 LLM 调用 = 一条账本记录」，
// 并按本地时间的 日 / 周 / 月 / 累计 分桶。
//
// 记录保持极简（单位 tokens），费用在读取时按当前价目表现算：
// 这样调价后历史金额也会跟着变，不必改历史数据。

import { costOf } from "./pricing.js";

/** 本地自然日 0 点。 */
export function startOfDay(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 本周起点（周一 0 点）。 */
export function startOfWeek(time) {
  const date = new Date(startOfDay(time));
  const weekday = (date.getDay() + 6) % 7; // 周一=0 … 周日=6
  date.setDate(date.getDate() - weekday);
  return date.getTime();
}

/** 本月 1 日 0 点。 */
export function startOfMonth(time) {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** 非负整数化，异常值按 0 计。 */
function count(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * 从一条持久化 assistant 消息的 stream 里取最后的 usage 记录。
 * 形状即 DSH 的 `{ type: 'chunk', chunk: { type: 'usage', usage } }`。
 * @param {unknown} stream 事件里的 stream 记录数组
 * @returns {object|undefined} usage
 */
export function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record && record.type === "chunk" && record.chunk && record.chunk.type === "usage") {
      return record.chunk.usage;
    }
  }
  return undefined;
}

/**
 * 把一条 `assistant/message` 事件转成账本记录；没有用量时返回 null。
 * @param {string} sessionId 所属会话
 * @param {object} event 持久化会话事件
 * @returns {object|null} 账本记录
 */
export function entryOf(sessionId, event) {
  if (!event || event.type !== "assistant/message") return null;
  const data = event.data ?? {};
  const usage = data.usage ?? lastStreamUsage(data.stream);
  if (!usage || typeof usage !== "object") return null;
  const input = count(usage.inputTokens);
  const cacheRead = count(usage.cacheReadTokens);
  const cacheWrite = count(usage.cacheWriteTokens);
  const output = count(usage.outputTokens);
  if (input + cacheRead + cacheWrite + output === 0) return null;
  const source = data.message && data.message.source;
  const model = source && typeof source.model === "string" ? source.model : "";
  const provider = source && typeof source.provider === "string" ? source.provider : "";
  return {
    id: `${sessionId}#${event.seq}`,
    s: sessionId,
    q: event.seq,
    t: typeof event.time === "number" && Number.isFinite(event.time) ? event.time : Date.now(),
    u: Number.isInteger(data.turn) ? data.turn : 0,
    p: provider,
    m: model,
    i: input,
    r: cacheRead,
    w: cacheWrite,
    o: output,
  };
}

/**
 * 折叠一批事件，只取其中可计价的 assistant 消息。
 * @param {string} sessionId 所属会话
 * @param {Iterable<object>} events 事件序列
 * @returns {object[]} 账本记录
 */
export function foldEvents(sessionId, events) {
  const out = [];
  for (const event of events ?? []) {
    const entry = entryOf(sessionId, event);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** 一个空桶。 */
function emptyBucket() {
  return { cost: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, models: [] };
}

/** 把一条记录累加进桶里。 */
function accumulate(bucket, entry, cost) {
  bucket.cost += cost;
  bucket.input += entry.i;
  bucket.cacheRead += entry.r;
  bucket.cacheWrite += entry.w;
  bucket.output += entry.o;
  bucket.calls += 1;
  if (entry.m !== "" && !bucket.models.includes(entry.m)) bucket.models.push(entry.m);
}

/**
 * 按本地时间分桶汇总。
 * `turns` 是「每个会话最近一轮」的金额，客户端按自己的 sessionId 取用。
 * @param {Iterable<object>} entries 账本记录
 * @param {(model: string) => object} priceOf 模型查价函数
 * @param {number} [now] 参考时间
 * @returns {{day: object, week: object, month: object, total: object, turns: Record<string, object>}}
 */
export function summarize(entries, priceOf, now = Date.now()) {
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const list = entries instanceof Map ? [...entries.values()] : [...(entries ?? [])];

  const maxTurn = new Map();
  for (const entry of list) {
    const current = maxTurn.get(entry.s);
    if (current === undefined || entry.u > current) maxTurn.set(entry.s, entry.u);
  }

  const day = emptyBucket();
  const week = emptyBucket();
  const month = emptyBucket();
  const total = emptyBucket();
  /** @type {Map<string, object>} */
  const turns = new Map();

  for (const entry of list) {
    const cost = costOf(entry, priceOf(entry.m, entry.t));
    accumulate(total, entry, cost);
    if (entry.t >= monthStart) accumulate(month, entry, cost);
    if (entry.t >= weekStart) accumulate(week, entry, cost);
    if (entry.t >= dayStart) accumulate(day, entry, cost);
    if (entry.u === maxTurn.get(entry.s)) {
      let turn = turns.get(entry.s);
      if (turn === undefined) {
        turn = { ...emptyBucket(), turn: entry.u };
        turns.set(entry.s, turn);
      }
      accumulate(turn, entry, cost);
    }
  }

  const plain = {};
  for (const [sessionId, turn] of turns) plain[sessionId] = turn;
  return { day, week, month, total, turns: plain };
}

/** 只保留 [from, to] 之间的记录，用于裁剪过旧数据。 */
export function keepAfter(entries, from) {
  const out = [];
  for (const entry of entries) if (entry.t >= from) out.push(entry);
  return out;
}

/**
 * lib.ts — 后端业务纯函数（与前端 web/src/utils/date.ts 语义保持一致）
 *
 * 处理：
 *   · 重复事件推进（weekly / monthly / yearly + repeat_interval + repeat_end）
 *   · tags 清洗（split(',' ) → trim → 去空 → 去重 → join(',')）
 *   · 日期合法性 / 解析辅助
 *
 * 注意：业务日期一律 YYYY-MM-DD（本地日期），与 schema / 前端约定一致；
 *       updated_at 用 ISO/UTC 时间戳（LWW 判据）。
 */

/** 补零到 2 位 */
function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 本地 Date → YYYY-MM-DD */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 字符串是否为合法 YYYY-MM-DD */
export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(parseInt(s.slice(0, 4), 10), parseInt(s.slice(5, 7), 10) - 1, parseInt(s.slice(8, 10), 10));
  return (
    d.getFullYear() === parseInt(s.slice(0, 4), 10) &&
    d.getMonth() === parseInt(s.slice(5, 7), 10) - 1 &&
    d.getDate() === parseInt(s.slice(8, 10), 10)
  );
}

/** YYYY-MM-DD → 本地 Date（当天 00:00） */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d);
}

/** target - today 的整天差（round 防 DST 毫秒误差） */
export function daysUntil(targetDate: string, today: string): number {
  if (!isValidDateStr(targetDate) || !isValidDateStr(today)) return 0;
  return Math.round((parseDate(targetDate).getTime() - parseDate(today).getTime()) / 86400000);
}

/**
 * 按月推进：每月 +steps 个月；若该月无对应日取当月最后一天。
 * anchorDay 用于保留「起始日号」（如从 1/31 开始，跨 2 月后回到有 31 号的月份仍为 31）。
 */
export function advanceMonth(dateStr: string, steps = 1, anchorDay?: number): string {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  const anchor = anchorDay && anchorDay > 0 ? anchorDay : d;
  let y2 = y;
  let m2 = m + steps;
  while (m2 > 12) { m2 -= 12; y2 += 1; }
  while (m2 < 1) { m2 += 12; y2 -= 1; }
  const lastDay = new Date(y2, m2, 0).getDate();
  const day = Math.min(anchor, lastDay);
  return `${y2}-${pad(m2)}-${pad(day)}`;
}

/** 按年推进 steps 年：2/29 遇平年取 2/28 */
export function advanceYear(dateStr: string, steps = 1): string {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  const y2 = y + steps;
  let dd = d;
  if (m === 2 && d === 29) {
    const leap = (y2 % 4 === 0 && y2 % 100 !== 0) || y2 % 400 === 0;
    if (!leap) dd = 28;
  }
  return `${y2}-${pad(m)}-${pad(dd)}`;
}

/** 按周推进：+7 天 × steps */
export function advanceWeek(dateStr: string, steps = 1): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + 7 * steps);
  return formatDate(d);
}

/** 通用重复推进一次：按 repeat_type + repeat_interval */
export function advanceRepeat(dateStr: string, repeatType: string, interval = 1, anchorDay?: number): string {
  const steps = Math.max(1, Math.floor(interval || 1));
  switch (repeatType) {
    case 'weekly': return advanceWeek(dateStr, steps);
    case 'monthly': return advanceMonth(dateStr, steps, anchorDay);
    case 'yearly': return advanceYear(dateStr, steps);
    default: return dateStr; // 不重复 → 不推进
  }
}

/**
 * 计算「下一次触发日」——从 target_date 持续推进直到 >= today。
 * 返回最新触发日（>= today）；若推进超过 repeat_end 则返回 null（重复已终止）。
 * 语义与前端 nextTriggerDate 完全一致。
 */
export function nextTriggerDate(
  targetDate: string,
  repeatType: string,
  interval: number,
  repeatEnd: string | null | undefined,
  today?: string,
): string | null {
  const todayStr = today ?? formatDate(new Date());
  if (repeatType === '' || !repeatType) return targetDate;

  let current = targetDate;
  const anchorDay = parseInt(targetDate.split('-')[2], 10);
  if (repeatEnd && isValidDateStr(repeatEnd) && current > repeatEnd) return null;

  // 防死循环上限
  for (let i = 0; i < 10000; i++) {
    if (daysUntil(current, todayStr) >= 0) break; // current >= today
    const next = advanceRepeat(current, repeatType, interval, anchorDay);
    if (next === current) break;
    if (repeatEnd && isValidDateStr(repeatEnd) && next > repeatEnd) return null;
    current = next;
  }
  return current;
}

/** tags 清洗：split(',') → trim → 去空 → 去重 → join(',') */
export function cleanTags(tagsRaw?: string | null | unknown): string {
  // 防御：非字符串/空值一律视为空标签（避免请求体传来数字/对象导致 split 抛错）
  if (typeof tagsRaw !== 'string' || !tagsRaw) return '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of tagsRaw.split(',')) {
    const t = part.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.join(',');
}

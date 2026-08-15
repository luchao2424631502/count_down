/**
 * utils/date.ts —— 日期核心纯函数
 *
 * 全部基于「本地日期」「YYYY-MM-DD」字符串表示，避免时区/UTC 坑。
 * 移动端 99% 使用场景均为本地日期；同步使用 ISO/UTC 时间戳（updated_at），
 * 而业务日期字段 target_date / end_date 一律 YYYY-MM-DD（本地）。
 */

import type { Reminder } from '@/types';

/** 补零到 2 位 */
function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 本地 Date → YYYY-MM-DD */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date → ISO YYYY-MM-DDTHH:mm:ss.sssZ（UTC，供 updated_at 用） */
export function nowIso(): string {
  return new Date().toISOString();
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

/** YYYY-MM-DD → 本地 Date（当天的 00:00） */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d);
}

/**
 * 计算「距目标日 X 天」。
 * 约定（与 schema/DATA_MODEL 一致）：
 *   · direction=1（倒数/未来）：target 在本日之后 → 正天数；target == 今天 → 0；已过 →
 *     按 direction 语义返回负数（到了就等于 0，过了则为负）。
 *   · direction=-1（正数/已过）：已经历过去多少天，恒为非负（0=今天，正数=已过 N 天）。
 *
 * 返回带符号天数；调用方用 abs/方向渲染展示文案。
 */
export function daysUntil(targetDate: string, today?: string): number {
  const todayStr = today ?? formatDate(new Date());
  if (!isValidDateStr(targetDate) || !isValidDateStr(todayStr)) return 0;
  const t = parseDate(targetDate);
  const n = parseDate(todayStr);
  // 以整日差（除以 86400000 并四舍五入）避免 DST 毫秒误差
  const diff = Math.round((t.getTime() - n.getTime()) / 86400000);
  return diff;
}

/**
 * 渲染展示天数。
 * direction=1（倒数）：未来显示 `还有 X 天`，今天=0，已过=X（负值取绝对值）。
 * direction=-1（正数）：显示 `已过 X 天`，今天=0。
 * 返回整数字符串（对外纯字符串，便于测试）。
 */
export function dayText(targetDate: string, direction: 1 | -1, today?: string): string {
  const raw = daysUntil(targetDate, today);
  if (direction === -1) {
    // 正数场景：显示已经历/距今天数。已过目标 → 绝对值；今天 → 0；
    // 若误配为未来目标，也显示其距今天数（正值取原值）。
    return String(raw < 0 ? -raw : raw);
  }
  // 倒数场景
  if (raw >= 0) return String(raw);
  return String(Math.abs(raw));
}

/**
 * 按月推进：每月 +1 月；若该月无对应日取当月最后一天。
 * anchorDay 用于保留「起始日号」（如从 1/31 开始，跨 2 月后回到有 31 号的月份仍为 31 号）。
 */
export function advanceMonth(dateStr: string, steps = 1, anchorDay?: number): string {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  const anchor = anchorDay && anchorDay > 0 ? anchorDay : d;
  let y2 = y;
  let m2 = m + steps; // m 为 1-based
  while (m2 > 12) {
    m2 -= 12;
    y2 += 1;
  }
  while (m2 < 1) {
    m2 += 12;
    y2 -= 1;
  }
  const lastDay = new Date(y2, m2, 0).getDate(); // m2 当月最后一天
  const day = Math.min(anchor, lastDay);
  return `${y2}-${pad(m2)}-${pad(day)}`;
}

/**
 * 按年推进 repeat_interval 次：2/29 遇平年取 2/28。
 */
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

/** 加减 N 天（N 为天数，可负） */
export function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

/**
 * 通用重复推进：按 repeat_type + repeat_interval 推进一次。
 * anchorDay：monthly 的起始日号锚点（保留 31 号这类对应日）。
 * 返回下一次触发日 YYYY-MM-DD。
 */
export function advanceRepeat(
  dateStr: string,
  repeatType: string,
  interval = 1,
  anchorDay?: number,
): string {
  const steps = Math.max(1, Math.floor(interval || 1));
  switch (repeatType) {
    case 'weekly':
      return advanceWeek(dateStr, steps);
    case 'monthly':
      return advanceMonth(dateStr, steps, anchorDay);
    case 'yearly':
      return advanceYear(dateStr, steps);
    default:
      return dateStr; // 不重复 → 不推进
  }
}

/**
 * 计算「下一次触发日应在哪天」——从给定 target_date 开始，持续推进直到 >= today。
 * 返回推进后的最新触发日（不会早于 today）。
 * 若推进超过 repeat_end 则返回 null（重复已终止，不再有下一次）。
 */
export function nextTriggerDate(
  targetDate: string,
  repeatType: string,
  interval: number,
  repeatEnd: string | null | undefined,
  today?: string,
): string | null {
  const todayStr = today ?? formatDate(new Date());
  if (repeatType === '' || !repeatType) {
    // 不重复：直接返回原目标日
    return targetDate;
  }
  let current = targetDate;
  const anchorDay = parseInt(targetDate.split('-')[2], 10);
  // 防止死循环：限制推进次数（比如 10000 次，超出视为异常返回 null）
  for (let i = 0; i < 10000; i++) {
    if (daysUntil(current, todayStr) >= 0) break; // current >= today
    const next = advanceRepeat(current, repeatType, interval, anchorDay);
    if (next === current) break; // 无推进
    current = next;
  }
  // 若推进后的日期已经超出重复终止日（且终止日存在），则终止
  if (repeatEnd && isValidDateStr(repeatEnd) && current > repeatEnd) {
    return null;
  }
  return current;
}

/** 解析 remind_days JSON 字符串为数字数组（清洗非法值） */
export function parseRemindDays(remindDays?: string | null): number[] {
  if (!remindDays) return [];
  try {
    const arr = JSON.parse(remindDays);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => parseInt(x, 10))
      .filter((x) => Number.isFinite(x) && x >= 0)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * 提醒判定：给定 target_date（触发日）、remind_days、today，
 * 返回今天应触发的提醒天数列表（提前 N 天）。
 * 判定规则：对每个 N，若 目标日 - N 天 == 今天，则触发。
 */
export function dueReminders(
  targetDate: string,
  remindDays?: string | null,
  today?: string,
): Reminder[] {
  const todayStr = today ?? formatDate(new Date());
  const days = parseRemindDays(remindDays);
  if (days.length === 0 || !isValidDateStr(targetDate)) return [];
  return days
    .map((n) => ({ daysBefore: n, remindOn: addDays(targetDate, -n) }))
    .filter((r) => r.remindOn === todayStr);
}

/**
 * tags 字符串清洗：split(',') → trim → 去空 → 去重 → join(',')。
 * DATA_MODEL §5.3 约定，前端展示/编辑与后端入库共用同一规则。
 */
export function cleanTags(tagsRaw?: string | null): string {
  if (!tagsRaw) return '';
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

/** tags 字符串 → 数组（用于展示） */
export function tagsToArray(tags?: string | null): string[] {
  return cleanTags(tags) ? cleanTags(tags).split(',') : [];
}

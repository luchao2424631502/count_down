/**
 * advance.ts — 后端侧重复事件自动推进
 *
 * 阅读 countdown 前，若重复事件（weekly/monthly/yearly）的 target_date（下一次触发日）
 * 已早于今天，则按重复规则持续推进到下一次（尊重 repeat_end：到达终止则不再推进，
 * 事件按 Repeat 停用）。推进使用服务端当前时间做判据，并把推进结果持久化
 * （刷新 updated_at 以便 LWW 同步到客户端）。
 *
 * 规则（与 schema 顶部【重复事件语义约定】及前端 nextTriggerDate 一致）：
 *   · monthly : 逐月 +interval 月；无对应日取当月最后一天
 *   · yearly  : 逐年 +interval 年；2/29 遇平年取 2/28
 *   · weekly  : 逐周 +7×interval 天
 *   · 推进超过 repeat_end → 事件终止，不再推进（target_date 保持，交给客户端按终止显示）
 */
import db from './db.js';
import { nextTriggerDate, formatDate } from './lib.js';
import type { CountdownRow } from './repo.js';
import { COUNTDOWN_COLUMNS } from './repo.js';

/**
 * 对给定行计算并持久化推进后的 target_date。
 * 返回 { row, advanced }：advanced=true 表示发生了推进并已写库。
 */
export function advanceRow(row: CountdownRow): { row: CountdownRow; advanced: boolean } {
  if (!row.repeat_type || row.is_deleted) return { row, advanced: false };
  const next = nextTriggerDate(
    row.target_date,
    row.repeat_type,
    row.repeat_interval,
    row.repeat_end,
    formatDate(new Date()),
  );
  // 若重复已终止（next===null）或无需推进，原样返回，不改 updated_at
  if (next === null || next === row.target_date) return { row, advanced: false };

  const updated: CountdownRow = { ...row, target_date: next, updated_at: new Date().toISOString() };
  const cols: Record<string, unknown> = { ...updated };
  // 仅更新业务列 + updated_at
  db.prepare(
    `UPDATE countdowns SET
       title=@title, note=@note, target_date=@target_date, direction=@direction,
       category_id=@category_id, tags=@tags, repeat_type=@repeat_type,
       repeat_interval=@repeat_interval, repeat_end=@repeat_end, pinned=@pinned,
       sort_order=@sort_order, remind_days=@remind_days, last_notified=@last_notified,
       notify_channel=@notify_channel, is_deleted=@is_deleted, updated_at=@updated_at
     WHERE id=@id`
  ).run(cols);
  return { row: updated, advanced: true };
}

/**
 * 推进所有到期的重复事件并持久化。返回被推进的行（含新 updated_at），
 * 供调用方合并进响应。
 */
export function advanceAllDue(): CountdownRow[] {
  const rows = db.prepare(`SELECT * FROM countdowns WHERE is_deleted = 0 AND repeat_type IS NOT NULL AND repeat_type != ''`).all() as CountdownRow[];
  const advanced: CountdownRow[] = [];
  for (const row of rows) {
    const { row: upd, advanced: changed } = advanceRow(row);
    if (changed) advanced.push(upd);
  }
  return advanced;
}

/** 幂等 upsert 快照辅助（sync 用）：无需在此重复实现，直接用 repo。 */
export { COUNTDOWN_COLUMNS };

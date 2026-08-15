/**
 * repo.ts — 数据库访问层（countdowns / categories 的 CRUD 基础封装）
 *
 * 采用全量 LWW / 软删除模型，所有写操作统一：
 *   · countdowns 写库前清洗 tags（cleanTags）
 *   · 写入的 updated_at 由调用方传入（客户端或服务端），后端不擅自覆盖
 * 对外返回「完整行对象」，供 REST 路由与 sync 复用。
 */
import db from './db.js';
import { cleanTags } from './lib.js';

/* ----------------------------- countdowns ----------------------------- */

export interface CountdownRow {
  id: string;
  title: string;
  note: string | null;
  target_date: string;
  direction: number;
  category_id: string | null;
  tags: string | null;
  repeat_type: string | null;
  repeat_interval: number;
  repeat_end: string | null;
  pinned: number;
  sort_order: number;
  remind_days: string | null;
  last_notified: string | null;
  notify_channel: string;
  is_deleted: number;
  updated_at: string;
  created_at: string;
}

export interface CountdownCols {
  title: string;
  note: string | null;
  target_date: string;
  direction: number;
  category_id: string | null;
  tags: string | null;
  repeat_type: string | null;
  repeat_interval: number;
  repeat_end: string | null;
  pinned: number;
  sort_order: number;
  remind_days: string | null;
  last_notified: string | null;
  notify_channel: string;
}

export const COUNTDOWN_COLUMNS: (keyof CountdownRow)[] = [
  'id', 'title', 'note', 'target_date', 'direction', 'category_id', 'tags',
  'repeat_type', 'repeat_interval', 'repeat_end', 'pinned', 'sort_order',
  'remind_days', 'last_notified', 'notify_channel', 'is_deleted', 'updated_at', 'created_at',
];

export function getCountdownById(id: string): CountdownRow | undefined {
  return db.prepare<[string], CountdownRow>(`SELECT * FROM countdowns WHERE id = ?`).get(id);
}

/** 取全部（含软删）—— 供 sync / refresh 的 LWW 合并使用 */
export function getAllCountdowns(): CountdownRow[] {
  return db.prepare(`SELECT * FROM countdowns`).all() as CountdownRow[];
}

/** 列表查询（展示用，含软删过滤 + 排序：pinned 优先 + sort_order + updated_at） */
export function listCountdowns(): CountdownRow[] {
  return db
    .prepare(
      `SELECT * FROM countdowns
       WHERE is_deleted = 0
       ORDER BY pinned DESC, sort_order ASC, updated_at DESC`
    )
    .all() as CountdownRow[];
}

/** 从请求体剥离出可写业务列（兼容前端 CountdownInput；缺失字段交给调用方默认值） */
export function pickCountdownCols(body: Record<string, unknown> | undefined): Partial<CountdownCols> {
  const b = body ?? {};
  const out: Partial<CountdownCols> = {};
  // 注意：可空字段（note/category_id/tags/repeat_end/remind_days/last_notified）用
  // `!== undefined` 判断，以便前端显式传 null 时能真正清空字段（而非保留旧值）。
  if (b.title !== undefined) out.title = b.title == null ? '' : String(b.title);
  if (b.note !== undefined) out.note = b.note == null ? null : String(b.note);
  if (b.target_date !== undefined) out.target_date = b.target_date == null ? '' : String(b.target_date);
  if (b.direction !== undefined) out.direction = Number(b.direction) === -1 ? -1 : 1;
  if (b.category_id !== undefined) out.category_id = b.category_id == null ? null : String(b.category_id);
  if (b.tags !== undefined) out.tags = cleanTags(b.tags as string | null);
  if (b.repeat_type !== undefined) out.repeat_type = b.repeat_type == null ? null : String(b.repeat_type);
  if (b.repeat_interval !== undefined) out.repeat_interval = Math.max(1, Math.floor(Number(b.repeat_interval) || 1));
  if (b.repeat_end !== undefined) out.repeat_end = b.repeat_end == null ? null : String(b.repeat_end);
  if (b.pinned !== undefined) out.pinned = b.pinned ? 1 : 0;
  if (b.sort_order !== undefined) out.sort_order = Math.floor(Number(b.sort_order) || 0);
  if (b.remind_days !== undefined) out.remind_days = b.remind_days == null ? null : String(b.remind_days);
  if (b.last_notified !== undefined) out.last_notified = b.last_notified == null ? null : String(b.last_notified);
  if (b.notify_channel !== undefined) out.notify_channel = b.notify_channel == null ? 'app' : String(b.notify_channel);
  return out;
}

const COUNTDOWN_INSERT_SQL = `INSERT OR REPLACE INTO countdowns
  (id, title, note, target_date, direction, category_id, tags,
   repeat_type, repeat_interval, repeat_end, pinned, sort_order,
   remind_days, last_notified, notify_channel, is_deleted, updated_at, created_at)
  VALUES
  (@id, @title, @note, @target_date, @direction, @category_id, @tags,
   @repeat_type, @repeat_interval, @repeat_end, @pinned, @sort_order,
   @remind_days, @last_notified, @notify_channel, @is_deleted, @updated_at, @created_at)`;

export function insertCountdown(row: CountdownRow): CountdownRow {
  db.prepare(COUNTDOWN_INSERT_SQL).run({ ...row, tags: cleanTags(row.tags) });
  return row;
}

/** 新增（is_deleted=0），返回完整行。id/时间戳由调用方决定；缺失业务列给默认值。 */
export function createCountdown(
  cols: Partial<CountdownCols> | undefined,
  opts: { id?: string; updated_at?: string; now?: string } = {},
): CountdownRow {
  const now = opts.now ?? new Date().toISOString();
  const c: CountdownCols = {
    title: cols?.title ?? '',
    note: cols?.note ?? null,
    target_date: cols?.target_date ?? '',
    direction: cols?.direction ?? 1,
    category_id: cols?.category_id ?? null,
    tags: cleanTags(cols?.tags ?? null),
    repeat_type: cols?.repeat_type ?? null,
    repeat_interval: cols?.repeat_interval ?? 1,
    repeat_end: cols?.repeat_end ?? null,
    pinned: cols?.pinned ?? 0,
    sort_order: cols?.sort_order ?? 0,
    remind_days: cols?.remind_days ?? null,
    last_notified: cols?.last_notified ?? null,
    notify_channel: cols?.notify_channel ?? 'app',
  };
  const row: CountdownRow = {
    id: opts.id ?? '',
    ...c,
    is_deleted: 0,
    updated_at: opts.updated_at ?? now,
    created_at: now,
  };
  return insertCountdown(row);
}

/** 更新可写列（保留 is_deleted / id / created_at），返回更新后的完整行。 */
export function updateCountdown(
  existing: CountdownRow,
  cols: Partial<CountdownCols>,
  updatedAt: string,
): CountdownRow {
  const merged: CountdownRow = {
    ...existing,
    title: cols.title ?? existing.title,
    note: cols.note !== undefined ? cols.note : existing.note,
    target_date: cols.target_date ?? existing.target_date,
    direction: cols.direction ?? existing.direction,
    category_id: cols.category_id !== undefined ? cols.category_id : existing.category_id,
    tags: cols.tags !== undefined ? cleanTags(cols.tags) : existing.tags,
    repeat_type: cols.repeat_type !== undefined ? cols.repeat_type : existing.repeat_type,
    repeat_interval: cols.repeat_interval ?? existing.repeat_interval,
    repeat_end: cols.repeat_end !== undefined ? cols.repeat_end : existing.repeat_end,
    pinned: cols.pinned ?? existing.pinned,
    sort_order: cols.sort_order ?? existing.sort_order,
    remind_days: cols.remind_days !== undefined ? cols.remind_days : existing.remind_days,
    last_notified: cols.last_notified !== undefined ? cols.last_notified : existing.last_notified,
    notify_channel: cols.notify_channel ?? existing.notify_channel,
    updated_at: updatedAt,
  };
  db.prepare(
    `UPDATE countdowns SET
       title=@title, note=@note, target_date=@target_date, direction=@direction,
       category_id=@category_id, tags=@tags, repeat_type=@repeat_type,
       repeat_interval=@repeat_interval, repeat_end=@repeat_end, pinned=@pinned,
       sort_order=@sort_order, remind_days=@remind_days, last_notified=@last_notified,
       notify_channel=@notify_channel, updated_at=@updated_at
     WHERE id=@id`
  ).run({ ...merged });
  return merged;
}

/** 软删除：is_deleted=1 + 刷新 updated_at。返回更新后的行。 */
export function softDeleteCountdown(existing: CountdownRow, updatedAt: string): CountdownRow {
  db.prepare(`UPDATE countdowns SET is_deleted = 1, updated_at = ? WHERE id = ?`).run(updatedAt, existing.id);
  return { ...existing, is_deleted: 1, updated_at: updatedAt };
}

/** 幂等 upsert（sync 用）：按主键整体覆盖（含 is_deleted、updated_at、created_at 原样保留） */
export function upsertCountdown(row: CountdownRow): CountdownRow {
  db.prepare(COUNTDOWN_INSERT_SQL).run({ ...row, tags: cleanTags(row.tags) });
  return row;
}

/* ----------------------------- categories ----------------------------- */

export interface CategoryRow {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  is_deleted: number;
  updated_at: string;
  created_at: string;
}

export const CATEGORY_COLUMNS: (keyof CategoryRow)[] = [
  'id', 'name', 'color', 'sort_order', 'is_deleted', 'updated_at', 'created_at',
];

export function getCategoryById(id: string): CategoryRow | undefined {
  return db.prepare<[string], CategoryRow>(`SELECT * FROM categories WHERE id = ?`).get(id);
}

export function getAllCategories(): CategoryRow[] {
  return db.prepare(`SELECT * FROM categories`).all() as CategoryRow[];
}

export function listCategories(): CategoryRow[] {
  return db
    .prepare(`SELECT * FROM categories WHERE is_deleted = 0 ORDER BY sort_order ASC, updated_at DESC`)
    .all() as CategoryRow[];
}

export function createCategory(cols: { name: string; color?: string | null; sort_order?: number }, opts: { id?: string; now?: string } = {}): CategoryRow {
  const now = opts.now ?? new Date().toISOString();
  const row: CategoryRow = {
    id: opts.id ?? '',
    name: cols.name,
    color: cols.color ?? null,
    sort_order: cols.sort_order ?? 0,
    is_deleted: 0,
    updated_at: now,
    created_at: now,
  };
  db.prepare(
    `INSERT INTO categories (id, name, color, sort_order, is_deleted, updated_at, created_at)
     VALUES (@id, @name, @color, @sort_order, 0, @updated_at, @created_at)`
  ).run(row);
  return row;
}

export function updateCategory(existing: CategoryRow, cols: { name?: string; color?: string | null; sort_order?: number }, updatedAt: string): CategoryRow {
  const merged: CategoryRow = {
    ...existing,
    name: cols.name ?? existing.name,
    color: cols.color !== undefined ? cols.color : existing.color,
    sort_order: cols.sort_order ?? existing.sort_order,
    updated_at: updatedAt,
  };
  db.prepare(
    `UPDATE categories SET name=@name, color=@color, sort_order=@sort_order, updated_at=@updated_at WHERE id=@id`
  ).run(merged);
  return merged;
}

export function softDeleteCategory(existing: CategoryRow, updatedAt: string): CategoryRow {
  db.prepare(`UPDATE categories SET is_deleted = 1, updated_at = ? WHERE id = ?`).run(updatedAt, existing.id);
  return { ...existing, is_deleted: 1, updated_at: updatedAt };
}

export function upsertCategory(row: CategoryRow): CategoryRow {
  db.prepare(
    `INSERT OR REPLACE INTO categories (id, name, color, sort_order, is_deleted, updated_at, created_at)
     VALUES (@id, @name, @color, @sort_order, @is_deleted, @updated_at, @created_at)`
  ).run(row);
  return row;
}

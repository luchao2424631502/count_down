/**
 * routes/countdowns.ts — 倒计时条目 CRUD 路由骨架
 *
 * - GET    /api/countdowns        列出（is_deleted=0，置顶/排序优先）
 * - GET    /api/countdowns/:id    单条
 * - POST   /api/countdowns        新建
 * - PUT    /api/countdowns/:id    更新（含 updated_at 刷新）
 * - DELETE /api/countdowns/:id    软删除（is_deleted=1）
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db.js';

interface CountdownRow {
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

export const router = Router();

// GET / —— 列出未删除条目
router.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM countdowns
       WHERE is_deleted = 0
       ORDER BY pinned DESC, sort_order ASC, created_at DESC`
    )
    .all() as CountdownRow[];
  res.json(rows);
});

// GET /:id —— 单条
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM countdowns WHERE id = ? AND is_deleted = 0`).get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  res.json(row);
});

// POST / —— 新建
router.post('/', (req, res) => {
  const now = new Date().toISOString();
  const {
    id = randomUUID(),
    title,
    note = null,
    target_date,
    direction = 1,
    category_id = null,
    tags = null,
    repeat_type = null,
    repeat_interval = 1,
    repeat_end = null,
    pinned = 0,
    sort_order = 0,
    remind_days = null,
    last_notified = null,
    notify_channel = 'app',
  } = req.body ?? {};

  if (!title || !target_date) {
    res.status(400).json({ error: 'title 与 target_date 必填' });
    return;
  }

  const stmt = db.prepare(
    `INSERT INTO countdowns
     (id, title, note, target_date, direction, category_id, tags,
      repeat_type, repeat_interval, repeat_end, pinned, sort_order,
      remind_days, last_notified, notify_channel, is_deleted, updated_at, created_at)
     VALUES
     (@id, @title, @note, @target_date, @direction, @category_id, @tags,
      @repeat_type, @repeat_interval, @repeat_end, @pinned, @sort_order,
      @remind_days, @last_notified, @notify_channel, 0, @updated_at, @created_at)`
  );
  stmt.run({
    id, title, note, target_date, direction, category_id, tags,
    repeat_type, repeat_interval, repeat_end, pinned, sort_order,
    remind_days, last_notified, notify_channel,
    updated_at: now, created_at: now,
  });

  res.status(201).json({ id, updated_at: now });
});

// PUT /:id —— 更新
router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM countdowns WHERE id = ? AND is_deleted = 0`).get(req.params.id) as
    | CountdownRow
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }

  const now = new Date().toISOString();
  const body = req.body ?? {};
  const merged: Record<string, unknown> = {
    title: body.title ?? existing.title,
    note: body.note ?? existing.note,
    target_date: body.target_date ?? existing.target_date,
    direction: body.direction ?? existing.direction,
    category_id: body.category_id ?? existing.category_id,
    tags: body.tags ?? existing.tags,
    repeat_type: body.repeat_type ?? existing.repeat_type,
    repeat_interval: body.repeat_interval ?? existing.repeat_interval,
    repeat_end: body.repeat_end ?? existing.repeat_end,
    pinned: body.pinned ?? existing.pinned,
    sort_order: body.sort_order ?? existing.sort_order,
    remind_days: body.remind_days ?? existing.remind_days,
    last_notified: body.last_notified ?? existing.last_notified,
    notify_channel: body.notify_channel ?? existing.notify_channel,
  };

  db.prepare(
    `UPDATE countdowns SET
       title=@title, note=@note, target_date=@target_date, direction=@direction,
       category_id=@category_id, tags=@tags, repeat_type=@repeat_type,
       repeat_interval=@repeat_interval, repeat_end=@repeat_end, pinned=@pinned,
       sort_order=@sort_order, remind_days=@remind_days, last_notified=@last_notified,
       notify_channel=@notify_channel, updated_at=@updated_at
     WHERE id=@id`
  ).run({ id: existing.id, ...merged, updated_at: now });

  res.json({ id: existing.id, updated_at: now });
});

// DELETE /:id —— 软删除
router.delete('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM countdowns WHERE id = ?`).get(req.params.id) as
    | CountdownRow
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE countdowns SET is_deleted = 1, updated_at = ? WHERE id = ?`).run(now, req.params.id);
  res.json({ id: existing.id, is_deleted: 1, updated_at: now });
});

export default router;

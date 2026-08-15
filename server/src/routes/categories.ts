/**
 * routes/categories.ts — 分类 CRUD 路由骨架
 *
 * - GET    /api/categories     列出（is_deleted=0）
 * - GET    /api/categories/:id 单条
 * - POST   /api/categories     新建
 * - PUT    /api/categories/:id 更新
 * - DELETE /api/categories/:id 软删除（is_deleted=1）
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db.js';

interface CategoryRow {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  is_deleted: number;
  updated_at: string;
  created_at: string;
}

export const router = Router();

// GET / —— 列出未删除分类
router.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM categories WHERE is_deleted = 0 ORDER BY sort_order ASC, created_at ASC`
    )
    .all() as CategoryRow[];
  res.json(rows);
});

// GET /:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM categories WHERE id = ? AND is_deleted = 0`).get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  res.json(row);
});

// POST /
router.post('/', (req, res) => {
  const now = new Date().toISOString();
  const { id = randomUUID(), name, color = null, sort_order = 0 } = req.body ?? {};
  if (!name) {
    res.status(400).json({ error: 'name 必填' });
    return;
  }
  db.prepare(
    `INSERT INTO categories (id, name, color, sort_order, is_deleted, updated_at, created_at)
     VALUES (@id, @name, @color, @sort_order, 0, @updated_at, @created_at)`
  ).run({ id, name, color, sort_order, updated_at: now, created_at: now });
  res.status(201).json({ id, updated_at: now });
});

// PUT /:id
router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM categories WHERE id = ? AND is_deleted = 0`).get(req.params.id) as
    | CategoryRow
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  const now = new Date().toISOString();
  const body = req.body ?? {};
  db.prepare(
    `UPDATE categories SET name=@name, color=@color, sort_order=@sort_order, updated_at=@updated_at WHERE id=@id`
  ).run({
    id: existing.id,
    name: body.name ?? existing.name,
    color: body.color ?? existing.color,
    sort_order: body.sort_order ?? existing.sort_order,
    updated_at: now,
  });
  res.json({ id: existing.id, updated_at: now });
});

// DELETE /:id —— 软删除
router.delete('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(req.params.id) as
    | CategoryRow
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE categories SET is_deleted = 1, updated_at = ? WHERE id = ?`).run(now, req.params.id);
  res.json({ id: existing.id, is_deleted: 1, updated_at: now });
});

export default router;

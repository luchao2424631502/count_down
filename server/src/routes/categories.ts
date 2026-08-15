/**
 * routes/categories.ts — 分类 CRUD 路由（与前端 web/src/api 契约对齐）
 *
 * 端点：
 *   GET    /api/categories        全量（含软删，供前端 LWW 合并）
 *   GET    /api/categories/:id    单条（含软删）
 *   POST   /api/categories        新建（id 客户端 UUID，服务端补时间戳），返回完整行
 *   PUT    /api/categories/:id    更新（刷新 updated_at，优先用客户端传入），返回完整行
 *   DELETE /api/categories/:id    软删除（is_deleted=1），返回完整行
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import * as repo from '../repo.js';

export const router = Router();

// GET / —— 全量（含软删）
router.get('/', (_req, res) => {
  res.json(repo.getAllCategories());
});

// GET /:id
router.get('/:id', (req, res) => {
  const row = repo.getCategoryById(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  res.json(row);
});

// POST /
router.post('/', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    res.status(400).json({ error: 'name 必填' });
    return;
  }
  const clientId = typeof body.id === 'string' && body.id ? body.id : randomUUID();
  const row = repo.createCategory(
    {
      name,
      color: body.color == null ? null : String(body.color),
      sort_order: Math.floor(Number(body.sort_order) || 0),
    },
    { id: clientId },
  );
  res.status(201).json(row);
});

// PUT /:id
router.put('/:id', (req, res) => {
  const existing = repo.getCategoryById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updatedAt =
    typeof body.updated_at === 'string' && body.updated_at ? body.updated_at : new Date().toISOString();
  const row = repo.updateCategory(
    existing,
    {
      name: typeof body.name === 'string' && body.name ? String(body.name).trim() : undefined,
      color: body.color !== undefined ? (body.color == null ? null : String(body.color)) : undefined,
      sort_order: body.sort_order != null ? Math.floor(Number(body.sort_order) || 0) : undefined,
    },
    updatedAt,
  );
  res.json(row);
});

// DELETE /:id —— 软删除
router.delete('/:id', (req, res) => {
  const existing = repo.getCategoryById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  const updatedAt = new Date().toISOString();
  const row = repo.softDeleteCategory(existing, updatedAt);
  res.json(row);
});

export default router;

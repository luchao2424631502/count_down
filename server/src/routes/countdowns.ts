/**
 * routes/countdowns.ts — 倒计时条目 CRUD 路由（与前端 web/src/api 契约对齐）
 *
 * 端点：
 *   GET    /api/countdowns        拉全量（含软删标记，供前端 LWW 合并）+ 重复推进后返回
 *   GET    /api/countdowns/:id    单条（含软删）
 *   POST   /api/countdowns        新建（id 客户端 UUID，created_at/updated_at 服务端补），返回完整行
 *   PUT    /api/countdowns/:id    更新（刷新 updated_at，LWW 时间戳由客户端经 body 或服务端生成），返回完整行
 *   DELETE /api/countdowns/:id    软删除（is_deleted=1，updated_at 刷新），返回完整行
 *
 * 说明：
 *   · GET / 返回「含软删」全量——前端 refresh() 按 updated_at 做 LWW 合并，
 *     必须能看到服务端软删记录才能正确双向合并。
 *   · 写接口统一经 repo（tags 清洗、默认值、完整行返回）。
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import * as repo from '../repo.js';
import { advanceAllDue } from '../advance.js';

export const router = Router();

// GET / —— 全量（含软删）+ 重复事件到期自动推进
router.get('/', (_req, res) => {
  // 后端侧重复推进：先把过期重复事件累进到下一次（持久化），再返回合并后的全量
  advanceAllDue();
  const rows = repo.getAllCountdowns(); // 含软删，供前端 LWW 合并
  res.json(rows);
});

// GET /:id —— 单条（含软删返回）
router.get('/:id', (req, res) => {
  const row = repo.getCountdownById(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  res.json(row);
});

// POST / —— 新建
router.post('/', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const cols = repo.pickCountdownCols(body);
  // 校验必填
  if (!cols.title) {
    res.status(400).json({ error: 'title 必填' });
    return;
  }
  if (!cols.target_date) {
    res.status(400).json({ error: 'target_date 必填' });
    return;
  }

  const clientId = typeof body.id === 'string' && body.id ? body.id : randomUUID();
  const clientUpdatedAt =
    typeof body.updated_at === 'string' && body.updated_at ? body.updated_at : undefined;
  const row = repo.createCountdown(cols, { id: clientId, updated_at: clientUpdatedAt });
  res.status(201).json(row);
});

// PUT /:id —— 更新（返回完整行；updated_at 优先用客户端传入的，否则服务端生成）
router.put('/:id', (req, res) => {
  const existing = repo.getCountdownById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const cols = repo.pickCountdownCols(body);
  const updatedAt =
    typeof body.updated_at === 'string' && body.updated_at ? body.updated_at : new Date().toISOString();
  const row = repo.updateCountdown(existing, cols, updatedAt);
  res.json(row);
});

// DELETE /:id —— 软删除
router.delete('/:id', (req, res) => {
  const existing = repo.getCountdownById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  const updatedAt = new Date().toISOString();
  const row = repo.softDeleteCountdown(existing, updatedAt);
  res.json(row);
});

export default router;

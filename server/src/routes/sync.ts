/**
 * routes/sync.ts — 云同步（POST /api/sync, 全量 LWW）
 *
 * 同步模型（见 DATA_MODEL.md §1 / README_SOLUTION §5）：
 *   单用户全量 LWW（Last-Write-Wins），以 updated_at 为冲突判据，
 *   is_deleted 软删除（0=存在 / 1=已删），同步时携带软删记录。
 *
 * 协议：
 *   请求体：
 *     { "countdowns": [...], "categories": [...], "clientTime": "ISO" }
 *       · countdowns / categories 为客户端本地全量（含软删），每项含 updated_at。
 *   响应：
 *     { "serverTime": "ISO", "countdowns": [...], "categories": [...] }
 *       · 服务端合并后的全量（含软删），客户端据此覆盖本地。
 *
 * 合并规则：
 *   · 对每条客户端项与服务端既有项按 (id, updated_at) 比较：
 *       - 客户端 updated_at 较新（或服务端无此 id）→ 以客户端为准覆盖。
 *       - 服务端 updated_at 较新（或客户端无此 id，即服务端独有）→ 保留服务端。
 *       - updated_at 相同 → 保留服务端（稳定）。
 *   · 返回「服务端全量」，客户端再按自己最新的本地改动做二次 LWW 合并
 *     （前端 refresh/sync 会后端返回 + 本地合并），从而不丢未上传改动。
 */
import { Router } from 'express';
import * as repo from '../repo.js';
import { advanceAllDue } from '../advance.js';

export const router = Router();

/**
 * 单表 LWW 合并：把客户端上传的全量逐条与服务端按 (id, updated_at) 合并。
 * 客户端较新 → upsert 覆盖；否则保留服务端。
 * 返回服务端（合并后）全量快照。
 */
function mergeTable(
  table: 'countdowns' | 'categories',
  incoming: unknown[] | undefined,
): repo.CountdownRow[] | repo.CategoryRow[] {
  if (Array.isArray(incoming)) {
    for (const item of incoming) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const id = rec.id;
      if (typeof id !== 'string' || !id) continue;

      const clientUpdatedAt = typeof rec.updated_at === 'string' ? rec.updated_at : '';
      const serverRow =
        table === 'countdowns' ? repo.getCountdownById(id) : repo.getCategoryById(id);

      // 客户端较新（或服务端无此 id）→ 覆盖
      if (!serverRow || clientUpdatedAt > serverRow.updated_at) {
        if (table === 'countdowns') {
          const row: repo.CountdownRow = normalizeCountdown(rec);
          repo.upsertCountdown(row);
        } else {
          const row: repo.CategoryRow = normalizeCategory(rec);
          repo.upsertCategory(row);
        }
      }
      // 否则保留服务端（服务端较新或相同）
    }
  }
  return table === 'countdowns' ? repo.getAllCountdowns() : repo.getAllCategories();
}

/** 把客户端 sync 项规整为完整 countdown 行（缺省列给默认值，保留客户端 updated_at/created_at） */
function normalizeCountdown(rec: Record<string, unknown>): repo.CountdownRow {
  const now = new Date().toISOString();
  const id = String(rec.id);
  return {
    id,
    title: rec.title == null ? '' : String(rec.title),
    note: rec.note == null ? null : String(rec.note),
    target_date: rec.target_date == null ? '' : String(rec.target_date),
    direction: Number(rec.direction) === -1 ? -1 : Number(rec.direction) || 1,
    category_id: rec.category_id == null ? null : String(rec.category_id),
    tags: typeof rec.tags === 'string' ? cleanSyncTags(rec.tags) : null,
    repeat_type: rec.repeat_type ? String(rec.repeat_type) : null,
    repeat_interval: Math.max(1, Math.floor(Number(rec.repeat_interval) || 1)),
    repeat_end: rec.repeat_end == null ? null : String(rec.repeat_end),
    pinned: rec.pinned ? 1 : 0,
    sort_order: Math.floor(Number(rec.sort_order) || 0),
    remind_days: rec.remind_days == null ? null : String(rec.remind_days),
    last_notified: rec.last_notified == null ? null : String(rec.last_notified),
    notify_channel: rec.notify_channel ? String(rec.notify_channel) : 'app',
    is_deleted: rec.is_deleted ? 1 : 0,
    updated_at: typeof rec.updated_at === 'string' && rec.updated_at ? rec.updated_at : now,
    created_at: typeof rec.created_at === 'string' && rec.created_at ? rec.created_at : now,
  };
}

/** 把客户端 sync 项规整为完整分类行 */
function normalizeCategory(rec: Record<string, unknown>): repo.CategoryRow {
  const now = new Date().toISOString();
  return {
    id: String(rec.id),
    name: rec.name == null ? '' : String(rec.name),
    color: rec.color == null ? null : String(rec.color),
    sort_order: Math.floor(Number(rec.sort_order) || 0),
    is_deleted: rec.is_deleted ? 1 : 0,
    updated_at: typeof rec.updated_at === 'string' && rec.updated_at ? rec.updated_at : now,
    created_at: typeof rec.created_at === 'string' && rec.created_at ? rec.created_at : now,
  };
}

/** sync 里的 tags 也做清洗（与写库一致） */
function cleanSyncTags(tagsRaw: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of tagsRaw.split(',')) {
    const t = part.trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out.join(',');
}

// POST /api/sync
router.post('/sync', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const serverTime = new Date().toISOString();

  // LWW 合并客户端上传的本地数据（保留客户端较新的更新）
  mergeTable('countdowns', body.countdowns as unknown[] | undefined);
  mergeTable('categories', body.categories as unknown[] | undefined);

  // 服务端侧重复推进（写后统一），再返回合并后全量让客户端覆盖本地
  advanceAllDue();

  const countdowns = repo.getAllCountdowns();
  const categories = repo.getAllCategories();

  res.json({ serverTime, countdowns, categories });
});

export default router;

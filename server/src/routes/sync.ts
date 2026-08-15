/**
 * routes/sync.ts — 云同步路由骨架（POST /api/sync, 全量 LWW）
 *
 * 单用户 MVP 策略（见 README_SOLUTION §5）：
 *   全量同步 —— 客户端启动时拉全量覆盖本地；本地改动上传覆盖服务端。
 *   冲突用 updated_at 最后写入为准（LWW）。
 *
 * 请求体（示例）:
 *   {
 *     "countdowns": [ ...本地计数条目... ],
 *     "categories": [ ...本地分类... ],
 *     "lastSyncAt": "2026-08-14T00:00:00.000Z"   // 可选，增量依据
 *   }
 * 响应:
 *   {
 *     "serverTime": "...",
 *     "countdowns": [ ...服务端合并后条目... ],
 *     "categories": [ ...服务端合并后分类... ]
 *   }
 *
 * 说明：这里是「骨架」。MVP 全量覆盖即可，但已按 LWW 预留合并逻辑。
 */
import { Router } from 'express';
import db from '../db.js';

export const router = Router();

/** 服务端侧 LWW 合并：若客户端变更较新则覆盖，否则保留服务端 */
function mergeLWW(table: 'countdowns' | 'categories', incoming: any[]): void {
  if (!Array.isArray(incoming)) return;

  const upsert = db.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`);
  const insertStmt = db.prepare(
    table === 'countdowns'
      ? `INSERT OR REPLACE INTO countdowns
           (id, title, note, target_date, direction, category_id, tags,
            repeat_type, repeat_interval, repeat_end, pinned, sort_order,
            remind_days, last_notified, notify_channel, is_deleted, updated_at, created_at)
         VALUES
           (@id, @title, @note, @target_date, @direction, @category_id, @tags,
            @repeat_type, @repeat_interval, @repeat_end, @pinned, @sort_order,
            @remind_days, @last_notified, @notify_channel, @is_deleted, @updated_at, @created_at)`
      : `INSERT OR REPLACE INTO categories
           (id, name, color, sort_order, is_deleted, updated_at, created_at)
         VALUES (@id, @name, @color, @sort_order, @is_deleted, @updated_at, @created_at)`
  );

  const columnNames = table === 'countdowns'
    ? ['id','title','note','target_date','direction','category_id','tags','repeat_type','repeat_interval','repeat_end','pinned','sort_order','remind_days','last_notified','notify_channel','is_deleted','updated_at','created_at']
    : ['id','name','color','sort_order','is_deleted','updated_at','created_at'];

  const now = new Date().toISOString();

  for (const item of incoming) {
    const id = item?.id;
    if (!id) continue;

    const serverRow = upsert.get(id) as { updated_at: string } | undefined;
    // 客户端较新（或服务端无此记录）→ 覆盖；否则保留服务端
    if (serverRow && serverRow.updated_at >= (item.updated_at ?? now)) continue;

    const record: Record<string, unknown> = { id, updated_at: now, created_at: now };
    for (const col of columnNames) {
      if (col === 'id' || col === 'updated_at' || col === 'created_at') continue;
      record[col] = item[col] ?? null;
    }
    insertStmt.run(record);
  }
}

// POST /api/sync
router.post('/sync', (req, res) => {
  const body = req.body ?? {};
  // 服务端时间戳（可并入客户端增量依据）
  const serverTime = new Date().toISOString();

  // LWW 合并客户端上传的本地数据
  mergeLWW('countdowns', body.countdowns);
  mergeLWW('categories', body.categories);

  // 返回合并后全量数据（客户端据此覆盖本地）
  const countdowns = db.prepare(`SELECT * FROM countdowns`).all();
  const categories = db.prepare(`SELECT * FROM categories`).all();

  res.json({ serverTime, countdowns, categories });
});

export default router;

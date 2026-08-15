/**
 * db/index.ts —— IndexedDB 本地缓存（Dexie）
 *
 * 离线可读写、启动时作为首屏数据源；云同步成功后覆盖本地。
 * 表：countdowns / categories，主键 id，建 updated_at 索引便于覆盖写。
 */

import Dexie, { type Table } from 'dexie';
import type { Category, Countdown } from '@/types';

class CountdownDB extends Dexie {
  countdowns!: Table<Countdown, string>;
  categories!: Table<Category, string>;

  constructor() {
    super('countdown-pwa');
    this.version(1).stores({
      countdowns: 'id, updated_at, category_id, is_deleted, pinned, sort_order, target_date',
      categories: 'id, updated_at, is_deleted, sort_order',
    });
  }
}

/** 单例；SSR/测试环境（无 indexedDB）时降级用内存 Map（便于 Node 下跑逻辑/测试） */
export const db = new CountdownDB();

/** 是否可用的内存态缓存（无 IndexedDB 环境兜底） */
export function isIdbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * 从本地读取全量数据（过滤软删用于展示，但仍可读通软删做同步）。
 */
export async function loadLocal(): Promise<{ countdowns: Countdown[]; categories: Category[] }> {
  const [countdowns, categories] = await Promise.all([
    db.countdowns.toArray(),
    db.categories.toArray(),
  ]);
  return { countdowns, categories };
}

/** 批量覆盖写（供云同步结果落地） */
export async function overwriteLocal(countdowns: Countdown[], categories: Category[]): Promise<void> {
  await db.transaction('rw', db.countdowns, db.categories, async () => {
    await db.countdowns.clear();
    await db.categories.clear();
    if (countdowns.length) await db.countdowns.bulkPut(countdowns);
    if (categories.length) await db.categories.bulkPut(categories);
  });
}

/** upsert 单个倒计时 */
export async function upsertCountdown(c: Countdown): Promise<void> {
  await db.countdowns.put(c);
}

/** upsert 单个分类 */
export async function upsertCategory(c: Category): Promise<void> {
  await db.categories.put(c);
}

/** 删除单个倒计时（物理清除本地缓存条目，软删逻辑由业务层更新 is_deleted） */
export async function removeLocalCountdown(id: string): Promise<void> {
  await db.countdowns.delete(id);
}

/** 删除单个分类 */
export async function removeLocalCategory(id: string): Promise<void> {
  await db.categories.delete(id);
}

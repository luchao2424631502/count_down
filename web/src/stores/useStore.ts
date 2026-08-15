/**
 * stores/useStore.ts —— 全局状态（zustand）
 *
 * 管理: countdowns / categories 列表、加载态、离线态、同步状态。
 * 策略（移动优先、离线可用）：
 *   · 启动/刷新优先从 IndexedDB 展示（秒开），后台拉 API 覆盖。
 *   · 增删改先写本地 + state，再异步同步后端（乐观更新，失败回滚标记 offline）。
 *   · 云同步 = 全量 LWW（/api/sync），成功后覆盖本地缓存。
 */

import { create } from 'zustand';
import type { Category, Countdown, CountdownInput, CategoryInput } from '@/types';
import * as api from '@/api';
import * as localDb from '@/db';
import { cleanTags, nowIso, nextTriggerDate } from '@/utils/date';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 构造带时间戳/默认值的完整 Countdown */
function makeCountdown(input: CountdownInput, existing?: Countdown): Countdown {
  const now = nowIso();
  return {
    id: existing?.id ?? genId(),
    title: input.title,
    note: input.note ?? null,
    target_date: input.target_date,
    direction: input.direction ?? 1,
    category_id: input.category_id ?? null,
    tags: cleanTags(input.tags),
    repeat_type: input.repeat_type ?? '',
    repeat_interval: Math.max(1, Math.floor(input.repeat_interval ?? 1)),
    repeat_end: input.repeat_end ?? null,
    pinned: input.pinned ? 1 : 0,
    sort_order: input.sort_order ?? 0,
    remind_days: input.remind_days ?? null,
    last_notified: input.last_notified ?? existing?.last_notified ?? null,
    notify_channel: input.notify_channel ?? existing?.notify_channel ?? 'app',
    is_deleted: existing?.is_deleted ?? 0,
    updated_at: now,
    created_at: existing?.created_at ?? now,
  };
}

function makeCategory(input: CategoryInput, existing?: Category): Category {
  const now = nowIso();
  return {
    id: existing?.id ?? genId(),
    name: input.name,
    color: input.color ?? null,
    sort_order: input.sort_order ?? 0,
    is_deleted: existing?.is_deleted ?? 0,
    updated_at: now,
    created_at: existing?.created_at ?? now,
  };
}

const IGNORE_FIELDS: (keyof Countdown)[] = [
  'id', 'created_at', 'updated_at', 'is_deleted',
  'last_notified', 'notify_channel',
];

/** 过滤出「业务差异字段」，供后端 PUT/POST 传递 */
function toInput(c: Countdown): CountdownInput {
  const o: Record<string, unknown> = {};
  (Object.keys(c) as (keyof Countdown)[]).forEach((k) => {
    if (IGNORE_FIELDS.includes(k)) return;
    o[k] = c[k];
  });
  return o as unknown as CountdownInput;
}

interface StoreState {
  countdowns: Countdown[];
  categories: Category[];
  loading: boolean;
  offline: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  /** 先本地加载（IndexedDB），成功即置 loading=false，再可选拉云端 */
  init: () => Promise<void>;
  /** 从云端拉全量（覆盖本地 + state） */
  refresh: () => Promise<void>;
  /** 全量 LWW 云同步（上传本地合并结果） */
  sync: () => Promise<void>;
  /** 新增倒计时（乐观写本地） */
  addCountdown: (input: CountdownInput) => Promise<Countdown>;
  /** 更新倒计时（乐观写本地） */
  updateCountdown: (id: string, input: Partial<CountdownInput>) => Promise<void>;
  /** 软删除倒计时 */
  removeCountdown: (id: string) => Promise<void>;
  /** 恢复被删/推进重复目标日后的本地刷新 */
  saveCountdown: (c: Countdown) => Promise<void>;
  /** 新增/更新分类 */
  upsertCategory: (input: CategoryInput, id?: string) => Promise<Category>;
  /** 软删除分类 */
  removeCategory: (id: string) => Promise<void>;
}

export const useStore = create<StoreState>()((set, get) => ({
  countdowns: [],
  categories: [],
  loading: true,
  offline: false,
  syncing: false,
  lastSyncAt: null,

  init: async () => {
    // 1) 先读本地缓存（离线秒开）
    try {
      if (localDb.isIdbAvailable()) {
        const local = await localDb.loadLocal();
        set({
          countdowns: local.countdowns,
          categories: local.categories,
          loading: false,
          offline: local.countdowns.length === 0 && local.categories.length === 0,
        });
      }
    } catch {
      set({ loading: false });
    }
    // 2) 后台拉云端刷新
    await get().refresh();
  },

  refresh: async () => {
    try {
      const [cd, cat] = await Promise.all([api.fetchCountdowns(), api.fetchCategories()]);
      await localDb.overwriteLocal(cd, cat);
      set({ countdowns: cd, categories: cat, offline: false, loading: false, lastSyncAt: nowIso() });
    } catch {
      set({ offline: true, loading: false });
    }
  },

  sync: async () => {
    set({ syncing: true });
    try {
      const result = await api.syncAll({
        countdowns: get().countdowns,
        categories: get().categories,
        clientTime: nowIso(),
      });
      await localDb.overwriteLocal(result.countdowns, result.categories);
      set({
        countdowns: result.countdowns,
        categories: result.categories,
        offline: false,
        lastSyncAt: nowIso(),
      });
    } finally {
      set({ syncing: false });
    }
  },

  addCountdown: async (input) => {
    const c = makeCountdown(input);
    await localDb.upsertCountdown(c);
    set((s) => ({ countdowns: [...s.countdowns, c] }));
    // 后台同步
    get().refresh().catch(() => undefined);
    return c;
  },

  updateCountdown: async (id, input) => {
    const cur = get().countdowns.find((x) => x.id === id);
    if (!cur) return;
    const merged: Countdown = {
      ...cur,
      ...input,
      id: cur.id,
      created_at: cur.created_at,
      updated_at: nowIso(),
      tags: cleanTags(input.tags ?? cur.tags),
    };
    await localDb.upsertCountdown(merged);
    set((s) => ({ countdowns: s.countdowns.map((x) => (x.id === id ? merged : x)) }));
    get().refresh().catch(() => undefined);
  },

  removeCountdown: async (id) => {
    // 软删除：置 is_deleted=1，保留记录便于同步清除多端
    const cur = get().countdowns.find((x) => x.id === id);
    if (cur) {
      const soft: Countdown = { ...cur, is_deleted: 1, updated_at: nowIso() };
      await localDb.upsertCountdown(soft);
      set((s) => ({ countdowns: s.countdowns.map((x) => (x.id === id ? soft : x)) }));
    } else {
      await localDb.removeLocalCountdown(id);
      set((s) => ({ countdowns: s.countdowns.filter((x) => x.id !== id) }));
    }
    get().refresh().catch(() => undefined);
  },

  saveCountdown: async (c) => {
    await localDb.upsertCountdown(c);
    set((s) => ({ countdowns: s.countdowns.map((x) => (x.id === c.id ? c : x)) }));
    get().refresh().catch(() => undefined);
  },

  upsertCategory: async (input, id) => {
    const cur = id ? get().categories.find((x) => x.id === id) : undefined;
    const c = makeCategory(input, cur);
    await localDb.upsertCategory(c);
    set((s) => ({
      categories: cur ? s.categories.map((x) => (x.id === c.id ? c : x)) : [...s.categories, c],
    }));
    get().refresh().catch(() => undefined);
    return c;
  },

  removeCategory: async (id) => {
    const cur = get().categories.find((x) => x.id === id);
    if (cur) {
      const soft: Category = { ...cur, is_deleted: 1, updated_at: nowIso() };
      await localDb.upsertCategory(soft);
      set((s) => ({ categories: s.categories.map((x) => (x.id === id ? soft : x)) }));
    } else {
      await localDb.removeLocalCategory(id);
      set((s) => ({ categories: s.categories.filter((x) => x.id !== id) }));
    }
    get().refresh().catch(() => undefined);
  },
}));

/** 便捷：按重复规则推进 target_date 并落库（触发完成后调用） */
export async function advanceTrigger(id: string): Promise<void> {
  const c = useStore.getState().countdowns.find((x) => x.id === id);
  if (!c || !c.repeat_type) return;
  const next = nextTriggerDate(c.target_date, c.repeat_type, c.repeat_interval, c.repeat_end);
  if (next && next !== c.target_date) {
    await useStore.getState().updateCountdown(id, { target_date: next });
  }
}

export { toInput, IGNORE_FIELDS };

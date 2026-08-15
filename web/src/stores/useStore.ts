/**
 * stores/useStore.ts —— 全局状态（zustand）
 *
 * 管理: countdowns / categories 列表、加载态、离线态、同步状态。
 * 策略（移动优先、离线可用）：
 *   · 启动/刷新优先从 IndexedDB 展示（秒开），后台拉 API 合并。
 *   · 增删改先写本地 + state，再【同步调用后端】写服务端（fire backend），
 *     联网时保证「本地 + 云端」双写；离线时后端调用失败 → 置 offline，
 *     但本地记录保留（updated_at 最新），下次合并/sync 时按 LWW 重新上传覆盖。
 *   · refresh() 采用 LWW 合并（updated_at 最新者胜、本地未同步的 pending 记录保留），
 *     绝不盲目用服务端旧数据覆盖本地未同步的改动。
 *   · 云同步 = 全量 LWW（/api/sync），成功后覆盖本地缓存。
 *
 * 同步模型（见 DATA_MODEL.md §1 / README_SOLUTION §5）：
 *   单用户全量 LWW（Last-Write-Wins），以 updated_at 为冲突判据，
 *   is_deleted 软删除（0=存在 / 1=已删），上线时携带软删记录。
 */

import { create } from 'zustand';
import type { Category, Countdown, CountdownInput, CategoryInput } from '@/types';
import * as api from '@/api';
import * as localDb from '@/db';
import { cleanTags, nowIso, nextTriggerDate, dueReminders, formatDate } from '@/utils/date';

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

/** 过滤出「业务差异字段」，供后端 POST/PUT 传递 */
function toInput(c: Countdown): CountdownInput {
  const o: Record<string, unknown> = {};
  (Object.keys(c) as (keyof Countdown)[]).forEach((k) => {
    if (IGNORE_FIELDS.includes(k)) return;
    o[k] = c[k];
  });
  return o as unknown as CountdownInput;
}

/**
 * LWW 合并列表：以本地为「权威方」，与远端列表按 updated_at 逐条合并。
 * 规则：
 *   · 同一 id：updated_at 较大者胜（最后一写获胜）。
 *   · 仅本地存在（远端没有）→ 保留本地（未同步的新改动，pending）。
 *   · 仅远端存在（本地没有）→ 采用远端（云端新增）。
 * 这样 refresh() 在拉取远端后合并，绝不丢弃本地未同步改动。
 */
function mergeByLWW<T extends { id: string; updated_at: string }>(
  local: T[],
  remote: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || r.updated_at > l.updated_at) {
      byId.set(r.id, r);
    }
  }
  return Array.from(byId.values());
}

/** 合并后的实体列表（供测试/通用使用），保留原泛型 */
export function mergeCountdowns(local: Countdown[], remote: Countdown[]): Countdown[] {
  return mergeByLWW(local, remote);
}
/** 合并后的分类列表 */
export function mergeCategories(local: Category[], remote: Category[]): Category[] {
  return mergeByLWW(local, remote);
}

interface StoreState {
  countdowns: Countdown[];
  categories: Category[];
  loading: boolean;
  offline: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  /** 先本地加载（IndexedDB），成功即置 loading=false，再可选拉云端合并 */
  init: () => Promise<void>;
  /** 从云端拉全量，与本地按 updated_at 做 LWW 合并（不覆盖未同步本地改动） */
  refresh: () => Promise<void>;
  /** 全量 LWW 云同步（上传本地合并结果） */
  sync: () => Promise<void>;
  /** 新增倒计时（乐观写本地 + 同步写后端） */
  addCountdown: (input: CountdownInput) => Promise<Countdown>;
  /** 更新倒计时（乐观写本地 + 同步写后端） */
  updateCountdown: (id: string, input: Partial<CountdownInput>) => Promise<void>;
  /** 软删除倒计时（本地软删 + 同步写后端软删） */
  removeCountdown: (id: string) => Promise<void>;
  /** 恢复被删/推进重复目标日后的本地刷新：落库 + 同步写后端的单条更新 */
  saveCountdown: (c: Countdown) => Promise<void>;
  /** 新增/更新分类 */
  upsertCategory: (input: CategoryInput, id?: string) => Promise<Category>;
  /** 软删除分类 */
  removeCategory: (id: string) => Promise<void>;
  /**
   * 扫描全部倒计时并触发今日应发提醒（按 last_notified 去重）。
   * Bug6：不排除 direction=-1（正数/已过/纪念日）——此类条目同样应能提醒。
   * Bug2：提醒前读 last_notified，今日已提醒则跳过；发出后把 last_notified
   *       更新为今天（YYYY-MM-DD）防重复推送。返回今日实际触发提醒的条目。
   */
  runDueReminders: () => Promise<Countdown[]>;
}

/**
 * 后端调用辅助：把一条本地改动的调用结果映射为「online 状态归位」。
 * 约定：一旦任一次后端写成功，即视为联网（offline=false）。
 */
async function pushBackend(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
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
    // 2) 后台拉云端 + LWW 合并（不覆盖本地未同步改动）
    await get().refresh();
  },

  refresh: async () => {
    try {
      const [remoteCd, remoteCat] = await Promise.all([
        api.fetchCountdowns(),
        api.fetchCategories(),
      ]);
      // LWW 合并：本地较新的（未同步）保留，服务端较新的 / 服务端独有的采纳
      const mergedCd = mergeByLWW(get().countdowns, remoteCd);
      const mergedCat = mergeByLWW(get().categories, remoteCat);
      await localDb.overwriteLocal(mergedCd, mergedCat);
      set({
        countdowns: mergedCd,
        categories: mergedCat,
        offline: false,
        loading: false,
        lastSyncAt: nowIso(),
      });
      // Bug3：重复事件自动推进 —— 数据落位后，把 target_date 已过期的
      // 重复事件累进到下一次触发日（尊重 repeat_end；终止事件不再推进）。
      // 放在 refresh() 里以便 init / 手动刷新统一触发；不破坏 LWW 合并/提醒。
      await autoAdvanceDue();
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
    // 1) 乐观写本地 + state（离线也立即可见）
    await localDb.upsertCountdown(c);
    set((s) => ({ countdowns: [...s.countdowns, c] }));
    // 2) 同步写后端：成功 → 服务端有了这条；失败 → 置 offline，本地记录保留，
    //    下次 refresh/sync 按 LWW 合并时因本地 updated_at 较新会被重新上传。
    const ok = await pushBackend(() => api.createCountdown(toInput(c)));
    if (!ok) set({ offline: true });
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
    // 1) 乐观写本地 + state
    await localDb.upsertCountdown(merged);
    set((s) => ({ countdowns: s.countdowns.map((x) => (x.id === id ? merged : x)) }));
    // 2) 同步写后端
    const ok = await pushBackend(() => api.updateCountdown(id, toInput({ ...merged })));
    if (!ok) set({ offline: true });
  },

  removeCountdown: async (id) => {
    const cur = get().countdowns.find((x) => x.id === id);
    if (cur) {
      // 软删除：置 is_deleted=1，保留记录便于同步清除多端
      const soft: Countdown = { ...cur, is_deleted: 1, updated_at: nowIso() };
      await localDb.upsertCountdown(soft);
      set((s) => ({ countdowns: s.countdowns.map((x) => (x.id === id ? soft : x)) }));
      // 同步写后端软删除
      const ok = await pushBackend(() => api.deleteCountdown(id));
      if (!ok) set({ offline: true });
    } else {
      await localDb.removeLocalCountdown(id);
      set((s) => ({ countdowns: s.countdowns.filter((x) => x.id !== id) }));
      const ok = await pushBackend(() => api.deleteCountdown(id));
      if (!ok) set({ offline: true });
    }
  },

  saveCountdown: async (c) => {
    await localDb.upsertCountdown(c);
    set((s) => ({ countdowns: s.countdowns.map((x) => (x.id === c.id ? c : x)) }));
    // 同步写后端单条更新
    const ok = await pushBackend(() => api.updateCountdown(c.id, toInput({ ...c })));
    if (!ok) set({ offline: true });
  },

  upsertCategory: async (input, id) => {
    const cur = id ? get().categories.find((x) => x.id === id) : undefined;
    const c = makeCategory(input, cur);
    await localDb.upsertCategory(c);
    set((s) => ({
      categories: cur ? s.categories.map((x) => (x.id === c.id ? c : x)) : [...s.categories, c],
    }));
    // 同步写后端
    const ok = await pushBackend(() =>
      cur ? api.updateCategory(c.id, input) : api.createCategory(input),
    );
    if (!ok) set({ offline: true });
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
    const ok = await pushBackend(() => api.deleteCategory(id));
    if (!ok) set({ offline: true });
  },

  runDueReminders: async () => {
    const { countdowns } = get();
    const todayStr = formatDate(new Date());
    const fired: Countdown[] = [];
    for (const c of countdowns) {
      if (c.is_deleted) continue; // 软删不提醒
      // Bug6：for 正向与反向（direction=-1 纪念日/已过）都判定，不做方向过滤。
      // Bug2：传入 last_notified 去重——今日已提醒则 dueReminders 返回 []。
      const due = dueReminders(c.target_date, c.remind_days, todayStr, c.last_notified);
      if (due.length === 0) continue;
      // 触发提醒（实际推送由调用方/notify_channel 处理）。发完把 last_notified 更新为今天（日期粒度）
      const updated = { ...c, last_notified: todayStr, updated_at: nowIso() };
      await get().saveCountdown(updated);
      fired.push(updated);
    }
    return fired;
  },
}));

/**
 * Bug3 修复核心：自动推进所有「target_date 已过期」的重复事件到下一次触发日。
 * 逐条计算并在有推进时写回本地缓存 + state（尊重 repeat_end：终止事件返回 null 不推进）。
 */
async function autoAdvanceDue(): Promise<void> {
  const state = useStore.getState();
  const due = state.countdowns.filter((c) => c.is_deleted === 0 && c.repeat_type);
  const advanced = new Map<string, Countdown>();
  for (const c of due) {
    const next = nextTriggerDate(c.target_date, c.repeat_type, c.repeat_interval, c.repeat_end);
    if (next && next !== c.target_date) {
      advanced.set(c.id, { ...c, target_date: next, updated_at: nowIso() });
    }
  }
  if (advanced.size === 0) return;
  const nextList = state.countdowns.map((c) => advanced.get(c.id) ?? c);
  for (const adv of advanced.values()) {
    await localDb.upsertCountdown(adv);
  }
  useStore.setState({ countdowns: nextList });
}

/** 便捷：按重复规则单条推进 target_date 并落库（详情页「推进到下次」按钮等手动触发） */
export async function advanceTrigger(id: string): Promise<void> {
  const c = useStore.getState().countdowns.find((x) => x.id === id);
  if (!c || !c.repeat_type) return;
  const next = nextTriggerDate(c.target_date, c.repeat_type, c.repeat_interval, c.repeat_end);
  if (next && next !== c.target_date) {
    await useStore.getState().updateCountdown(id, { target_date: next });
  }
}

export { toInput, IGNORE_FIELDS };

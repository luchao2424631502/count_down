/**
 * stores/useStore.test.ts —— 修复 Bug1 的回归测试
 *
 * 覆盖（见任务要求）：
 *   1. 新增倒计时 → 同步调用后端 create 写服务端（而非只写本地）
 *   2. 编辑倒计时 → 同步调用后端 update 写服务端
 *   3. 删除倒计时 → 同步调用后端 delete 写服务端（软删除）
 *   4. refresh() 拉取远端较旧的数据时，不覆盖本地未同步的改动（LWW 合并保留本地新版）
 *
 * 测试策略：mock @/api 与 @/db，隔离验证 store 的「写后端」与「LWW 合并」编排逻辑，
 * 不依赖真实 IndexedDB / 后端。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Countdown, Category, CountdownInput, CategoryInput, SyncPayload, SyncResult } from '@/types';
import * as api from '@/api';
import * as localDb from '@/db';
import { nextTriggerDate } from '@/utils/date';

// ---- mock 掉网络与本地存储，聚焦 store 编排 ----
vi.mock('@/api', () => ({
  fetchCountdowns: vi.fn(),
  fetchCategories: vi.fn(),
  createCountdown: vi.fn(),
  updateCountdown: vi.fn(),
  deleteCountdown: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  syncAll: vi.fn(),
}));

vi.mock('@/db', () => ({
  isIdbAvailable: vi.fn(() => true),
  loadLocal: vi.fn(async () => ({ countdowns: [], categories: [] })),
  overwriteLocal: vi.fn(async () => undefined),
  upsertCountdown: vi.fn(async () => undefined),
  upsertCategory: vi.fn(async () => undefined),
  removeLocalCountdown: vi.fn(async () => undefined),
  removeLocalCategory: vi.fn(async () => undefined),
}));

// zustand 需要真实实现；store 在 import 时注册到 zustand，测试里动态 import 以获得新实例。
let store: typeof import('./useStore');
let useStore: typeof import('./useStore')['useStore'];

/** 构造一条合法 countdown 输入 */
function makeInput(overrides: Partial<import('@/types').CountdownInput> = {}) {
  return {
    title: '转正答辩',
    target_date: '2026-09-01',
    direction: 1 as const,
    repeat_type: '' as const,
    repeat_interval: 1,
    pinned: 0,
    sort_order: 0,
    ...overrides,
  };
}

const apiMock = api as unknown as {
  fetchCountdowns: Mock<() => Promise<Countdown[]>>;
  fetchCategories: Mock<() => Promise<Category[]>>;
  createCountdown: Mock<(input: CountdownInput) => Promise<Countdown>>;
  updateCountdown: Mock<(id: string, input: Partial<CountdownInput>) => Promise<Countdown>>;
  deleteCountdown: Mock<(id: string) => Promise<void>>;
  createCategory: Mock<(input: CategoryInput) => Promise<Category>>;
  updateCategory: Mock<(id: string, input: CategoryInput) => Promise<Category>>;
  deleteCategory: Mock<(id: string) => Promise<void>>;
  syncAll: Mock<(payload: SyncPayload) => Promise<SyncResult>>;
};

const dbMock = localDb as unknown as {
  overwriteLocal: Mock<(a: Countdown[], b: Category[]) => Promise<void>>;
  upsertCountdown: Mock<(c: Countdown) => Promise<void>>;
};

/** 生成一条完整后端返回的 Countdown */
function serverCountdown(id: string, title: string, updated_at: string): Countdown {
  return {
    id,
    title,
    note: null,
    target_date: '2026-09-01',
    direction: 1,
    category_id: null,
    tags: null,
    repeat_type: '',
    repeat_interval: 1,
    repeat_end: null,
    pinned: 0,
    sort_order: 0,
    remind_days: null,
    last_notified: null,
    notify_channel: 'app',
    is_deleted: 0,
    updated_at,
    created_at: updated_at,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  // 重置 zustand store 内部状态（重新创建）
  vi.resetModules();
  store = await import('./useStore');
  useStore = store.useStore;
  // 默认：init 拉取为空
  apiMock.fetchCountdowns.mockResolvedValue([]);
  apiMock.fetchCategories.mockResolvedValue([]);
  apiMock.createCountdown.mockResolvedValue(serverCountdown('x', 'resolved', '2026-01-01T00:00:00Z'));
  apiMock.updateCountdown.mockResolvedValue(serverCountdown('x', 'resolved', '2026-01-01T00:00:00Z'));
  apiMock.deleteCountdown.mockResolvedValue(undefined);
  apiMock.createCategory.mockResolvedValue({ id: 'c', name: 'resolved', sort_order: 0, is_deleted: 0, updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' });
  apiMock.updateCategory.mockResolvedValue({ id: 'c', name: 'resolved', sort_order: 0, is_deleted: 0, updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' });
  apiMock.deleteCategory.mockResolvedValue(undefined);
  apiMock.syncAll.mockResolvedValue({ countdowns: [], categories: [] });
});

describe('Bug1 修复：增删改同步写后端', () => {
  it('新增倒计时 → 调用后端 createCountdown 写服务端（而非只写本地）', async () => {
    const st = useStore.getState();
    const created = await st.addCountdown(makeInput({ title: '新同事入职' }));

    // 本地 state 立即可见
    expect(useStore.getState().countdowns.some((x) => x.title === '新同事入职')).toBe(true);
    // 本地 IndexedDB 也写了
    expect(dbMock.upsertCountdown).toHaveBeenCalledTimes(1);
    // 关键：后端 createCountdown 被调用写服务端
    expect(apiMock.createCountdown).toHaveBeenCalledTimes(1);
    const payload = apiMock.createCountdown.mock.calls[0][0];
    expect(payload).toMatchObject({ title: '新同事入职', target_date: '2026-09-01' });
    // Bug(重复 id)：客户端生成的 id 必须随 body 发给后端，
    // 否则本地与云端各存一条不同 id 副本 → refresh LWW 合并显示两项。
    expect((payload as unknown as Record<string, unknown>).id).toBe(created.id);
    // 创建成功后不应处于 offline
    expect(useStore.getState().offline).toBe(false);
    expect(created).toBeDefined();
  });

  it('新增分类 → 后端 createCategory 收到客户端生成的 id（避免本地/云端各存一条）', async () => {
    const st = useStore.getState();
    const created = await st.upsertCategory({ name: '工作', sort_order: 0 });

    // 本地 state 立即可见
    expect(useStore.getState().categories.some((x) => x.name === '工作')).toBe(true);
    // 后端 createCategory 被调用写服务端
    expect(apiMock.createCategory).toHaveBeenCalledTimes(1);
    const payload = apiMock.createCategory.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(payload).toMatchObject({ name: '工作', sort_order: 0 });
    // 关键：新增分类也要把客户端 id 传给后端
    expect(payload.id).toBe(created.id);
    expect(useStore.getState().offline).toBe(false);
  });

  it('离线时新增仍保留本地，且 offline=true（后续 merge/sync 会重传）', async () => {
    apiMock.createCountdown.mockRejectedValue(new Error('network down'));
    const st = useStore.getState();
    await st.addCountdown(makeInput({ title: '离线新建' }));

    // 本地记录保留（不丢数据）
    expect(useStore.getState().countdowns.some((x) => x.title === '离线新建')).toBe(true);
    expect(useStore.getState().offline).toBe(true);
  });

  it('编辑倒计时 → 调用后端 updateCountdown 写服务端', async () => {
    const st = useStore.getState();
    const created = await st.addCountdown(makeInput({ title: '旧标题' }));
    // 清除 create 的调用记录，专注 update
    apiMock.updateCountdown.mockClear();

    await st.updateCountdown(created.id, { title: '新标题' });

    expect(apiMock.updateCountdown).toHaveBeenCalledTimes(1);
    expect(apiMock.updateCountdown.mock.calls[0][0]).toBe(created.id);
    expect(apiMock.updateCountdown.mock.calls[0][1]).toMatchObject({ title: '新标题' });
    // 本地 state 更新
    expect(useStore.getState().countdowns.find((x) => x.id === created.id)?.title).toBe('新标题');
  });

  it('删除倒计时 → 本地软删除（is_deleted=1）+ 调用后端 deleteCountdown', async () => {
    const st = useStore.getState();
    const created = await st.addCountdown(makeInput({ title: '要删的任务' }));
    apiMock.deleteCountdown.mockClear();

    await st.removeCountdown(created.id);

    // 本地软删除：记录保留但 is_deleted=1
    const local = useStore.getState().countdowns.find((x) => x.id === created.id);
    expect(local?.is_deleted).toBe(1);
    expect(local).toBeDefined();
    // 后端 delete 被调用（软删除）
    expect(apiMock.deleteCountdown).toHaveBeenCalledTimes(1);
    expect(apiMock.deleteCountdown.mock.calls[0][0]).toBe(created.id);
  });
});

describe('Bug1 修复：refresh 不覆盖本地未同步改动', () => {
  it('refresh 拉取到远端旧数据时，保留本地较新的未同步改动（LWW 合并）', async () => {
    // 本地已有一条较新（updated_at 较晚）、远端同一 id 但较旧的记录
    const remoteOlder: Countdown = serverCountdown('item-1', '远端旧版', '2026-08-01T00:00:00.000Z');

    // 构造与 remote 同 id 的本地较新版记录
    const newer: Countdown = serverCountdown('item-1', '本地较新版', '2026-08-15T10:00:00.000Z');
    await dbMock.overwriteLocal([newer], []);
    useStore.setState(() => ({ countdowns: [newer] }));

    // 远端旧版
    apiMock.fetchCountdowns.mockResolvedValue([remoteOlder]);

    await useStore.getState().refresh();

    // 本地较新版保留，未被远端旧版覆盖
    const after = useStore.getState().countdowns.find((x) => x.id === 'item-1');
    expect(after?.title).toBe('本地较新版');
    expect(after?.updated_at).toBe('2026-08-15T10:00:00.000Z');
  });

  it('refresh 采纳远端较新的改动（服务端 LWW 胜过本地旧数据）', async () => {
    const remoteNewer: Countdown = serverCountdown('item-2', '远端新版', '2026-08-15T10:00:00.000Z');

    const older: Countdown = serverCountdown('item-2', '本地旧版', '2026-08-01T00:00:00.000Z');
    useStore.setState(() => ({ countdowns: [older] }));

    apiMock.fetchCountdowns.mockResolvedValue([remoteNewer]);

    await useStore.getState().refresh();

    const after = useStore.getState().countdowns.find((x) => x.id === 'item-2');
    expect(after?.title).toBe('远端新版');
  });

  it('refresh 合并时保留「仅本地存在」的 pending 新记录（不被远端空档删除）', async () => {
    const st = useStore.getState();
    const created = await st.addCountdown(makeInput({ title: '仅本地的新记录' }));
    // 远端无此记录
    apiMock.fetchCountdowns.mockResolvedValue([]);

    await useStore.getState().refresh();

    expect(useStore.getState().countdowns.some((x) => x.id === created.id)).toBe(true);
    expect(useStore.getState().offline).toBe(false);
  });
});

describe('mergeByLWW 导出函数', () => {
  it('updated_at 相同/本地有条目时本地优先', async () => {
    const l = serverCountdown('a', '本地标题', '2026-08-15T00:00:00.000Z');
    const r = serverCountdown('a', '远端标题', '2026-08-01T00:00:00.000Z');
    const merged = store.mergeCountdowns([l], [r]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('本地标题');
  });
});

/** 构造一条「重复事件」完整 Countdown（target 已过期，用于 Bug3 自动推进） */
function serverRepeat(id: string, targetDate: string, repeatType: string, repeatEnd: string | null): Countdown {
  return {
    ...serverCountdown(id, '重复事件', '2026-01-01T00:00:00.000Z'),
    target_date: targetDate,
    repeat_type: repeatType as Countdown['repeat_type'],
    repeat_end: repeatEnd,
  };
}

describe('Bug3 修复：重复事件自动推进（refresh 后 target_date 累进到下一次触发日）', () => {
  it('weekly 已过期事件：refresh 后自动推进到下一次未来触发日', async () => {
    // target 2020-01-06（历史上的周一），weekly 无终止
    const item = serverRepeat('r1', '2020-01-06', 'weekly', null);
    apiMock.fetchCountdowns.mockResolvedValue([item]);

    await useStore.getState().refresh();

    const after = useStore.getState().countdowns.find((x) => x.id === 'r1');
    expect(after).toBeDefined();
    // 应推进到 >= 今天的下一次周一（与纯函数判定一致），且不再等于原始目标
    const expected = nextTriggerDate('2020-01-06', 'weekly', 1, null);
    expect(after?.target_date).toBe(expected);
    expect(after?.target_date).not.toBe('2020-01-06');
  });

  it('monthly 已过期事件：自动推进且保留锚点日号', async () => {
    const item = serverRepeat('r2', '2020-01-31', 'monthly', null);
    apiMock.fetchCountdowns.mockResolvedValue([item]);

    await useStore.getState().refresh();

    const after = useStore.getState().countdowns.find((x) => x.id === 'r2');
    const expected = nextTriggerDate('2020-01-31', 'monthly', 1, null);
    expect(after?.target_date).toBe(expected);
    expect(after?.target_date.slice(8, 10)).toBe('31'); // 回到有 31 号的月份仍是 31 号
  });

  it('已过 repeat_end 的重复事件：不再推进（无未来触发日，保留原值）', async () => {
    // weekly，repeat_end = 2020-01-31，今天已远超 → nextTriggerDate 返回 null → 不推进
    const item = serverRepeat('r3', '2020-01-06', 'weekly', '2020-01-31');
    apiMock.fetchCountdowns.mockResolvedValue([item]);

    await useStore.getState().refresh();

    const after = useStore.getState().countdowns.find((x) => x.id === 'r3');
    expect(nextTriggerDate('2020-01-06', 'weekly', 1, '2020-01-31')).toBeNull();
    // 未推进：target_date 保持原样
    expect(after?.target_date).toBe('2020-01-06');
  });

  it('仍有效（repeat_end 未到的）重复事件正常推进', async () => {
    // repeat_end 足够远（2199-12-31），应正常推进
    const item = serverRepeat('r4', '2020-02-29', 'yearly', '2199-12-31');
    apiMock.fetchCountdowns.mockResolvedValue([item]);

    await useStore.getState().refresh();

    const after = useStore.getState().countdowns.find((x) => x.id === 'r4');
    const expected = nextTriggerDate('2020-02-29', 'yearly', 1, '2199-12-31');
    expect(after?.target_date).toBe(expected);
    expect(after?.target_date).not.toBe('2020-02-29');
    // yearly 2/29：推进后的年份当天是不跳越的 2/28(平年) 或 2/29(闰年)
    expect(['28', '29']).toContain(after?.target_date.slice(8, 10));
  });

  it('非重复事件（repeat_type 为空）即便已过期也不推进', async () => {
    const past = serverCountdown('r5', '已过期普通', '2020-01-01T00:00:00.000Z');
    // serverCountdown 默认 repeat_type='' 且 target_date='2026-09-01'，这里强制回填过期目标
    apiMock.fetchCountdowns.mockResolvedValue([{ ...past, target_date: '2020-01-01' }]);

    await useStore.getState().refresh();

    const after = useStore.getState().countdowns.find((x) => x.id === 'r5');
    expect(after?.target_date).toBe('2020-01-01'); // 不推进
  });
});

/** 本地 YYYY-MM-DD（与 dueReminders 判定一致） */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 构造一条「今天为提醒日」的 countdown：target = 今天 + daysBefore 天，remind_days=[5] */
function dueTodayCountdown(overrides: Partial<Countdown> = {}): Countdown {
  const target = new Date();
  target.setDate(target.getDate() + 5);
  const t = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  const base = serverCountdown('fire-1', '今天该提醒', '2026-08-15T00:00:00.000Z');
  return {
    ...base,
    target_date: t,
    remind_days: '[5]', // target-5 == today → 今日触发
    ...overrides,
  };
}

describe('Bug2/Bug6：runDueReminders 提醒去重与方向', () => {
  it('last_notified 已含今日触发日 → 不重复提醒（去重生效）', async () => {
    const c = dueTodayCountdown({ last_notified: todayStr() }); // 今日已提醒
    useStore.setState(() => ({ countdowns: [c] }));
    dbMock.upsertCountdown.mockClear();
    apiMock.updateCountdown.mockClear();

    const fired = await useStore.getState().runDueReminders();

    expect(fired).toHaveLength(0); // 今日已提醒 → 跳过，不重复触发
    // 不写 last_notified / 不调用后端（无需更新）
    expect(dbMock.upsertCountdown).not.toHaveBeenCalled();
  });

  it('提醒发出后 last_notified 正确更新为今天（YYYY-MM-DD）', async () => {
    const c = dueTodayCountdown({ last_notified: null }); // 今日尚未提醒
    useStore.setState(() => ({ countdowns: [c] }));

    const fired = await useStore.getState().runDueReminders();

    // 今日确实触发
    expect(fired.map((x) => x.id)).toEqual(['fire-1']);
    // last_notified 更新为今天
    expect(fired[0].last_notified).toBe(todayStr());
    const persisted = useStore.getState().countdowns.find((x) => x.id === c.id);
    expect(persisted?.last_notified).toBe(todayStr());
    // 落库（saveCountdown → upsertCountdown）被调用
    expect(dbMock.upsertCountdown).toHaveBeenCalled();
  });

  it('非提醒日不触发且不写 last_notified', async () => {
    // target 今天+1，remind_days=[5] → 今天不是提醒日
    const target = new Date();
    target.setDate(target.getDate() + 1);
    const t = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
    const c = {
      ...serverCountdown('fire-x', '非提醒日', '2026-08-15T00:00:00.000Z'),
      target_date: t,
      remind_days: '[5]',
      last_notified: null,
    };
    useStore.setState(() => ({ countdowns: [c] }));
    dbMock.upsertCountdown.mockClear();

    const fired = await useStore.getState().runDueReminders();
    expect(fired).toHaveLength(0);
    expect(dbMock.upsertCountdown).not.toHaveBeenCalled();
  });

  it('Bug6：direction=-1（纪念日/已过）也能触发提醒', async () => {
    // 纪念日：今天恰为触发日（remind_days=[0]），direction=-1
    const target = new Date();
    const t = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
    const c = {
      ...serverCountdown('anni-1', '结婚纪念日', '2026-08-15T00:00:00.000Z'),
      target_date: t, // 今天
      direction: -1 as const, // 正数/已过
      remind_days: '[0]', // 触发日当天提醒
      last_notified: null,
    };
    useStore.setState(() => ({ countdowns: [c] }));

    const fired = await useStore.getState().runDueReminders();

    expect(fired.map((x) => x.id)).toEqual(['anni-1']); // 不被 direction=-1 排除
    expect(fired[0].last_notified).toBe(todayStr());
  });

  it('软删除条目不触发提醒', async () => {
    const c = dueTodayCountdown({ is_deleted: 1, last_notified: null });
    useStore.setState(() => ({ countdowns: [c] }));
    dbMock.upsertCountdown.mockClear();

    const fired = await useStore.getState().runDueReminders();
    expect(fired).toHaveLength(0);
    expect(dbMock.upsertCountdown).not.toHaveBeenCalled();
  });
});

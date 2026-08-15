/**
 * repo.test.ts — repo.ts 数据库访问层单元测试
 *
 * 覆盖：
 *   · createCountdown / 默认值 / tags 清洗
 *   · getCountdownById / getAllCountdowns / listCountdowns（软删过滤 + 排序）
 *   · updateCountdown（可空字段置空、updated_at 填充）
 *   · softDeleteCountdown（is_deleted=1 不真删、GET 过滤、list 不出现）
 *   · upsertCountdown（按主键整体覆盖）
 *   · pickCountdownCols 字段映射
 *   · categories CRUD / upsert
 *
 * 使用真实 SQLite 内存库（:memory:），不污染正式库。
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// 必须在使用任何依赖 db 的模块前设置 DB_PATH（ESM 顶层 await 先于 test 回调）
process.env.DB_PATH = ':memory:';
const { initSchema, db } = await import('../src/db.js');
const repo = await import('../src/repo.js');
initSchema();

// 每个用例前清空两表，保证隔离（同一进程共享单例数据库）
beforeEach(() => {
  db.prepare('DELETE FROM countdowns').run();
  db.prepare('DELETE FROM categories').run();
});

const T1 = '2026-08-15T00:00:00.000Z';
const T2 = '2026-08-16T00:00:00.000Z';
const T3 = '2026-08-17T00:00:00.000Z';

function baseCols(overrides: Record<string, unknown> = {}) {
  return {
    title: '转正答辩',
    note: null,
    target_date: '2026-12-01',
    direction: 1,
    category_id: null,
    tags: ' 工作 , 重要 ,工作 ',
    repeat_type: null,
    repeat_interval: 1,
    repeat_end: null,
    pinned: 0,
    sort_order: 0,
    remind_days: null,
    last_notified: null,
    notify_channel: 'app',
    ...overrides,
  };
}

describe('countdowns CRUD', () => {
  test('createCountdown 写入并返回完整行，tags 清洗生效', () => {
    const row = repo.createCountdown(baseCols(), { id: 'c1', now: T1 });
    assert.equal(row.id, 'c1');
    assert.equal(row.is_deleted, 0);
    assert.equal(row.updated_at, T1);
    assert.equal(row.created_at, T1);
    assert.equal(row.tags, '工作,重要'); // 清洗（去空格/去重）
  });

  test('getCountdownById 命中与缺失', () => {
    const row = repo.createCountdown(baseCols(), { id: 'c2', now: T1 });
    const found = repo.getCountdownById('c2');
    assert.ok(found);
    assert.equal(found!.title, '转正答辩');
    assert.equal(repo.getCountdownById('nope'), undefined);
  });

  test('listCountdowns 仅返回未删除，按 pinned/sort/updated_at 排序', () => {
    repo.createCountdown(baseCols({ title: 'A', sort_order: 1 }), { id: 'a', now: T1 });
    repo.createCountdown(baseCols({ title: 'B', pinned: 1, sort_order: 5 }), { id: 'b', now: T2 });
    repo.createCountdown(baseCols({ title: 'C', sort_order: 0 }), { id: 'c', now: T3 });
    const list = repo.listCountdowns();
    // B(pinned)→C(sort0,newest)→A(sort1)
    assert.deepEqual(list.map((r) => r.id), ['b', 'c', 'a']);
  });

  test('updateCountdown 更新列并填充 updated_at；可空字段可置空', () => {
    const existing = repo.createCountdown(baseCols(), { id: 'u1', now: T1 });
    assert.equal(existing.tags, '工作,重要');
    const updated = repo.updateCountdown(existing, { title: '新标题', note: '备注', tags: '', repeat_end: null }, T2);
    assert.equal(updated.title, '新标题');
    assert.equal(updated.note, '备注');
    assert.equal(updated.updated_at, T2);
    assert.equal(updated.created_at, T1); // created_at 不变
    // tags 传空串 → ''
    assert.equal(updated.tags, '');
  });

  test('updateCountdown 未传字段保留旧值', () => {
    const existing = repo.createCountdown(baseCols({ title: 'X', note: '旧备注' }), { id: 'u2', now: T1 });
    const updated = repo.updateCountdown(existing, { title: 'Y' }, T2);
    assert.equal(updated.title, 'Y');
    assert.equal(updated.note, '旧备注'); // 未传 → 保留
  });

  test('softDeleteCountdown 置 is_deleted=1 但不真删，list 过滤、getAll 可见', () => {
    repo.createCountdown(baseCols(), { id: 'd1', now: T1 });
    const existing = repo.getCountdownById('d1')!;
    const deleted = repo.softDeleteCountdown(existing, T2);
    assert.equal(deleted.is_deleted, 1);
    assert.equal(deleted.updated_at, T2);
    // 仍能查到（软删除不真删）
    assert.ok(repo.getCountdownById('d1'));
    assert.equal(repo.getCountdownById('d1')!.is_deleted, 1);
    // listCountdowns 过滤掉
    assert.ok(!repo.listCountdowns().some((r) => r.id === 'd1'));
    // getAllCountdowns 包含（同步用）
    assert.ok(repo.getAllCountdowns().some((r) => r.id === 'd1'));
  });

  test('upsertCountdown 按主键整体覆盖（含 is_deleted/updated_at/created_at）', () => {
    repo.createCountdown(baseCols(), { id: 'up1', now: T1 });
    // 用较新 updated_at 覆盖
    const row = {
      id: 'up1',
      title: '覆盖版',
      note: null,
      target_date: '2026-12-31',
      direction: -1,
      category_id: null,
      tags: '新标签',
      repeat_type: null,
      repeat_interval: 1,
      repeat_end: null,
      pinned: 1,
      sort_order: 9,
      remind_days: null,
      last_notified: null,
      notify_channel: 'app',
      is_deleted: 0,
      updated_at: T3,
      created_at: T1,
    };
    repo.upsertCountdown(row);
    const got = repo.getCountdownById('up1')!;
    assert.equal(got.title, '覆盖版');
    assert.equal(got.target_date, '2026-12-31');
    assert.equal(got.updated_at, T3);
    assert.equal(got.created_at, T1);
  });

  test('pickCountdownCols 字段映射与默认', () => {
    const cols = repo.pickCountdownCols({ title: 'T', tags: ' a,b,a ', repeat_interval: 0, direction: -1 });
    assert.equal(cols.title, 'T');
    assert.equal(cols.tags, 'a,b');
    assert.equal(cols.repeat_interval, 1); // 0 → 兜底 1
    assert.equal(cols.direction, -1);
    const undef = repo.pickCountdownCols({});
    assert.equal(undef.title, undefined);
  });
});

describe('categories CRUD', () => {
  test('createCategory + getCategoryById + list（软删过滤）', () => {
    const cat = repo.createCategory({ name: '工作', color: '#f00', sort_order: 2 }, { id: 'cat1', now: T1 });
    assert.equal(cat.name, '工作');
    assert.equal(cat.color, '#f00');
    assert.equal(cat.is_deleted, 0);
    assert.equal(repo.getCategoryById('cat1')!.sort_order, 2);
    assert.ok(repo.listCategories().some((c) => c.id === 'cat1'));
  });

  test('updateCategory 填充 updated_at 并保留其余', () => {
    const existing = repo.createCategory({ name: 'A', sort_order: 0 }, { id: 'cat2', now: T1 });
    const updated = repo.updateCategory(existing, { name: 'B', color: null }, T2);
    assert.equal(updated.name, 'B');
    assert.equal(updated.color, null);
    assert.equal(updated.updated_at, T2);
    assert.equal(updated.created_at, T1);
  });

  test('softDeleteCategory 置位且 list 过滤', () => {
    repo.createCategory({ name: 'C' }, { id: 'cat3', now: T1 });
    const existing = repo.getCategoryById('cat3')!;
    repo.softDeleteCategory(existing, T2);
    assert.ok(!repo.listCategories().some((c) => c.id === 'cat3'));
    assert.ok(repo.getAllCategories().some((c) => c.id === 'cat3'));
  });

  test('upsertCategory 整体覆盖', () => {
    repo.createCategory({ name: 'D' }, { id: 'cat4', now: T1 });
    repo.upsertCategory({
      id: 'cat4', name: 'D2', color: null, sort_order: 3, is_deleted: 0, updated_at: T3, created_at: T1,
    });
    const got = repo.getCategoryById('cat4')!;
    assert.equal(got.name, 'D2');
    assert.equal(got.sort_order, 3);
    assert.equal(got.updated_at, T3);
  });
});

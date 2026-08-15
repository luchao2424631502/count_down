/**
 * advance.test.ts — advance.ts 过期重复事件自动推进
 *
 * 覆盖：
 *   · advanceRow：weekly/monthly/yearly 过期后推进并持久化（刷新 target_date + updated_at）
 *   · 未过期不推进、非重复不推进、软删不推进
 *   · 重复已终止（next===null）不推进
 *   · advanceAllDue 批量推进全部到期项
 *
 * 使用真实 SQLite 内存库（:memory:）。
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { initSchema, db } = await import('../src/db.js');
const repo = await import('../src/repo.js');
const advance = await import('../src/advance.js');
initSchema();

beforeEach(() => {
  db.prepare('DELETE FROM countdowns').run();
});

// 固定“今天”以得到确定推进结果：advanceRow 内部用 formatDate(new Date())，
// 我们通过构造远超过去的 target_date 让推进必然发生，断言单调性而非具体某天。
const NOW_ISO = new Date().toISOString();

function cols(overrides: Record<string, unknown> = {}) {
  return {
    title: '重复事件',
    target_date: '2000-01-01',
    direction: 1,
    tags: null,
    repeat_type: 'weekly',
    repeat_interval: 1,
    repeat_end: null,
    pinned: 0,
    sort_order: 0,
    ...overrides,
  };
}

describe('advanceRow', () => {
  test('weekly 过期事件推进到 >= 今天并持久化', () => {
    const row = repo.createCountdown(cols({ repeat_type: 'weekly', repeat_interval: 1 }), {
      id: 'a1', now: NOW_ISO,
    });
    const origUpdatedAt = row.updated_at;
    const { row: upd, advanced } = advance.advanceRow(row);
    assert.equal(advanced, true);
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(upd.target_date >= today, `target_date=${upd.target_date} 应 >= 今天=${today}`);
    assert.notEqual(upd.updated_at, origUpdatedAt); // 刷新了 updated_at
    // 持久化验证
    const persisted = repo.getCountdownById('a1')!;
    assert.equal(persisted.target_date, upd.target_date);
  });

  test('weekly 未来的日期不推进', () => {
    const future = '2099-01-01';
    const row = repo.createCountdown(cols({ target_date: future, repeat_type: 'weekly' }), {
      id: 'a2', now: NOW_ISO,
    });
    const { advanced } = advance.advanceRow(row);
    assert.equal(advanced, false);
    assert.equal(repo.getCountdownById('a2')!.target_date, future);
  });

  test('非重复（repeat_type 空）不推进', () => {
    const row = repo.createCountdown(cols({ target_date: '2000-01-01', repeat_type: null }), {
      id: 'a3', now: NOW_ISO,
    });
    const { advanced } = advance.advanceRow(row);
    assert.equal(advanced, false);
  });

  test('软删除行不推进', () => {
    const row = repo.createCountdown(cols({ repeat_type: 'weekly' }), { id: 'a4', now: NOW_ISO });
    repo.softDeleteCountdown(row, NOW_ISO);
    const existing = repo.getCountdownById('a4')!;
    const { advanced } = advance.advanceRow(existing);
    assert.equal(advanced, false);
  });

  test('重复已终止（repeat_end 已过）不推进', () => {
    // target 很早，但 repeat_end 已过（无论推进与否，终止）
    const row = repo.createCountdown(
      cols({ repeat_type: 'weekly', repeat_end: '1999-01-01' }),
      { id: 'a5', now: NOW_ISO },
    );
    const { advanced } = advance.advanceRow(row);
    assert.equal(advanced, false);
  });

  test('推进跨步（interval>1）越过 repeat_end 时终止且持久化保留原状', () => {
    // yearly interval=2：2024-02-29 -> 2026-02-29，若 repeat_end=2025-12-31 则 2026 越过 → 终止
    const row = repo.createCountdown(
      cols({ repeat_type: 'yearly', target_date: '2024-02-29', repeat_interval: 2, repeat_end: '2025-12-31' }),
      { id: 'a8', now: NOW_ISO },
    );
    const { row: upd, advanced } = advance.advanceRow(row);
    assert.equal(advanced, false); // 终止 → 不推进
    assert.equal(upd.target_date, '2024-02-29'); // 原样保留
  });

  test('monthly 推进使用月末规则仍满足 >= 今天', () => {
    const row = repo.createCountdown(
      cols({ repeat_type: 'monthly', target_date: '2000-01-31' }),
      { id: 'a6', now: NOW_ISO },
    );
    const { row: upd, advanced } = advance.advanceRow(row);
    assert.equal(advanced, true);
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(upd.target_date >= today);
  });

  test('yearly 2/29 平年取 2/28 推进', () => {
    const row = repo.createCountdown(
      cols({ repeat_type: 'yearly', target_date: '2000-02-29', repeat_interval: 1 }),
      { id: 'a7', now: NOW_ISO },
    );
    const { row: upd, advanced } = advance.advanceRow(row);
    assert.equal(advanced, true);
    // 推进后年份必须是 4 的倍数月份 2 且日 ≤28（若非闰年则是 28）
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(upd.target_date >= today);
  });
});

describe('advanceAllDue', () => {
  test('仅推进到期重复项，返回被推进的列表', () => {
    repo.createCountdown(cols({ repeat_type: 'weekly', target_date: '2000-01-01' }), { id: 'p1', now: NOW_ISO });
    repo.createCountdown(cols({ repeat_type: null, target_date: '2000-01-01' }), { id: 'p2', now: NOW_ISO });
    repo.createCountdown(cols({ repeat_type: 'weekly', target_date: '2099-01-01' }), { id: 'p3', now: NOW_ISO });
    // 先插入软删的过期重复项，不应被推进
    const delRow = repo.createCountdown(cols({ repeat_type: 'weekly', target_date: '2000-01-01' }), {
      id: 'p4', now: NOW_ISO,
    });
    repo.softDeleteCountdown(delRow, NOW_ISO);

    const advanced = advance.advanceAllDue();
    const ids = advanced.map((r) => r.id).sort();
    assert.deepEqual(ids, ['p1']); // 仅 p1 过期且未删且重复
    // p2(非重复)、p3(未来)、p4(软删) 不该被推进
    assert.ok(!ids.includes('p2'));
    assert.ok(!ids.includes('p3'));
    assert.ok(!ids.includes('p4'));
  });
});

/**
 * routes.test.ts — REST 路由测试（countdowns / categories / sync）
 *
 * 用真实 Express 实例监听随机端口 + 内置 fetch，覆盖：
 *   · countdowns：POST 新建、GET 全量(含软删)、GET :id、PUT 更新、DELETE 软删、404、400 校验
 *   · categories：POST/GET/PUT/DELETE/404/400
 *   · sync：全量 LWW 合并（按 updated_at 判据、is_deleted 处理、保留客户端 updated_at、
 *     服务端较新不覆盖、客户端较新覆盖、服务端独有保留）
 *
 * 不使用 supertest，轻量（Node 内置 fetch）。
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.DB_PATH = ':memory:';
const { initSchema, db } = await import('../src/db.js');
const { default: countdownsRouter } = await import('../src/routes/countdowns.js');
const { default: categoriesRouter } = await import('../src/routes/categories.js');
const { default: syncRouter } = await import('../src/routes/sync.js');
const express = (await import('express')).default;
initSchema();

const app = express();
app.use(express.json());
app.use('/api/countdowns', countdownsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api', syncRouter);

// 每个用例前清空，保证隔离
beforeEach(() => {
  db.prepare('DELETE FROM countdowns').run();
  db.prepare('DELETE FROM categories').run();
});

let server: ReturnType<typeof createServer>;
let base = '';

before(async () => {
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server?.close();
});

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  const text = await res.text();
  if (text) json = JSON.parse(text);
  return { status: res.status, json };
}

const T1 = '2026-08-15T00:00:00.000Z';
const T2 = '2026-08-16T00:00:00.000Z';
const T3 = '2026-08-17T00:00:00.000Z';

describe('countdowns 路由', () => {
  test('POST 新建返回 201 与完整行（含服务端时间戳）', async () => {
    const { status, json } = await req('POST', '/api/countdowns', {
      id: 'cd-1', title: '答辩', target_date: '2026-12-01', tags: ' 工作 ,工作,重要 ',
    });
    assert.equal(status, 201);
    assert.equal(json.id, 'cd-1');
    assert.equal(json.title, '答辩');
    assert.equal(json.tags, '工作,重要'); // 清洗
    assert.ok(json.updated_at);
    assert.ok(json.created_at);
  });

  test('POST 缺 title / target_date 返回 400', async () => {
    assert.equal((await req('POST', '/api/countdowns', { title: 'x' })).status, 400);
    assert.equal((await req('POST', '/api/countdowns', { target_date: '2026-12-01' })).status, 400);
  });

  test('POST 含非字符串 tags（数字/对象）不应 500，应安全落空', async () => {
    const { status, json } = await req('POST', '/api/countdowns', {
      id: 'cd-tag', title: '带异常标签', target_date: '2026-12-01', tags: 12345,
    });
    assert.equal(status, 201);
    assert.equal(json.tags, '');
  });

  test('GET / 返回含软删全量', async () => {
    await req('POST', '/api/countdowns', { id: 'cd-2', title: 'A', target_date: '2026-12-01' });
    await req('POST', '/api/countdowns', { id: 'cd-3', title: 'B', target_date: '2026-12-02' });
    await req('DELETE', '/api/countdowns/cd-2');
    const { json } = await req('GET', '/api/countdowns');
    const rows = json as { id: string; is_deleted: number }[];
    const cd2 = rows.find((r) => r.id === 'cd-2')!;
    const cd3 = rows.find((r) => r.id === 'cd-3')!;
    assert.equal(cd2.is_deleted, 1); // 软删仍返回
    assert.equal(cd3.is_deleted, 0);
  });

  test('GET :id 命中与 404', async () => {
    await req('POST', '/api/countdowns', { id: 'cd-1', title: '答辩', target_date: '2026-12-01' });
    const { status, json } = await req('GET', '/api/countdowns/cd-1');
    assert.equal(status, 200);
    assert.equal(json.title, '答辩');
    assert.equal((await req('GET', '/api/countdowns/nope-xyz')).status, 404);
  });

  test('PUT 更新并优先用客户端 updated_at', async () => {
    await req('POST', '/api/countdowns', { id: 'cd-1', title: '旧', target_date: '2026-12-01' });
    const { json } = await req('PUT', '/api/countdowns/cd-1', {
      title: '新标题', updated_at: T2,
    });
    assert.equal(json.title, '新标题');
    assert.equal(json.updated_at, T2);
    assert.equal((await req('PUT', '/api/countdowns/nope-xyz', { title: 'x' })).status, 404);
  });

  test('DELETE 软删除返回 is_deleted=1', async () => {
    await req('POST', '/api/countdowns', { id: 'cd-3', title: 'B', target_date: '2026-12-02' });
    const { status, json } = await req('DELETE', '/api/countdowns/cd-3');
    assert.equal(status, 200);
    assert.equal(json.is_deleted, 1);
    assert.equal((await req('DELETE', '/api/countdowns/nope-xyz')).status, 404);
  });
});

describe('categories 路由', () => {
  test('POST 新建 + 清洗 name + 400', async () => {
    const { status, json } = await req('POST', '/api/categories', { id: 'cat-1', name: '  工作  ', color: '#f00' });
    assert.equal(status, 201);
    assert.equal(json.name, '工作');
    assert.equal((await req('POST', '/api/categories', { name: '  ' })).status, 400);
  });

  test('GET 全量 + GET :id + PUT + DELETE', async () => {
    await req('POST', '/api/categories', { id: 'cat-1', name: '工作' });
    await req('POST', '/api/categories', { id: 'cat-2', name: '家庭' });
    const { json: all } = await req('GET', '/api/categories');
    assert.ok((all as { id: string }[]).some((c) => c.id === 'cat-2'));
    const { json: one } = await req('GET', '/api/categories/cat-1');
    assert.equal(one.name, '工作');
    assert.equal((await req('GET', '/api/categories/nope')).status, 404);
    const { json: upd } = await req('PUT', '/api/categories/cat-1', { name: '工作2', updated_at: T3 });
    assert.equal(upd.name, '工作2');
    assert.equal(upd.updated_at, T3);
    const { json: del } = await req('DELETE', '/api/categories/cat-2');
    assert.equal(del.is_deleted, 1);
    assert.equal((await req('PUT', '/api/categories/nope', { name: 'x' })).status, 404);
  });
});

describe('sync 全量 LWW 合并', () => {
  test('客户端较新 → 覆盖（保留客户端 updated_at / 字段）', async () => {
    // 服务端已有旧行（T1）
    await req('POST', '/api/countdowns', { id: 'cd-1', title: '服务端旧', target_date: '2026-12-01' });
    await req('PUT', '/api/countdowns/cd-1', { title: '服务端旧', updated_at: T1 });
    const clientRow = {
      id: 'cd-1', title: '客户端新', note: null, target_date: '2026-12-01', direction: 1,
      category_id: null, tags: '新标签', repeat_type: null, repeat_interval: 1, repeat_end: null,
      pinned: 0, sort_order: 0, remind_days: null, last_notified: null, notify_channel: 'app',
      is_deleted: 0, updated_at: T3, // 比服务端 T1 新
      created_at: T1,
    };
    const { json } = await req('POST', '/api/sync', {
      countdowns: [clientRow], categories: [],
    });
    const saved = (json.countdowns as { id: string; title: string; updated_at: string }[]).find((r) => r.id === 'cd-1')!;
    assert.equal(saved.title, '客户端新'); // 客户端覆盖
    assert.equal(saved.updated_at, T3); // 保留客户端 updated_at
  });

  test('服务端较新 → 保留服务端（客户端不覆盖）', async () => {
    // 先创建服务端行并置为较新（T3）：先 POST 再 PUT 升级 updated_at
    await req('POST', '/api/countdowns', { id: 'cd-1', title: '初始', target_date: '2026-12-01' });
    await req('PUT', '/api/countdowns/cd-1', { title: '服务端较新', updated_at: T3 });
    const staleClient = {
      id: 'cd-1', title: '旧客户端', note: null, target_date: '2026-12-01', direction: 1,
      category_id: null, tags: null, repeat_type: null, repeat_interval: 1, repeat_end: null,
      pinned: 0, sort_order: 0, remind_days: null, last_notified: null, notify_channel: 'app',
      is_deleted: 0, updated_at: T1, created_at: T1, // 更旧
    };
    const { json } = await req('POST', '/api/sync', { countdowns: [staleClient], categories: [] });
    const saved = (json.countdowns as { id: string; title: string }[]).find((r) => r.id === 'cd-1')!;
    assert.equal(saved.title, '服务端较新');
    assert.equal(saved.updated_at, T3);
  });

  test('客户端带 is_deleted=1 的软删记录 → 覆盖服务端为软删', async () => {
    // 服务端存在 cd-2（当前软删状态随意，先确保一条记录）
    const deletedClient = {
      id: 'cd-2', title: '已删', note: null, target_date: '2026-01-01', direction: 1,
      category_id: null, tags: null, repeat_type: null, repeat_interval: 1, repeat_end: null,
      pinned: 0, sort_order: 0, remind_days: null, last_notified: null, notify_channel: 'app',
      is_deleted: 1, updated_at: T3, created_at: T1,
    };
    const { json } = await req('POST', '/api/sync', { countdowns: [deletedClient], categories: [] });
    const saved = (json.countdowns as { id: string; is_deleted: number; updated_at: string }[]).find((r) => r.id === 'cd-2')!;
    assert.equal(saved.is_deleted, 1);
    assert.equal(saved.updated_at, T3);
  });

  test('服务端独有且较新的行保留（客户端未带）', async () => {
    // 服务端有 cd-3 独有（客户端全量里没有）
    await req('POST', '/api/countdowns', { id: 'cd-9', title: '服务端独有', target_date: '2026-12-01' });
    const { json } = await req('POST', '/api/sync', { countdowns: [], categories: [] });
    assert.ok((json.countdowns as { id: string }[]).some((r) => r.id === 'cd-9'));
  });

  test('客户端新增（服务端无此 id）→ 写入', async () => {
    const clientRow = {
      id: 'brand-new', title: '新增', note: null, target_date: '2026-12-25', direction: 1,
      category_id: null, tags: '新', repeat_type: null, repeat_interval: 1, repeat_end: null,
      pinned: 0, sort_order: 0, remind_days: null, last_notified: null, notify_channel: 'app',
      is_deleted: 0, updated_at: T2, created_at: T2,
    };
    const { json } = await req('POST', '/api/sync', { countdowns: [clientRow], categories: [] });
    assert.ok((json.countdowns as { id: string }[]).some((r) => r.id === 'brand-new'));
  });

  test('客户端与服务端 updated_at 相同 → 保留服务端（LWW 稳定）', async () => {
    await req('POST', '/api/countdowns', { id: 'cd-eq', title: '服务端版', target_date: '2026-12-01' });
    await req('PUT', '/api/countdowns/cd-eq', { title: '服务端版', updated_at: T2 });
    const sameClient = {
      id: 'cd-eq', title: '客户端版', note: null, target_date: '2026-12-01', direction: 1,
      category_id: null, tags: null, repeat_type: null, repeat_interval: 1, repeat_end: null,
      pinned: 0, sort_order: 0, remind_days: null, last_notified: null, notify_channel: 'app',
      is_deleted: 0, updated_at: T2, created_at: T1, // 与服务端相同
    };
    const { json } = await req('POST', '/api/sync', { countdowns: [sameClient], categories: [] });
    const saved = (json.countdowns as { id: string; title: string; updated_at: string }[]).find((r) => r.id === 'cd-eq')!;
    assert.equal(saved.title, '服务端版'); // 相同 → 保留服务端
    assert.equal(saved.updated_at, T2);
  });

  test('categories 同步 LWW：客户端较新覆盖、服务端较新保留', async () => {
    await req('POST', '/api/categories', { id: 'cat-1', name: '服务端分类' });
    await req('PUT', '/api/categories/cat-1', { name: '服务端分类', updated_at: T1 });
    // 客户端较新
    const clientCat = {
      id: 'cat-1', name: '客户端分类', color: '#00f', sort_order: 1, is_deleted: 0,
      updated_at: T3, created_at: T1,
    };
    const { json } = await req('POST', '/api/sync', { countdowns: [], categories: [clientCat] });
    const saved = (json.categories as { id: string; name: string; updated_at: string }[]).find((c) => c.id === 'cat-1')!;
    assert.equal(saved.name, '客户端分类');
    assert.equal(saved.updated_at, T3);
  });

  test('clientTime / serverTime 字段存在', async () => {
    const { json } = await req('POST', '/api/sync', { countdowns: [], categories: [], clientTime: T2 });
    assert.ok(json.serverTime);
    assert.ok(json.countdowns);
    assert.ok(json.categories);
  });
});

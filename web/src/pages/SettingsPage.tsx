/**
 * pages/SettingsPage.tsx —— 设置页：分类管理 + 云同步
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '@/stores/useStore';
import type { CategoryInput } from '@/types';

const PALETTE = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

export default function SettingsPage() {
  const categories = useStore((s) => s.categories);
  const upsertCategory = useStore((s) => s.upsertCategory);
  const removeCategory = useStore((s) => s.removeCategory);
  const sync = useStore((s) => s.sync);
  const syncing = useStore((s) => s.syncing);
  const offline = useStore((s) => s.offline);
  const lastSyncAt = useStore((s) => s.lastSyncAt);

  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[4]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [msg, setMsg] = useState('');

  const active = categories.filter((c) => c.is_deleted === 0).sort((a, b) => a.sort_order - b.sort_order);

  const addCat = async () => {
    if (!name.trim()) return;
    const input: CategoryInput = { name: name.trim(), color, sort_order: active.length };
    await upsertCategory(input);
    setName('');
    setMsg('分类已添加');
    setTimeout(() => setMsg(''), 2000);
  };

  const saveEdit = async (id: string) => {
    const cur = categories.find((c) => c.id === id);
    await upsertCategory({ name: editName.trim(), sort_order: cur?.sort_order ?? 0 }, id);
    setEditingId(null);
    setMsg('已更新');
    setTimeout(() => setMsg(''), 2000);
  };

  const onRemove = async (id: string) => {
    if (!window.confirm('删除该分类？（原关联倒计时将变为未分类）')) return;
    await removeCategory(id);
  };

  const onSync = async () => {
    setMsg('');
    try {
      await sync();
      setMsg('✅ 同步完成');
    } catch {
      setMsg('❌ 同步失败，请检查网络/后端');
    }
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">设置与同步</h2>

      {/* 云同步 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <h3 className="font-semibold mb-2">云同步</h3>
        <p className="text-sm text-gray-500 mb-3">
          全量 LWW 同步（updated_at 最后写者获胜）。离线状态会保留本地缓存。
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onSync}
            disabled={syncing}
            className="flex-1 rounded-xl bg-indigo-600 py-3 text-white font-semibold disabled:opacity-60"
          >
            {syncing ? '同步中…' : '☁ 立即同步'}
          </button>
          {offline && <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-600">离线</span>}
        </div>
        {msg && <p className="text-sm text-gray-600 mt-2">{msg}</p>}
        {lastSyncAt && <p className="text-[11px] text-gray-400 mt-2">上次同步：{lastSyncAt.slice(0, 19).replace('T', ' ')}</p>}
      </div>

      {/* 分类管理 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <h3 className="font-semibold mb-3">分类管理</h3>

        {/* 新增 */}
        <div className="flex gap-2 mb-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCat()}
            placeholder="新分类名称"
            className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button onClick={addCat} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-white text-sm font-medium">
            ＋
          </button>
        </div>

        {/* 颜色选择（新增用） */}
        <div className="flex gap-2 flex-wrap mb-4">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="h-8 w-8 rounded-full border-2"
              style={{ backgroundColor: c, borderColor: color === c ? '#4f46e5' : 'transparent' }}
              aria-label={`选择颜色 ${c}`}
            />
          ))}
        </div>

        {/* 列表 */}
        {active.length === 0 ? (
          <p className="text-sm text-gray-400">暂无分类，添加一个吧。</p>
        ) : (
          <ul className="space-y-2">
            {active.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2">
                <span className="h-4 w-4 rounded-full flex-shrink-0" style={{ backgroundColor: c.color ?? '#cbd5e1' }} />
                {editingId === c.id ? (
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(c.id)}
                    autoFocus
                    className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                  />
                ) : (
                  <span className="flex-1 text-sm">{c.name}</span>
                )}
                {editingId === c.id ? (
                  <button onClick={() => saveEdit(c.id)} className="text-xs text-indigo-600">保存</button>
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(c.id);
                      setEditName(c.name);
                    }}
                    className="text-xs text-gray-500"
                  >
                    改
                  </button>
                )}
                <button onClick={() => onRemove(c.id)} className="text-xs text-red-500">
                  删
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-center text-xs text-gray-400">
        <Link to="/" className="underline">返回列表</Link>
      </p>
    </section>
  );
}

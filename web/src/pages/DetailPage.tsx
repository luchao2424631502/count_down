/**
 * pages/DetailPage.tsx —— 倒计时详情 + 编辑 / 新增
 *
 * 路径：/countdown/:id  详情（含编辑） ; /new  新增。
 * 细节：展示计算天数、重复推进按钮、提醒状态；编辑复用 CountdownForm。
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import CountdownForm from '@/components/CountdownForm';
import { useStore } from '@/stores/useStore';
import { daysUntil, dueReminders, nextTriggerDate, tagsToArray } from '@/utils/date';

export default function DetailPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new' || !id;
  const navigate = useNavigate();

  const countdowns = useStore((s) => s.countdowns);
  const categories = useStore((s) => s.categories);
  const addCountdown = useStore((s) => s.addCountdown);
  const updateCountdown = useStore((s) => s.updateCountdown);
  const removeCountdown = useStore((s) => s.removeCountdown);

  const [editing, setEditing] = useState(isNew);
  const cur = isNew ? undefined : countdowns.find((c) => c.id === id);

  if (!isNew && cur?.is_deleted) {
    return (
      <section className="py-20 text-center">
        <p className="text-gray-500 mb-4">该倒计时已删除</p>
        <Link to="/" className="text-indigo-600 underline">返回列表</Link>
      </section>
    );
  }
  if (!isNew && !cur) {
    return (
      <section className="py-20 text-center">
        <p className="text-gray-500 mb-4">加载中…</p>
        <Link to="/" className="text-indigo-600 underline">返回列表</Link>
      </section>
    );
  }
  const onSubmit = async (input: Parameters<typeof addCountdown>[0]) => {
    if (isNew) {
      await addCountdown(input);
      navigate('/');
    } else if (cur) {
      await updateCountdown(cur.id, input);
      setEditing(false);
    }
  };

  const onDelete = async () => {
    if (!cur) return;
    if (!window.confirm(`删除「${cur.title}」？(可同步清除)`)) return;
    await removeCountdown(cur.id);
    navigate('/');
  };

  const onAdvance = async () => {
    if (!cur || !cur.repeat_type) return;
    const next = nextTriggerDate(cur.target_date, cur.repeat_type, cur.repeat_interval, cur.repeat_end);
    if (next && next !== cur.target_date) {
      await updateCountdown(cur.id, { target_date: next });
    }
  };

  const raw = cur ? daysUntil(cur.target_date) : 0;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const due = cur ? dueReminders(cur.target_date, cur.remind_days, todayStr) : [];

  return (
    <section>
      <Link to="/" className="inline-block text-indigo-600 text-sm mb-3">← 返回</Link>

      {editing || isNew ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">{isNew ? '新增倒计时' : '编辑倒计时'}</h2>
          <CountdownForm categories={categories} initial={cur} onSubmit={onSubmit} onCancel={isNew ? () => navigate('/') : () => setEditing(false)} submitLabel={isNew ? '创建' : '保存'} />
        </div>
      ) : cur ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">{cur.title}</h2>
            <button onClick={() => setEditing(true)} className="rounded-xl bg-indigo-50 text-indigo-600 px-3 py-1.5 text-sm">
              编辑
            </button>
          </div>

          <div className={`text-5xl font-bold mb-2 ${raw === 0 ? 'text-emerald-500' : raw > 0 ? 'text-indigo-600' : 'text-gray-400'}`}>
            {Math.abs(raw)}
            <span className="text-base font-normal text-gray-400 ml-1">天</span>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            {cur.direction === -1 ? '已过' : raw > 0 ? '还有' : raw === 0 ? '就是今天' : '已过'} {cur.target_date}
          </p>

          {cur.note && <p className="text-sm text-gray-600 mb-3">📝 {cur.note}</p>}

          {cur.repeat_type && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-600">
                🔁 {cur.repeat_type} ×{cur.repeat_interval}
              </span>
              {cur.repeat_end && <span className="text-xs text-gray-400">至 {cur.repeat_end}</span>}
              <button onClick={onAdvance} className="text-xs text-indigo-600 underline ml-auto">
                推进到下次
              </button>
            </div>
          )}

          {tagsToArray(cur.tags).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {tagsToArray(cur.tags).map((t) => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">#{t}</span>
              ))}
            </div>
          )}

          {due.length > 0 && (
            <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">
              🔔 今天应提醒（提前 {due.map((d) => d.daysBefore).join('、')} 天）
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-gray-100 flex justify-between">
            <button onClick={onDelete} className="text-sm text-red-600 underline">
              删除
            </button>
            <span className="text-[11px] text-gray-400">
              {cur.pinned === 1 ? '📌 置顶 · ' : ''}更新 {cur.updated_at.slice(0, 10)}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

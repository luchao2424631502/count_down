/**
 * components/CountdownForm.tsx —— 倒计时新增/编辑表单
 *
 * 字段覆盖 schema.sql 全部可编辑项：
 *   标题 / 备注 / 目标日期 / direction / 分类 / 标签 / 重复类型 weekly|monthly|yearly + interval / 重复终止 / 置顶 / 排序 / 提醒天数 JSON。
 * 移动优先：单列、大触控目标（>=48px）、数字禁用缩放。
 */

import { useState, type FormEvent } from 'react';
import type { Category, Countdown, CountdownInput, Direction, RepeatType } from '@/types';
import { cleanTags } from '@/utils/date';

interface Props {
  categories: Category[];
  initial?: Countdown;
  onSubmit: (input: CountdownInput) => Promise<void> | void;
  onCancel?: () => void;
  submitLabel?: string;
}

type FormState = {
  title: string;
  note: string;
  target_date: string;
  direction: Direction;
  category_id: string;
  tags: string;
  repeat_type: RepeatType;
  repeat_interval: string;
  repeat_end: string;
  pinned: boolean;
  sort_order: string;
  remind_days: string; // 逗号分隔数字
};

const EMPTY: FormState = {
  title: '',
  note: '',
  target_date: '',
  direction: 1,
  category_id: '',
  tags: '',
  repeat_type: '',
  repeat_interval: '1',
  repeat_end: '',
  pinned: false,
  sort_order: '0',
  remind_days: '',
};

function fromCountdown(c: Countdown): FormState {
  let remind = '';
  try {
    if (c.remind_days) {
      const arr = JSON.parse(c.remind_days);
      if (Array.isArray(arr)) remind = arr.join(',');
    }
  } catch {
    /* ignore */
  }
  return {
    title: c.title,
    note: c.note ?? '',
    target_date: c.target_date,
    direction: c.direction ?? 1,
    category_id: c.category_id ?? '',
    tags: c.tags ?? '',
    repeat_type: c.repeat_type ?? '',
    repeat_interval: String(c.repeat_interval ?? 1),
    repeat_end: c.repeat_end ?? '',
    pinned: c.pinned === 1,
    sort_order: String(c.sort_order ?? 0),
    remind_days: remind,
  };
}

const inputCls =
  'w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white';
const labelCls = 'block text-sm font-medium text-gray-600 mb-1';

export default function CountdownForm({ categories, initial, onSubmit, onCancel, submitLabel = '保存' }: Props) {
  const [f, setF] = useState<FormState>(initial ? fromCountdown(initial) : EMPTY);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((s) => ({ ...s, [k]: v }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return; // 防连点：提交期间拒绝再次触发
    const target_date = f.target_date.trim();
    if (!f.title.trim()) return setError('请填写标题');
    if (!target_date) return setError('请选择目标日期');

    let remind_days: string | null = null;
    if (f.remind_days.trim()) {
      const arr = f.remind_days
        .split(/[,，\s]+/)
        .map((x) => parseInt(x, 10))
        .filter((x) => Number.isFinite(x) && x >= 0);
      const uniq = [...new Set(arr)].sort((a, b) => a - b);
      remind_days = JSON.stringify(uniq);
    }

    setSubmitting(true);
    try {
      await onSubmit({
        title: f.title.trim(),
        note: f.note.trim() || null,
        target_date,
        direction: f.direction,
        category_id: f.category_id || null,
        tags: cleanTags(f.tags),
        repeat_type: f.repeat_type,
        repeat_interval: Math.max(1, Math.floor(parseInt(f.repeat_interval || '1', 10) || 1)),
        repeat_end: f.repeat_end || null,
        pinned: f.pinned ? 1 : 0,
        sort_order: Math.floor(parseInt(f.sort_order || '0', 10) || 0),
        remind_days,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="rounded-xl bg-red-50 text-red-600 text-sm px-3 py-2">{error}</div>}

      <div>
        <label className={labelCls}>标题 *</label>
        <input className={inputCls} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="如：转正答辩" />
      </div>

      <div>
        <label className={labelCls}>备注</label>
        <textarea className={`${inputCls} h-20 resize-none`} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="选填" />
      </div>

      <div>
        <label className={labelCls}>目标日期 *</label>
        <input
          className={inputCls}
          type="date"
          value={f.target_date}
          onChange={(e) => set('target_date', e.target.value)}
        />
      </div>

      <div>
        <label className={labelCls}>方向</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => set('direction', 1)}
            className={`rounded-xl border px-3 py-2.5 text-center text-base ${
              f.direction === 1 ? 'border-indigo-500 bg-indigo-50 text-indigo-600 font-medium' : 'border-gray-300 bg-white text-gray-500'
            }`}
          >
            倒数（未来）
          </button>
          <button
            type="button"
            onClick={() => set('direction', -1)}
            className={`rounded-xl border px-3 py-2.5 text-center text-base ${
              f.direction === -1 ? 'border-indigo-500 bg-indigo-50 text-indigo-600 font-medium' : 'border-gray-300 bg-white text-gray-500'
            }`}
          >
            正数（已过）
          </button>
        </div>
      </div>

      <div>
        <label className={labelCls}>分类</label>
        <select className={inputCls} value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>
          <option value="">未分类</option>
          {categories
            .filter((c) => c.is_deleted === 0)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>标签（逗号分隔）</label>
        <input className={inputCls} value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="生日,重要" />
      </div>

      <div>
        <label className={labelCls}>重复</label>
        <div className="grid grid-cols-4 gap-1.5">
          {([
            ['', '不重复'],
            ['weekly', '每周'],
            ['monthly', '每月'],
            ['yearly', '每年'],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => set('repeat_type', v as RepeatType)}
              className={`rounded-xl border px-1 py-2 text-center text-sm ${
                f.repeat_type === v ? 'border-indigo-500 bg-indigo-50 text-indigo-600 font-medium' : 'border-gray-300 bg-white text-gray-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {f.repeat_type && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>间隔倍数</label>
              <input
                className={inputCls}
                type="number"
                min={1}
                inputMode="numeric"
                value={f.repeat_interval}
                onChange={(e) => set('repeat_interval', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>结束日期（可选）</label>
              <input className={inputCls} type="date" value={f.repeat_end} onChange={(e) => set('repeat_end', e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <div>
        <label className={labelCls}>提前提醒天数（逗号分隔，如 1,3,7）</label>
        <input
          className={inputCls}
          inputMode="numeric"
          value={f.remind_days}
          onChange={(e) => set('remind_days', e.target.value)}
          placeholder="1,3,7"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            className="h-5 w-5 accent-indigo-600"
            checked={f.pinned}
            onChange={(e) => set('pinned', e.target.checked)}
          />
          置顶
        </label>
        <div>
          <label className={labelCls}>排序（小在前）</label>
          <input
            className={inputCls}
            type="number"
            inputMode="numeric"
            value={f.sort_order}
            onChange={(e) => set('sort_order', e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-gray-300 bg-white py-3 text-base text-gray-600">
            取消
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-xl bg-indigo-600 py-3 text-base font-semibold text-white active:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? '保存中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export { fromCountdown, EMPTY };

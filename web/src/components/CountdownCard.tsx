/**
 * components/CountdownCard.tsx —— 单条倒计时卡片（移动优先）
 *
 * 移动端单列大卡片；PC(lg) 多列网格内自适应不变形。
 * 展示：标题 / 距目标日天数(倒数或正数) / 分类色条 / 置顶标记 / 标签 / 备注 / 重复徽标。
 */

import { Link } from 'react-router-dom';
import type { Category, Countdown } from '@/types';
import { dayText, daysUntil, tagsToArray } from '@/utils/date';

interface Props {
  countdown: Countdown;
  categories: Category[];
}

const REPEAT_LABEL: Record<string, string> = {
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
};

export default function CountdownCard({ countdown: c, categories }: Props) {
  const cat = c.category_id ? categories.find((x) => x.id === c.category_id) : undefined;
  const color = cat?.color || (c.pinned ? '#f59e0b' : '#cbd5e1');
  const raw = daysUntil(c.target_date);
  const tags = tagsToArray(c.tags);
  const isFuture = raw > 0;
  const isToday = raw === 0;

  const dayTextNum = dayText(c.target_date, c.direction);
  const dirLabel = c.direction === -1 ? '已过' : isToday ? '就是今天' : isFuture ? '还有' : '已过';

  return (
    <Link
      to={`/countdown/${c.id}`}
      className="block rounded-2xl bg-white p-4 shadow-sm border border-gray-100 active:scale-[0.99] transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {/* 分类色条 */}
          <span
            className="mt-1 h-10 w-1.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 truncate">
              {c.pinned === 1 && <span className="mr-1 text-amber-500">📌</span>}
              {c.title}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{c.target_date}</p>
            {c.note && <p className="text-xs text-gray-500 mt-1 truncate">{c.note}</p>}
          </div>
        </div>

        {/* 天数 */}
        <div className="flex flex-col items-end flex-shrink-0">
          <div className={`text-3xl font-bold leading-none ${isToday ? 'text-emerald-500' : isFuture ? 'text-indigo-600' : 'text-gray-400'}`}>
            {dayTextNum}
            <span className="text-xs font-normal text-gray-400 ml-1">天</span>
          </div>
          <span
            className={`mt-1 text-xs px-2 py-0.5 rounded-full ${
              isToday ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {dirLabel}
          </span>
        </div>
      </div>

      {/* 重复 + 标签 */}
      {(tags.length > 0 || c.repeat_type) && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {c.repeat_type && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
              🔁 {REPEAT_LABEL[c.repeat_type] ?? c.repeat_type}
              {c.repeat_interval > 1 ? `×${c.repeat_interval}` : ''}
            </span>
          )}
          {tags.map((t) => (
            <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">
              #{t}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

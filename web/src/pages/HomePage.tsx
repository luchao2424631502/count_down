/**
 * pages/HomePage.tsx —— 倒计时列表页（移动优先单列，PC lg 多列）
 *
 * 特性：
 *   · 移动端单列大卡片流；PC(lg:grid-cols-2 / xl:grid-cols-3) 多列。
 *   · 首屏 IndexedDB 离线秒开 + 刷新按钮/下拉触发云端同步。
 *   · 置顶优先 + sort_order + 创建时间排序。
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import CountdownCard from '@/components/CountdownCard';
import { useStore } from '@/stores/useStore';

export default function HomePage() {
  const countdowns = useStore((s) => s.countdowns);
  const categories = useStore((s) => s.categories);
  const loading = useStore((s) => s.loading);
  const offline = useStore((s) => s.offline);
  const init = useStore((s) => s.init);
  const refresh = useStore((s) => s.refresh);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => {
    return countdowns
      .filter((c) => c.is_deleted === 0)
      .slice()
      .sort((a, b) => {
        if ((b.pinned ?? 0) !== (a.pinned ?? 0)) return (b.pinned ?? 0) - (a.pinned ?? 0);
        if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
        return a.created_at.localeCompare(b.created_at);
      });
  }, [countdowns]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">我的倒计时</h2>
        <div className="flex items-center gap-2">
          {offline && <span className="px-2 py-1 text-[11px] rounded-full bg-amber-50 text-amber-600">离线</span>}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 active:bg-gray-100 disabled:opacity-60"
          >
            {refreshing ? '…' : '⟳ 刷新'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-white border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : sorted.length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-5xl mb-4">⏳</p>
          <p className="text-gray-500 mb-2">还没有倒计时</p>
          <Link to="/new" className="mt-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-white font-medium">
            ＋ 添加第一个
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {sorted.map((c) => (
            <CountdownCard key={c.id} countdown={c} categories={categories} />
          ))}
        </div>
      )}
    </section>
  );
}

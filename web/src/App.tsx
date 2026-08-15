import { Routes, Route, Link } from 'react-router-dom';
import HomePage from '@/pages/HomePage';
import DetailPage from '@/pages/DetailPage';
import SettingsPage from '@/pages/SettingsPage';

/**
 * App.tsx —— 路由 + 移动优先布局骨架
 *
 * 移动端：顶部标题栏 + 底部导航（列表/设置）+ 悬浮「+」新增。
 * PC(lg+)：内容居中不破版。
 */
function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-indigo-600 text-white px-4 py-3">
        <div className="mx-auto max-w-md md:max-w-3xl flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            <Link to="/">倒数日 ⏳</Link>
          </h1>
          <Link to="/settings" className="text-sm text-indigo-100" aria-label="设置">
            ⚙️
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-4 md:max-w-3xl pb-24 lg:pb-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/new" element={<DetailPage />} />
          <Route path="/countdown/:id" element={<DetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {/* 移动端悬浮新增按钮 */}
      <Link
        to="/new"
        className="fixed bottom-20 right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-3xl text-white shadow-lg lg:hidden"
        aria-label="新增倒计时"
      >
        ＋
      </Link>

      {/* 移动端底部导航 */}
      <footer className="fixed bottom-0 inset-x-0 z-10 border-t border-gray-200 bg-white lg:hidden pb-safe">
        <nav className="mx-auto max-w-md flex items-center justify-around py-2">
          <Link to="/" className="flex flex-col items-center text-xs text-indigo-600">
            <span className="text-lg leading-6">⏳</span>
            <span>倒计时</span>
          </Link>
          <Link to="/settings" className="flex flex-col items-center text-xs text-gray-500">
            <span className="text-lg leading-6">⚙️</span>
            <span>设置</span>
          </Link>
        </nav>
      </footer>
    </div>
  );
}

export default App;

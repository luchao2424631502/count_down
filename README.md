# countdown-pwa

自建云的「倒数日 / Days Matter」轻量 PWA。移动优先 + 响应式，前端 React，后端 TS+Node Express，SQLite 单库，云同步 LWW（单用户自用）。

## 项目结构

```
countdown-pwa/
├── package.json          # pnpm workspace 根
├── server/               # 后端 TS + Express + SQLite
│   ├── schema.sql        # 数据库定稿 DDL（countdowns + categories + 索引）
│   └── src/
│       ├── index.ts      # Express 入口（端口 3001）
│       ├── db.ts         # SQLite 连接 + 建表
│       └── routes/       # countdowns / categories / sync 路由
└── web/                  # 前端 React + Vite + Tailwind + PWA
    └── src/
        ├── main.tsx      # 入口
        ├── App.tsx       # 路由骨架
        └── pages/ components/ api/ stores/   # 目录占位
```

## 快速启动

```bash
# 1. 安装所有依赖（根 + server + web）
pnpm install

# 2. 后端（端口 3001，首次启动自动建表）
pnpm --filter server dev

# 3. 前端（Vite dev server）
pnpm --filter web dev
```

或一条命令同时启动前后端：

```bash
pnpm dev
```

## 前端功能（已实现）

- **倒计时列表**：移动优先单列卡片流，PC(`lg:`)多列；显示标题/距目标日天数(倒数或正数)/分类颜色/置顶/标签/备注/重复徽标；置顶优先+手动排序；首屏 IndexedDB 离线秒开 + 下拉/按钮刷新拉云端。
- **详情/新增/编辑**：标题/备注/目标日期/方向(倒数|正数)/分类/标签/重复类型(weekly|monthly|yearly)+间隔+终止日/置顶/排序/提前提醒天数；重复事件可手动“推进到下次”；软删除。
- **设置**：分类增删改（含颜色）+ 云同步触发按钮（全量 LWW）。
- **数据层**：IndexedDB(Dexie) 本地缓存 + `/api/countdowns`、`/api/categories`、`/api/sync` fetch 封装 + Zustand 状态管理；类型对齐 `server/schema.sql`。
- **PWA**：vite-plugin-pwa 生成 manifest + Service Worker(离线可用、可安装)。

## 前端单元测试

```bash
cd web && pnpm test        # vitest run
```

覆盖核心纯函数：天数计算、重复推进(weekly/monthly/yearly + 间隔/终止)、下一次触发日、提醒判定、tags 清洗、日期格式化。

## 技术要点

- 数据表定稿见 `server/schema.sql`，含 countdowns / categories 及 3 个索引。
- `is_deleted` 软删除，同步携带软删除记录。
- 云同步 LWW：以 `updated_at`（ISO/UTC）为判据，后写入者获胜。
- 移动优先，99% 安卓手机 + 1% PC 浏览器，布局自适应不破版。

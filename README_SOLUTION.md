# 倒计时 PWA · 技术方案（Self-hosted Countdown PWA）

> 自建云的「倒数日/Days Matter」轻量 PWA。前端倒计时 + 自建后端云同步，自用。
> 生成日期：2026-08-14

---

## 1. 需求总览

| 项 | 内容 |
|----|------|
| 形态 | **PWA**（Android 可添加到主屏离线使用） |
| 架构 | 前后端分离 |
| 前端 | 技术栈待定（方案见 §4，推荐 React + Vite） |
| 后端 | **TypeScript + Node.js**（Express/Fastify） |
| 功能 | **极简 MVP = 倒计时 + 云同步**，仅此两项 |
| 同步 | 自建服务器（self-hosted），自用数据，不做多用户/社交 |
| 端适配 | **移动优先 + 响应式（自适应手机/PC）**，为主力场景优化（见 §4.1） |
| 参照 | Days Matter（倒数日），但去掉农历/挂件/历史上的今天等 |

**端适配（响应式）需求 —— ★老板强调、移动优先**

- **使用场景**：约 **99% 时间在安卓手机上**使用，约 **1% 可能在电脑浏览器**上打开。
- **结论：这是一个「移动优先（mobile-first）」应用**，手机是主力端。
- **要求**：前端布局**必须自动适配 phone 与 PC**（Responsive Web Design / 自适应），
  - 手机端：为最常用场景，交互/排版优先做精、做大触控目标；
  - PC 端：作为次要端，可用即可 —— 布局**不能破**（不错位、不溢出、可正常浏览操作）。
- 此需求贯穿整个前端实现，属于**验收硬指标**，任何一次提交都不得破坏两端适配。

**明确不做（本期）**：用户注册体系（单用户）、桌面Widget、农历、历史上的今天、多端复杂冲突合并。

---

## 2. 架构概览

```
┌─────────────────────────┐         ┌──────────────────────┐
│   前端 PWA (React)       │  HTTPS  │   后端 API (TS+Node)  │
│  · 倒计时展示            │ ──────► │  · /api/auth          │
│  · 增删改倒计时          │  REST   │  · /api/countdowns    │
│  · IndexedDB 本地缓存    │  JSON   │  · /api/sync          │
│  · Service Worker 离线   │         │  · SQLite 存储        │
└─────────────────────────┘         └──────────────────────┘
        Android 浏览器/添加到主屏          自建服务器
```

- 单用户（自用），后端一套 API，前端一套 PWA。
- 前端本地缓存（IndexedDB）+ 后端云存储，两者可同步。

---

## 3. 数据模型

### 3.1 后端存储（SQLite）

> 定稿 DDL 见 `server/schema.sql`（可注释后直接落库）。以下表格 + 语义说明与之对应。

**语义约定① 重复事件**（★核心）
当 `repeat_type` 非空（`weekly` | `monthly` | `yearly`）时，`target_date` 定义为**「下一次触发日」**（非起始日）。触发完成后按推进规则累进 `target_date`：

| 类型 | 推进规则 |
|------|----------|
| monthly | 逐月 +1；当月无对应日取**当月最后一天**（如 1/31→2 月取 2/28） |
| yearly | 逐年 +1；2/29 遇平年取 **2/28** |
| weekly | 逐周 **+7 天** |

- 配合 `repeat_interval`，实际间隔 = 单位 × interval（如 `yearly`+interval=2 → 每 2 年）。
- 无重复（`repeat_type` 为空）时 `target_date` 即普通目标日，只触发一次。

**语义约定② 标签清洗**
`tags` 为逗号分隔字符串：单个标签**禁止含逗号**；入库前每个标签必须 **trim**；空标签剔除（不产生孤立逗号）。后端统一执行 `split(',')→trim→去空→去重→join(',')`。

**语义约定③ 通知去重**
`last_notified` 存**日期粒度 `YYYY-MM-DD`**（非时间戳），用于「今天这个重复触发日是否已提醒」的去重，避免重复推送。

---

**表：countdowns**

| 字段 | 类型/默认 | 说明 |
|------|-----------|------|
| id | TEXT (PK) | 客户端生成的 UUID |
| title | TEXT NOT NULL | 标题，如「转正答辩」 |
| note | TEXT | 备注（可选） |
| target_date | TEXT NOT NULL | ISO `YYYY-MM-DD`；有重复时为**下一次触发日**（约定①） |
| direction | INTEGER DEFAULT 1 | 1=倒数(未来)、-1=正数(已过) |
| category_id | TEXT | 关联 `categories.id`（可为空=未分类） |
| tags | TEXT | 逗号分隔；禁止含逗号、需 trim（约定②） |
| repeat_type | TEXT | 空=`weekly`/`monthly`/`yearly` |
| repeat_interval | INTEGER DEFAULT 1 | 重复间隔倍数（`>=1`），默认 1 不破坏既有 |
| repeat_end | TEXT | 重复终止日 YYYY-MM-DD（NULL=无限） |
| pinned | INTEGER DEFAULT 0 | 1=置顶 |
| sort_order | INTEGER DEFAULT 0 | 手动排序 |
| remind_days | TEXT | JSON 数组字符串，如 `'[1,3,7]'`（提前 N 天提醒） |
| last_notified | TEXT | `YYYY-MM-DD` 日期粒度，已提醒的触发日（约定③） |
| notify_channel | TEXT DEFAULT 'app' | 推送通道预留：`app`(默认)/`email`/`openclaw` |
| is_deleted | INTEGER DEFAULT 0 | 软删除：0=存在、1=已删 |
| updated_at | TEXT NOT NULL | LWW 冲突/同步判据 |
| created_at | TEXT NOT NULL | 创建时间 |

**表：categories**

| 字段 | 类型/默认 | 说明 |
|------|-----------|------|
| id | TEXT (PK) | 客户端生成的 UUID |
| name | TEXT NOT NULL | 分类名，如「工作」「家庭」 |
| color | TEXT | 展示色（CSS 色值，可选） |
| sort_order | INTEGER DEFAULT 0 | 排序 |
| is_deleted | INTEGER DEFAULT 0 | 软删除（与 countdowns 一致） |
| updated_at | TEXT NOT NULL | LWW 判据（分类也参与同步） |
| created_at | TEXT NOT NULL | 创建时间 |

**索引（云同步性能）**

| 索引 | 目标表/列 | 用途 |
|------|-----------|------|
| idx_countdowns_lww | countdowns `(is_deleted, updated_at)` | 全量 LWW 同步查询：未删除优先 + 按更新时间排序取变更 |
| idx_countdowns_category | countdowns `category_id` | 按分类筛选/联查 |
| idx_categories_updated | categories `updated_at` | 分类侧 LWW 同步/增量抓取 |

**表：sync_meta**（可选，简化版可并入）
- 记录本地与服务端同步游标，用于增量同步。

---

## 4. 前端技术选型（推荐）

| 项 | 选择 | 理由 |
|----|------|------|
| 框架 | **React + TypeScript** | 生态成熟、PWA 支持好 |
| 构建 | Vite | 快、轻、PWA 插件现成 |
| PWA | vite-plugin-pwa | 自动生成 manifest + Service Worker |
| 状态 | Zustand | 轻量，倒计时状态够用 |
| 本地存储 | IndexedDB（via Dexie） | 离线缓存倒计时数据 |
| UI | 纯 Tailwind / 极简手写 | 不引重 UI 库，自用轻量；**天然响应式**（见 §4.1） |

**备选**：SvelteKit（更轻）或 Vue3+Vite（你更熟 Vue 就用 Vue）。**若你无偏好，默认 React。**

### 4.1 响应式方案（移动优先）★

**需求**：99% 时间在**安卓手机**使用、约 1% 在 **PC 浏览器**。因此前端按**移动优先（mobile-first）**做响应式（RWD）适配，手机是主力、PC 次要且布局不破。

**技术落地（默认方案，Tailwind 提供）：**

- **移动优先断点**：以手机（默认/base）为基准设计，再通过 `sm/md/lg/xl` 断点向 PC 渐进增强。断点栅格：
  | 断点 | 宽度 | 设备取向 |
  |------|------|----------|
  | base（默认） | <640px | **手机（主力）** |
  | sm | ≥640px | 小平板 |
  | md | ≥768px | 平板 |
  | lg | ≥1024px | 桌面（次要点） |
  | xl | ≥1280px | 大屏 |
- **手法**：优先写移动端布局（单列、大按钮、58px+ 触控区），用 `lg:` 前缀覆写为 PC 多列/宽布局。零媒体查询手动管理，由 Tailwind 统一生成。
- **若未采用 Tailwind**：用原生 CSS **`@media (min-width: …)` 媒体查询**，断点同上，初始样式即手机端。
- **验收标准**：
  - 手机 360px~480px 宽：紧凑单列、触控友好、不横向滚动；
  - PC ≥1024px：内容居中、可宽限展示，布局不破（不错位/不溢出）。
- 注意：PWA `viewport` 元标签、`min-width/overflow` 处理要到位，防止手机端意外缩放/滚动。

---

## 5. API 设计（REST，JSON）

> Base: `https://<your-server>/api`

### 5.1 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /auth/login | 单用户登录，返回 token（自用可极简：固定口令→token）|

自用可简化为 **Bearer token 写死在环境变量** 或简单口令；不引入完整注册系统。

### 5.2 倒计时 CRUD
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /countdowns | 拉取全部（含已删标记） |
| GET | /countdowns/:id | 单条 |
| POST | /countdowns | 新建 |
| PUT | /countdowns/:id | 更新 |
| DELETE | /countdowns/:id | 软删除（置 is_deleted） |

### 5.3 同步
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /sync | 客户端提交本地变更集，服务端返回合并结果（以 updated_at 为准，最后一写获胜）|

**同步策略（MVP）**：全量同步即可——客户端启动时拉全量覆盖本地；本地改动上传覆盖服务端。冲突用 `updated_at` 最后写入为准（LWW）。单用户场景足够。

---

## 6. 目录结构（目标）

```
countdown-pwa/
├── README_SOLUTION.md       ← 本方案
├── server/                  ← 后端 TS+Node
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts         # 入口
│   │   ├── db.ts            # SQLite 初始化
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   └── countdowns.ts
│   │   └── types.ts
│   └── data/                # SQLite 文件（gitignore）
└── web/                     ← 前端 PWA
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api.ts           # 调后端
        ├── store.ts         # Zustand
        ├── db.ts            # IndexedDB(Dexie)
        └── components/
            └── CountdownList.tsx
```

---

## 7. 实施步骤（照此执行）

### Phase 0：初始化
- [ ] 建 server/、web/ 两套 package.json + tsconfig
- [ ] 根目录统一 .gitignore（node_modules、data/、dist/）

### Phase 1：后端
- [ ] 初始化 Express/Fastify + TS
- [ ] SQLite（better-sqlite3，同步简单）建表
- [ ] 实现 /api/auth（单用户 token）
- [ ] 实现 /api/countdowns CRUD（软删除）
- [ ] 实现 /api/sync（全量 LWW）
- [ ] 环境变量：PORT、TOKEN、DB_PATH

### Phase 2：前端
- [ ] Vite + React + TS 脚手架
- [ ] vite-plugin-pwa（manifest + SW，可离线打开）
- [ ] **移动优先响应式布局**：Tailwind（或 media query）按 §4.1 断点做手机/PC 自适应（手机主力，PC 不破）
- [ ] 倒计时列表 UI（标题、目标日、剩余天数）
- [ ] 增/改/删交互
- [ ] IndexedDB 本地缓存（离线可读写）
- [ ] api.ts 对接后端（axios/fetch），token 存 localStorage

### Phase 3：联调 + PWA 落地
- [ ] 本地起 server + web，CORS 配好
- [ ] 云同步闭环验证（改->上传->重开->拉取一致）
- [ ] build 前端，部署到自建服务器
- [ ] Android Chrome 打开 ->「添加到主屏」-> 验证离线可用
- [ ] **两端适配验收**：真机安卓（360~480px）+ PC 浏览器各过一遍，确认移动优先布局生效、PC 布局不破

---

## 8. 部署（自建服务器）

简化方案：
- 后端：Node 进程 + systemd / pm2 守护，SQLite 单文件
- 前端：build 产物静态托管（可由同一个 Node 服务 serve，或 Nginx）
- HTTPS：必须（PWA Service Worker 要求安全上下文）——用 Caddy 自动证书最省事
- 反代示例（Caddy）：`your.domain { reverse_proxy localhost:PORT }` 自动 HTTPS

---

## 9. 风险与取舍

| 点 | 说明 |
|----|------|
| PWA 需 HTTPS | 本地 localhost 可测，真机需 https/内网穿透 |
| 移动优先/响应式 | 手机（99%）为主力、PC（1%）次要不破；前端按 Tailwind 断点（§4.1）推进，验收时两端各过一遍 |
| 单用户简化 | 无多账户，token 写死或口令 |
| 冲突策略 LWW | 单用户基本不会冲突，够用 |
| 服务器 | 你可复用现有 clash 那台（47.x）或另开；端口自定 |

---

## 10. 待你确认项（开工前）

1. 前端用 **React** 可以吗？（无偏好就 React）
2. 后端框架 **Express** 还是 **Fastify**？（默认 Express，更简单）
3. 手机离家用 **内网 / 公网**？决定 HTTPS 与地址方案
4. 有没有目标服务器（复用现有 47.108.x 还是新的）？

> 你确认第 1-2 项即可开工；3-4 项联调部署时才需要。

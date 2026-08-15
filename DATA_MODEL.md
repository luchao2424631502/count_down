# 倒计时 PWA · 数据表定稿方案（权威文档）

> 本文件为**数据层定稿文档**，是后端建表与业务逻辑实现的**唯一开发依据**。
> 权威来源：`server/schema.sql`（DDL 可注释后直接落库）。本文件与 schema.sql 保持一致；
> 若出现差异，**以 `server/schema.sql` 为准**。
>
> 适用：自建单用户云同步倒计时 PWA（SQLite）。
> 生成日期：2026-08-14

---

## 目录

1. [表设计总览](#1-表设计总览)
2. [countdowns 表（倒计时条目）](#2-countdowns-表倒计时条目)
3. [categories 表（分类）](#3-categories-表分类)
4. [索引说明](#4-索引说明)
5. [关键语义约定](#5-关键语义约定)
6. [功能需求覆盖映射](#6-功能需求覆盖映射)
7. [注意事项 / 迁移说明](#7-注意事项--迁移说明)

---

## 1. 表设计总览

系统共 **2 张业务表**，均为 SQLite 存储，定义于 `server/schema.sql`：

| 表名 | 用途 |
|------|------|
| `countdowns` | **倒计时条目表**。承载全部倒计时业务数据：标题、目标日期、重复规则、标签、提醒、置顶排序、软删除与同步元信息。 |
| `categories` | **分类表**。为倒计时提供可选的分类分组（如「工作」「家庭」），并承载软删除与同步元信息。 |

> 同步模型：**单用户全量 LWW（Last-Write-Wins）**，以 `updated_at` 为冲突判据，`is_deleted` 做软删除（0=存在 / 1=已删），同步时携带软删除记录。
>
> 注：方案中还提到可选的 `sync_meta` 表（记录同步游标），本期 MVP 可并入简化逻辑，暂不列入定稿。

---

## 2. countdowns 表（倒计时条目）

### 2.1 完整 DDL

```sql
CREATE TABLE IF NOT EXISTS countdowns (
    id              TEXT    PRIMARY KEY,                -- 客户端生成的 UUID
    title           TEXT    NOT NULL,                   -- 标题，如「转正答辩」
    note            TEXT,                               -- 备注（可选）
    target_date     TEXT    NOT NULL,                   -- 见「重复事件语义约定」
    direction       INTEGER NOT NULL DEFAULT 1,         -- 1=倒数(未来)、-1=正数(已过)
    category_id     TEXT,                               -- 关联 categories.id（可为空=未分类）
    tags            TEXT,                               -- 逗号分隔字符串，见「标签清洗约定」
    repeat_type     TEXT,                               -- 空 / 'weekly' | 'monthly' | 'yearly'
    repeat_interval INTEGER NOT NULL DEFAULT 1 CHECK (repeat_interval >= 1),
    repeat_end      TEXT,                               -- 重复终止日 YYYY-MM-DD（NULL=无限）
    pinned          INTEGER NOT NULL DEFAULT 0,         -- 1=置顶
    sort_order      INTEGER NOT NULL DEFAULT 0,         -- 手动排序
    remind_days     TEXT,                               -- JSON 数组字符串，如 '[1,3,7]'
    last_notified   TEXT,                               -- YYYY-MM-DD 日期粒度（去重）
    notify_channel  TEXT DEFAULT 'app',                 -- 'app' | 'email' | 'openclaw'
    is_deleted      INTEGER NOT NULL DEFAULT 0,         -- 0=存在 / 1=已删（软删除）
    updated_at      TEXT    NOT NULL,                   -- ISO/UTC，LWW 冲突判据
    created_at      TEXT    NOT NULL                    -- ISO/UTC，创建时间
);
```

### 2.2 字段说明

| 字段 | 类型 / 默认 | 是否必填 | 说明 |
|------|-------------|:--------:|------|
| `id` | TEXT / (PK) | ✅ | 客户端生成的 UUID，主键。 |
| `title` | TEXT NOT NULL | ✅ | 标题，如「转正答辩」。 |
| `note` | TEXT | ❌ | 备注，可选。 |
| `target_date` | TEXT NOT NULL | ✅ | ISO `YYYY-MM-DD`。见 [§5.1 重复事件语义约定](#51-重复事件语义约定)：**无重复 = 普通目标日；有重复 = 下一次触发日**。 |
| `direction` | INTEGER NOT NULL DEFAULT 1 | ✅ | `1`=倒数（目标在未来）；`-1`=正数（目标已过）。 |
| `category_id` | TEXT | ❌ | 关联 `categories.id`；**可为空 = 未分类**。 |
| `tags` | TEXT | ❌ | 逗号分隔字符串。见 [§5.3 标签清洗约定](#53-标签清洗约定)。 |
| `repeat_type` | TEXT | ❌ | 空/NULL = 不重复；`'weekly'` / `'monthly'` / `'yearly'`。 |
| `repeat_interval` | INTEGER NOT NULL DEFAULT 1 | ✅ | 重复间隔倍数，`CHECK (>= 1)`，默认 1（每 1 单位）；支持「每 N 周/月/年」。 |
| `repeat_end` | TEXT | ❌ | 重复终止日 `YYYY-MM-DD`；**NULL = 无限重复**。 |
| `pinned` | INTEGER NOT NULL DEFAULT 0 | ✅ | `1`=置顶，列表优先展示。 |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | ✅ | 手动排序（同权重内）。 |
| `remind_days` | TEXT | ❌ | JSON 数组字符串，如 `'[1,3,7]'`，含义 = 提前 N 天提醒。 |
| `last_notified` | TEXT | ❌ | `YYYY-MM-DD` **日期粒度（非时间戳）**，记录最近已提醒的触发日，用于「今天这个 repeat 触发日是否已提醒」去重。 |
| `notify_channel` | TEXT DEFAULT 'app' | ✅ | 推送通道预留：`'app'`（默认）/ `'email'` / `'openclaw'`。 |
| `is_deleted` | INTEGER NOT NULL DEFAULT 0 | ✅ | 软删除：`0`=存在、`1`=已删（同步用，需携带软删记录）。 |
| `updated_at` | TEXT NOT NULL | ✅ | ISO 时间戳 / UTC，LWW 冲突与同步判据。 |
| `created_at` | TEXT NOT NULL | ✅ | ISO 时间戳 / UTC，创建时间。 |

> **提醒：** `repeat_type`、`remind_days`、`tags`、`last_notified` 为带语义的文本字段，其含义由业务层约定（见 §5），需在代码中保持一致性。

---

## 3. categories 表（分类）

### 3.1 完整 DDL

```sql
CREATE TABLE IF NOT EXISTS categories (
    id         TEXT    PRIMARY KEY,                    -- 客户端生成的 UUID
    name       TEXT    NOT NULL,                       -- 分类名，如「工作」「家庭」
    color      TEXT,                                   -- 展示色（CSS 色值，可选）
    sort_order INTEGER NOT NULL DEFAULT 0,             -- 排序
    is_deleted INTEGER NOT NULL DEFAULT 0,             -- 软删除（与 countdowns 一致）
    updated_at TEXT    NOT NULL,                       -- LWW 冲突判据
    created_at TEXT    NOT NULL
);
```

### 3.2 字段说明

| 字段 | 类型 / 默认 | 是否必填 | 说明 |
|------|-------------|:--------:|------|
| `id` | TEXT / (PK) | ✅ | 客户端生成的 UUID，主键。 |
| `name` | TEXT NOT NULL | ✅ | 分类名，如「工作」「家庭」。 |
| `color` | TEXT | ❌ | 展示色（CSS 色值，可选）。 |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | ✅ | 排序权重。 |
| `is_deleted` | INTEGER NOT NULL DEFAULT 0 | ✅ | 软删除（与 `countdowns` 语义一致，分类也参与软/增量同步）。 |
| `updated_at` | TEXT NOT NULL | ✅ | LWW 冲突 / 同步判据。 |
| `created_at` | TEXT NOT NULL | ✅ | 创建时间。 |

> 分类也有 `updated_at`，同样用作 LWW 判据 —— 分类**参与同步**。

---

## 4. 索引说明

共 **3 个索引**，服务于云同步查询与分类联查性能：

| 索引名 | 目标表 / 列 | 用途 |
|--------|-------------|------|
| `idx_countdowns_lww` | countdowns `(is_deleted, updated_at)` | **全量 LWW 云同步查询**：按「未删除优先展示」+「`updated_at` 排序取变更」命中该复合索引。 |
| `idx_countdowns_category` | countdowns `category_id` | **按分类筛选 / 联查 `categories` 加速**。 |
| `idx_categories_updated` | categories `updated_at` | **分类侧 LWW 同步排序 / 增量抓取**。 |

```sql
CREATE INDEX IF NOT EXISTS idx_countdowns_lww
    ON countdowns (is_deleted, updated_at);

CREATE INDEX IF NOT EXISTS idx_countdowns_category
    ON countdowns (category_id);

CREATE INDEX IF NOT EXISTS idx_categories_updated
    ON categories (updated_at);
```

---

## 5. 关键语义约定

以下为**业务层约定**，DDL 无法表达，后端实现时必须严格遵循，并保证与前端展示一致。

### 5.1 重复事件语义约定（★核心）

当 `repeat_type` 非空（`'weekly'` / `'monthly'` / `'yearly'`）时，**`target_date` 定义为「下一次触发日」**（而非起始日 / 创建日）。

每次触发完成后，由后端按推进规则**累进 `target_date`**，供下次触发判断：

| 类型 | 推进规则 |
|------|----------|
| `monthly` | 逐月 **+1 个月**；若该月无对应日（如 1/31 → 2 月），**取该月最后一天**。 |
| `yearly` | 逐年 **+1 年**；**2/29 遇平年取 2/28**。 |
| `weekly` | 逐周 **+7 天**。 |

- 配合 `repeat_interval`，**实际间隔 = 单位 × interval**：
  - 例：`yearly` + `interval=2` → 每 2 年一次；`weekly` + `interval=2` → 每 2 周一次。
- **无重复**（`repeat_type` 为 NULL / 空）时，`target_date` 即普通目标日期，事件**只触发一次**。

### 5.2 通知去重约定

- `last_notified` 为 **`YYYY-MM-DD` 日期粒度**（非时间戳）。
- 用于「**今天这个 repeat 触发日是否已提醒**」的去重，**避免重复推送**。
- 去重粒度以「触发日」为准：同一个触发日在同一天内推送一次即可。

### 5.3 标签清洗约定

`tags` 为**逗号分隔字符串**（例如 `'生日,重要'`），约定：

1. **单个标签内禁止包含逗号（`,`）**—— 逗号是唯一分隔符。
2. 入库前**每个标签必须 trim**（去除首尾空白）。
3. **空标签**（trim 后为空）**应当剔除**，不产生孤立逗号 / 空元素。

建议后端在写库前统一执行：
```
split(',') → trim → 去空 → 去重 → join(',')
```

### 5.4 云同步约定

- **模型**：单用户**全量同步**（客户端启动拉全量覆盖本地；本地改动上传覆盖服务端）。冲突以 **`updated_at` 最后写者获胜（LWW）**。
- **软删除**：删除 = 置 `is_deleted=1`（不物理删除），**同步时携带软删除记录**，保证多端一致清除。
- **判据**：两表均以 `updated_at`（ISO / UTC）为冲突判据。

---

## 6. 功能需求覆盖映射

将方案（README_SOLUTION.md）中的功能需求类目（A 基础 / B 增强 / C 预留接口）映射到对应字段：

| 需求类别 | 功能点 | 对应字段（countdowns） |
|----------|--------|------------------------|
| **A 基础** | 倒计时核心（标题 + 目标日 + 剩余天数） | `title`、`target_date`、`direction` |
| A 基础 | 备注 | `note` |
| A 基础 | 增 / 删 / 改 | `is_deleted`（软删）、`updated_at`、`created_at` |
| A 基础 | 云同步（全量 LWW） | `updated_at`（判据）、`is_deleted`（软删）、覆盖索引 `idx_countdowns_lww` / `idx_categories_updated` |
| **B 增强** | 重复事件（周 / 月 / 年 + 间隔 + 终止） | `repeat_type`、`repeat_interval`、`repeat_end` |
| B 增强 | 重复事件推进核心 `target_date`（下一次触发日） | `target_date`（语义约定 §5.1） |
| B 增强 | 分类分组 | `category_id`（联表 `categories`）、索引 `idx_countdowns_category` |
| B 增强 | 标签 | `tags`（清洗约定 §5.3） |
| B 增强 | 置顶 / 排序 | `pinned`、`sort_order` |
| B 增强 | 提前 N 天提醒 | `remind_days`（JSON 数组） |
| B 增强 | 提醒去重（避免重复推送） | `last_notified`（日期粒度，约定 §5.2） |
| B 增强 | 倒数 / 正数方向 | `direction` |
| **C 预留接口** | 推送通道扩展（app / email / openclaw） | `notify_channel` |
| C 预留接口 | 未来多端 / 更细同步扩展 | `id`（UUID 全局唯一）、`updated_at`、`created_at` |

> 说明：`categories` 表支撑「分类分组」增强项；`color` 字段为展示扩展预留。

> **关于端适配（移动优先 + 响应式）的说明**：
> 「手机（99%）主力 + PC（1%）次要不破」的响应式适配属于**纯前端展示层需求**（布局/断点/Tailwind），
> 不涉及任何数据表结构或字段变更；`countdowns` / `categories` 的存储与同步模型与展示端无关，
> 两端共用同一数据层。具体响应式方案见 `README_SOLUTION.md` §4.1。

---

## 7. 注意事项 / 迁移说明

- **SQLite 不支持 `ALTER TABLE` 添加带语义的列注释**，所有语义基于本文件与 `schema.sql` 顶部注释；修改 DDL 时须同步维护两处注释，避免语义漂移。
- `repeat_interval` 为**本次新增字段**（默认 1 + `CHECK >= 1`），**不影响既有写入**。
- `last_notified` 约定为**日期粒度 `YYYY-MM-DD`**，勿误存时间戳。
- `tags` 清洗约定与重复推进规则均为**业务层约定**，后端实现时遵循，前端展示保持一致。

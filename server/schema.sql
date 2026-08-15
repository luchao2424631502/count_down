-- ============================================================================
-- 倒计时 PWA · 数据库定稿 DDL  (SQLite)
-- 文件: server/schema.sql
-- 生成日期: 2026-08-14
--
-- 适用: 自建单用户云同步倒计时 PWA
-- 同步模型: 单用户全量 LWW (Last-Write-Wins)，以 updated_at 为判据，
--           is_deleted 软删除（0=存在, 1=已删），同步时携带软删除记录。
-- 注意: SQLite 不支持 ALTER TABLE 添加带语义的列注释，所有语义见本文件
--       顶部注释与各段注释，务必与后端代码 / 前端展示保持一致。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 表 1: countdowns —— 倒计时条目
--
-- 【重复事件语义约定】★核心★
--   当 repeat_type 非空（'weekly' | 'monthly' | 'yearly'）时，
--   target_date 字段定义为「下一次触发日」，而非起始日/创建日。
--   每次触发完成后由后端按推进规则累进 target_date，供下次触发判断：
--     · monthly : 逐月 +1 个月；若该月无对应日（如 1/31 → 2 月），
--                 取该月最后一天。
--     · yearly  : 逐年 +1 年；2/29 遇平年取 2/28。
--     · weekly  : 逐周 +7 天。
--   配合 repeat_interval，实际间隔 = 单位 × repeat_interval：
--     例: yearly + interval=2 → 每 2 年一次;  weekly + interval=2 → 每 2 周。
--   无重复（repeat_type 为 NULL/空）时，target_date 即普通目标日期，
--   事件只触发一次。
--
-- 【标签输入清洗约定】
--   tags 为逗号分隔字符串（例如 '生日,重要'），约定：
--     · 单个标签内禁止包含逗号（,）—— 逗号为唯一分隔符；
--     · 入库前每个标签必须 trim（去除首尾空白）；
--     · 空标签（trim 后为空）应剔除，不产生孤立逗号/空元素。
--   建议后端在写库前统一执行「split(',' ) → trim → 去空 → 去重 → join(',')」。
--
-- 【重复+提醒字段关系】
--   remind_days 为 JSON 数组（如 '[1,3,7]'），含义=提前 N 天提醒；
--   last_notified 记录「最近一次已提醒的触发日（YYYY-MM-DD）」，
--   用于『今天这个 repeat 触发日是否已提醒』的去重，避免重复推送。
-- ============================================================================

CREATE TABLE IF NOT EXISTS countdowns (
    id             TEXT    PRIMARY KEY,                -- 客户端生成的 UUID
    title          TEXT    NOT NULL,                   -- 标题，如「转正答辩」
    note           TEXT,                               -- 备注（可选）
    -- target_date: 见顶部【重复事件语义约定】。无重复=普通目标日；
    --              有重复=下一次触发日。ISO YYYY-MM-DD。
    target_date    TEXT    NOT NULL,
    direction      INTEGER NOT NULL DEFAULT 1,         -- 1=倒数(未来)、-1=正数(已过)
    category_id    TEXT,                               -- 关联 categories.id（可为空=未分类）
    tags           TEXT,                               -- 逗号分隔字符串，见【标签输入清洗约定】
    -- repeat_type: NULL/空=不重复；'weekly' | 'monthly' | 'yearly'（见顶部语义）
    repeat_type    TEXT,
    -- repeat_interval: 重复间隔倍数，配合 repeat_type。
    --   默认 1（每 1 周/月/年），支持「每 N 周/月/年」。
    repeat_interval INTEGER NOT NULL DEFAULT 1 CHECK (repeat_interval >= 1),
    -- repeat_end: 重复终止日期 YYYY-MM-DD（可选；NULL=无限重复）
    repeat_end     TEXT,
    pinned         INTEGER NOT NULL DEFAULT 0,         -- 1=置顶（列表优先展示）
    sort_order     INTEGER NOT NULL DEFAULT 0,         -- 手动排序（同权重内）
    remind_days    TEXT,                               -- JSON 数组字符串，如 '[1,3,7]'（提前 N 天提醒）
    -- last_notified: YYYY-MM-DD 日期粒度（非时间戳），
    --   记录最近已提醒的触发日，用于『今天是否已提醒』去重。
    last_notified  TEXT,
    -- notify_channel: 推送通道预留。'app'(默认) | 'email' | 'openclaw'
    notify_channel TEXT DEFAULT 'app',
    is_deleted     INTEGER NOT NULL DEFAULT 0,         -- 软删除: 0=存在, 1=已删（同步用）
    updated_at     TEXT NOT NULL,                      -- ISO 时间戳/UTC，LWW 冲突判据
    created_at     TEXT NOT NULL                       -- ISO 时间戳/UTC，创建时间
);

-- 索引 1: (is_deleted, updated_at) —— 全量 LWW 云同步查询用
--   同步时按「未删除优先展示」+「updated_at 排序取变更」，命中此复合索引。
CREATE INDEX IF NOT EXISTS idx_countdowns_lww
    ON countdowns (is_deleted, updated_at);

-- 索引 2: category_id —— 按分类筛选/联查 categories 加速
CREATE INDEX IF NOT EXISTS idx_countdowns_category
    ON countdowns (category_id);

-- ---------------------------------------------------------------------------
-- 表 2: categories —— 分类
--   updated_at 同样用作 LWW 判据；分类也参与软/增量同步。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
    id         TEXT    PRIMARY KEY,                    -- 客户端生成的 UUID
    name       TEXT    NOT NULL,                       -- 分类名，如「工作」「家庭」
    color      TEXT,                                   -- 展示色（CSS 色值，可选）
    sort_order INTEGER NOT NULL DEFAULT 0,             -- 排序
    is_deleted INTEGER NOT NULL DEFAULT 0,             -- 软删除（与 countdowns 一致）
    updated_at TEXT    NOT NULL,                       -- LWW 冲突判据
    created_at TEXT    NOT NULL
);

-- 索引 3: categories.updated_at —— 分类侧 LWW 同步排序/增量抓取
CREATE INDEX IF NOT EXISTS idx_categories_updated
    ON categories (updated_at);

-- ============================================================================
-- 迁移说明:
--   · repeat_interval 为本次新增字段（默认 1），不影响既有写入；
--   · last_notified 约定为日期粒度 YYYY-MM-DD；
--   · tags 清洗约定与重复推进规则为业务层约定，见顶部注释，后端实现时遵循。
-- ============================================================================

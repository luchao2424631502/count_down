/**
 * types/index.ts —— 对齐 server/schema.sql 的类型定义
 *
 * 两表: countdowns / categories，均为客户端/UUID 生成主键，LWW 同步。
 * 语义约定见 DATA_MODEL.md：
 *   · repeat_type: '' (不重复) | 'weekly' | 'monthly' | 'yearly'
 *   · target_date: 有重复时为「下一次触发日」
 *   · tags: 逗号分隔，禁止含逗号、需 trim、去空、去重
 *   · remind_days: JSON 数组字符串 '[1,3,7]'
 *   · last_notified: YYYY-MM-DD 日期粒度（去重）
 */

export type RepeatType = 'weekly' | 'monthly' | 'yearly' | '';

export type NotifyChannel = 'app' | 'email' | 'openclaw';

export type Direction = 1 | -1;

/** countdowns 表 —— 倒计时条目 */
export interface Countdown {
  /** 客户端生成的 UUID */
  id: string;
  /** 标题 */
  title: string;
  /** 备注（可选） */
  note?: string | null;
  /** ISO YYYY-MM-DD；有重复时为下一次触发日 */
  target_date: string;
  /** 1=倒数(未来)、-1=正数(已过) */
  direction: Direction;
  /** 关联 categories.id（可为空=未分类） */
  category_id?: string | null;
  /** 逗号分隔字符串，清洗约定见 DATA_MODEL §5.3 */
  tags?: string | null;
  /** 空=不重复 | 'weekly' | 'monthly' | 'yearly' */
  repeat_type: RepeatType;
  /** 重复间隔倍数，>=1 */
  repeat_interval: number;
  /** 重复终止日 YYYY-MM-DD（null=无限） */
  repeat_end?: string | null;
  /** 1=置顶 */
  pinned: number;
  /** 手动排序（同权重内） */
  sort_order: number;
  /** JSON 数组字符串，如 '[1,3,7]' */
  remind_days?: string | null;
  /** YYYY-MM-DD 日期粒度（去重） */
  last_notified?: string | null;
  /** 推送通道预留 */
  notify_channel: NotifyChannel;
  /** 软删除: 0=存在, 1=已删 */
  is_deleted: number;
  /** ISO/UTC，LWW 判据 */
  updated_at: string;
  /** ISO/UTC */
  created_at: string;
}

/** categories 表 —— 分类 */
export interface Category {
  /** 客户端生成的 UUID */
  id: string;
  /** 分类名 */
  name: string;
  /** 展示色（CSS 色值，可选） */
  color?: string | null;
  /** 排序 */
  sort_order: number;
  /** 软删除 */
  is_deleted: number;
  /** ISO/UTC，LWW 判据 */
  updated_at: string;
  /** ISO/UTC */
  created_at: string;
}

/** 新建/编辑倒计时的入参（去掉服务端/客户端生成字段） */
export type CountdownInput = {
  title: string;
  note?: string | null;
  target_date: string;
  direction: Direction;
  category_id?: string | null;
  tags?: string | null;
  repeat_type: RepeatType;
  repeat_interval: number;
  repeat_end?: string | null;
  pinned: number;
  sort_order: number;
  remind_days?: string | null;
  last_notified?: string | null;
  notify_channel?: NotifyChannel;
};

/** 新建/编辑分类的入参 */
export type CategoryInput = {
  name: string;
  color?: string | null;
  sort_order: number;
};

/** /api/sync 请求与响应体（全量 LWW 同步） */
export interface SyncPayload {
  countdowns: Countdown[];
  categories: Category[];
  /** 客户端当前时间，用于服务端 LWW 判断 */
  clientTime?: string;
}

export interface SyncResult {
  countdowns: Countdown[];
  categories: Category[];
  serverTime?: string;
}

/** 提醒判定结果 */
export interface Reminder {
  /** 触发提醒的天数（提前 N 天） */
  daysBefore: number;
  /** 触发日期 YYYY-MM-DD（= 目标日 - N 天） */
  remindOn: string;
}

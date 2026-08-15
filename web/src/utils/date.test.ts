/**
 * src/utils/date.test.ts —— 核心逻辑单元测试
 *
 * 覆盖：天数计算、重复推进、提醒判定、tags 清洗、日期格式化。
 */

import { describe, it, expect } from 'vitest';
import {
  daysUntil,
  dayText,
  formatDate,
  isValidDateStr,
  advanceRepeat,
  advanceMonth,
  advanceYear,
  advanceWeek,
  nextTriggerDate,
  dueReminders,
  parseRemindDays,
  cleanTags,
  tagsToArray,
} from './date';

describe('天数计算 daysUntil', () => {
  it('未来目标日返回正数（倒数）', () => {
    expect(daysUntil('2026-08-20', '2026-08-15')).toBe(5);
  });
  it('今天返回 0', () => {
    expect(daysUntil('2026-08-15', '2026-08-15')).toBe(0);
  });
  it('过去返回负数', () => {
    expect(daysUntil('2026-08-10', '2026-08-15')).toBe(-5);
  });
  it('跨月、跨年正确', () => {
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
    expect(daysUntil('2026-12-01', '2026-11-30')).toBe(1);
  });
  it('非法日期返回 0', () => {
    expect(daysUntil('bad-date', '2026-08-15')).toBe(0);
  });
});

describe('展示文本 dayText', () => {
  it('倒数（未来）显示正值', () => {
    expect(dayText('2026-08-20', 1, '2026-08-15')).toBe('5');
  });
  it('正数（已过）显示已过天数', () => {
    expect(dayText('2026-08-10', -1, '2026-08-15')).toBe('5');
  });
  it('正数今天=0', () => {
    expect(dayText('2026-08-15', -1, '2026-08-15')).toBe('0');
  });
  it('倒数已过取绝对值', () => {
    expect(dayText('2026-08-10', 1, '2026-08-15')).toBe('5');
  });
});

describe('日期格式化/校验', () => {
  it('formatDate 输出 YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
  it('isValidDateStr 校验', () => {
    expect(isValidDateStr('2026-08-15')).toBe(true);
    expect(isValidDateStr('2026-2-3')).toBe(false);
    expect(isValidDateStr('2026-13-40')).toBe(false);
    expect(isValidDateStr('abc')).toBe(false);
    expect(isValidDateStr('2026-02-29')).toBe(false); // 2026 非闰年
    expect(isValidDateStr('2024-02-29')).toBe(true);
  });
});

describe('重复推进 advanceRepeat', () => {
  it('weekly 逐周 +7 天', () => {
    expect(advanceWeek('2026-08-15', 1)).toBe('2026-08-22');
    expect(advanceWeek('2026-08-15', 2)).toBe('2026-08-29');
  });
  it('monthly +1 月：1/31 → 2/28（平年）', () => {
    expect(advanceMonth('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('monthly 闰年 1/31 → 2/29', () => {
    expect(advanceMonth('2024-01-31', 1)).toBe('2024-02-29');
  });
  it('monthly 常规 5/15 → 6/15', () => {
    expect(advanceMonth('2026-05-15', 1)).toBe('2026-06-15');
  });
  it('yearly 2/29 遇平年取 2/28', () => {
    expect(advanceYear('2024-02-29', 1)).toBe('2025-02-28');
  });
  it('yearly 闰年之间保持 2/29', () => {
    expect(advanceYear('2024-02-29', 4)).toBe('2028-02-29');
  });
  it('yearly 普通日期 +1 年', () => {
    expect(advanceYear('2026-08-15', 1)).toBe('2027-08-15');
  });
  it('advanceRepeat 分发到 weekly/monthly/yearly，不重复返回原值', () => {
    expect(advanceRepeat('2026-08-15', 'weekly', 1)).toBe('2026-08-22');
    expect(advanceRepeat('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(advanceRepeat('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
    expect(advanceRepeat('2026-08-15', '', 1)).toBe('2026-08-15');
  });
  it('interval=2 → 每 2 周/月/年', () => {
    expect(advanceRepeat('2026-08-15', 'weekly', 2)).toBe('2026-08-29');
    expect(advanceRepeat('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
    expect(advanceRepeat('2024-02-29', 'yearly', 2)).toBe('2026-02-28');
  });
});

describe('nextTriggerDate 下一次触发日（推进到 >= today）', () => {
  it('无重复直接返回原目标日', () => {
    expect(nextTriggerDate('2026-08-20', '', 1, null, '2026-08-15')).toBe('2026-08-20');
  });
  it('weekly 目标已过 → 推进到未来', () => {
    // 2026-08-08 已过，+7 → 08-15（正好今天，>= today 即停止）
    const r = nextTriggerDate('2026-08-08', 'weekly', 1, null, '2026-08-15');
    expect(r).toBe('2026-08-15');
  });
  it('monthly 已过目标推进', () => {
    const r = nextTriggerDate('2026-01-31', 'monthly', 1, null, '2026-03-01');
    // 01-31 → 02-28 仍 <03-01 → 03-31
    expect(r).toBe('2026-03-31');
  });
  it('达到 repeat_end 后返回 null（终止）', () => {
    const r = nextTriggerDate('2026-01-01', 'monthly', 1, '2026-01-01', '2026-03-01');
    expect(r).toBeNull();
  });
  it('repeat_end 未超时返回推进值', () => {
    const r = nextTriggerDate('2026-01-15', 'monthly', 1, '2026-12-31', '2026-02-20');
    expect(r).toBe('2026-03-15'); // 01-15→02-15(<02-20)→03-15
  });
  it('目标已是未来/今天则不变', () => {
    expect(nextTriggerDate('2026-08-20', 'weekly', 1, null, '2026-08-15')).toBe('2026-08-20');
  });
});

describe('提醒判定 dueReminders / parseRemindDays', () => {
  it('解析 remind_days JSON 数组', () => {
    expect(parseRemindDays('[1,3,7]')).toEqual([1, 3, 7]);
    expect(parseRemindDays('[7,1]')).toEqual([1, 7]); // 排序
    expect(parseRemindDays('null')).toEqual([]);
    expect(parseRemindDays('bad')).toEqual([]);
    expect(parseRemindDays('')).toEqual([]);
    expect(parseRemindDays('[true,2,-1,"x"]')).toEqual([2]); // 过滤非法
  });
  it('提前 N 天当天触发提醒', () => {
    // 目标 08-20，提前 5 天 → 应于 08-15 提醒
    const r = dueReminders('2026-08-20', '[5]', '2026-08-15');
    expect(r).toEqual([{ daysBefore: 5, remindOn: '2026-08-15' }]);
  });
  it('非提醒日不触发', () => {
    expect(dueReminders('2026-08-20', '[5]', '2026-08-16')).toEqual([]);
  });
  it('多档提前日分别在对应日期触发', () => {
    expect(dueReminders('2026-08-20', '[1,3,7]', '2026-08-17')).toEqual([
      { daysBefore: 3, remindOn: '2026-08-17' },
    ]);
    expect(dueReminders('2026-08-20', '[1,3,7]', '2026-08-13')).toEqual([
      { daysBefore: 7, remindOn: '2026-08-13' },
    ]);
  });
  it('空提醒或非法日期不触发', () => {
    expect(dueReminders('2026-08-20', null, '2026-08-15')).toEqual([]);
    expect(dueReminders('', '[5]', '2026-08-15')).toEqual([]);
  });
});

describe('tags 清洗 cleanTags', () => {
  it('trim 每个标签', () => {
    expect(cleanTags(' 生日 , 重要 ')).toBe('生日,重要');
  });
  it('剔除空标签，不产生孤立逗号', () => {
    expect(cleanTags('生日,,重要,,')).toBe('生日,重要');
    expect(cleanTags('')).toBe('');
    expect(cleanTags(null)).toBe('');
  });
  it('去重', () => {
    expect(cleanTags('生日,生日,重要')).toBe('生日,重要');
  });
  it('tagsToArray 返回数组', () => {
    expect(tagsToArray(' 生日 , 重要 , ')).toEqual(['生日', '重要']);
    expect(tagsToArray(null)).toEqual([]);
  });
});

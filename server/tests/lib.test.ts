/**
 * lib.test.ts — lib.ts 纯函数单元测试
 *
 * 覆盖：
 *   · 日期辅助：formatDate / isValidDateStr / parseDate / daysUntil
 *   · 重复推进：advanceWeek / advanceMonth / advanceYear / advanceRepeat
 *   · 下一次触发日 nextTriggerDate（weekly +7、monthly 逐月、yearly 2/29、
 *     repeat_interval、repeat_end 终止）
 *   · tags 清洗 cleanTags（split/trim/去空/去重/禁含逗号）
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTags,
  isValidDateStr,
  daysUntil,
  advanceWeek,
  advanceMonth,
  advanceYear,
  advanceRepeat,
  nextTriggerDate,
  formatDate,
  parseDate,
} from '../src/lib.js';

describe('日期辅助', () => {
  test('formatDate 补零', () => {
    assert.equal(formatDate(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(formatDate(new Date(2026, 11, 25)), '2026-12-25');
  });

  test('isValidDateStr 校验格式与真实日期', () => {
    assert.equal(isValidDateStr('2026-08-15'), true);
    assert.equal(isValidDateStr('2026-2-3'), false); // 需补零
    assert.equal(isValidDateStr('2026-02-30'), false); // 2 月无 30 日
    assert.equal(isValidDateStr('2026-13-01'), false); // 13 月
    assert.equal(isValidDateStr('2026-08-15T10:00'), false);
    assert.equal(isValidDateStr('abcd-ef-gh'), false);
    assert.equal(isValidDateStr('2024-02-29'), true); // 闰年 2/29 合法
    assert.equal(isValidDateStr('2023-02-29'), false); // 平年 2/29 非法
  });

  test('daysUntil 整天差', () => {
    assert.equal(daysUntil('2026-08-15', '2026-08-15'), 0);
    assert.equal(daysUntil('2026-08-20', '2026-08-15'), 5);
    assert.equal(daysUntil('2026-08-10', '2026-08-15'), -5);
    assert.equal(daysUntil('bad-date', '2026-08-15'), 0); // 非法返回 0
  });

  test('parseDate 解析', () => {
    const d = parseDate('2026-08-15');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 7);
    assert.equal(d.getDate(), 15);
  });
});

describe('重复推进', () => {
  test('advanceWeek +7 天', () => {
    assert.equal(advanceWeek('2026-08-15'), '2026-08-22');
    assert.equal(advanceWeek('2026-08-30', 2), '2026-09-13'); // 跨月
    // 跨年边界
    assert.equal(advanceWeek('2026-12-30'), '2027-01-06');
  });

  test('advanceMonth 逐月；无此日取月末', () => {
    assert.equal(advanceMonth('2026-08-15'), '2026-09-15');
    assert.equal(advanceMonth('2026-01-31'), '2026-02-28'); // 2 月无 31
    assert.equal(advanceMonth('2024-01-31'), '2024-02-29'); // 闰年 2/29
    assert.equal(advanceMonth('2026-08-31', 1), '2026-09-30'); // 9 月无 31 → 30
    // 跨年
    assert.equal(advanceMonth('2026-12-31'), '2027-01-31');
    // interval=3
    assert.equal(advanceMonth('2026-01-15', 3), '2026-04-15');
    // 从 1/31 推进两步：1/31→2/28→3/28（anchor 默认跟随当前 d，可能丢失锚点日）
    assert.equal(advanceMonth('2026-01-31', 1), '2026-02-28');
  });

  test('advanceMonth 保留 anchorDay 锚点', () => {
    // 锚点=31：1/31 +1月 +1月 应得 3/31（绕过 2 月无 31）
    assert.equal(advanceMonth('2026-01-31', 1, 31), '2026-02-28');
    // 从 1/31 anchor=31 连推两步到 3 月应回 31
    const first = advanceMonth('2026-01-31', 1, 31); // 2026-02-28
    assert.equal(advanceMonth(first, 1, 31), '2026-03-31');
  });

  test('advanceYear 逐年；2/29 平年取 2/28', () => {
    assert.equal(advanceYear('2026-08-15'), '2027-08-15');
    assert.equal(advanceYear('2024-02-29'), '2025-02-28'); // 2025 平年 → 2/28
    assert.equal(advanceYear('2024-02-29', 1), '2025-02-28');
    assert.equal(advanceYear('2024-02-29', 4), '2028-02-29'); // 2028 闰年保持 29
    assert.equal(advanceYear('2023-02-28'), '2024-02-28'); // 非 29 不受影响
  });

  test('advanceRepeat 按 repeat_type + interval 分发', () => {
    assert.equal(advanceRepeat('2026-08-15', 'weekly', 1), '2026-08-22');
    assert.equal(advanceRepeat('2026-08-15', 'weekly', 3), '2026-09-05'); // +21 天
    assert.equal(advanceRepeat('2026-01-31', 'monthly', 1, 31), '2026-02-28');
    assert.equal(advanceRepeat('2024-02-29', 'yearly', 1), '2025-02-28');
    assert.equal(advanceRepeat('2026-08-15', 'yearly', 2), '2028-08-15');
    // 不重复 / 未知类型不推进
    assert.equal(advanceRepeat('2026-08-15', '', 1), '2026-08-15');
    assert.equal(advanceRepeat('2026-08-15', 'daily', 1), '2026-08-15');
    // interval 兜底为至少 1
    assert.equal(advanceRepeat('2026-08-15', 'weekly', 0), '2026-08-22');
  });
});

describe('nextTriggerDate 下一次触发日', () => {
  const today = '2026-08-15';

  test('非重复返回原 target', () => {
    assert.equal(nextTriggerDate('2030-01-01', '', 1, null, today), '2030-01-01');
    assert.equal(nextTriggerDate('2030-01-01', 'none', 1, null, today), '2030-01-01');
  });

  test('weekly：已过期则推进到 >= today', () => {
    // 2026-08-13 是周四，+7 到 08-20（>= 08-15）
    assert.equal(nextTriggerDate('2026-08-13', 'weekly', 1, null, today), '2026-08-20');
    // 恰好今天
    assert.equal(nextTriggerDate('2026-08-15', 'weekly', 1, null, today), '2026-08-15');
    // 未来日期不动
    assert.equal(nextTriggerDate('2026-08-29', 'weekly', 1, null, today), '2026-08-29');
  });

  test('monthly：逐月推进 >= today', () => {
    // 从 07-20 推到 08-20
    assert.equal(nextTriggerDate('2026-07-20', 'monthly', 1, null, today), '2026-08-20');
    // 从 01-31 经 2 月推进（锚点 31），到 >= today 时应回 31 号月份
    // 01-31 -> 02-28 -> 03-31 -> ... -> 08-31
    assert.equal(nextTriggerDate('2026-01-31', 'monthly', 1, null, today), '2026-08-31');
  });

  test('yearly：2/29 平年取 2/28', () => {
    // 2024-02-29：2025-02-28(平年降为28) -> 2026-02-28(仍<today) -> 2027-02-28（>=today，停）
    // 2027-02-28 已晚于 2026-08-15，应返回 2027-02-28
    assert.equal(nextTriggerDate('2024-02-29', 'yearly', 1, null, today), '2027-02-28');
    // 验证闰年 2/29 在闰年返回时保持 29
    assert.equal(nextTriggerDate('2024-02-29', 'yearly', 4, null, '2027-01-01'), '2028-02-29');
  });

  test('repeat_interval=2 每 2 周', () => {
    // 2026-08-08 每 2 周 → 08-08, 08-22
    assert.equal(nextTriggerDate('2026-08-08', 'weekly', 2, null, today), '2026-08-22');
  });

  test('repeat_end 提前终止返回 null', () => {
    // weekly，target 已过，但 repeat_end 在本次推进之前 → 终止
    assert.equal(nextTriggerDate('2026-08-10', 'weekly', 1, '2026-08-15', today), null);
  });

  test('repeat_end 在推进范围内正常返回', () => {
    // weekly target 08-13 +7 → 08-20，repeat_end 08-31 未超
    assert.equal(nextTriggerDate('2026-08-13', 'weekly', 1, '2026-08-31', today), '2026-08-20');
  });

  test('already-past target with repeat_end equal to target', () => {
    // target 与 today 相同且 repeat_end = today → 返回 target（>=today 直接 break）
    assert.equal(nextTriggerDate('2026-08-15', 'weekly', 1, '2026-08-15', today), '2026-08-15');
  });
});

describe('cleanTags 标签清洗', () => {
  test('split + trim', () => {
    assert.equal(cleanTags(' 生日 , 重要 '), '生日,重要');
  });

  test('去空（连续逗号 / 首尾逗号）', () => {
    assert.equal(cleanTags('a,,b'), 'a,b');
    assert.equal(cleanTags(',a,b,'), 'a,b');
    assert.equal(cleanTags('a, ,b'), 'a,b');
  });

  test('去重（保留最先出现）', () => {
    assert.equal(cleanTags('a,b,a'), 'a,b');
    // trim 后再去重
    assert.equal(cleanTags(' a ,a'), 'a');
  });

  test('空输入返回空串', () => {
    assert.equal(cleanTags(''), '');
    assert.equal(cleanTags(null), '');
    assert.equal(cleanTags(undefined), '');
    assert.equal(cleanTags('   '), '');
    assert.equal(cleanTags(',,,,'), '');
  });

  test('单个合法标签保留', () => {
    assert.equal(cleanTags('生日'), '生日');
  });

  test('非字符串输入防御性处理（数字/对象/数组不抛错，返回空）', () => {
    assert.equal(cleanTags(12345 as unknown as string), '');
    assert.equal(cleanTags({ a: 1 } as unknown as string), '');
    assert.equal(cleanTags(['a', 'b'] as unknown as string), '');
  });
});

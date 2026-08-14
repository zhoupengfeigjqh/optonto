/**
 * 结果协议单元测试 —— 【状态】标记的解析与剔除。
 * 核心回归点：无标记 → 判失败（保守兜底，宁可多核实一次也不漏报失败副作用）。
 */
import { describe, it, expect } from 'vitest';
import { parseResultStatus, stripResultStatus, RESULT_STATUS_OK, RESULT_STATUS_FAIL } from './result-protocol.js';

describe('parseResultStatus', () => {
  it('有【状态】成功 → 成功', () => {
    expect(parseResultStatus(`已创建 PO-001\n${RESULT_STATUS_OK}`)).toEqual({ failed: false, found: true });
  });

  it('有【状态】失败 → 失败', () => {
    expect(parseResultStatus(`前置规则不通过\n${RESULT_STATUS_FAIL}`)).toEqual({ failed: true, found: true });
  });

  it('无状态标记 → 判失败（found=false，保守兜底）', () => {
    expect(parseResultStatus('已创建采购记录 PO-001')).toEqual({ failed: true, found: false });
  });

  it('多条标记取最后一条', () => {
    expect(parseResultStatus(`${RESULT_STATUS_FAIL} 自纠后 ${RESULT_STATUS_OK}`)).toEqual({ failed: false, found: true });
    expect(parseResultStatus(`${RESULT_STATUS_OK} 但实际 ${RESULT_STATUS_FAIL}`)).toEqual({ failed: true, found: true });
  });
});

describe('stripResultStatus', () => {
  it('剔除状态标记并 trim', () => {
    expect(stripResultStatus(`已创建 PO-001\n${RESULT_STATUS_OK}`)).toBe('已创建 PO-001');
  });
});

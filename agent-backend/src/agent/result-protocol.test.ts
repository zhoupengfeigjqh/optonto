/**
 * 结果协议单元测试 —— 【状态】标记的解析与剔除。
 * 核心回归点：无标记 → 判失败（保守兜底，宁可多核实一次也不漏报失败副作用）。
 */
import { describe, it, expect } from 'vitest';
import {
  parseResultStatus, stripResultStatus, formatResultStatus,
  RESULT_STATUS_OK, RESULT_STATUS_FAIL, RESULT_STATUS_RE,
} from './result-protocol.js';

/**
 * 生成侧（formatResultStatus）此前**无任何测试**，导致该函数两个分支
 * （成功/失败）都未被执行验证，branches 覆盖率停在 66%。
 * 它是「提示词里的标记」与「解析侧的正则」之间的契约锚点：
 * 一旦生成侧改文案而正则未改，子任务结果会被全部误判为「无标记 → 失败」。
 */
describe('formatResultStatus', () => {
  it('成功 → 生成【状态】成功（与解析侧正则严格对应）', () => {
    const text = formatResultStatus(true);
    expect(text).toBe(RESULT_STATUS_OK);
    // 契约锚点：生成结果必须能被自己的解析器识别为成功
    expect(parseResultStatus(`干完了${text}`)).toEqual({ failed: false, found: true });
  });

  it('失败 → 生成【状态】失败（可被解析为失败）', () => {
    const text = formatResultStatus(false);
    expect(text).toBe(RESULT_STATUS_FAIL);
    expect(parseResultStatus(`中途失败${text}`)).toEqual({ failed: true, found: true });
  });

  it('两端用同一常量（MUST NOT 各自硬编码字面量，否则一端改了就静默失配）', () => {
    expect(formatResultStatus(true)).toBe('【状态】成功');
    expect(formatResultStatus(false)).toBe('【状态】失败');
    // 正则能同时识别两种标记
    for (const t of [RESULT_STATUS_OK, RESULT_STATUS_FAIL]) {
      expect(new RegExp(RESULT_STATUS_RE.source).test(t)).toBe(true);
    }
  });
});

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

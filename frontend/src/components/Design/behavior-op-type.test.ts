/** behavior-op-type 单测：显式值优先、空/非法值按读推导（与后端 _resolve_op_type 同口径）。 */
import { describe, it, expect } from 'vitest';
import { resolveOpType, isWriteBehavior } from './behavior-op-type';

describe('resolveOpType', () => {
  it('显式 command / query 以其为准且非推导', () => {
    expect(resolveOpType({ op_type: 'command' })).toEqual({ type: 'command', derived: false });
    expect(resolveOpType({ op_type: 'query' })).toEqual({ type: 'query', derived: false });
  });

  it('空值与非法值推导为 query（derived=true）', () => {
    expect(resolveOpType({})).toEqual({ type: 'query', derived: true });
    expect(resolveOpType({ op_type: '' })).toEqual({ type: 'query', derived: true });
    expect(resolveOpType({ op_type: 'HTTP' })).toEqual({ type: 'query', derived: true });
  });
});

describe('isWriteBehavior', () => {
  it('仅显式 command 为写行为', () => {
    expect(isWriteBehavior({ op_type: 'command' })).toBe(true);
    expect(isWriteBehavior({ op_type: 'query' })).toBe(false);
    expect(isWriteBehavior({})).toBe(false);
  });
});

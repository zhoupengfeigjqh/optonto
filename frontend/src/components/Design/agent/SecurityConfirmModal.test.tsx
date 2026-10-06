/**
 * SecurityConfirmModal 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 重点是 2026-10-05 C3 新增的两个 prop：
 *  - `error`：回执失败原因就地展示，且**弹窗保持打开**（用户可重试或改为拒绝）。
 *    修复前弹窗一律关闭、失败被 `.catch(() => {})` 吞掉，用户以为已批准、实际后端已放弃。
 *  - `busy`：回执进行中禁用按钮，防连点与中途改主意。
 *
 * 本组件在 `AgentConversation.test.tsx` 中被替换为探针（那里只断言「弹窗不关闭」），
 * 故 busy/error 的实际呈现由本文件覆盖。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SecurityConfirmModal from './SecurityConfirmModal';

afterEach(() => { vi.clearAllMocks(); });

const modal = {
  confirmId: 'k1',
  behavior: 'CreatePurchaseRecord',
  content: '【行为】CreatePurchaseRecord\n【说明】创建采购记录',
  params: { supplier_id: 7, item_id: 3 },
};

function setup(over: { busy?: boolean; error?: string } = {}) {
  const onReject = vi.fn();
  const onApprove = vi.fn();
  render(
    <SecurityConfirmModal
      confirmModal={modal}
      countdown={42}
      busy={over.busy}
      error={over.error}
      onReject={onReject}
      onApprove={onApprove}
    />,
  );
  return { onReject, onApprove };
}

describe('SecurityConfirmModal — 属性传递', () => {
  it('展示行为名、倒计时与参数表', () => {
    setup();
    expect(screen.getByText('CreatePurchaseRecord')).toBeInTheDocument();
    expect(screen.getByText(/42 秒后自动取消/)).toBeInTheDocument();
    expect(screen.getByText('共 2 项')).toBeInTheDocument();
  });

  it('无 error 时不渲染错误条', () => {
    setup();
    expect(screen.queryByText(/回执通道不可用/)).not.toBeInTheDocument();
  });
});

describe('SecurityConfirmModal — 事件触发', () => {
  it('点「批准执行」回传 onApprove', () => {
    const { onApprove } = setup();
    fireEvent.click(screen.getByRole('button', { name: /批准执行/ }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('点「拒绝」回传 onReject', () => {
    const { onReject } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^拒\s*绝$/ }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});

describe('SecurityConfirmModal — 回执失败与进行中（C3）', () => {
  it('error 非空 → 就地展示原因，且弹窗仍在（用户仍可操作）', () => {
    const { onReject } = setup({ error: '回执失败：网络错误' });
    expect(screen.getByText('回执失败：网络错误')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /批准执行/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^拒\s*绝$/ })).toBeInTheDocument();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('busy → 点击「批准执行」不触发回调（防连点：重复批准会产生重复写入）', () => {
    const { onApprove } = setup({ busy: true });
    fireEvent.click(screen.getByRole('button', { name: /批准执行/ }));
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('busy + error 同时存在：既展示原因又阻止操作（回执进行中的失败重试窗口）', () => {
    const { onApprove } = setup({ busy: true, error: '服务器内部错误' });
    expect(screen.getByText('服务器内部错误')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /批准执行/ }));
    expect(onApprove).not.toHaveBeenCalled();
  });
});

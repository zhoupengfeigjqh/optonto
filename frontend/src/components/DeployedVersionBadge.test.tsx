/**
 * 「已部署」徽标：点击只弹基本元数据，不再展示完整 YAML（2026-10-19 口径）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/api/client', () => ({
  getDeployedOntology: vi.fn(),
}));

import DeployedVersionBadge from './DeployedVersionBadge';
import * as api from '@/api/client';

const DEPLOYED_YAML = `metadata:
  source_file: 需求.md
  source_thread: 线程A
  created_at: '2026-10-01 10:00:00'
  scenario_name: 生产调度
  scenario_id: 3
  ontology_name: 采购本体
  ontology_id: 7
  deployed_version: v1.2
concepts:
- name: PurchaseOrder
  display_name: 采购单
`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getDeployedOntology).mockResolvedValue({ content: DEPLOYED_YAML });
});

describe('DeployedVersionBadge', () => {
  it('点击后只展示基本元数据，不渲染完整 YAML', async () => {
    const { container } = render(<DeployedVersionBadge ontologyId={7} deployedVersion="v1.2" />);

    fireEvent.click(screen.getByText('已部署: v1.2'));

    await waitFor(() => expect(screen.getByText('本体部署元数据')).toBeTruthy());
    expect(screen.getByText('采购本体')).toBeTruthy();
    expect(screen.getByText('生产调度')).toBeTruthy();
    expect(screen.getByText('需求.md')).toBeTruthy();
    expect(screen.getByText('2026-10-01 10:00:00')).toBeTruthy();

    // 不允许再出现 YAML 代码视图或概念节内容
    expect(container.querySelector('.cm-editor')).toBeNull();
    expect(screen.queryByText(/name: PurchaseOrder/)).toBeNull();
  });

  it('未部署时不渲染可点击标签', () => {
    render(<DeployedVersionBadge ontologyId={7} deployedVersion="" />);
    expect(screen.getByText('未部署')).toBeTruthy();
    expect(api.getDeployedOntology).not.toHaveBeenCalled();
  });
});

/**
 * antd 组件交互助手（组件级测试用）。
 *
 * 两个必须知道的事实（踩过的坑）：
 * 1. antd `Modal` / `Select` 的下拉都渲染在 **body 的 portal** 里，不在 `render()` 返回的
 *    container 内 —— 因此这里统一查 `document`，传 container 是查不到的；
 * 2. `Select` 不是原生控件，需要 `mousedown` 到 `.ant-select-selector` 才展开，
 *    选不中选项多半是漏了这一步。
 *
 * 另外：`getByText` 只匹配**直接文本子节点**，所以 `数量(integer)` 这类结构里
 * `getByText(/^数量$/)` 命中的是外层 span（也就是带条件样式的那个），无需再取 parentElement。
 */
import { fireEvent } from '@testing-library/react';

/** 展开第 index 个 antd Select（默认第一个） */
export function openSelect(index = 0): void {
  const all = document.querySelectorAll('.ant-select-selector');
  const selector = all[index] as HTMLElement | undefined;
  if (!selector) throw new Error(`未找到第 ${index} 个 antd Select（共 ${all.length} 个）`);
  fireEvent.mouseDown(selector);
}

/** 在已展开的浮层中点击文本包含 label 的选项 */
export function clickOption(label: string): void {
  const items = Array.from(document.querySelectorAll('.ant-select-item-option'));
  const hit = items.find(el => el.textContent?.includes(label));
  if (!hit) {
    throw new Error(`下拉未找到选项「${label}」，当前选项：${items.map(el => el.textContent).join(' | ') || '（无）'}`);
  }
  fireEvent.click(hit);
}

/** 展开 Select 并选中某个选项（最常用的一步操作） */
export function selectOption(label: string, index = 0): void {
  openSelect(index);
  clickOption(label);
}

/** 浮层里的选项文本列表（断言选项集合用） */
export function optionTexts(): string[] {
  return Array.from(document.querySelectorAll('.ant-select-item-option')).map(el => el.textContent || '');
}

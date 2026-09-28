/**
 * 测试环境初始化（章程 III / IV）。
 *
 * 三件事：
 * 1. 注册 jest-dom 语义化断言；
 * 2. 补齐 jsdom 缺失的浏览器 API（Ant Design 依赖 matchMedia，表格/图表依赖 ResizeObserver）；
 * 3. 把 fetch 换成抛错桩 —— 测试禁止真实网络请求（用例需按需覆盖 fetch 桩）。
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// findBy* / waitFor 默认只等 1000ms。组件级用例要等 antd 把 Modal、Select 浮层、
// message 提示挂到 portal 上，全量并行跑时这段挂载会被拖到 1s 以上而误报
// 「Unable to find ...」——失败信息像是元素不存在，实际只是没等够。统一放宽到 5s。
configure({ asyncUtilTimeout: 5000 });

// ─── jsdom 缺失 API 补齐 ──────────────────────────────────────────────

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

// jsdom 未实现 Element.scrollIntoView（会话页每轮消息后自动滚到底会调用它）。
// 不补的话会抛 "scrollIntoView is not a function"，导致整个会话组件渲染中断。
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

// jsdom 未实现伪元素的 getComputedStyle（antd 测量滚动条时会传入 `::-webkit-scrollbar`），
// 直接调用会向控制台抛 "Not implemented" 噪音。这里统一降级为「按元素本身求值」，
// 即从不把伪元素参数透给 jsdom，保持测试输出干净且不改变被测逻辑。
const originalGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((element: Element, pseudoElement?: string | null) => {
  if (pseudoElement) return originalGetComputedStyle(element);
  return originalGetComputedStyle(element);
}) as typeof window.getComputedStyle;

// ─── 网络隔离 ────────────────────────────────────────────────────────

/** 默认桩：任何未显式打桩的网络请求都会失败，确保测试不依赖真实后端/LLM */
function rejectRealNetwork(): never {
  throw new Error('[测试禁止真实网络请求] 请在用例中显式 stub fetch');
}

vi.stubGlobal('fetch', vi.fn(rejectRealNetwork));

afterEach(() => {
  cleanup();
  // 注意：**不要**在这里清空 document.body。
  // antd 的 message / notification 会把渲染容器缓存成单例并挂在 body 上，
  // 清掉后续用例的消息提示会挂到已脱离文档的节点上（表现为「提示找不到」）。
  // 用例间的隔离由 cleanup() 卸载组件树 + asyncUtilTimeout 放宽等待共同保证。
});

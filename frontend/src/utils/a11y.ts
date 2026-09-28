import type { KeyboardEvent } from 'react';

/**
 * 无障碍交互属性（章程 IV：可交互组件必须支持键盘导航并遵循 WAI-ARIA）。
 *
 * 用于「语义上可点击、但元素本身不是 button」的场景（如表格内文本、折叠标题）。
 * 优先考虑直接使用 <button>；确需用 div/span 承载点击时 MUST 使用本助手，
 * 以补齐 role / tabIndex / Enter·Space 键响应，避免只能用鼠标操作。
 *
 * 用法：
 *   <span {...clickableProps(() => setOpen(!open))} className="...">标题</span>
 */
export function clickableProps(onActivate: () => void, ariaLabel?: string) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': ariaLabel,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      // 仅响应 Enter/Space（WAI-ARIA button 语义）；避免触发页面滚动
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

/**
 * 自定义复选框的无障碍属性（div 模拟 checkbox 时使用）。
 */
export function checkboxProps(checked: boolean, onToggle: () => void, ariaLabel?: string) {
  return {
    role: 'checkbox' as const,
    'aria-checked': checked,
    tabIndex: 0,
    'aria-label': ariaLabel,
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onToggle();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }
    },
  };
}

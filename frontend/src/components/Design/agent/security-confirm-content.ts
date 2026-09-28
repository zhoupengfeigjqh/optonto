/**
 * 安全确认弹窗的纯逻辑（自 AgentApp.tsx 抽取并独立，便于单测）。
 * 与视图分离：弹窗组件只负责渲染，数据构建/文本解析在本模块。
 */

/** 参数行：中文名 / 英文 key / 值 / 是否必填 / 是否待补充 */
export interface ConfirmRow {
  key: string;
  name: string;
  value: string;
  required: boolean;
  empty: boolean;
}

/**
 * 从行为 params 构建参数行。
 * - 值为对象时视为参数声明（取 value/description/required），否则按标量展示
 * - 对象值序列化为 JSON 字符串，避免渲染出 [object Object]
 */
export function buildConfirmRows(params: Record<string, any> | null | undefined): ConfirmRow[] {
  return Object.entries(params || {}).map(([key, val]) => {
    const spec = val !== null && typeof val === 'object' ? val : null;
    const raw = spec ? (spec.value ?? '') : String(val ?? '');
    const value = typeof raw === 'object' ? JSON.stringify(raw) : raw;
    return {
      key,
      name: spec?.description || key,
      value,
      required: !!(spec && spec.required),
      empty: value === '' || value === null || value === undefined,
    };
  });
}

/** 从 content 文本解析出【说明】/【审核要求】区块（不存在时为空串） */
export function parseConfirmContent(content: string): { description: string; audit: string } {
  let description = '', audit = '';
  for (const raw of (content || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('【说明】')) description = line.slice('【说明】'.length).trim();
    else if (line.startsWith('【审核要求】')) audit = line.slice('【审核要求】'.length).trim();
  }
  return { description, audit };
}

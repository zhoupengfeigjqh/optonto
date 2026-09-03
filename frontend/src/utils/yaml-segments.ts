/** YAML 顶层节切分与组装工具。
 *
 * 用于本体 YAML 的分段展示：左侧一级目录选择 + 右侧对应内容编辑。
 * 切分规则：顶格 `key:` 为节边界，首个 key 之前的内容归入 header（注释等）。
 */

export interface Seg { key: string; text: string }
export interface Doc { header: string; segs: Seg[] }

export const ALL = '__all__';

/** 顶层 key 中文映射（与本体明细页签命名一致） */
export const KEY_LABELS: Record<string, string> = {
  metadata: '元数据',
  concepts: '概念',
  relations: '关系',
  functions: '函数',
  behaviors: '行为',
  rules: '规则',
  processes: '流程',
  securities: '安全',
  data_engines: '数据引擎',
};

/** 按"0 缩进 + key: 形态"切分顶层段；第一个 key 之前的内容（如文件头注释）归入 header */
export function splitDoc(content: string): Doc {
  const lines = content.split('\n');
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && !/^\s/.test(l) && !l.startsWith('#') && /^[A-Za-z_][\w-]*:/.test(l)) boundaries.push(i);
  }
  if (!boundaries.length) return { header: content, segs: [] };
  const header = lines.slice(0, boundaries[0]).join('\n');
  const segs: Seg[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const end = b + 1 < boundaries.length ? boundaries[b + 1] : lines.length;
    const segLines = lines.slice(boundaries[b], end);
    segs.push({ key: segLines[0].split(':')[0].trim(), text: segLines.join('\n') });
  }
  return { header, segs };
}

/** 段拼接回完整文档（split('\n')/join('\n') 对称，未编辑的段逐字节还原） */
export function assemble(doc: Doc): string {
  return [doc.header, ...doc.segs.map(s => s.text)].filter(p => p !== '').join('\n');
}

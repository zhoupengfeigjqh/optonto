/**
 * markdown 渲染单测 —— 2026-10-06 补（宪法 III / VI）。
 *
 * ## 为什么优先级高
 *
 * `renderMarkdown` 的返回值被 MessageList 直接送进 `dangerouslySetInnerHTML`，
 * 而模型输出（规划叙事、子任务总结）本质是**不受信任文本**——
 * `escapeHtml` 是唯一的注入防线，它一旦失效就是 XSS。
 * 该文件此前零测试、且不在覆盖率门禁内，等于「安全关键路径无任何验证」。
 *
 * 本文件分组：① XSS 防线（最重要）② 块级结构 ③ 行内元素 ④ 边界与容错。
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

// ─── ① XSS 防线：escapeHtml 是唯一屏障 ─────────────────────────────────────

describe('renderMarkdown — XSS 防线（escapeHtml）', () => {
  it('裸 <script> 被转义，产出的 HTML 里不含可执行标签', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('img onerror 事件属性注入同样被转义', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toMatch(/<img/);
    expect(html).toContain('&lt;img');
  });

  it('闭合标签逃逸尝试（</div><div onclick=...>）无法形成新标签', () => {
    const html = renderMarkdown('正常文本</div><div onclick="x()">');
    // 关键断言是「标签没被形成」——< 与 > 已转义，浏览器不会解析为元素
    expect(html).not.toContain('<div');
    expect(html).toContain('&lt;/div&gt;');
    // 注：escapeHtml 有意**不转义引号**。当前 markdown 内容只进元素文本节点，
    // 不进属性值，故引号裸露无害。若将来把渲染结果嵌进 title="..." 等属性，
    // 必须先给 escapeHtml 补上引号转义——这条断言就是那个变更的护栏。
  });

  it('**加粗** 内的 HTML 同样被转义（行内处理也走 escapeHtml，不存在"加粗里裸奔"）', () => {
    const html = renderMarkdown('**<script>bad()</script>**');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<strong');
  });

  it('代码块内的 HTML 被转义（围栏内不做行内解析，但必须转义）', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<pre');
  });

  it('& < > 三类实体均被转义（& 必须最先处理，否则双重转义）', () => {
    const html = renderMarkdown('a & b < c > d');
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    // 原始 & 不应残留（否则说明转义顺序错了）
    expect(html).not.toMatch(/a & b/);
  });
});

// ─── ② 块级结构 ──────────────────────────────────────────────────────────

describe('renderMarkdown — 块级结构', () => {
  it('标题：# / ## / ### 映射到 h1-h3 且带层级样式', () => {
    expect(renderMarkdown('# 一级')).toContain('<h1');
    expect(renderMarkdown('## 二级')).toContain('<h2');
    expect(renderMarkdown('### 三级')).toContain('<h3');
  });

  it('#### 四级及以上不当作标题（只支持 1-3 级，避免未定义层级样式）', () => {
    const html = renderMarkdown('#### 四级');
    expect(html).not.toContain('<h4');
  });

  it('无序列表：连续 - 项合并进同一个 <ul>', () => {
    const html = renderMarkdown('- 甲\n- 乙');
    expect(html).toContain('<ul');
    expect((html.match(/<li/g) || []).length).toBe(2);
    // 两项在同一 ul 内而非两个 ul
    expect((html.match(/<ul/g) || []).length).toBe(1);
  });

  it('有序列表：1. 2. 合并进同一个 <ol> 且 list-decimal', () => {
    const html = renderMarkdown('1. 第一\n2. 第二');
    expect(html).toContain('<ol');
    expect(html).toContain('list-decimal');
  });

  it('列表类型切换（ul → ol）会关闭前一个列表，不产生嵌套', () => {
    const html = renderMarkdown('- 甲\n1. 乙');
    expect((html.match(/<ul/g) || []).length).toBe(1);
    expect((html.match(/<ol/g) || []).length).toBe(1);
  });

  it('表格：| 行渲染为 table，分隔行（含 ---）被跳过', () => {
    const html = renderMarkdown('| 名称 | 数量 |\n| --- | --- |\n| 甲 | 1 |');
    expect(html).toContain('<table');
    expect(html).toContain('<td');
    // 分隔行不应产出 td
    expect((html.match(/<td/g) || []).length).toBe(4);
  });

  it('分隔线 --- → <hr>', () => {
    expect(renderMarkdown('---')).toContain('<hr');
  });

  it('代码块 → <pre><code>，且保留换行', () => {
    const html = renderMarkdown('```js\nconst a = 1;\nconst b = 2;\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('const a = 1;\nconst b = 2;');
  });

  it('段落 → <p>', () => {
    expect(renderMarkdown('普通文本')).toContain('<p');
  });
});

// ─── ③ 行内元素 ──────────────────────────────────────────────────────────

describe('renderMarkdown — 行内元素', () => {
  it('**加粗** → <strong>', () => {
    expect(renderMarkdown('**粗**')).toContain('<strong');
  });

  it('*斜体* → <em>', () => {
    expect(renderMarkdown('*斜*')).toContain('<em');
  });

  it('`行内代码` → <code>（内容同样转义）', () => {
    const html = renderMarkdown('`<script>x</script>`');
    expect(html).toContain('<code');
    expect(html).not.toContain('<script>');
  });

  it('三者在同一行内混排互不干扰', () => {
    const html = renderMarkdown('**粗** 和 *斜* 和 `码`');
    expect(html).toContain('<strong');
    expect(html).toContain('<em');
    expect((html.match(/<code/g) || []).length).toBe(1);
  });
});

// ─── ④ 边界与容错 ────────────────────────────────────────────────────────

describe('renderMarkdown — 边界与容错', () => {
  it('空串 → 空输出（不产出空 <p>）', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('未闭合代码块：仍输出代码内容（末尾补 flush，不丢用户内容）', () => {
    const html = renderMarkdown('```\n未闭合的代码');
    expect(html).toContain('<pre');
    expect(html).toContain('未闭合的代码');
  });

  it('空行分隔不产出空段落，且正确断开列表', () => {
    const html = renderMarkdown('- 甲\n\n- 乙');
    //两个独立 ul（被空行断开）
    expect((html.match(/<ul/g) || []).length).toBe(2);
    expect(html).not.toContain('<p class="text-text-secondary my-1.5"></p>');
  });

  it('只有列表项、无尾随换行也能正确 flush（末尾 flushList 生效）', () => {
    const html = renderMarkdown('- 甲');
    expect(html).toContain('<li');
    expect(html.trimEnd().endsWith('</ul>')).toBe(true);
  });

  it('只有表格行、无尾随换行也能正确 flush（末尾 flushTable 生效）', () => {
    const html = renderMarkdown('| a | b |');
    expect(html).toContain('<table');
    expect(html.trimEnd().endsWith('</table>')).toBe(true);
  });

  it('空列表项 "-"（无内容）不被当作列表项', () => {
    // 正则要求 -\s+(.+)，故裸 "-" 走普通段落
    const html = renderMarkdown('-');
    expect(html).not.toContain('<li');
  });

  it('表格行未以 | 结尾时不进表格（避免误吞普通文本）', () => {
    const html = renderMarkdown('| a | b');
    expect(html).not.toContain('<table');
  });
});
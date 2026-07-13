/** Simple markdown to HTML renderer — shared across chat and requirement viewer. */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const htmlLines: string[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let inTable = false;
  let tableBuffer: string[] = [];
  let inList = false;
  let listBuffer: string[] = [];
  let listType = '';

  const flushList = () => {
    if (listBuffer.length === 0) return;
    const tag = listType === 'ol' ? 'ol' : 'ul';
    htmlLines.push(`<${tag} class="my-2">${listBuffer.join('')}</${tag}>`);
    listBuffer = [];
    inList = false;
  };

  const flushTable = () => {
    if (tableBuffer.length === 0) return;
    htmlLines.push(`<table class="my-2 w-full border-collapse">${tableBuffer.join('')}</table>`);
    tableBuffer = [];
    inTable = false;
  };

  const processInline = (text: string): string => {
    let t = escapeHtml(text);
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>');
    t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
    t = t.replace(/`(.+?)`/g, '<code class="bg-dark-bg px-1 rounded text-accent-blue text-xs">$1</code>');
    return t;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        flushList(); flushTable();
        inCodeBlock = true;
        codeBuffer = [];
      } else {
        inCodeBlock = false;
        const code = codeBuffer.join('\n');
        htmlLines.push(`<pre class="bg-dark-bg p-3 rounded-lg overflow-x-auto text-sm my-2"><code>${escapeHtml(code)}</code></pre>`);
      }
      continue;
    }
    if (inCodeBlock) { codeBuffer.push(line); continue; }

    // Empty line
    if (line.trim() === '') {
      flushList(); flushTable();
      continue;
    }

    // Table row
    if (line.trimStart().startsWith('|') && line.trimEnd().endsWith('|')) {
      if (line.includes('---')) continue;
      flushList();
      if (!inTable) inTable = true;
      const cells = line.split('|').filter(c => c.trim()).map(c => `<td class="border border-dark-border px-3 py-1 text-text-secondary text-sm">${processInline(c.trim())}</td>`).join('');
      tableBuffer.push(`<tr>${cells}</tr>`);
      continue;
    } else if (inTable) { flushTable(); }

    // HR
    if (/^---+$/.test(line.trim())) { flushList(); htmlLines.push('<hr class="border-dark-border my-3" />'); continue; }

    // Headings
    const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      flushList(); flushTable();
      const level = hMatch[1].length;
      const sizes = ['text-xl font-bold', 'text-lg font-semibold', 'text-base font-semibold'];
      const margins = ['mt-4 mb-2', 'mt-4 mb-1', 'mt-3 mb-1'];
      htmlLines.push(`<h${level} class="${sizes[level - 1]} text-text-primary ${margins[level - 1]}">${processInline(hMatch[2])}</h${level}>`);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^-\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') { flushList(); inList = true; listType = 'ul'; }
      listBuffer.push(`<li class="text-text-secondary ml-4 list-disc">${processInline(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') { flushList(); inList = true; listType = 'ol'; }
      listBuffer.push(`<li class="text-text-secondary ml-4 list-decimal">${processInline(olMatch[1])}</li>`);
      continue;
    }
    flushList();

    // Regular paragraph
    htmlLines.push(`<p class="text-text-secondary my-1.5">${processInline(line)}</p>`);
  }

  flushList(); flushTable();
  if (inCodeBlock) {
    htmlLines.push(`<pre class="bg-dark-bg p-3 rounded-lg overflow-x-auto text-sm my-2"><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
  }

  return htmlLines.join('\n');
}

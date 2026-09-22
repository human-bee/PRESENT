const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeEvidenceHtml = (value: string) => value.replace(/[&<>"']/g, character => entities[character] ?? character);
type CitationMark = { endIndex: number; html: string };

/** Render a deliberately small Markdown subset. Provider text never becomes raw HTML. */
export function renderEvidenceMarkdown(text: string, marks: CitationMark[], safeUrl: (value: string) => string | null): string {
  let prefix = '\u0000present-citation:';
  while (text.includes(prefix)) prefix += ':';
  const placeholders = new Map<string, string>();
  let prepared = '', cursor = 0;
  for (const [index, mark] of [...marks].sort((a, b) => a.endIndex - b.endIndex).entries()) {
    const token = `${prefix}${index}\u0000`;
    prepared += text.slice(cursor, mark.endIndex) + token;
    placeholders.set(token, mark.html); cursor = mark.endIndex;
  }
  prepared += text.slice(cursor);
  prepared = prepared.replace(/cite[^]*/g, '');
  const escaped = (value: string) => {
    let result = escapeEvidenceHtml(value);
    for (const [token, html] of placeholders) result = result.replaceAll(token, html);
    return result;
  };
  const inline = (value: string, depth = 0): string => {
    if (depth > 3) return escaped(value);
    const pattern = /(`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]\n]+)\]\(([^\s)]+)\))/g;
    let result = '', start = 0;
    for (const match of value.matchAll(pattern)) {
      result += escaped(value.slice(start, match.index));
      if (match[2]) result += `<code>${escaped(match[2])}</code>`;
      else if (match[3] || match[4]) result += `<strong>${inline(match[3] ?? match[4], depth + 1)}</strong>`;
      else if (match[5] || match[6]) result += `<em>${inline(match[5] ?? match[6], depth + 1)}</em>`;
      else {
        const url = safeUrl(match[8]);
        result += url ? `<a href="${escapeEvidenceHtml(url)}" target="_blank" rel="noopener noreferrer">${inline(match[7], depth + 1)}</a>` : inline(match[7], depth + 1);
      }
      start = match.index + match[0].length;
    }
    return result + escaped(value.slice(start));
  };
  const lines = prepared.split(/\r?\n/), blocks: string[] = [];
  let paragraph: string[] = [], list: string[] = [], listTag = 'ul', quote: string[] = [], code: string[] | undefined;
  const flush = () => {
    if (paragraph.length) { blocks.push(`<p>${inline(paragraph.join('\n'))}</p>`); paragraph = []; }
    if (list.length) { blocks.push(`<${listTag}>${list.map(line => `<li>${inline(line)}</li>`).join('')}</${listTag}>`); list = []; }
    if (quote.length) { blocks.push(`<blockquote>${inline(quote.join('\n'))}</blockquote>`); quote = []; }
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (code) { blocks.push(`<pre><code>${escaped(code.join('\n'))}</code></pre>`); code = undefined; }
      else { flush(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = /^#{1,6}\s+(.+)$/.exec(line), item = /^\s*(?:([-*+])|\d+\.)\s+(.+)$/.exec(line), quoted = /^>\s?(.*)$/.exec(line);
    if (heading) { flush(); blocks.push(`<h3>${inline(heading[1])}</h3>`); }
    else if (item) {
      const tag = item[1] ? 'ul' : 'ol';
      if (paragraph.length || quote.length || (list.length && tag !== listTag)) flush();
      listTag = tag; list.push(item[2]);
    } else if (quoted) { if (paragraph.length || list.length) flush(); quote.push(quoted[1]); }
    else { if (list.length || quote.length) flush(); paragraph.push(line); }
  }
  flush(); if (code) blocks.push(`<pre><code>${escaped(code.join('\n'))}</code></pre>`);
  return blocks.join('');
}

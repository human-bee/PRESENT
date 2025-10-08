export function normalizeMermaidText(text: string): string {
  const raw = (text || '').replace(/\r/g, '').trim();
  if (!raw) return 'graph TD;';
  if (/^sequenceDiagram\b/.test(raw)) {
    return raw.split('\n').map((line) => line.trimEnd()).join('\n').trim();
  }
  const tokens = raw
    .split(/\n+/)
    .flatMap((line) => line.split(/;+/))
    .map((line) => line.trim())
    .filter(Boolean);
  let header = 'graph TD;';
  const body: string[] = [];
  for (const token of tokens) {
    if (/^graph\s+/i.test(token)) {
      const dirMatch = token.match(/^graph\s+([A-Za-z]{2})/i);
      if (dirMatch) {
        const dir = dirMatch[1].toUpperCase();
        header = new Set(['TD', 'TB', 'LR', 'RL', 'BT']).has(dir) ? `graph ${dir};` : 'graph TD;';
      } else if (/^graph\s+LR/i.test(token)) {
        header = 'graph LR;';
      } else {
        header = 'graph TD;';
      }
      continue;
    }
    const normalized = token.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    if (/^(?:end|subgraph\b|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b|%%)/i.test(normalized)) {
      body.push(normalized);
      continue;
    }
    body.push(`${normalized.replace(/;$/, '')};`);
  }
  if (body.length === 0) return header;
  return [header, ...body].join('\n');
}

export function getMermaidLastNode(text: string): string | undefined {
  const normalized = normalizeMermaidText(text);
  if (/^sequenceDiagram\b/.test(normalized)) return undefined;
  const matches = Array.from(normalized.matchAll(/([^\s;]+)\s*--\>\s*([^\s;]+)/g));
  if (matches.length === 0) return undefined;
  const last = matches[matches.length - 1];
  return last?.[2]?.replace(/;$/, '') || undefined;
}

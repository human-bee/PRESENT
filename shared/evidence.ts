import { z } from 'zod';
import { pageIdSchema } from './room';
import { escapeEvidenceHtml as escapeHtml, renderEvidenceMarkdown } from './evidence-markdown';

export const providerRequestSchema = z.object({
  roomId: z.string().regex(/^[a-f0-9]{24,64}$/), prompt: z.string().trim().min(1).max(3000),
  pageId: pageIdSchema.optional(),
  actor: z.string().min(1).max(100), requestId: z.string().regex(/^[\w:.-]{1,100}$/),
  selection: z.array(z.string().min(1).max(100)).max(4).default([]),
  position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).default({ x: 0, y: 0 }),
});
export type ProviderRequest = z.infer<typeof providerRequestSchema>;
export function safeEvidenceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
const sourceSchema = z.object({ id: z.string(), url: z.string().refine(value => safeEvidenceUrl(value) !== null), title: z.string().max(200) });
export const evidenceReportSchema = z.object({
  question: z.string().max(3000), status: z.literal('model-assessment'),
  coverage: z.enum(['cited-sources', 'no-citable-sources']), model: z.string(), responseId: z.string(), retrievedAt: z.number(),
  modelAssessment: z.object({ text: z.string().max(10000), citations: z.array(z.object({ sourceId: z.string(), startIndex: z.number().int().min(0), endIndex: z.number().int().min(0) })).max(40) }),
  sources: z.array(sourceSchema).max(12), consultedSources: z.array(z.object({ url: z.string(), title: z.string().max(200) })).max(30),
});
export type EvidenceReport = z.infer<typeof evidenceReportSchema>;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Only provider URL annotations become citations; plain model-written URLs do not. */
export function parseResearchEvidence(raw: unknown, question: string, model: string, retrievedAt: number): EvidenceReport {
  const response = record(raw); const output = Array.isArray(response.output) ? response.output.map(record) : [];
  if (response.status !== 'completed' || typeof response.id !== 'string') throw new Error('Research did not complete.');
  if (!output.some(item => item.type === 'web_search_call' && item.status === 'completed')) throw new Error('The provider did not complete a web search.');
  const sources: EvidenceReport['sources'] = []; const citations: EvidenceReport['modelAssessment']['citations'] = [];
  const consultedSources: EvidenceReport['consultedSources'] = []; let text = '';
  for (const item of output) {
    if (item.type === 'web_search_call') {
      const action = record(item.action);
      for (const entry of Array.isArray(action.sources) ? action.sources : []) {
        const source = record(entry); const url = safeEvidenceUrl(source.url);
        if (url && consultedSources.length < 30 && !consultedSources.some(value => value.url === url)) consultedSources.push({ url, title: String(source.title ?? new URL(url).hostname).slice(0, 200) });
      }
    }
    if (item.type !== 'message') continue;
    for (const entry of Array.isArray(item.content) ? item.content : []) {
      const content = record(entry);
      if (content.type !== 'output_text' || typeof content.text !== 'string') continue;
      if (text) text += '\n\n'; const offset = text.length; text += content.text;
      for (const entry of Array.isArray(content.annotations) ? content.annotations : []) {
        const annotation = record(entry); const url = safeEvidenceUrl(annotation.url);
        const start = annotation.start_index, end = annotation.end_index;
        if (annotation.type !== 'url_citation' || !url || typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > content.text.length) continue;
        let source = sources.find(value => value.url === url);
        if (!source) { source = { id: String(sources.length + 1), url, title: String(annotation.title ?? new URL(url).hostname).slice(0, 200) }; sources.push(source); }
        citations.push({ sourceId: source.id, startIndex: offset + start, endIndex: offset + end });
      }
    }
  }
  if (!text.trim()) throw new Error('The research response had no assessment.');
  return evidenceReportSchema.parse({ question, status: 'model-assessment', coverage: citations.length ? 'cited-sources' : 'no-citable-sources', model: typeof response.model === 'string' ? response.model : model, responseId: response.id, retrievedAt, modelAssessment: { text, citations }, sources, consultedSources });
}

export function researchWidgetHtml(report: EvidenceReport): string {
  const text = report.modelAssessment.text;
  const marks = new Map<number, string[]>();
  const sourceLinks = new Map(report.sources.flatMap(source => {
    const url = safeEvidenceUrl(source.url);
    return url ? [[source.id, { ...source, url }] as const] : [];
  }));
  for (const citation of report.modelAssessment.citations) {
    if (citation.endIndex < 0 || citation.endIndex > text.length || !sourceLinks.has(citation.sourceId)) continue;
    marks.set(citation.endIndex, [...new Set([...(marks.get(citation.endIndex) ?? []), citation.sourceId])]);
  }
  const citationMarks = [...marks].map(([endIndex, ids]) => {
    const links = ids.flatMap(id => {
      const source = sourceLinks.get(id);
      return source ? [`<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(source.title)}" aria-label="Source ${escapeHtml(id)}: ${escapeHtml(source.title)}">${escapeHtml(id)}</a>`] : [];
    }).join(', ');
    return { endIndex, html: `<sup>[${links}]</sup>` };
  });
  const assessmentHtml = renderEvidenceMarkdown(text, citationMarks, safeEvidenceUrl);
  return `<style>body{padding:18px;height:100vh;overflow:auto;box-sizing:border-box}h2{font-size:15px;line-height:1.4;margin:0 0 12px}h3{font-size:15px;line-height:1.4;margin:18px 0 8px}p,blockquote,li{font-size:14px;line-height:1.55}p,blockquote{white-space:pre-wrap}blockquote{border-left:3px solid #dce4d5;margin:12px 0;padding-left:12px;color:#53624b}pre{overflow:auto;white-space:pre-wrap}code{font-size:.92em;background:#f0f3eb;padding:1px 3px;border-radius:3px}small{color:#66765f}a{color:#3f6d3b;text-underline-offset:2px}a:focus-visible{outline:2px solid #7a9761;outline-offset:3px}li{margin:8px 0;overflow-wrap:anywhere}.sources li{font-size:12px}textarea{box-sizing:border-box;width:100%;min-height:90px;padding:10px;border:1px solid #dce4d5;border-radius:8px;background:#fffef9;color:#28342a}</style>
<h2>${escapeHtml(report.question)}</h2><small>Model assessment · ${report.coverage === 'cited-sources' ? 'web sources attached' : 'no citable sources returned'}</small>
<section class="assessment">${assessmentHtml}</section><ol class="sources">${[...sourceLinks.values()].map(source => `<li value="${escapeHtml(source.id)}"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><b>${escapeHtml(source.title)}</b><br>${escapeHtml(source.url)}</a></li>`).join('')}</ol>
<label for="notes"><small>Your notes</small></label><textarea id="notes" placeholder="Add your interpretation or a follow-up…"></textarea>
<script>const notes=document.getElementById('notes');const render=()=>{const value=window.present.getState().notes;const text=typeof value==='string'?value:'';if(notes.value!==text)notes.value=text};notes.addEventListener('input',()=>window.present.setState({notes:notes.value.slice(0,4000)}));window.addEventListener('present:state',render);render();</script>`;
}

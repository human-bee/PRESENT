import type { Editor } from 'tldraw';

export function renderPlaintextFromRichText(_editor: Editor | any, richText: unknown): string {
  try {
    if (!richText) return '';
    if (typeof richText === 'string') return richText;
    if (Array.isArray(richText)) {
      return richText
        .map((node: unknown) => (typeof node === 'string' ? node : (node as any)?.text || ''))
        .join(' ');
    }
    return String((richText as any)?.text || '');
  } catch {
    return '';
  }
}

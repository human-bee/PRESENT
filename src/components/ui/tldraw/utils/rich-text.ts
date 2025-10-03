export function toPlainText(richText: unknown): string {
  try {
    if (!richText) return '';
    if (typeof richText === 'string') return richText;
    if (Array.isArray(richText)) {
      return richText
        .map((node: any) => {
          if (typeof node === 'string') return node;
          if (node && typeof node.text === 'string') return node.text;
          return '';
        })
        .join(' ');
    }
    if (typeof richText === 'object' && (richText as any)?.text) {
      return String((richText as any).text);
    }
    return '';
  } catch {
    return '';
  }
}

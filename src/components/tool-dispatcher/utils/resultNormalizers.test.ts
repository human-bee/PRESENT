import { getMermaidLastNode, normalizeMermaidText } from './resultNormalizers';

describe('resultNormalizers', () => {
  it('normalizes mermaid text by adding headers and semicolons', () => {
    expect(normalizeMermaidText('A-->B')).toBe('graph TD;\nA-->B;');
    expect(normalizeMermaidText('graph LR; A-->B;')).toBe('graph LR;\nA-->B;');
  });

  it('returns last node in mermaid text', () => {
    const text = 'graph TD; A-->B; B-->C;';
    expect(getMermaidLastNode(text)).toBe('C');
  });
});

import {
  getMermaidLastNode,
  normalizeExaFallbackResult,
  normalizeMermaidText,
} from './resultNormalizers';

describe('resultNormalizers', () => {
  it('normalizes mermaid text by adding headers and semicolons', () => {
    expect(normalizeMermaidText('A-->B')).toBe('graph TD;\nA-->B;');
    expect(normalizeMermaidText('graph LR; A-->B;')).toBe('graph LR;\nA-->B;');
  });

  it('returns last node in mermaid text', () => {
    const text = 'graph TD; A-->B; B-->C;';
    expect(getMermaidLastNode(text)).toBe('C');
  });

  it('returns an explicit error instead of fake exa research results', () => {
    expect(
      normalizeExaFallbackResult({
        toolName: 'exa',
        result: { status: 'IGNORED' },
        params: { query: 'ai agents' },
      }),
    ).toEqual({
      status: 'ERROR',
      message:
        'Exa MCP is unavailable for "ai agents". Configure MCP servers in /mcp-config to enable real research results.',
      error: 'Exa MCP unavailable',
      results: [],
    });
  });

  it('preserves real exa results', () => {
    const result = {
      status: 'SUCCESS',
      results: [{ title: 'Real result' }],
    };
    expect(
      normalizeExaFallbackResult({
        toolName: 'exa',
        result,
        params: { query: 'ai agents' },
      }),
    ).toBe(result);
  });
});

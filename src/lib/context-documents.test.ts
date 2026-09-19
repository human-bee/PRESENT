import { parseContextDocuments } from './context-documents';

describe('context documents', () => {
  it('accepts MCP-sourced documents', () => {
    expect(
      parseContextDocuments([
        {
          id: 'doc-1',
          title: 'MCP Context',
          content: '# Summary',
          type: 'markdown',
          timestamp: 123,
          source: 'mcp',
        },
      ]),
    ).toEqual([
      {
        id: 'doc-1',
        title: 'MCP Context',
        content: '# Summary',
        type: 'markdown',
        timestamp: 123,
        source: 'mcp',
      },
    ]);
  });

  it('rejects invalid document sources', () => {
    expect(
      parseContextDocuments([
        {
          id: 'doc-1',
          title: 'Invalid',
          content: 'x',
          type: 'text',
          timestamp: 123,
          source: 'email',
        },
      ]),
    ).toEqual([]);
  });
});

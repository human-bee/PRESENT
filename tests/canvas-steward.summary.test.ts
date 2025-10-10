describe('summarizeCanvasDocument', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key';
  });

  it('summarizes shapes with limits', async () => {
    const { summarizeCanvasDocument } = await import('@/lib/agents/shared/supabase-context');
    const doc = {
      store: {
        'shape:shapeA': {
          id: 'shapeA',
          type: 'geo',
          parentId: 'page:page1',
          childIndex: 1,
          props: { text: 'Main box', geo: 'rectangle' },
        },
        'shape:shapeB': {
          id: 'shapeB',
          type: 'note',
          parentId: 'page:page1',
          props: { text: 'Secondary note' },
        },
      },
      pages: { 'page:page1': { id: 'page:page1' } },
      components: { comp1: { type: 'Note' } },
    } as const;

    const summary = summarizeCanvasDocument(doc, { maxShapes: 1 });

    expect(summary.totalShapes).toBe(2);
    expect(summary.shapes).toHaveLength(1);
    expect(summary.shapes[0]).toMatchObject({
      id: 'shapeA',
      type: 'geo',
      pageId: 'page:page1',
      geo: 'rectangle',
    });
    expect(summary.pageCount).toBe(1);
    expect(summary.components).toBe(1);
  });
});

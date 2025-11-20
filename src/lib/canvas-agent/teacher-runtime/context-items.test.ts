import { buildTeacherContextItems } from './context-items';
import type { CanvasShapeSummary } from '@/lib/agents/shared/supabase-context';

describe('buildTeacherContextItems', () => {
  it('maps shape summaries and selections into context items', () => {
    const shapes: CanvasShapeSummary[] = [
      { id: 'shape-1', type: 'text', label: 'Hero', meta: { x: 10, y: 20 } },
    ];
    const selected = [
      { id: 'shape-2', type: 'note', text: 'Focus', x: 5, y: 6 },
    ];
    const items = buildTeacherContextItems({
      shapes,
      selectedShapes: selected,
      viewport: { x: 0, y: 0, w: 320, h: 240 },
    });

    expect(items.some((item) => item.type === 'shape')).toBe(true);
    expect(items.some((item) => item.type === 'shapes')).toBe(true);
    expect(items.some((item) => item.type === 'area')).toBe(true);
  });
});

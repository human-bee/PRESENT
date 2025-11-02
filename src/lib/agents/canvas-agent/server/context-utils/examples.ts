type FewShotExample = {
  user: string;
  actions: Array<{ name: string; params: Record<string, unknown> }>;
};

export function creativeFewShots(): FewShotExample[] {
  return [
    {
      user: 'Sketch a small labeled concept map inside the current viewport.',
      actions: [
        { name: 'create_shape', params: { kind: 'text', text: 'Idea A', x: 0, y: 0 } },
        { name: 'create_shape', params: { kind: 'text', text: 'Idea B', x: 220, y: 40 } },
        { name: 'create_shape', params: { kind: 'text', text: 'Idea C', x: 120, y: 180 } },
        { name: 'create_shape', params: { kind: 'arrow', from: 'Idea A', to: 'Idea B' } },
        { name: 'create_shape', params: { kind: 'arrow', from: 'Idea B', to: 'Idea C' } },
        { name: 'align', params: { ids: ['Idea A', 'Idea B'], axis: 'y', mode: 'middle' } },
        { name: 'distribute', params: { ids: ['Idea A', 'Idea B', 'Idea C'], axis: 'x' } },
      ],
    },
    {
      user: 'Add variety and follow up with more detail if needed.',
      actions: [
        { name: 'update_shape', params: { id: 'Idea A', style: { fill: 'solid' } } },
        { name: 'update_shape', params: { id: 'Idea B', style: { dash: 'dashed' } } },
        { name: 'stack', params: { ids: ['Idea A', 'Idea C'], direction: 'column', gap: 24 } },
        { name: 'add_detail', params: { reason: 'refine labels and spacing' } },
      ],
    },
  ];
}

export function styleInstructions() {
  return {
    tone: 'clear, schematic, balanced spacing',
    colorHints: ['use contrasting fills sparingly', 'prefer solid strokes for anchors'],
    shapeHints: ['use arrows for relationships', 'group related items if cluttered'],
  };
}


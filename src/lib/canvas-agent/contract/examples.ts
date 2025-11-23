type FewShotExample = {
  user: string;
  actions: Array<{ name: string; params: Record<string, unknown> }>;
};

export function creativeFewShots(): FewShotExample[] {
  return [
    {
      user: 'Draft a brutalist poster concept with a mono hero on the left, asymmetrical right-column notes, and burnt orange accents.',
      actions: [
        { name: 'create_shape', params: { id: 'poster_bg', type: 'rectangle', x: -360, y: -220, props: { w: 700, h: 460, color: 'red', dash: 'solid', fill: 'none' } } },
        { name: 'apply_preset', params: { preset: 'Hero', text: 'BRUTAL FORM', x: -280, y: -140 } },
        { name: 'create_shape', params: { id: 'hero_underlay', type: 'rectangle', x: -300, y: -160, props: { w: 320, h: 220, color: 'red', dash: 'solid', fill: 'none' } } },
        { name: 'create_shape', params: { id: 'column_divider', type: 'rectangle', x: -40, y: -210, props: { w: 6, h: 420, color: 'red', fill: 'solid' } } },
        { name: 'apply_preset', params: { preset: 'Callout', text: 'Asymmetry', x: 80, y: -80 } },
        { name: 'create_shape', params: { id: 'copy-note-1', type: 'note', x: 140, y: 40, props: { text: 'CTA concepts', color: 'yellow', size: 'm' } } },
        { name: 'create_shape', params: { id: 'copy-note-2', type: 'note', x: 140, y: 140, props: { text: 'Headline alts', color: 'yellow', size: 'm' } } },
        { name: 'create_shape', params: { id: 'copy-note-3', type: 'note', x: 140, y: 240, props: { text: 'Body copy beats', color: 'yellow', size: 'm' } } },
        { name: 'align', params: { ids: ['copy-note-1', 'copy-note-2', 'copy-note-3'], axis: 'x', mode: 'start' } },
        { name: 'stack', params: { ids: ['copy-note-1', 'copy-note-2', 'copy-note-3'], direction: 'column', gap: 32 } },
        { name: 'create_shape', params: { id: 'pen-underline', type: 'draw', x: -280, y: -40, props: { color: 'red', size: 'm', segments: [{ type: 'free', points: [{ x: 0, y: 0, z: 0.5 }, { x: 220, y: 14, z: 0.6 }] }], isComplete: true, isClosed: false } } },
        { name: 'todo', params: { text: 'Add three sticky notes for copy ideas on the right column.' } },
      ],
    },
    {
      user: 'Lay out a three-panel storyboard moving left to right with captions and subtle connectors.',
      actions: [
        { name: 'create_shape', params: { id: 'frame-row', type: 'rectangle', x: -360, y: -60, props: { w: 720, h: 260, color: 'grey', dash: 'dotted', fill: 'none' } } },
        { name: 'create_shape', params: { id: 'panel-1', type: 'rectangle', x: -330, y: -20, props: { w: 200, h: 160, color: 'grey', dash: 'solid', fill: 'none' } } },
        { name: 'create_shape', params: { id: 'panel-2', type: 'rectangle', x: -70, y: -20, props: { w: 200, h: 160, color: 'grey', dash: 'solid', fill: 'none' } } },
        { name: 'create_shape', params: { id: 'panel-3', type: 'rectangle', x: 190, y: -20, props: { w: 200, h: 160, color: 'grey', dash: 'solid', fill: 'none' } } },
        { name: 'distribute', params: { ids: ['panel-1', 'panel-2', 'panel-3'], axis: 'x' } },
        { name: 'apply_preset', params: { preset: 'Quiet', text: 'Shot 1: cold open', x: -320, y: 160 } },
        { name: 'apply_preset', params: { preset: 'Quiet', text: 'Shot 2: introduce product', x: -60, y: 160 } },
        { name: 'apply_preset', params: { preset: 'Quiet', text: 'Shot 3: CTA payoff', x: 200, y: 160 } },
        {
          name: 'create_shape',
          params: {
            id: 'story-arrow-1',
            type: 'draw',
            x: -120,
            y: 60,
            props: {
              color: 'grey',
              size: 's',
              segments: [{ type: 'free', points: [{ x: 0, y: 0, z: 0.5 }, { x: 80, y: 0, z: 0.55 }, { x: 120, y: -10, z: 0.6 }] }],
              isComplete: true,
              isClosed: false,
            },
          },
        },
        { name: 'stack', params: { ids: ['panel-1', 'panel-2', 'panel-3'], direction: 'row', gap: 48 } },
        { name: 'think', params: { text: 'Panels aligned on a shared baseline; captions keep rhythm consistent.' } },
      ],
    },
    {
      user: 'Zoom to the right quadrant, sketch a sticky cluster, and ask for copy to fill it.',
      actions: [
        { name: 'set_viewport', params: { bounds: { x: 200, y: -100, w: 500, h: 400 } } },
        { name: 'create_shape', params: { id: 'cluster-bg', type: 'rectangle', x: 260, y: -40, props: { w: 360, h: 320, color: 'grey', dash: 'dotted', fill: 'none' } } },
        { name: 'create_shape', params: { id: 'idea-note-a', type: 'note', x: 280, y: 0, props: { text: 'Insight A', color: 'green', size: 'm' } } },
        { name: 'create_shape', params: { id: 'idea-note-b', type: 'note', x: 420, y: 40, props: { text: 'Insight B', color: 'green', size: 'm' } } },
        { name: 'create_shape', params: { id: 'idea-note-c', type: 'note', x: 360, y: 140, props: { text: 'Insight C', color: 'green', size: 'm' } } },
        { name: 'align', params: { ids: ['idea-note-a', 'idea-note-b', 'idea-note-c'], axis: 'y', mode: 'center' } },
        { name: 'add_detail', params: { hint: 'Provide copy for the three sticky notes in the cluster.', targetIds: ['idea-note-a', 'idea-note-b', 'idea-note-c'] } },
      ],
    },
    // Layout-focused few-shot: hero block + tidy supporting cards.
    {
      user: 'Drop a hero block on the left and three supporting cards on the right, then tidy them with align/distribute/stack before summarizing progress.',
      actions: [
        { name: 'create_shape', params: { id: 'hero-field', type: 'rectangle', x: -360, y: -160, props: { w: 320, h: 260, color: 'red', dash: 'solid', fill: 'none' } } },
        { name: 'apply_preset', params: { preset: 'Hero', text: 'Launch Signal', x: -340, y: -120 } },
        { name: 'create_shape', params: { id: 'card-1', type: 'note', x: 40, y: -60, props: { text: 'Driver', color: 'yellow', size: 'm' } } },
        { name: 'create_shape', params: { id: 'card-2', type: 'note', x: 200, y: -10, props: { text: 'Tactic', color: 'yellow', size: 'm' } } },
        { name: 'create_shape', params: { id: 'card-3', type: 'note', x: 320, y: 30, props: { text: 'Metric', color: 'yellow', size: 'm' } } },
        { name: 'align', params: { ids: ['card-1', 'card-2', 'card-3'], axis: 'y', mode: 'center' } },
        { name: 'stack', params: { ids: ['card-1', 'card-2', 'card-3'], direction: 'row', gap: 32 } },
        { name: 'distribute', params: { ids: ['card-1', 'card-2', 'card-3'], axis: 'x' } },
        { name: 'align', params: { ids: ['hero-field', 'card-1'], axis: 'y', mode: 'start' } },
        { name: 'reorder', params: { ids: ['hero-field'], where: 'back' } },
        { name: 'message', params: { text: 'Hero anchored on the left, card row aligned and spaced at 32px—ready for follow-up styling.' } },
      ],
    },
    {
      user: 'Group the sticky trio on the right, stack them with 32px gaps, then send the background frame behind everything.',
      actions: [
        { name: 'group', params: { ids: ['copy-note-1', 'copy-note-2', 'copy-note-3'], groupId: 'copy-cluster' } },
        { name: 'stack', params: { ids: ['copy-note-1', 'copy-note-2', 'copy-note-3'], direction: 'column', gap: 32 } },
        { name: 'align', params: { ids: ['copy-note-1', 'copy-note-2', 'copy-note-3'], axis: 'x', mode: 'center' } },
        { name: 'reorder', params: { ids: ['poster_bg'], where: 'back' } },
        { name: 'think', params: { text: 'Group → stack → align keeps IDs stable; use reorder to push the frame behind the notes.' } },
      ],
    },
    {
      user: 'You already placed the hero block—resize it 20% larger, nudge it up, and add a todo reminding yourself to add texture.',
      actions: [
        { name: 'update_shape', params: { id: 'hero-headline', props: { w: 480 } } },
        { name: 'move', params: { ids: ['hero-headline'], dx: 0, dy: -24 } },
        { name: 'think', params: { text: 'Shapes that already exist should be updated or moved—never recreate them.' } },
        { name: 'todo', params: { text: 'Add spray-paint texture behind hero once copy is approved.' } },
      ],
    },
    // Custom component manipulation examples
    {
      user: 'Move the timer to the right side of the canvas.',
      actions: [
        { name: 'think', params: { text: 'User wants to move the RetroTimer component. Checking shapes for type: "custom" with componentType: "RetroTimer".' } },
        { name: 'move', params: { ids: ['shape:timer-1'], dx: 400, dy: 0 } },
      ],
    },
    {
      user: 'Arrange the kanban board and the two timers in a row with 48px gaps.',
      actions: [
        { name: 'think', params: { text: 'Custom components (kanban, timers) can be laid out like native shapes using stack/align.' } },
        { name: 'align', params: { ids: ['shape:kanban-1', 'shape:timer-1', 'shape:timer-2'], axis: 'y', mode: 'center' } },
        { name: 'stack', params: { ids: ['shape:kanban-1', 'shape:timer-1', 'shape:timer-2'], direction: 'row', gap: 48 } },
      ],
    },
  ];
}

export function styleInstructions() {
  return {
    tone: 'clear, brutalist editorial energy, confident spacing',
    colorHints: [
      'lean on burnt/brutalist oranges and charcoal neutrals first',
      'fallback to TLDraw palette when you need accents (blue, violet, green)',
    ],
    shapeHints: [
      'block background → hero → supporting column → annotations to maintain hierarchy',
      'use align/distribute/stack after dropping shapes so spacing snaps to the 32px rhythm',
      'alternate solid fill blocks with outlined frames for rhythm, and rely on draw strokes for bespoke connectors/underlines',
      'when using the draw pen, emit complete segments (each with ≥2 points) in a single action—no steward-side fixes will correct half-written strokes',
      'Complete IDs before issuing multi-shape verbs. If you’re still typing an id, keep streaming the same action until it contains the full list.',
      'Group existing notes instead of recreating them; reuse ids like copy-note-1/2/3 when stacking or aligning the set.',
    ],
  };
}

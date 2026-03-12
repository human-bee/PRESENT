import type { BenchmarkScenario, BenchmarkVariant } from './types';

export const BENCHMARK_VARIANTS: BenchmarkVariant[] = [
  {
    id: 'haiku-4-5',
    label: 'Claude Haiku 4.5',
    comparisonLabel: 'haiku-4.5',
    provider: 'anthropic',
    model: 'anthropic:claude-haiku-4-5',
    pricing: {
      inputPer1MUsd: 1,
      outputPer1MUsd: 5,
      notes: 'Anthropic Claude Platform list pricing for Haiku 4.5.',
      sourceUrl: 'https://www.anthropic.com/claude/haiku',
    },
    execution: {
      preset: 'creative',
      contextProfile: 'standard',
      configOverrides: {
        followups: { maxDepth: 2 },
      },
    },
  },
  {
    id: 'gpt5-4-low',
    label: 'GPT-5.4 Low',
    comparisonLabel: 'gpt5.4-low',
    provider: 'openai',
    model: 'openai:gpt-5.4',
    assumptions: [
      'This comparison slot uses the official OpenAI GPT-5.4 runtime with a lean benchmark preset.',
      'Low-latency behavior is approximated through the precise preset and lean followup budget.',
    ],
    pricing: {
      inputPer1MUsd: 2.5,
      outputPer1MUsd: 15,
      notes: 'OpenAI GPT-5.4 text-token pricing.',
      sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.4',
    },
    execution: {
      preset: 'precise',
      contextProfile: 'standard',
      configOverrides: {
        followups: { maxDepth: 1 },
        prompt: { maxChars: 160_000 },
      },
    },
  },
  {
    id: 'cerebras-gpt-oss-120b',
    label: 'Cerebras GPT OSS 120B',
    comparisonLabel: 'openai OSS 120B cerebras',
    provider: 'cerebras',
    model: 'cerebras:gpt-oss-120b',
    pricing: {
      inputPer1MUsd: 0.25,
      outputPer1MUsd: 0.69,
      notes: 'Cerebras Cloud gpt-oss-120b list pricing.',
      sourceUrl: 'https://www.cerebras.ai/blog/cerebras-launches-openai-s-gpt-oss-120b-at-a-blistering-3-000-tokens-sec',
    },
    execution: {
      preset: 'precise',
      contextProfile: 'standard',
      configOverrides: {
        followups: { maxDepth: 1 },
        prompt: { maxChars: 160_000 },
      },
    },
  },
];

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: 'business-operating-plan',
    label: 'Business Operating Plan',
    category: 'business',
    description: 'A structured planning board with objectives, owners, and risks.',
    tags: ['business', 'planning', 'layout'],
    steps: [
      {
        id: 'plan-board',
        label: 'Plan board',
        message:
          'Build a quarterly operating plan canvas for a startup launch. Use a clear title, three swimlanes for objectives, owners, and risks, and enough notes or cards that an operator could talk through it on a call.',
      },
    ],
    evaluation: {
      minShapeCount: 8,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['align', 'distribute', 'stack'],
    },
  },
  {
    id: 'podcast-episode-map',
    label: 'Podcast Episode Map',
    category: 'podcast',
    description: 'An episode board with segment sequencing and sponsor placement.',
    tags: ['podcast', 'storytelling', 'sequence'],
    steps: [
      {
        id: 'episode-outline',
        label: 'Episode outline',
        message:
          'Design a podcast episode planning board for a design-and-technology show. Map the cold open, segment beats, sponsor slot, listener questions, and closing. Make it readable for collaborators in a live canvas review.',
      },
    ],
    evaluation: {
      minShapeCount: 7,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['stack', 'align'],
    },
  },
  {
    id: 'collaborative-brainstorm',
    label: 'Collaborative Brainstorm',
    category: 'brainstorm',
    description: 'A cluster-based ideation board with grouped themes.',
    tags: ['brainstorm', 'collaboration', 'sticky-notes'],
    steps: [
      {
        id: 'theme-clusters',
        label: 'Theme clusters',
        message:
          'Create a collaborative brainstorm board for new realtime-canvas features. Show three thematic clusters, leave room for new notes, and label the clusters with short, memorable names.',
      },
    ],
    evaluation: {
      minShapeCount: 9,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['align', 'group'],
    },
  },
  {
    id: 'scratchpad-systems',
    label: 'Scratchpad Systems Sketch',
    category: 'scratchpad',
    description: 'An informal but legible systems sketch with arrows and annotations.',
    tags: ['scratchpad', 'systems', 'diagram'],
    steps: [
      {
        id: 'latency-sketch',
        label: 'Latency sketch',
        message:
          'On a blank board, sketch the low-latency canvas pipeline as a rough scratchpad: voice input, queue, steward, screenshot, action stream, and ack loop. Keep it legible but informal, like something a staff engineer would draw live.',
      },
    ],
    evaluation: {
      minShapeCount: 6,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['reorder', 'align'],
    },
  },
  {
    id: 'presentation-storyboard',
    label: 'Presentation Storyboard',
    category: 'presentation',
    description: 'A visually strong presentation board that continues over two turns.',
    tags: ['presentation', 'storyboard', 'continuation'],
    steps: [
      {
        id: 'opening-slide',
        label: 'Opening slide',
        message:
          'Draft a presentation storyboard for a product kickoff. Create a strong opening panel, two supporting panels, and concise visual hierarchy for a live walkthrough.',
      },
      {
        id: 'continue-storyboard',
        label: 'Continue storyboard',
        message:
          'Continue the existing storyboard without recreating the opening panel. Add a proof or evidence area and a final next-steps panel that fits the composition.',
      },
    ],
    evaluation: {
      minShapeCount: 8,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['update_shape', 'align', 'distribute'],
    },
  },
  {
    id: 'remote-board-game-night',
    label: 'Remote Board Game Night',
    category: 'play',
    description: 'A playful board for turn order, score, and shared game state.',
    tags: ['play', 'game-night', 'scoreboard'],
    steps: [
      {
        id: 'game-state',
        label: 'Game state board',
        message:
          'Design a remote board game night canvas with a title, turn order area, score track, shared resource pool, and a playful mascot or flourish. It should feel useful, not childish.',
      },
    ],
    evaluation: {
      minShapeCount: 8,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['align', 'stack', 'reorder'],
    },
  },
  {
    id: 'collaborative-drawing-mural',
    label: 'Collaborative Drawing Mural',
    category: 'collaborative-drawing',
    description: 'A freer canvas that pressures the pen and spatial-composition path.',
    tags: ['drawing', 'pen', 'mural'],
    steps: [
      {
        id: 'draw-mural',
        label: 'Draw mural',
        message:
          'Use the canvas like a collaborative drawing wall. Create a lively mural with at least some freehand energy, a central focal area, and supporting marks around it. Keep it tasteful and presentation-ready.',
      },
    ],
    evaluation: {
      minShapeCount: 5,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['draw', 'reorder'],
    },
  },
  {
    id: 'freehand-sketchnote-recap',
    label: 'Freehand Sketchnote Recap',
    category: 'freehand',
    description: 'A live sketchnote board with handwriting energy, arrows, and loose grouping.',
    tags: ['drawing', 'freehand', 'sketchnote'],
    steps: [
      {
        id: 'sketchnote-recap',
        label: 'Sketchnote recap',
        message:
          'Create a freehand sketchnote recap of a product strategy meeting. Use pen energy, arrows, boxed callouts, and short handwritten-feeling labels. It should look intentional, not sloppy.',
      },
    ],
    evaluation: {
      minShapeCount: 8,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['draw', 'reorder', 'align'],
    },
  },
  {
    id: 'freehand-mascot-poster',
    label: 'Freehand Mascot Poster',
    category: 'freehand',
    description: 'A poster-like scene that pressures composition and expressive pen strokes.',
    tags: ['drawing', 'poster', 'freehand'],
    steps: [
      {
        id: 'mascot-poster',
        label: 'Mascot poster',
        message:
          'Use the canvas to create a freehand poster for a remote team offsite, with a mascot, headline, supporting notes, and hand-drawn accents. Favor expressive pen marks over rigid box layout.',
      },
    ],
    evaluation: {
      minShapeCount: 6,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['draw', 'reorder'],
    },
  },
  {
    id: 'freehand-journey-map',
    label: 'Freehand Journey Map',
    category: 'freehand',
    description: 'A journey map that mixes looser drawing with structured storytelling.',
    tags: ['drawing', 'journey-map', 'freehand'],
    steps: [
      {
        id: 'journey-map',
        label: 'Journey map',
        message:
          'Draw a freehand customer journey map for onboarding into a realtime collaboration product. Use a left-to-right flow, handwritten-feeling labels, emotional highs and lows, and lightweight visual flourishes.',
      },
    ],
    evaluation: {
      minShapeCount: 7,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['draw', 'align', 'distribute'],
    },
  },
  {
    id: 'multi-fairy-zones',
    label: 'Multi-Fairy Zones',
    category: 'multi-fairy',
    description: 'A board divided into clearly separated work zones to mimic swarm collaboration.',
    tags: ['multi-fairy', 'zones', 'parallelism'],
    steps: [
      {
        id: 'zone-layout',
        label: 'Zone layout',
        message:
          'Lay out a canvas as if three fairies were collaborating in parallel. Create three clearly separated zones with distinct visual purposes and leave a shared center for synthesis.',
      },
    ],
    evaluation: {
      minShapeCount: 7,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['align', 'distribute'],
    },
  },
  {
    id: 'meeting-retro-board',
    label: 'Meeting Retro Board',
    category: 'collaboration',
    description: 'A classic retro board with structure and enough density to test organization.',
    tags: ['retro', 'collaboration', 'sticky-notes'],
    steps: [
      {
        id: 'retro-columns',
        label: 'Retro columns',
        message:
          'Create a team retrospective board with three columns for wins, friction, and experiments. Populate it with enough notes to feel real and keep the spacing disciplined.',
      },
    ],
    evaluation: {
      minShapeCount: 9,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['stack', 'align', 'distribute'],
    },
  },
  {
    id: 'call-ready-hero-board',
    label: 'Call-Ready Hero Board',
    category: 'realtime',
    description: 'A high-signal board optimized for being reviewed live on a video call.',
    tags: ['realtime', 'call', 'hero-layout'],
    steps: [
      {
        id: 'hero-board',
        label: 'Hero board',
        message:
          'Create a call-ready hero board for a live video review. Make one dominant idea area, supporting notes, and enough whitespace that a presenter could quickly orient teammates in realtime.',
      },
    ],
    evaluation: {
      minShapeCount: 6,
      requiredVerbs: ['create_shape'],
      preferredVerbs: ['align', 'reorder'],
    },
  },
];

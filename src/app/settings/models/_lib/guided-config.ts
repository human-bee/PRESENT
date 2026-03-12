import type { GuidedField, GuidedSection, ResolvedFieldSource } from './types';

const MODEL_SUGGESTIONS = {
  openai: [
    'gpt-realtime-1.5',
    'gpt-realtime-mini',
    'gpt-audio-1.5',
    'gpt-audio-mini',
    'gpt-5-mini',
    'gpt-4o-mini-transcription',
    'whisper-1',
  ],
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-5'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro-image-preview'],
  cerebras: ['llama3.3-70b', 'gpt-oss-120b', 'qwen3-32b', 'llama3.1-8b'],
  together: ['black-forest-labs/FLUX.1-schnell'],
};

export const GUIDED_SECTIONS: GuidedSection[] = [
  {
    id: 'models-core',
    title: 'Core Runtime Models',
    description: 'Primary model selectors used across voice, canvas, search, and fast stewards.',
    fields: [
      {
        path: 'models.canvasSteward',
        label: 'Canvas Steward Model',
        kind: 'string',
        help: 'Used by canvas steward tasks and canvas tool execution.',
        suggestions: [...MODEL_SUGGESTIONS.anthropic, ...MODEL_SUGGESTIONS.openai],
      },
      {
        path: 'models.voiceRealtime',
        label: 'Voice Realtime Model',
        kind: 'string',
        help: 'Used by realtime voice AgentSession model constructor.',
        suggestions: MODEL_SUGGESTIONS.openai,
      },
      {
        path: 'models.voiceRealtimePrimary',
        label: 'Voice Realtime Primary Model',
        kind: 'string',
        help: 'Primary voice realtime model (used for full profile in adaptive mode).',
        suggestions: MODEL_SUGGESTIONS.openai,
      },
      {
        path: 'models.voiceRealtimeSecondary',
        label: 'Voice Realtime Secondary Model',
        kind: 'string',
        help: 'Secondary voice realtime model (used for lite profile in adaptive mode).',
        suggestions: MODEL_SUGGESTIONS.openai,
      },
      {
        path: 'models.voiceRouter',
        label: 'Voice Router Model',
        kind: 'string',
        help: 'Used by manual voice routing decisions.',
        suggestions: MODEL_SUGGESTIONS.anthropic,
      },
      {
        path: 'models.voiceStt',
        label: 'Voice STT Model',
        kind: 'string',
        help: 'Used for input transcription model selection.',
        suggestions: MODEL_SUGGESTIONS.openai,
      },
      {
        path: 'models.searchModel',
        label: 'Search / Fact-check Model',
        kind: 'string',
        help: 'Used by web-search and fact-check paths.',
        suggestions: MODEL_SUGGESTIONS.openai,
      },
      {
        path: 'models.fastDefault',
        label: 'Fast Steward Default Model',
        kind: 'string',
        help: 'Global fallback for fast stewards unless overridden per steward.',
        suggestions: MODEL_SUGGESTIONS.cerebras,
      },
    ],
  },
  {
    id: 'models-fast-overrides',
    title: 'Per-Steward Fast Model Overrides',
    description: 'Override fast model selection by steward name.',
    fields: [
      {
        path: 'models.fastBySteward.flowchart',
        label: 'Flowchart Fast Model',
        kind: 'string',
        help: 'Fast path model for flowchart steward.',
        suggestions: MODEL_SUGGESTIONS.cerebras,
      },
      {
        path: 'models.fastBySteward.summary',
        label: 'Summary Fast Model',
        kind: 'string',
        help: 'Fast path model for summary steward.',
        suggestions: MODEL_SUGGESTIONS.cerebras,
      },
      {
        path: 'models.fastBySteward.debate',
        label: 'Debate Fast Model',
        kind: 'string',
        help: 'Fast path model for debate steward.',
        suggestions: MODEL_SUGGESTIONS.cerebras,
      },
      {
        path: 'models.fastBySteward.crowd_pulse',
        label: 'Crowd Pulse Fast Model',
        kind: 'string',
        help: 'Fast path model for crowd pulse steward.',
        suggestions: MODEL_SUGGESTIONS.cerebras,
      },
      {
        path: 'models.fastBySteward.linear',
        label: 'Linear Fast Model',
        kind: 'string',
        help: 'Fast path model for linear steward.',
        suggestions: MODEL_SUGGESTIONS.cerebras,
      },
      {
        path: 'models.fastBySteward.youtube',
        label: 'YouTube Fast Model',
        kind: 'string',
        help: 'Fast path model for YouTube steward.',
        suggestions: MODEL_SUGGESTIONS.cerebras,
      },
    ],
  },
  {
    id: 'knobs-canvas',
    title: 'Canvas Knobs',
    description: 'Operational knobs for canvas generation and follow-ups.',
    fields: [
      {
        path: 'knobs.canvas.preset',
        label: 'Canvas Preset',
        kind: 'enum',
        options: [
          { label: 'Creative', value: 'creative' },
          { label: 'Precise', value: 'precise' },
        ],
        help: 'Controls prompt behavior presets in canvas config.',
      },
      {
        path: 'knobs.canvas.temperature',
        label: 'Temperature',
        kind: 'float',
        min: 0,
        max: 2,
        step: 0.05,
        help: 'Sampling temperature (0.0-2.0).',
      },
      {
        path: 'knobs.canvas.topP',
        label: 'Top P',
        kind: 'float',
        min: 0,
        max: 1,
        step: 0.01,
        help: 'Nucleus sampling value (0.0-1.0).',
      },
      {
        path: 'knobs.canvas.maxOutputTokens',
        label: 'Max Output Tokens',
        kind: 'int',
        min: 1,
        max: 32000,
        help: 'Maximum output tokens for canvas model responses.',
      },
      {
        path: 'knobs.canvas.screenshotTimeoutMs',
        label: 'Screenshot Timeout (ms)',
        kind: 'int',
        min: 250,
        max: 30000,
        help: 'Screenshot RPC timeout in milliseconds.',
      },
      {
        path: 'knobs.canvas.followupMaxDepth',
        label: 'Follow-up Max Depth',
        kind: 'int',
        min: 0,
        max: 12,
        help: 'Maximum bounded follow-up depth.',
      },
      {
        path: 'knobs.canvas.lowActionThreshold',
        label: 'Low Action Threshold',
        kind: 'int',
        min: 0,
        max: 40,
        help: 'Threshold for low-action follow-up handling.',
      },
      {
        path: 'knobs.canvas.promptMaxChars',
        label: 'Prompt Max Characters',
        kind: 'int',
        min: 2000,
        max: 500000,
        help: 'Max prompt chars sent to canvas runtime.',
      },
    ],
  },
  {
    id: 'knobs-voice',
    title: 'Voice Knobs',
    description: 'Runtime behavior for realtime voice sessions.',
    fields: [
      {
        path: 'knobs.voice.transcriptionEnabled',
        label: 'Transcription Enabled',
        kind: 'boolean',
        help: 'Enable or disable input transcription.',
      },
      {
        path: 'knobs.voice.turnDetection',
        label: 'Turn Detection',
        kind: 'enum',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Server VAD', value: 'server_vad' },
          { label: 'Semantic VAD', value: 'semantic_vad' },
        ],
        help: 'Realtime turn detection mode.',
      },
      {
        path: 'knobs.voice.realtimeModelStrategy',
        label: 'Realtime Model Strategy',
        kind: 'enum',
        options: [
          { label: 'Adaptive Profile', value: 'adaptive_profile' },
          { label: 'Fixed', value: 'fixed' },
        ],
        help: 'Choose model by capability profile (`adaptive_profile`) or use fixed realtime model.',
      },
      {
        path: 'knobs.voice.inputNoiseReduction',
        label: 'Input Noise Reduction',
        kind: 'enum',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Near Field', value: 'near_field' },
          { label: 'Far Field', value: 'far_field' },
        ],
        help: 'Realtime input noise reduction profile.',
      },
      {
        path: 'knobs.voice.replyTimeoutMs',
        label: 'Reply Timeout (ms)',
        kind: 'int',
        min: 100,
        max: 120000,
        help: 'Timeout waiting for model reply completion.',
      },
      {
        path: 'knobs.voice.interruptTimeoutMs',
        label: 'Interrupt Timeout (ms)',
        kind: 'int',
        min: 50,
        max: 120000,
        help: 'Timeout waiting for realtime interrupt operations.',
      },
      {
        path: 'knobs.voice.transcriptionReadyTimeoutMs',
        label: 'Transcription Ready Timeout (ms)',
        kind: 'int',
        min: 100,
        max: 120000,
        help: 'Timeout waiting for transcription readiness.',
      },
    ],
  },
  {
    id: 'knobs-conductor-search',
    title: 'Conductor and Search Knobs',
    description: 'Queue throughput controls and search budget/cache controls.',
    fields: [
      {
        path: 'knobs.conductor.roomConcurrency',
        label: 'Room Concurrency',
        kind: 'int',
        min: 1,
        max: 256,
        help: 'Concurrent room processing limit for conductor workers.',
      },
      {
        path: 'knobs.conductor.taskLeaseTtlMs',
        label: 'Task Lease TTL (ms)',
        kind: 'int',
        min: 500,
        max: 300000,
        help: 'Lease TTL for queue task claims.',
      },
      {
        path: 'knobs.conductor.taskIdlePollMs',
        label: 'Task Idle Poll (ms)',
        kind: 'int',
        min: 10,
        max: 60000,
        help: 'Base idle poll interval when queue is sparse.',
      },
      {
        path: 'knobs.conductor.taskIdlePollMaxMs',
        label: 'Task Idle Poll Max (ms)',
        kind: 'int',
        min: 10,
        max: 120000,
        help: 'Maximum idle poll backoff interval.',
      },
      {
        path: 'knobs.search.maxResults',
        label: 'Search Max Results',
        kind: 'int',
        min: 1,
        max: 6,
        help: 'Maximum web-search evidence results per query.',
      },
      {
        path: 'knobs.search.cacheTtlSec',
        label: 'Search Cache TTL (sec)',
        kind: 'int',
        min: 1,
        max: 86400,
        help: 'In-memory search response cache TTL.',
      },
      {
        path: 'knobs.search.includeAnswer',
        label: 'Search Include Answer',
        kind: 'boolean',
        help: 'Include answer-style summary from search model output.',
      },
      {
        path: 'knobs.search.costPerMinuteLimit',
        label: 'Search Cost Limit / Minute',
        kind: 'int',
        min: 1,
        max: 10000,
        help: 'Cost guard limiter value used in search budget checks.',
      },
    ],
  },
];

const RESTART_REQUIRED_PREFIXES = [
  'knobs.conductor.taskLeaseTtlMs',
  'knobs.conductor.taskIdlePollMs',
  'knobs.conductor.taskIdlePollMaxMs',
  'knobs.conductor.taskMaxRetryAttempts',
  'knobs.conductor.taskRetryBaseDelayMs',
  'knobs.conductor.taskRetryMaxDelayMs',
  'knobs.conductor.taskRetryJitterRatio',
];

const NEXT_SESSION_PREFIXES = [
  'knobs.conductor.roomConcurrency',
  'models.voiceRealtime',
  'models.voiceRealtimePrimary',
  'models.voiceRealtimeSecondary',
  'models.voiceRouter',
  'models.voiceStt',
  'knobs.voice.realtimeModelStrategy',
];

export const ALL_GUIDED_FIELDS = GUIDED_SECTIONS.flatMap((section) => section.fields);

export const inputIdForPath = (path: string): string => `guided-${path.replace(/[^a-zA-Z0-9]/g, '-')}`;

const getPathValue = (root: Record<string, unknown>, path: string): unknown => {
  const parts = path.split('.');
  let cursor: unknown = root;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
};

const setPathValue = (root: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = path.split('.');
  let cursor: Record<string, unknown> = root;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }
    const current = cursor[part];
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
};

const compactObject = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const nextArray = value
      .map((entry) => compactObject(entry))
      .filter((entry) => entry !== undefined);
    return nextArray.length ? nextArray : undefined;
  }
  if (!value || typeof value !== 'object') return value;
  const nextEntries = Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, compactObject(entry)] as const)
    .filter(([, entry]) => entry !== undefined);
  if (!nextEntries.length) return undefined;
  return Object.fromEntries(nextEntries);
};

export const seedGuidedValues = (effective: Record<string, unknown> | null | undefined): Record<string, string> => {
  const next: Record<string, string> = {};
  const root = effective ?? {};
  for (const field of ALL_GUIDED_FIELDS) {
    const raw = getPathValue(root, field.path);
    if (typeof raw === 'undefined' || raw === null) {
      next[field.path] = '';
      continue;
    }
    if (field.kind === 'boolean') {
      next[field.path] = raw === true ? 'true' : raw === false ? 'false' : '';
      continue;
    }
    next[field.path] = String(raw);
  }
  return next;
};

const parseInteger = (path: string, value: string, field: GuidedField): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${path} must be an integer`);
  }
  if (typeof field.min === 'number' && parsed < field.min) {
    throw new Error(`${path} must be >= ${field.min}`);
  }
  if (typeof field.max === 'number' && parsed > field.max) {
    throw new Error(`${path} must be <= ${field.max}`);
  }
  return parsed;
};

const parseFloatValue = (path: string, value: string, field: GuidedField): number => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${path} must be a number`);
  }
  if (typeof field.min === 'number' && parsed < field.min) {
    throw new Error(`${path} must be >= ${field.min}`);
  }
  if (typeof field.max === 'number' && parsed > field.max) {
    throw new Error(`${path} must be <= ${field.max}`);
  }
  return parsed;
};

export const buildPatchFromGuided = (values: Record<string, string>): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  for (const field of ALL_GUIDED_FIELDS) {
    const raw = values[field.path] ?? '';
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (field.kind === 'boolean') {
      if (trimmed !== 'true' && trimmed !== 'false') {
        throw new Error(`${field.path} must be true or false`);
      }
      setPathValue(patch, field.path, trimmed === 'true');
      continue;
    }
    if (field.kind === 'enum') {
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      if (!allowed.has(trimmed)) {
        throw new Error(`${field.path} must be one of: ${Array.from(allowed).join(', ')}`);
      }
      setPathValue(patch, field.path, trimmed);
      continue;
    }
    if (field.kind === 'int') {
      setPathValue(patch, field.path, parseInteger(field.path, trimmed, field));
      continue;
    }
    if (field.kind === 'float') {
      setPathValue(patch, field.path, parseFloatValue(field.path, trimmed, field));
      continue;
    }
    setPathValue(patch, field.path, trimmed);
  }
  return (compactObject(patch) as Record<string, unknown>) ?? {};
};

export const resolveApplyModeForPath = (
  path: string,
  applyModes: Record<string, string> | null | undefined,
): 'live' | 'next_session' | 'restart_required' => {
  const explicit = applyModes?.[path];
  if (explicit === 'live' || explicit === 'next_session' || explicit === 'restart_required') {
    return explicit;
  }
  if (RESTART_REQUIRED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return 'restart_required';
  }
  if (NEXT_SESSION_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return 'next_session';
  }
  return 'live';
};

export const formatFieldSource = (
  source: ResolvedFieldSource | undefined,
): { label: string; tone: 'gray' | 'indigo' | 'emerald' | 'amber' } => {
  if (!source) return { label: 'unset', tone: 'gray' };
  if (source.scope === 'env') return { label: 'env default', tone: 'gray' };
  if (source.scope === 'request') return { label: 'request override', tone: 'amber' };
  if (source.scope === 'global') return { label: 'global profile', tone: 'indigo' };
  if (source.scope === 'task') return { label: 'task profile', tone: 'indigo' };
  if (source.scope === 'room') return { label: 'room profile', tone: 'emerald' };
  return { label: 'user profile', tone: 'emerald' };
};

export const filterGuidedSections = (sections: GuidedSection[], query: string): GuidedSection[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return sections;
  return sections
    .map((section) => {
      const matchedFields = section.fields.filter((field) => {
        const haystack = `${field.path} ${field.label} ${field.help}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      });
      if (
        matchedFields.length ||
        section.title.toLowerCase().includes(normalizedQuery) ||
        section.description.toLowerCase().includes(normalizedQuery)
      ) {
        return { ...section, fields: matchedFields.length ? matchedFields : section.fields };
      }
      return null;
    })
    .filter((section): section is GuidedSection => Boolean(section));
};

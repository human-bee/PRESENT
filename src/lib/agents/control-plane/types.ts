export const MODEL_PROVIDERS = ['openai', 'anthropic', 'google', 'together', 'cerebras'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export const KNOB_SCOPES = ['global', 'room', 'user', 'task'] as const;
export type KnobScope = (typeof KNOB_SCOPES)[number];

export type ApplyMode = 'live' | 'next_session' | 'restart_required';

export type CanvasKnobPatch = {
  preset?: 'creative' | 'precise';
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  ttfbSloMs?: number;
  screenshotTimeoutMs?: number;
  screenshotRetries?: number;
  screenshotRetryDelayMs?: number;
  followupMaxDepth?: number;
  lowActionThreshold?: number;
  promptMaxChars?: number;
  transcriptWindowMs?: number;
};

export type VoiceKnobPatch = {
  transcriptionEnabled?: boolean;
  sttModel?: string;
  realtimeModel?: string;
  routerModel?: string;
  turnDetection?: 'none' | 'server_vad' | 'semantic_vad';
  inputNoiseReduction?: 'none' | 'near_field' | 'far_field';
  replyTimeoutMs?: number;
  interruptTimeoutMs?: number;
  transcriptionReadyTimeoutMs?: number;
};

export type ConductorKnobPatch = {
  roomConcurrency?: number;
  taskLeaseTtlMs?: number;
  taskIdlePollMs?: number;
  taskIdlePollMaxMs?: number;
  taskMaxRetryAttempts?: number;
  taskRetryBaseDelayMs?: number;
  taskRetryMaxDelayMs?: number;
  taskRetryJitterRatio?: number;
};

export type SearchKnobPatch = {
  model?: string;
  cacheTtlSec?: number;
  maxResults?: number;
  includeAnswer?: boolean;
  costPerMinuteLimit?: number;
};

export type FastStewardKnobPatch = {
  defaultModel?: string;
  bySteward?: Record<string, string>;
};

export type ModelControlPatch = {
  models?: {
    canvasSteward?: string;
    voiceRouter?: string;
    voiceRealtime?: string;
    voiceStt?: string;
    searchModel?: string;
    fastDefault?: string;
    fastBySteward?: Record<string, string>;
  };
  knobs?: {
    canvas?: CanvasKnobPatch;
    voice?: VoiceKnobPatch;
    conductor?: ConductorKnobPatch;
    search?: SearchKnobPatch;
    fastStewards?: FastStewardKnobPatch;
  };
};

export type ModelControlScopeRef = {
  id: string;
  scope: KnobScope;
  scopeId: string;
  taskPrefix?: string | null;
  priority: number;
  version: number;
};

export type ResolveModelControlInput = {
  task?: string;
  room?: string;
  userId?: string;
  billingUserId?: string;
  requestModel?: string;
  requestProvider?: ModelProvider;
  includeUserScope?: boolean;
};

export type ResolvedModelControl = {
  effective: ModelControlPatch;
  sources: ModelControlScopeRef[];
  applyModes: Record<string, ApplyMode>;
  resolvedAt: string;
  configVersion: string;
};

export type SharedKeySource = 'byok' | 'shared';


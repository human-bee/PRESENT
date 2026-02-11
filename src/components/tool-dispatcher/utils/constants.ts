export const TOOL_RUN_DEFAULT_TIMEOUT_MS = 90_000;
export const TOOL_STEWARD_WINDOW_MS = 60_000;
export const TOOL_STEWARD_DELAY_MS = 2_000;

export const TOOL_EVENT_TOPICS = {
  request: 'tool_call',
  started: 'tool:started',
  update: 'tool:update',
  done: 'tool_result',
  error: 'tool_error',
  editorAction: 'editor_action',
  decision: 'decision',
  stewardTrigger: 'steward_trigger',
} as const;

export type ToolEventTopicKey = keyof typeof TOOL_EVENT_TOPICS;

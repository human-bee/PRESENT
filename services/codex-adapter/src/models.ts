export const CODEX_MODEL_POLICY = {
  planner: 'gpt-5.4',
  reviewer: 'gpt-5.4',
  executor: 'gpt-5.3-codex',
  widget: 'gpt-5.3-codex-spark',
} as const;

export const CODEX_AUTH_MODES = ['chatgpt', 'api_key', 'shared_key', 'byok'] as const;

export const CODEX_APP_SERVER_ENDPOINTS = {
  loginStart: '/account/login/start',
  threadStart: '/thread/start',
  turnStart: '/turn/start',
  turnStatus: '/turn/status',
} as const;

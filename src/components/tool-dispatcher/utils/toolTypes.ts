export type ToolParameters = Record<string, unknown>;

export interface ToolCallPayload {
  tool: string;
  params?: ToolParameters;
  context?: {
    source?: string;
    timestamp?: number;
    fast_route_type?: 'timer' | 'sticky' | 'plain_text';
    idempotency_key?: string;
    participant_id?: string;
    experiment_id?: string;
    variant_id?: string;
    assignment_namespace?: string;
    assignment_unit?: 'room_session';
    assignment_ts?: string;
    factor_levels?: Record<string, string>;
    [key: string]: unknown;
  };
}

export interface ToolCall {
  id: string;
  roomId?: string;
  type: 'tool_call';
  payload: ToolCallPayload;
  timestamp?: number;
  source?: string;
}

export interface ToolRunResult {
  status: string;
  message?: string;
  [key: string]: unknown;
}

export type ToolJobStatus = 'queued' | 'running' | 'succeeded' | 'error';

export interface ToolJob {
  id: string;
  tool: string;
  status: ToolJobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolQueueState {
  jobs: ToolJob[];
}

export interface DispatcherContext {
  executeToolCall: (call: ToolCall) => Promise<ToolRunResult>;
}

export interface ToolRunnerDependencies {
  contextKey?: string;
  enableLogging?: boolean;
}

export type ToolEventTopic =
  | 'tool:request'
  | 'tool:started'
  | 'tool:update'
  | 'tool:done'
  | 'tool:error'
  | 'editor_action'
  | 'decision'
  | 'steward_trigger';

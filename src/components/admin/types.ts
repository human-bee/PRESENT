export type AgentOverviewResponse = {
  ok: boolean;
  queue: Record<string, number>;
  tracesLastHour: number;
  workers: Array<Record<string, unknown>>;
  generatedAt: string;
};

export type AgentQueueTask = {
  id: string;
  room: string;
  task: string;
  status: string;
  priority: number;
  attempt: number;
  error?: string | null;
  request_id?: string | null;
  resource_keys?: string[];
  lease_expires_at?: string | null;
  created_at?: string;
};

export type AgentTraceEventRow = {
  id: string;
  trace_id?: string | null;
  request_id?: string | null;
  intent_id?: string | null;
  room?: string | null;
  task_id?: string | null;
  task?: string | null;
  stage: string;
  status?: string | null;
  latency_ms?: number | null;
  created_at?: string;
  payload?: Record<string, unknown> | null;
};

export type AgentWorkerHeartbeat = {
  worker_id: string;
  updated_at: string;
  host?: string | null;
  pid?: string | null;
  version?: string | null;
  active_tasks?: number | null;
  queue_lag_ms?: number | null;
  health?: 'online' | 'degraded' | 'offline';
};

export type AgentAuditEntry = {
  id: string;
  created_at: string;
  actor_user_id: string;
  action: string;
  target_task_id?: string | null;
  target_trace_id?: string | null;
  reason: string;
  before_status?: string | null;
  after_status?: string | null;
};

export type AgentOverviewResponse = {
  ok: boolean;
  actorUserId: string;
  actorAccessMode?: 'allowlist' | 'open_access';
  safeActionsAllowed?: boolean;
  detailGlobalScope?: boolean;
  detailMaskDefault?: boolean;
  queue: Record<string, number>;
  queueOldestQueuedAt?: string | null;
  queueOldestQueuedAgeMs?: number | null;
  tracesLastHour: number;
  activeWorkers?: number;
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
  trace_id?: string | null;
  worker_id?: string | null;
  last_failure_stage?: string | null;
  last_failure_reason?: string | null;
  last_failure_at?: string | null;
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
  subsystem?: string | null;
  worker_id?: string | null;
  worker_host?: string | null;
  worker_pid?: string | null;
  failure_reason?: string | null;
  latency_ms?: number | null;
  created_at?: string;
  payload?: Record<string, unknown> | null;
};

export type AgentTraceFailure = {
  status: string;
  stage: string | null;
  subsystem: string | null;
  reason: string | null;
  created_at: string | null;
  trace_id: string | null;
  request_id: string | null;
  intent_id: string | null;
  task_id: string | null;
  task: string | null;
  worker_id: string | null;
};

export type AgentTraceContextTranscriptEntry = {
  eventId: string;
  participantId: string;
  participantName: string | null;
  text: string;
  timestamp: number;
  manual: boolean;
};

export type AgentTraceContextTranscriptPage = {
  room: string | null;
  sessionId: string | null;
  direction: 'latest' | 'older' | 'newer';
  entries: AgentTraceContextTranscriptEntry[];
  hasOlder: boolean;
  hasNewer: boolean;
  beforeTs: number | null;
  afterTs: number | null;
  nextBeforeTs: number | null;
  nextAfterTs: number | null;
};

export type AgentTraceTaskSnapshot = {
  id: string;
  room: string | null;
  task: string | null;
  status: string | null;
  attempt: number;
  error: string | null;
  request_id: string | null;
  trace_id: string | null;
  created_at: string | null;
  updated_at: string | null;
} | null;

export type AgentTraceContextResponse = {
  ok: boolean;
  actorUserId: string;
  traceId: string;
  failure: AgentTraceFailure | null;
  taskSnapshot: AgentTraceTaskSnapshot;
  transcriptPage: AgentTraceContextTranscriptPage;
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

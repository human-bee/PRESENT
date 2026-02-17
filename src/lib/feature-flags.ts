export function getBooleanFlag(envVar: string | undefined, defaultValue: boolean): boolean {
  const normalized =
    typeof envVar === 'string'
      ? envVar
          .trim()
          .replace(/^"/, '')
          .replace(/"$/, '')
          .replace(/\\n/g, '')
          .replace(/\\r/g, '')
          .trim()
          .toLowerCase()
      : undefined;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
}

export function getNumberFlag(envVar: string | undefined, defaultValue: number): number {
  if (typeof envVar !== 'string') return defaultValue;
  const parsed = Number(envVar.trim());
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function isFairyClientAgentEnabled(envVar: string | undefined): boolean {
  return getBooleanFlag(envVar, false);
}

export function parseCsvFlag(envVar: string | undefined): string[] {
  if (typeof envVar !== 'string') return [];
  return envVar
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const flags = {
  localToolRoutingEnabled: getBooleanFlag(process.env.NEXT_PUBLIC_LOCAL_TOOL_ROUTING_ENABLED, true),
  mcpEarlyInitEnabled: getBooleanFlag(process.env.NEXT_PUBLIC_MCP_EARLY_INIT_ENABLED, true),
  bypassCloudChatThread: getBooleanFlag(process.env.NEXT_PUBLIC_BYPASS_CLOUD_CHAT_THREAD, false),
  toolDispatchStrictTypes: getBooleanFlag(process.env.NEXT_PUBLIC_TOOL_DISPATCH_STRICT_TYPES, true),
  toolDispatchKillSwitch: getBooleanFlag(process.env.NEXT_PUBLIC_TOOL_DISPATCH_KILL_SWITCH, false),
  mcpReadyTimeoutMs: Number(process.env.NEXT_PUBLIC_MCP_READY_TIMEOUT_MS || 150),
  swarmOrchestrationEnabled: getBooleanFlag(process.env.SWARM_ORCHESTRATION_ENABLED, false),
  swarmFairySpeculativeEnabled: getBooleanFlag(process.env.SWARM_FAIRY_SPECULATIVE_ENABLED, true),
  swarmFairyConfidenceThreshold: getNumberFlag(process.env.SWARM_FAIRY_CONFIDENCE_THRESHOLD, 0.7),
  swarmSpeculativeTimeoutMs: getNumberFlag(process.env.SWARM_SPECULATIVE_TIMEOUT_MS, 200),
  agentTraceLedgerEnabled: getBooleanFlag(process.env.AGENT_TRACE_LEDGER_ENABLED, true),
  agentTraceSampleRate: getNumberFlag(process.env.AGENT_TRACE_SAMPLE_RATE, 1),
  agentTraceRetentionDays: getNumberFlag(process.env.AGENT_TRACE_RETENTION_DAYS, 30),
  agentAdminActionsEnabled: getBooleanFlag(process.env.AGENT_ADMIN_ACTIONS_ENABLED, true),
};

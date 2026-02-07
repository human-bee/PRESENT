export function getBooleanFlag(envVar: string | undefined, defaultValue: boolean): boolean {
  const normalized =
    typeof envVar === 'string'
      ? envVar.trim().replace(/^"/, '').replace(/"$/, '')
      : undefined;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
}

export const flags = {
  localToolRoutingEnabled: getBooleanFlag(process.env.NEXT_PUBLIC_LOCAL_TOOL_ROUTING_ENABLED, true),
  mcpEarlyInitEnabled: getBooleanFlag(process.env.NEXT_PUBLIC_MCP_EARLY_INIT_ENABLED, true),
  bypassCloudChatThread: getBooleanFlag(process.env.NEXT_PUBLIC_BYPASS_CLOUD_CHAT_THREAD, false),
  toolDispatchStrictTypes: getBooleanFlag(process.env.NEXT_PUBLIC_TOOL_DISPATCH_STRICT_TYPES, true),
  toolDispatchKillSwitch: getBooleanFlag(process.env.NEXT_PUBLIC_TOOL_DISPATCH_KILL_SWITCH, false),
  mcpReadyTimeoutMs: Number(process.env.NEXT_PUBLIC_MCP_READY_TIMEOUT_MS || 150),
};

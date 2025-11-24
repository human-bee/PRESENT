export function getBooleanFlag(envVar, defaultValue) {
    if (envVar === 'true')
        return true;
    if (envVar === 'false')
        return false;
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
//# sourceMappingURL=feature-flags.js.map
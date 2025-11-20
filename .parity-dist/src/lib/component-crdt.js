const MAX_OP_LOG_LENGTH = 200;
const opLog = new Map();
const opEpochs = new Map();
const serializeOp = (op) => {
    try {
        return JSON.stringify(op);
    }
    catch {
        return String(op);
    }
};
const coerceEpochKey = (version, timestamp) => {
    if (version != null && Number.isFinite(version)) {
        return `v:${version}`;
    }
    if (timestamp != null && Number.isFinite(timestamp)) {
        return `t:${timestamp}`;
    }
    return 'epoch:unknown';
};
export function filterNewOps(componentId, ops, metadata) {
    if (!Array.isArray(ops) || ops.length === 0) {
        return [];
    }
    const hasMeta = metadata.version != null || metadata.timestamp != null;
    if (!hasMeta) {
        // Without metadata we cannot safely dedupe; allow all ops.
        return ops;
    }
    const epochKey = coerceEpochKey(metadata.version ?? null, metadata.timestamp ?? null);
    const previousEpoch = opEpochs.get(componentId);
    let epoch = previousEpoch;
    if (!previousEpoch || previousEpoch.epochKey !== epochKey) {
        epoch = { epochKey, seen: new Set() };
        opEpochs.set(componentId, epoch);
    }
    const fresh = [];
    for (const op of ops) {
        const key = serializeOp(op);
        if (epoch.seen.has(key)) {
            continue;
        }
        epoch.seen.add(key);
        fresh.push(op);
    }
    return fresh;
}
export function recordOps(componentId, ops, metadata) {
    if (!Array.isArray(ops) || ops.length === 0)
        return;
    const entries = opLog.get(componentId) ?? [];
    for (const op of ops) {
        const key = serializeOp(op);
        entries.push({ key, op, version: metadata.version ?? null, timestamp: metadata.timestamp ?? null });
    }
    if (entries.length > MAX_OP_LOG_LENGTH) {
        entries.splice(0, entries.length - MAX_OP_LOG_LENGTH);
    }
    opLog.set(componentId, entries);
}
export function getOpLog(componentId) {
    return opLog.get(componentId)?.slice() ?? [];
}
export function clearOps(componentId) {
    if (componentId) {
        opLog.delete(componentId);
        opEpochs.delete(componentId);
        return;
    }
    opLog.clear();
    opEpochs.clear();
}
//# sourceMappingURL=component-crdt.js.map
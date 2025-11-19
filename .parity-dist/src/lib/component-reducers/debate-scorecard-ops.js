import { claimSchema, debateScorecardStateSchema, } from '@/lib/agents/debate-scorecard-schema';
const dedupeById = (items, existing = []) => {
    const result = new Map();
    for (const item of existing) {
        if (!item)
            continue;
        const key = item.id ?? JSON.stringify(item);
        result.set(key, { ...item });
    }
    for (const item of items) {
        if (!item)
            continue;
        const key = item.id ?? JSON.stringify(item);
        if (!key)
            continue;
        result.set(key, { ...result.get(key), ...item });
    }
    return Array.from(result.values());
};
const mergeClaims = (state, claims) => {
    if (!Array.isArray(claims) || claims.length === 0)
        return state;
    const map = new Map(state.claims.map((claim) => [claim.id, { ...claim }]));
    for (const claim of claims) {
        if (!claim?.id)
            continue;
        const existing = map.get(claim.id);
        const merged = existing ? { ...existing, ...claim } : claim;
        map.set(claim.id, debateScorecardStateSchema.shape.claims.element.parse(merged));
    }
    return { ...state, claims: Array.from(map.values()) };
};
const updateClaim = (state, claimId, patch) => {
    if (!claimId)
        return state;
    const nextClaims = state.claims.map((claim) => claim.id === claimId ? claimSchema.parse({ ...claim, ...patch }) : claim);
    return { ...state, claims: nextClaims };
};
const removeClaims = (state, claimIds) => {
    if (!Array.isArray(claimIds) || claimIds.length === 0)
        return state;
    const remove = new Set(claimIds);
    return { ...state, claims: state.claims.filter((claim) => !remove.has(claim.id)) };
};
const upsertPlayers = (state, partials, mergeAchievements = true) => {
    if (!Array.isArray(partials) || partials.length === 0)
        return state;
    const map = new Map(state.players.map((player) => [player.id, { ...player }]));
    for (const partial of partials) {
        if (!partial?.id)
            continue;
        const existing = map.get(partial.id);
        if (!existing) {
            map.set(partial.id, {
                id: partial.id,
                label: partial.label ?? partial.id,
                side: partial.side ?? 'AFF',
                color: partial.color ?? '#38bdf8',
                score: partial.score ?? 0,
                streakCount: partial.streakCount ?? 0,
                momentum: partial.momentum ?? 0.5,
                bsMeter: partial.bsMeter ?? 0.08,
                learningScore: partial.learningScore ?? 0.5,
                achievements: partial.achievements ? [...partial.achievements] : [],
                summary: partial.summary,
                avatarUrl: partial.avatarUrl,
                lastUpdated: partial.lastUpdated ?? Date.now(),
            });
            continue;
        }
        const nextAchievements = mergeAchievements
            ? dedupeById(partial.achievements ?? [], existing.achievements ?? [])
            : partial.achievements ?? existing.achievements ?? [];
        map.set(partial.id, {
            ...existing,
            ...partial,
            achievements: nextAchievements,
        });
    }
    return { ...state, players: Array.from(map.values()) };
};
const appendTimeline = (state, events) => {
    if (!Array.isArray(events) || events.length === 0)
        return state;
    const map = new Map(state.timeline.map((event) => [event.id, { ...event }]));
    for (const event of events) {
        if (!event?.id)
            continue;
        map.set(event.id, { ...event });
    }
    const timeline = Array.from(map.values()).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return { ...state, timeline };
};
const appendSources = (state, sources) => {
    if (!Array.isArray(sources) || sources.length === 0)
        return state;
    return { ...state, sources: dedupeById(sources, state.sources) };
};
const updateMap = (state, nodes, edges, replace = false) => {
    const nextNodes = nodes
        ? replace
            ? [...nodes]
            : dedupeById(nodes, state.map.nodes)
        : state.map.nodes;
    const edgeKey = (edge) => `${edge.from}->${edge.to}`;
    const nextEdges = edges
        ? replace
            ? [...edges]
            : Array.from(new Map(state.map.edges.concat(edges).map((edge) => [edgeKey(edge), edge])).values())
        : state.map.edges;
    return {
        ...state,
        map: {
            nodes: nextNodes,
            edges: nextEdges,
        },
    };
};
const queueAchievements = (state, achievements, append = true) => {
    if (!Array.isArray(achievements) || achievements.length === 0)
        return state;
    if (!append) {
        return { ...state, achievementsQueue: achievements.slice() };
    }
    return {
        ...state,
        achievementsQueue: dedupeById(achievements, state.achievementsQueue),
    };
};
export const applyDebateScorecardOps = (initial, ops) => {
    if (!Array.isArray(ops) || ops.length === 0)
        return initial;
    let state = { ...initial };
    for (const op of ops) {
        if (!op || typeof op !== 'object')
            continue;
        switch (op.type) {
            case 'UPSERT_CLAIMS':
                state = mergeClaims(state, op.claims ?? []);
                break;
            case 'UPDATE_CLAIM':
                state = updateClaim(state, op.claimId, op.patch ?? {});
                break;
            case 'REMOVE_CLAIMS':
                state = removeClaims(state, op.claimIds ?? []);
                break;
            case 'UPSERT_PLAYERS':
                state = upsertPlayers(state, op.players ?? [], op.mergeAchievements !== false);
                break;
            case 'UPDATE_METRICS':
                state = { ...state, metrics: { ...state.metrics, ...(op.metrics ?? {}) } };
                break;
            case 'UPDATE_STATUS':
                state = { ...state, status: { ...state.status, ...(op.status ?? {}) } };
                break;
            case 'APPEND_TIMELINE':
                state = appendTimeline(state, op.events ?? []);
                break;
            case 'APPEND_SOURCES':
                state = appendSources(state, op.sources ?? []);
                break;
            case 'SET_FILTERS':
                state = { ...state, filters: { ...state.filters, ...(op.filters ?? {}) } };
                break;
            case 'SET_TOPIC':
                state = {
                    ...state,
                    topic: op.topic ?? state.topic,
                    round: op.round ?? state.round,
                };
                break;
            case 'SET_FACT_CHECK_ENABLED':
                state = { ...state, factCheckEnabled: Boolean(op.enabled) };
                break;
            case 'UPDATE_MAP':
                state = updateMap(state, op.nodes, op.edges, op.replace);
                break;
            case 'QUEUE_ACHIEVEMENTS':
                state = queueAchievements(state, op.achievements ?? [], op.append !== false);
                break;
            default:
                if (process.env.NODE_ENV !== 'production') {
                    console.warn('[DebateScorecardOps] unknown op', op);
                }
        }
    }
    return debateScorecardStateSchema.parse({ ...state, lastUpdated: Date.now() });
};
//# sourceMappingURL=debate-scorecard-ops.js.map
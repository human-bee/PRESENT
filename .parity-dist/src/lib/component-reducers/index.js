import { applyDebateScorecardOps } from './debate-scorecard-ops';
const reducers = new Map([
    [
        'DebateScorecard',
        (state, ops) => applyDebateScorecardOps(state, ops),
    ],
]);
export function applyComponentOps(componentType, state, ops) {
    if (!Array.isArray(ops) || ops.length === 0) {
        return state;
    }
    const reducer = reducers.get(componentType);
    if (!reducer) {
        return state;
    }
    try {
        const next = reducer(state, ops);
        if (next && typeof next === 'object') {
            return next;
        }
        return state;
    }
    catch (error) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[ComponentReducers] failed to apply ops', { componentType, error });
        }
        return state;
    }
}
//# sourceMappingURL=index.js.map
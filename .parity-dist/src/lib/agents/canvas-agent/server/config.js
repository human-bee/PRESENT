import { resolveFollowupDepth, resolvePreset } from './model/presets';
const DEFAULT_SCREENSHOT_TIMEOUT_MS = 3500;
const MIN_SCREENSHOT_TIMEOUT_MS = 2500;
const DEFAULT_SCREENSHOT_EDGE = 1024;
const MIN_SCREENSHOT_EDGE = 64;
const DEFAULT_PROMPT_MAX_CHARS = 200000;
const coerceScreenshotTimeout = (value) => {
    const parsed = value ? Number.parseInt(value, 10) : DEFAULT_SCREENSHOT_TIMEOUT_MS;
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_SCREENSHOT_TIMEOUT_MS;
    }
    return Math.max(parsed, MIN_SCREENSHOT_TIMEOUT_MS);
};
const clampScreenshotEdge = (value, fallback = DEFAULT_SCREENSHOT_EDGE) => {
    if (!value)
        return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.max(MIN_SCREENSHOT_EDGE, Math.min(4096, Math.floor(parsed)));
};
const parseDownscaleEdges = (raw, base, minEdge) => {
    const defaults = [0.75, 0.6, 0.5, 0.4];
    const ratios = raw
        ? raw
            .split(',')
            .map((entry) => Number.parseFloat(entry.trim()))
            .filter((ratio) => Number.isFinite(ratio) && ratio > 0 && ratio < 1)
        : defaults;
    const values = ratios
        .map((ratio) => Math.max(minEdge, Math.floor(base * ratio)))
        .filter((edge) => edge < base);
    const unique = Array.from(new Set(values));
    unique.sort((a, b) => b - a);
    return unique;
};
const sanitizeEdgeList = (input, base, minEdge) => {
    if (!Array.isArray(input))
        return undefined;
    const edges = input
        .map((value) => Number(value))
        .filter((edge) => Number.isFinite(edge))
        .map((edge) => Math.max(minEdge, Math.min(base - 1, Math.floor(edge))));
    const unique = Array.from(new Set(edges.filter((edge) => edge < base)));
    unique.sort((a, b) => b - a);
    return unique.length ? unique : undefined;
};
const parseOverrides = (raw) => {
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    }
    catch {
        console.warn('[CanvasAgent:Config] Failed to parse CANVAS_AGENT_CONFIG JSON; falling back to env defaults');
    }
    return {};
};
const parseAgentMode = (raw) => {
    const value = (raw ?? '').toLowerCase();
    if (value === 'teacher' || value === 'tldraw-teacher')
        return 'tldraw-teacher';
    if (value === 'shadow')
        return 'shadow';
    return 'present';
};
export function loadCanvasAgentConfig(env = process.env) {
    const preset = resolvePreset(env);
    const screenshotMaxEdge = clampScreenshotEdge(env.CANVAS_AGENT_SCREENSHOT_MAX_SIZE);
    const screenshotMinEdge = clampScreenshotEdge(env.CANVAS_AGENT_SCREENSHOT_MIN_EDGE, Math.min(512, screenshotMaxEdge));
    const promptDownscaleEdges = parseDownscaleEdges(env.CANVAS_AGENT_PROMPT_DOWNSCALE_RATIOS, screenshotMaxEdge, screenshotMinEdge);
    const baseConfig = {
        modelName: env.CANVAS_STEWARD_MODEL,
        debug: env.CANVAS_STEWARD_DEBUG === 'true',
        preset,
        clientEnabled: env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED === 'true',
        ttfbSloMs: Number(env.CANVAS_AGENT_TTFB_SLO_MS ?? 200),
        mode: parseAgentMode(env.CANVAS_AGENT_MODE),
        screenshot: {
            timeoutMs: coerceScreenshotTimeout(env.CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS),
            retries: Math.max(0, Number.parseInt(env.CANVAS_AGENT_SCREENSHOT_RETRIES ?? '1', 10) || 0),
            retryDelayMs: Math.max(100, Number.parseInt(env.CANVAS_AGENT_SCREENSHOT_RETRY_DELAY_MS ?? '450', 10) || 450),
            maxEdge: screenshotMaxEdge,
            minEdge: screenshotMinEdge,
        },
        prompt: {
            maxChars: Math.max(120000, Number.parseInt(env.CANVAS_AGENT_PROMPT_MAX_CHARS ?? String(DEFAULT_PROMPT_MAX_CHARS), 10) ||
                DEFAULT_PROMPT_MAX_CHARS),
            downscaleEdges: promptDownscaleEdges,
        },
        followups: {
            maxDepth: resolveFollowupDepth(env, preset),
            lowActionThreshold: Math.max(0, Number.parseInt(env.CANVAS_AGENT_LOW_ACTION_THRESHOLD ?? '6', 10) || 6),
        },
    };
    const overrides = parseOverrides(env.CANVAS_AGENT_CONFIG);
    const merged = {
        ...baseConfig,
        ...overrides,
        screenshot: { ...baseConfig.screenshot, ...(overrides.screenshot ?? {}) },
        prompt: { ...baseConfig.prompt, ...(overrides.prompt ?? {}) },
        followups: { ...baseConfig.followups, ...(overrides.followups ?? {}) },
    };
    const overrideDownscale = sanitizeEdgeList(overrides.prompt?.downscaleEdges, merged.screenshot.maxEdge, merged.screenshot.minEdge);
    if (overrideDownscale) {
        merged.prompt.downscaleEdges = overrideDownscale;
    }
    return merged;
}
//# sourceMappingURL=config.js.map
import { DEFAULT_MODEL_NAME } from '../../../../vendor/tldraw-agent-template/worker/models';
const MODEL_ALIASES = {
    'anthropic:claude-4.5-sonnet': 'claude-4.5-sonnet',
    'anthropic:claude-4-sonnet': 'claude-4-sonnet',
    'anthropic:claude-3.5-sonnet': 'claude-3.5-sonnet',
    'anthropic:claude-3-5-sonnet': 'claude-3.5-sonnet',
    'anthropic:claude-3-5-sonnet-20241022': 'claude-3.5-sonnet',
};
const FALLBACK_MESSAGE = 'Continue improving the canvas layout with strong hierarchy and confident composition.';
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const coerceMessages = (raw) => {
    const filtered = raw
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
    if (filtered.length > 0)
        return filtered;
    return [FALLBACK_MESSAGE];
};
const resolveTeacherModelName = (raw) => {
    if (!raw)
        return DEFAULT_MODEL_NAME;
    const normalized = raw.trim().toLowerCase();
    return MODEL_ALIASES[normalized] ?? DEFAULT_MODEL_NAME;
};
export function buildTeacherPrompt(context) {
    const requestType = context.requestType ?? 'user';
    const messages = coerceMessages(context.userMessages);
    if (isNonEmptyString(context.styleInstructions)) {
        messages.push(`Brand / style guardrails (from PRESENT):\n${context.styleInstructions.trim()}`);
    }
    const parts = {
        system: { type: 'system' },
        modelName: {
            type: 'modelName',
            name: resolveTeacherModelName(context.modelName),
        },
        messages: {
            type: 'messages',
            messages,
            requestType,
        },
        screenshot: {
            type: 'screenshot',
            screenshot: context.screenshotDataUrl ?? null,
        },
        viewportBounds: {
            type: 'viewportBounds',
            userBounds: context.viewport ?? context.bounds ?? null,
            agentBounds: context.bounds ?? context.viewport ?? null,
        },
        todoList: {
            type: 'todoList',
            items: context.todoItems ?? [],
        },
        chatHistory: {
            type: 'chatHistory',
            items: context.chatHistory ?? null,
        },
        contextItems: {
            type: 'contextItems',
            items: context.contextItems ?? [],
            requestType,
            // PRESENT passes shape summaries in contextItems so the vendored teacher agent gets a coarse canvas snapshot.
        },
        data: {
            type: 'data',
            data: context.promptBudget ? [context.promptBudget] : [],
        },
        time: {
            type: 'time',
            time: context.timestamp ?? new Date().toISOString(),
        },
    };
    return parts;
}
//# sourceMappingURL=prompt.js.map
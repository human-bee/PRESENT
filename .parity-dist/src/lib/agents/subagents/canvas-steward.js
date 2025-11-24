import { z } from 'zod';
import { randomUUID } from 'crypto';
import { jsonObjectSchema, jsonValueSchema } from '@/lib/utils/json-schema';
import { runCanvasAgent } from '@/lib/agents/canvas-agent/server/runner';
import { sendActionsEnvelope } from '@/lib/agents/canvas-agent/server/wire';
const logWithTs = (label, payload) => {
    try {
        console.log(label, { ts: new Date().toISOString(), ...payload });
    }
    catch { }
};
const CANVAS_STEWARD_DEBUG = process.env.CANVAS_STEWARD_DEBUG === 'true';
const debugLog = (...args) => {
    if (CANVAS_STEWARD_DEBUG) {
        try {
            console.log('[CanvasSteward]', ...args);
        }
        catch { }
    }
};
const debugJson = (label, value, max = 2000) => {
    if (!CANVAS_STEWARD_DEBUG)
        return;
    try {
        const json = JSON.stringify(value, null, 2);
        debugLog(label, json.length > max ? `${json.slice(0, max)}… (truncated ${json.length - max} chars)` : json);
    }
    catch (error) {
        debugLog(label, value);
    }
};
const ParamEntry = z.object({
    key: z.string(),
    value: jsonValueSchema,
});
export async function runCanvasSteward(args) {
    const { task, params } = args;
    const normalizedEntries = objectToEntries(params);
    const payload = jsonObjectSchema.parse(entriesToObject(normalizedEntries));
    const room = extractRoom(payload);
    const model = typeof payload.model === 'string' ? payload.model : undefined;
    const taskLabel = task.startsWith('canvas.') ? task.slice('canvas.'.length) : task;
    const start = Date.now();
    logWithTs('🚀 [CanvasSteward] run.start', {
        task,
        taskLabel,
        room,
        message: typeof payload.message === 'string' ? payload.message.slice(0, 100) : undefined,
    });
    try {
        if (task === 'canvas.quick_text') {
            const result = await handleQuickTextTask(room, payload);
            logWithTs('✅ [CanvasSteward] quick_text.complete', {
                task,
                room,
                durationMs: Date.now() - start,
                shapeId: result.shapeId,
            });
            return result;
        }
        const message = extractMessage(payload);
        // Call unified Canvas Agent server runner
        await runCanvasAgent({
            roomId: room,
            userMessage: message,
            model,
            initialViewport: payload.bounds,
        });
        logWithTs('✅ [CanvasSteward] run.complete', {
            task,
            room,
            durationMs: Date.now() - start,
        });
        return 'Canvas agent executed';
    }
    catch (error) {
        logWithTs('❌ [CanvasSteward] run.error', {
            task,
            room,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
function extractRoom(payload) {
    const raw = payload.room;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim();
    }
    throw new Error('Canvas steward requires a room parameter');
}
function extractMessage(payload) {
    const raw = payload.message || payload.instruction || payload.text;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim();
    }
    throw new Error('Canvas steward requires a message parameter');
}
function extractQuickText(payload) {
    const raw = payload.text || payload.message || payload.content || payload.label;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim();
    }
    throw new Error('canvas.quick_text requires text content');
}
async function handleQuickTextTask(room, payload) {
    const text = extractQuickText(payload);
    const requestId = typeof payload.requestId === 'string' && payload.requestId.trim().length > 0
        ? payload.requestId.trim()
        : randomUUID();
    const sessionId = `quick-text-${requestId}`;
    const shapeId = typeof payload.shapeId === 'string' && payload.shapeId.trim().length > 0
        ? payload.shapeId.trim()
        : `qt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const x = typeof payload.x === 'number' && Number.isFinite(payload.x)
        ? payload.x
        : Math.round((Math.random() - 0.5) * 400);
    const y = typeof payload.y === 'number' && Number.isFinite(payload.y)
        ? payload.y
        : Math.round((Math.random() - 0.5) * 250);
    const actions = [
        {
            id: `create-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            name: 'create_shape',
            params: {
                id: shapeId,
                type: 'text',
                x,
                y,
                props: {
                    text,
                },
            },
        },
    ];
    await sendActionsEnvelope(room, sessionId, 0, actions);
    return {
        status: 'ok',
        requestId,
        shapeId,
    };
}
const entriesToObject = (entries) => Object.fromEntries((entries ?? []).map(({ key, value }) => [key, value]));
const objectToEntries = (obj) => {
    if (!obj)
        return [];
    if (Array.isArray(obj))
        return obj;
    return Object.entries(obj)
        .filter(([, value]) => typeof value !== 'undefined')
        .map(([key, value]) => ParamEntry.parse({ key, value: value }));
};
//# sourceMappingURL=canvas-steward.js.map
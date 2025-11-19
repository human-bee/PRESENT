import { Agent as OpenAIAgent, run as runAgent, tool as agentTool } from '@openai/agents';
async function publish(room, topic, payload) {
    try {
        room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
            reliable: true,
            topic,
        });
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[TldrawControlAgent] publish error', e);
    }
}
export function createTldrawControlAgent(room) {
    const listShapes = agentTool({
        name: 'canvas_list_shapes',
        description: 'List TLDraw shapes (id, type, and text/name when available).',
        parameters: undefined,
        async execute() {
            const id = `list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await publish(room, 'tool_call', {
                id,
                roomId: room.name || 'unknown',
                type: 'tool_call',
                payload: { tool: 'canvas_list_shapes', params: {} },
                timestamp: Date.now(),
                source: 'voice-subagent',
            });
            return { ok: true, id };
        },
    });
    const createNote = agentTool({
        name: 'canvas_create_note',
        description: 'Create a sticky note (TLDraw note).',
        parameters: undefined,
        async execute(params) {
            const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await publish(room, 'tool_call', {
                id,
                roomId: room.name || 'unknown',
                type: 'tool_call',
                payload: { tool: 'canvas_create_note', params: { text: params?.text || 'Note' } },
                timestamp: Date.now(),
                source: 'voice-subagent',
            });
            return { ok: true, id };
        },
    });
    const focus = agentTool({
        name: 'canvas_focus',
        description: 'Focus/zoom camera to all, selection, a component id, or a shape id.',
        parameters: undefined,
        async execute(params) {
            const id = `focus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await publish(room, 'tool_call', {
                id,
                roomId: room.name || 'unknown',
                type: 'tool_call',
                payload: { tool: 'canvas_focus', params },
                timestamp: Date.now(),
                source: 'voice-subagent',
            });
            return { ok: true, id };
        },
    });
    const drawSmiley = agentTool({
        name: 'canvas_draw_smiley',
        description: 'Draw a simple smiley using geo shapes.',
        parameters: undefined,
        async execute(params) {
            const id = `smiley-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await publish(room, 'tool_call', {
                id,
                roomId: room.name || 'unknown',
                type: 'tool_call',
                payload: { tool: 'canvas_draw_smiley', params: { size: params?.size || 300 } },
                timestamp: Date.now(),
                source: 'voice-subagent',
            });
            return { ok: true, id };
        },
    });
    return new OpenAIAgent({
        name: 'TldrawControl',
        model: 'gpt-5-mini',
        instructions: 'You control a TLDraw canvas via tools. Prefer listing shapes first and focusing/creating succinctly. Keep updates frequent and observable.',
        tools: [listShapes, focus, createNote, drawSmiley],
    });
}
export async function runTldrawControlAgent(room, prompt) {
    const agent = createTldrawControlAgent(room);
    return runAgent(agent, prompt);
}
//# sourceMappingURL=tldraw-control-agent.js.map
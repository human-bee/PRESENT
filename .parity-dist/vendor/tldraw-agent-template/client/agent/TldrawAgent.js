import { atom, Box, react, reverseRecordsDiff, structuredClone, Vec, } from 'tldraw';
import { AgentHelpers } from '../../shared/AgentHelpers';
import { getAgentActionUtilsRecord, getPromptPartUtilsRecord } from '../../shared/AgentUtils';
import { DEFAULT_MODEL_NAME } from '../../worker/models';
import { $agentsAtom } from './agentsAtom';
/**
 * An agent that can be prompted to edit the canvas.
 * Returned by the `useTldrawAgent` hook.
 *
 * @example
 * ```tsx
 * const agent = useTldrawAgent(editor)
 * agent.prompt({ message: 'Draw a snowman' })
 * ```
 */
export class TldrawAgent {
    /**
     * Create a new tldraw agent.
     */
    constructor({ editor, id, onError }) {
        /**
         * An atom containing the currently active request.
         * This is mainly used to render highlights and other UI elements.
         */
        this.$activeRequest = atom('activeRequest', null);
        /**
         * An atom containing the next request that the agent has scheduled for
         * itself. Null if there is no scheduled request.
         */
        this.$scheduledRequest = atom('scheduledRequest', null);
        /**
         * An atom containing the agent's chat history.
         */
        this.$chatHistory = atom('chatHistory', []);
        /**
         * An atom containing the position on the page where the current chat
         * started.
         */
        this.$chatOrigin = atom('chatOrigin', { x: 0, y: 0 });
        /**
         * An atom containing the agent's todo list.
         */
        this.$todoList = atom('todoList', []);
        /**
         * An atom that's used to store document changes made by the user since the
         * previous request.
         */
        this.$userActionHistory = atom('userActionHistory', []);
        /**
         * An atom containing currently selected context items.
         *
         * To send context items to the model, include them in the `contextItems`
         * field of a request.
         */
        this.$contextItems = atom('contextItems', []);
        /**
         * An atom containing the model name that the user has selected. This gets
         * passed through to prompts unless manually overridden.
         *
         * Note: Prompt part utils may ignore or override this value. See the
         * ModelNamePartUtil for an example.
         */
        this.$modelName = atom('modelName', DEFAULT_MODEL_NAME);
        /**
         * A function that cancels the agent's current prompt, if one is active.
         */
        this.cancelFn = null;
        /**
         * Whether the agent is currently acting on the editor or not.
         * This flag is used to prevent agent actions from being recorded as user actions.
         */
        this.isActing = false;
        this.editor = editor;
        this.id = id;
        this.onError = onError;
        $agentsAtom.update(editor, (agents) => [...agents, this]);
        this.agentActionUtils = getAgentActionUtilsRecord(this);
        this.promptPartUtils = getPromptPartUtilsRecord(this);
        this.unknownActionUtil = this.agentActionUtils.unknown;
        persistAtomInLocalStorage(this.$chatHistory, `${id}:chat-history`);
        persistAtomInLocalStorage(this.$chatOrigin, `${id}:chat-origin`);
        persistAtomInLocalStorage(this.$modelName, `${id}:model-name`);
        persistAtomInLocalStorage(this.$todoList, `${id}:todo-items`);
        persistAtomInLocalStorage(this.$contextItems, `${id}:context-items`);
        this.stopRecordingFn = this.startRecordingUserActions();
    }
    /**
     * Dispose of the agent by cancelling requests and stopping listeners.
     */
    dispose() {
        this.cancel();
        this.stopRecordingUserActions();
        $agentsAtom.update(this.editor, (agents) => agents.filter((agent) => agent.id !== this.id));
    }
    /**
     * Get an agent action util for a specific action type.
     *
     * @param type - The type of action to get the util for.
     * @returns The action util.
     */
    getAgentActionUtil(type) {
        const utilType = this.getAgentActionUtilType(type);
        return this.agentActionUtils[utilType];
    }
    /**
     * Get the util type for a provided action type.
     * If no util type is found, returns 'unknown'.
     */
    getAgentActionUtilType(type) {
        if (!type)
            return 'unknown';
        const util = this.agentActionUtils[type];
        if (!util)
            return 'unknown';
        return type;
    }
    /**
     * Get a prompt part util for a specific part type.
     *
     * @param type - The type of part to get the util for.
     * @returns The part util.
     */
    getPromptPartUtil(type) {
        return this.promptPartUtils[type];
    }
    /**
     * Get a full agent request from a user input by filling out any missing
     * values with defaults.
     * @param input - A partial agent request or a string message.
     */
    getFullRequestFromInput(input) {
        const request = this.getPartialRequestFromInput(input);
        const activeRequest = this.$activeRequest.get();
        return {
            type: request.type ?? 'user',
            messages: request.messages ?? [],
            data: request.data ?? [],
            selectedShapes: request.selectedShapes ?? [],
            contextItems: request.contextItems ?? [],
            bounds: request.bounds ?? activeRequest?.bounds ?? this.editor.getViewportPageBounds(),
            modelName: request.modelName ?? activeRequest?.modelName ?? this.$modelName.get(),
        };
    }
    /**
     * Convert an input into a partial request.
     * This involves handling the various ways that the input can be provided.
     *
     * @example
     * ```tsx
     * agent.prompt('Draw a cat')
     * agent.prompt(['Draw a cat', 'Draw a dog'])
     * agent.prompt({ messages: 'Draw a cat' })
     * agent.prompt({ message: 'Draw a cat' })
     * ```
     *
     * @param input - The input to get the request partial from.
     * @returns The request partial.
     */
    getPartialRequestFromInput(input) {
        // eg: agent.prompt('Draw a cat')
        if (typeof input === 'string') {
            return { messages: [input] };
        }
        // eg: agent.prompt(['Draw a cat', 'Draw a dog'])
        if (Array.isArray(input)) {
            return { messages: input };
        }
        // eg: agent.prompt({ messages: 'Draw a cat' })
        if (typeof input.messages === 'string') {
            return { ...input, messages: [input.messages] };
        }
        // eg: agent.prompt({ message: 'Draw a cat' })
        if (typeof input.message === 'string') {
            return { ...input, messages: [input.message, ...(input.messages ?? [])] };
        }
        return input;
    }
    /**
     * Get a full prompt based on a request.
     *
     * @param request - The request to use for the prompt.
     * @param helpers - The helpers to use.
     * @returns The fully assembled prompt.
     */
    async preparePrompt(request, helpers) {
        const { promptPartUtils } = this;
        const transformedParts = [];
        for (const util of Object.values(promptPartUtils)) {
            const part = await util.getPart(structuredClone(request), helpers);
            if (!part)
                continue;
            transformedParts.push(part);
        }
        return Object.fromEntries(transformedParts.map((part) => [part.type, part]));
    }
    /**
     * Prompt the agent to edit the canvas.
     *
     * @example
     * ```tsx
     * const agent = useTldrawAgent(editor)
     * agent.prompt('Draw a cat')
     * ```
     *
     * ```tsx
     * agent.prompt({
     *   message: 'Draw a cat in this area',
     *   bounds: {
     *     x: 0,
     *     y: 0,
     *     w: 300,
     *     h: 400,
     *   },
     * })
     * ```
     *
     * @returns A promise for when the agent has finished its work.
     */
    async prompt(input) {
        const request = this.getFullRequestFromInput(input);
        // Submit the request to the agent.
        await this.request(request);
        // After the request is handled, check if there are any outstanding todo items or requests
        let scheduledRequest = this.$scheduledRequest.get();
        const todoItemsRemaining = this.$todoList.get().filter((item) => item.status !== 'done');
        if (!scheduledRequest) {
            // If there no outstanding todo items or requests, finish
            if (todoItemsRemaining.length === 0 || !this.cancelFn) {
                return;
            }
            // If there are outstanding todo items, schedule a request
            scheduledRequest = {
                messages: request.messages,
                contextItems: request.contextItems,
                bounds: request.bounds,
                modelName: request.modelName,
                selectedShapes: request.selectedShapes,
                data: request.data,
                type: 'todo',
            };
        }
        // Add the scheduled request to chat history
        const resolvedData = await Promise.all(scheduledRequest.data);
        this.$chatHistory.update((prev) => [
            ...prev,
            {
                type: 'continuation',
                data: resolvedData,
            },
        ]);
        // Handle the scheduled request
        this.$scheduledRequest.set(null);
        await this.prompt(scheduledRequest);
    }
    /**
     * Send a single request to the agent and handle its response.
     *
     * Note: This method does not chain multiple requests together. For a full
     * agentic system, use the `prompt` method.
     *
     * Most developers will not want to use this method directly. It's mostly
     * used internally by the `prompt` method, but can also be useful for
     * carrying out evals.
     *
     * @param input - The input to form the request from.
     * @returns A promise for when the request is complete and a cancel function
     * to abort the request.
     */
    async request(input) {
        const request = this.getFullRequestFromInput(input);
        // Interrupt any currently active request
        if (this.$activeRequest.get() !== null) {
            this.cancel();
        }
        this.$activeRequest.set(request);
        // Call an external helper function to request the agent
        const { promise, cancel } = requestAgent({ agent: this, request });
        this.cancelFn = cancel;
        promise.finally(() => {
            this.cancelFn = null;
        });
        const results = await promise;
        this.$activeRequest.set(null);
        return results;
    }
    /**
     * Schedule further work for the agent to do after this request has finished.
     * What you schedule will get merged with the currently scheduled request, if there is one.
     *
     * @example
     * ```tsx
     * // Add an instruction
     * agent.schedule('Add more detail.')
     * ```
     *
     * @example
     * ```tsx
     * // Move the viewport
     * agent.schedule({
     *  bounds: { x: 0, y: 0, w: 100, h: 100 },
     * })
     * ```
     *
     * @example
     * ```tsx
     * // Add data to the request
     * agent.schedule({ data: [value] })
     * ```
     */
    schedule(input) {
        const scheduledRequest = this.$scheduledRequest.get();
        // If there's no request scheduled yet, schedule one
        if (!scheduledRequest) {
            this.setScheduledRequest(input);
            return;
        }
        const request = this.getPartialRequestFromInput(input);
        this.setScheduledRequest({
            type: 'schedule',
            // Append to properties where possible
            messages: [...scheduledRequest.messages, ...(request.messages ?? [])],
            contextItems: [...scheduledRequest.contextItems, ...(request.contextItems ?? [])],
            selectedShapes: [...scheduledRequest.selectedShapes, ...(request.selectedShapes ?? [])],
            data: [...scheduledRequest.data, ...(request.data ?? [])],
            // Override specific properties
            bounds: request.bounds ?? scheduledRequest.bounds,
            modelName: request.modelName ?? scheduledRequest.modelName,
        });
    }
    /**
     * Manually override what the agent should do next.
     *
     * @example
     * ```tsx
     * agent.setScheduledRequest('Add more detail.')
     * ```
     *
     * @example
     * ```tsx
     * agent.setScheduledRequest({
     *  message: 'Add more detail to this area.',
     *  bounds: { x: 0, y: 0, w: 100, h: 100 },
     * })
     * ```
     *
     * @example
     * ```tsx
     * // Cancel the scheduled request
     * agent.setScheduledRequest(null)
     * ```
     *
     * @param input - What to set the scheduled request to, or null to cancel
     * the scheduled request.
     */
    setScheduledRequest(input) {
        if (input === null) {
            this.$scheduledRequest.set(null);
            return;
        }
        const request = this.getFullRequestFromInput(input);
        request.type = 'schedule';
        this.$scheduledRequest.set(request);
    }
    /**
     * Add a todo item to the agent's todo list.
     * @param text The text of the todo item.
     * @returns The id of the todo item.
     */
    addTodo(text) {
        const id = this.$todoList.get().length;
        this.$todoList.update((todoItems) => {
            return [
                ...todoItems,
                {
                    id,
                    status: 'todo',
                    text,
                },
            ];
        });
        return id;
    }
    /**
     * Make the agent perform an action.
     * @param action The action to make the agent do.
     * @param helpers The helpers to use.
     * @returns The diff of the action, and a promise for when the action is finished
     */
    act(action, helpers = new AgentHelpers(this)) {
        const { editor } = this;
        const util = this.getAgentActionUtil(action._type);
        this.isActing = true;
        let promise = null;
        let diff;
        try {
            diff = editor.store.extractingChanges(() => {
                promise = util.applyAction(structuredClone(action), helpers) ?? null;
            });
        }
        finally {
            this.isActing = false;
        }
        // Add the action to chat history
        if (util.savesToHistory()) {
            const historyItem = {
                type: 'action',
                action,
                diff,
                acceptance: 'pending',
            };
            this.$chatHistory.update((historyItems) => {
                // If there are no items, start off the chat history with the first item
                if (historyItems.length === 0)
                    return [historyItem];
                // If the last item is still in progress, replace it with the new item
                const lastHistoryItem = historyItems.at(-1);
                if (lastHistoryItem &&
                    lastHistoryItem.type === 'action' &&
                    !lastHistoryItem.action.complete) {
                    return [...historyItems.slice(0, -1), historyItem];
                }
                // Otherwise, just add the new item to the end of the list
                return [...historyItems, historyItem];
            });
        }
        return { diff, promise };
    }
    /**
     * Cancel the agent's current prompt, if one is active.
     */
    cancel() {
        this.cancelFn?.();
        this.$activeRequest.set(null);
        this.$scheduledRequest.set(null);
        this.cancelFn = null;
    }
    /**
     * Reset the agent's chat and memory.
     * Cancel the current request if there's one active.
     */
    reset() {
        this.cancel();
        this.$contextItems.set([]);
        this.$todoList.set([]);
        this.$userActionHistory.set([]);
        const viewport = this.editor.getViewportPageBounds();
        this.$chatHistory.set([]);
        this.$chatOrigin.set({ x: viewport.x, y: viewport.y });
    }
    /**
     * Check if the agent is currently working on a request or not.
     */
    isGenerating() {
        return this.$activeRequest.get() !== null;
    }
    /**
     * Start recording user actions.
     * @returns A cleanup function to stop recording user actions.
     */
    startRecordingUserActions() {
        const { editor } = this;
        const cleanUpCreate = editor.sideEffects.registerAfterCreateHandler('shape', (shape, source) => {
            if (source !== 'user')
                return;
            if (this.isActing)
                return;
            const change = {
                added: { [shape.id]: shape },
                updated: {},
                removed: {},
            };
            this.$userActionHistory.update((prev) => [...prev, change]);
            return;
        });
        const cleanUpDelete = editor.sideEffects.registerAfterDeleteHandler('shape', (shape, source) => {
            if (source !== 'user')
                return;
            if (this.isActing)
                return;
            const change = {
                added: {},
                updated: {},
                removed: { [shape.id]: shape },
            };
            this.$userActionHistory.update((prev) => [...prev, change]);
            return;
        });
        const cleanUpChange = editor.sideEffects.registerAfterChangeHandler('shape', (prev, next, source) => {
            if (source !== 'user')
                return;
            if (this.isActing)
                return;
            const change = {
                added: {},
                updated: { [prev.id]: [prev, next] },
                removed: {},
            };
            this.$userActionHistory.update((prev) => [...prev, change]);
            return;
        });
        function cleanUp() {
            cleanUpCreate();
            cleanUpDelete();
            cleanUpChange();
        }
        return cleanUp;
    }
    /**
     * Stop recording user actions.
     */
    stopRecordingUserActions() {
        this.stopRecordingFn?.();
    }
    /**
     * Add a context item to the agent's context, ensuring that duplicates are
     * not included.
     *
     * @param item The context item to add.
     */
    addToContext(item) {
        this.$contextItems.update((items) => {
            // Don't add shapes that are already within context
            if (item.type === 'shapes') {
                const newItems = dedupeShapesContextItem(item, items);
                return [...items, ...newItems];
            }
            // Don't add items that are already in context
            if (this.hasContextItem(item)) {
                return items;
            }
            return [...items, structuredClone(item)];
        });
    }
    /**
     * Remove a context item from the agent's context.
     * @param item The context item to remove.
     */
    removeFromContext(item) {
        this.$contextItems.update((items) => items.filter((v) => item !== v));
    }
    /**
     * Check if the agent's context contains a specific context item. This could
     * mean as an individual item, or as part of a group of items.
     *
     * @param item The context item to check for.
     * @returns True if the agent's context contains the item, false otherwise.
     */
    hasContextItem(item) {
        const items = this.$contextItems.get();
        if (items.some((v) => areContextItemsEqual(v, item))) {
            return true;
        }
        if (item.type === 'shape') {
            for (const existingItem of items) {
                if (existingItem.type === 'shapes') {
                    if (existingItem.shapes.some((shape) => shape.shapeId === item.shape.shapeId)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}
/**
 * Send a request to the agent and handle its response.
 *
 * This is a helper function that is used internally by the agent.
 */
function requestAgent({ agent, request }) {
    const { editor } = agent;
    // If the request is from the user, add it to chat history
    if (request.type === 'user') {
        const promptHistoryItem = {
            type: 'prompt',
            message: request.messages.join('\n'),
            contextItems: request.contextItems,
            selectedShapes: request.selectedShapes,
        };
        agent.$chatHistory.update((prev) => [...prev, promptHistoryItem]);
    }
    let cancelled = false;
    const controller = new AbortController();
    const signal = controller.signal;
    const helpers = new AgentHelpers(agent);
    const requestPromise = (async () => {
        const prompt = await agent.preparePrompt(request, helpers);
        let incompleteDiff = null;
        const actionPromises = [];
        try {
            for await (const action of streamAgent({ prompt, signal })) {
                if (cancelled)
                    break;
                editor.run(() => {
                    const actionUtil = agent.getAgentActionUtil(action._type);
                    // helpers the agent's action
                    const transformedAction = actionUtil.sanitizeAction(action, helpers);
                    if (!transformedAction) {
                        incompleteDiff = null;
                        return;
                    }
                    // If there was a diff from an incomplete action, revert it so that we can reapply the action
                    if (incompleteDiff) {
                        const inversePrevDiff = reverseRecordsDiff(incompleteDiff);
                        editor.store.applyDiff(inversePrevDiff);
                    }
                    // Apply the action to the app and editor
                    const { diff, promise } = agent.act(transformedAction, helpers);
                    if (promise) {
                        actionPromises.push(promise);
                    }
                    // The the action is incomplete, save the diff so that we can revert it in the future
                    if (transformedAction.complete) {
                        incompleteDiff = null;
                    }
                    else {
                        incompleteDiff = diff;
                    }
                }, {
                    ignoreShapeLock: false,
                    history: 'ignore',
                });
            }
            await Promise.all(actionPromises);
        }
        catch (e) {
            if (e === 'Cancelled by user' || (e instanceof Error && e.name === 'AbortError')) {
                return;
            }
            agent.onError(e);
        }
    })();
    const cancel = () => {
        cancelled = true;
        controller.abort('Cancelled by user');
    };
    return { promise: requestPromise, cancel };
}
/**
 * Stream a response from the model.
 * Act on the model's events as they come in.
 *
 * This is a helper function that is used internally by the agent.
 */
async function* streamAgent({ prompt, signal, }) {
    const res = await fetch('/stream', {
        method: 'POST',
        body: JSON.stringify(prompt),
        headers: {
            'Content-Type': 'application/json',
        },
        signal,
    });
    if (!res.body) {
        throw Error('No body in response');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const actions = buffer.split('\n\n');
            buffer = actions.pop() || '';
            for (const action of actions) {
                const match = action.match(/^data: (.+)$/m);
                if (match) {
                    try {
                        const data = JSON.parse(match[1]);
                        // If the response contains an error, throw it
                        if ('error' in data) {
                            throw new Error(data.error);
                        }
                        const agentAction = data;
                        yield agentAction;
                    }
                    catch (err) {
                        throw new Error(err.message);
                    }
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
/**
 * Check if two context items are equal.
 *
 * This is a helper function that is used internally by the agent.
 */
function areContextItemsEqual(a, b) {
    if (a.type !== b.type)
        return false;
    switch (a.type) {
        case 'shape': {
            const _b = b;
            return a.shape.shapeId === _b.shape.shapeId;
        }
        case 'shapes': {
            const _b = b;
            if (a.shapes.length !== _b.shapes.length)
                return false;
            return a.shapes.every((shape) => _b.shapes.find((s) => s.shapeId === shape.shapeId));
        }
        case 'area': {
            const _b = b;
            return Box.Equals(a.bounds, _b.bounds);
        }
        case 'point': {
            const _b = b;
            return Vec.Equals(a.point, _b.point);
        }
        default: {
            exhaustiveSwitchError(a);
        }
    }
}
/**
 * Remove duplicate shapes from a shapes context item.
 * If there's only one shape left, return it as a shape item instead.
 *
 * This is a helper function that is used internally by the agent.
 */
function dedupeShapesContextItem(item, existingItems) {
    // Get all shape IDs that are already in the context
    const existingShapeIds = new Set();
    // Check individual shapes
    existingItems.forEach((contextItem) => {
        if (contextItem.type === 'shape') {
            existingShapeIds.add(contextItem.shape.shapeId);
        }
        else if (contextItem.type === 'shapes') {
            contextItem.shapes.forEach((shape) => {
                existingShapeIds.add(shape.shapeId);
            });
        }
    });
    // Filter out shapes that are already in the context
    const newShapes = item.shapes.filter((shape) => !existingShapeIds.has(shape.shapeId));
    // Only add if there are remaining shapes
    if (newShapes.length > 0) {
        // If only one shape remains, add it as a single shape item
        if (newShapes.length === 1) {
            const newItem = {
                type: 'shape',
                shape: newShapes[0],
                source: item.source,
            };
            return [structuredClone(newItem)];
        }
        // Otherwise add as a shapes group
        const newItem = {
            type: 'shapes',
            shapes: newShapes,
            source: item.source,
        };
        return [structuredClone(newItem)];
    }
    // No new shapes to add
    return [];
}
/**
 * Load an atom's value from local storage and persist it to local storage whenever it changes.
 *
 * This is a helper function that is used internally by the agent.
 */
function persistAtomInLocalStorage(atom, key) {
    const localStorage = globalThis.localStorage;
    if (!localStorage)
        return;
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            const value = JSON.parse(stored);
            atom.set(value);
        }
    }
    catch {
        console.warn(`Couldn't load ${key} from localStorage`);
    }
    react(`save ${key} to localStorage`, () => {
        localStorage.setItem(key, JSON.stringify(atom.get()));
    });
}
/**
 * Throw an error if a switch case is not exhaustive.
 *
 * This is a helper function that is used internally by the agent.
 */
function exhaustiveSwitchError(value, property) {
    const debugValue = property && value && typeof value === 'object' && property in value ? value[property] : value;
    throw new Error(`Unknown switch case ${debugValue}`);
}
//# sourceMappingURL=TldrawAgent.js.map
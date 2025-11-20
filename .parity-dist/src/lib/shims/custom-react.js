import * as React from 'react';
const placeholderThread = {
    id: 'placeholder',
    messages: [],
    generationStage: 'IDLE',
    statusMessage: '',
};
let lastSetInputValue = null;
let lastSubmit = null;
export function usecustom() {
    const [thread] = React.useState(placeholderThread);
    return { thread, componentList: [], toolRegistry: new Map() };
}
export function usecustomClient() {
    const sendMessage = async (text) => {
        if (process.env.NODE_ENV === 'development')
            console.log('[custom shim] sendMessage:', text);
    };
    return { sendMessage };
}
export function usecustomThread() {
    const [inputValue, setInputValue] = React.useState('');
    const thread = placeholderThread;
    const addThreadMessage = async (_msg) => void (process.env.NODE_ENV === 'development' && console.log('[custom shim] addThreadMessage (noop)'));
    const updateThreadMessage = async (_id, _msg) => void (process.env.NODE_ENV === 'development' && console.log('[custom shim] updateThreadMessage (noop)'));
    const switchCurrentThread = async (_id) => void (process.env.NODE_ENV === 'development' && console.log('[custom shim] switchCurrentThread (noop)'));
    const startNewThread = () => void (process.env.NODE_ENV === 'development' && console.log('[custom shim] startNewThread (noop)'));
    const sendMessage = async (text, _opts) => void (process.env.NODE_ENV === 'development' && console.log('[custom shim] sendMessage (noop):', text));
    return {
        thread,
        inputValue,
        setInputValue,
        addThreadMessage,
        updateThreadMessage,
        switchCurrentThread,
        startNewThread,
        sendMessage,
    };
}
export function usecustomThreadInput(_contextKey) {
    const [value, setValue] = React.useState('');
    const [isPending, setPending] = React.useState(false);
    const [error, setError] = React.useState(null);
    React.useEffect(() => {
        lastSetInputValue = setValue;
        return () => {
            if (lastSetInputValue === setValue)
                lastSetInputValue = null;
        };
    }, [setValue]);
    const submit = React.useCallback(async (_opts) => {
        setPending(true);
        setError(null);
        try {
            const msg = value.trim();
            if (!msg)
                return;
            // Derive room name from URL (?room=...), fallback to a stable default
            let roomName = 'present-room';
            if (typeof window !== 'undefined') {
                const params = new URLSearchParams(window.location.search);
                roomName = params.get('room') || roomName;
            }
            // Fire agent dispatch to ensure the agent joins the room
            const res = await fetch('/api/agent/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomName }),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Dispatch failed (${res.status}): ${text || res.statusText}`);
            }
            // Clear input on success
            if (process.env.NODE_ENV === 'development') {
                console.log('[custom submit] Dispatched agent to room:', roomName, 'message:', msg);
            }
            setValue('');
        }
        catch (e) {
            setError(e);
        }
        finally {
            setPending(false);
        }
    }, [value, setValue]);
    React.useEffect(() => {
        lastSubmit = submit;
        return () => {
            if (lastSubmit === submit)
                lastSubmit = null;
        };
    }, [submit]);
    return { value, setValue, submit, isPending, error };
}
export function usecustomSuggestions(_opts) {
    const [selectedSuggestionId, setSelectedSuggestionId] = React.useState(null);
    const suggestions = [];
    const accept = ({ suggestion }) => {
        setSelectedSuggestionId(suggestion.id);
        if (lastSetInputValue)
            lastSetInputValue(suggestion.text);
    };
    const generateResult = { isPending: false, error: null };
    return { suggestions, selectedSuggestionId, accept, generateResult };
}
export function usecustomMessageContext() {
    return { messageId: undefined };
}
//# sourceMappingURL=custom-react.js.map
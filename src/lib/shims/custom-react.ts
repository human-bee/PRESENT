import * as React from 'react';

export type customThreadMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | string;
  content: any;
  createdAt?: string;
};

export type customThread = {
  id: string;
  messages: customThreadMessage[];
  generationStage?: string;
  statusMessage?: string;
};

export type Suggestion = { id: string; text: string };

export type customTool = {
  name: string;
  description?: string;
  tool: (...args: any[]) => any | Promise<any>;
  toolSchema?: any;
};

const placeholderThread: customThread = {
  id: 'placeholder',
  messages: [],
  generationStage: 'IDLE',
  statusMessage: '',
};

let lastSetInputValue: ((v: string) => void) | null = null;
let lastSubmit:
  | ((opts?: { contextKey?: string; streamResponse?: boolean }) => Promise<void>)
  | null = null;

export function usecustom() {
  const [thread] = React.useState<customThread>(placeholderThread);
  return { thread, componentList: [] as Array<{ name: string; description?: string }>, toolRegistry: new Map<string, any>() };
}

export function usecustomClient() {
  const sendMessage = async (text: string) => {
    if (process.env.NODE_ENV === 'development') console.log('[custom shim] sendMessage:', text);
  };
  return { sendMessage };
}

export function usecustomThread() {
  const [inputValue, setInputValue] = React.useState('');
  const thread = placeholderThread;

  const addThreadMessage = async (_msg: customThreadMessage) =>
    void (process.env.NODE_ENV === 'development' && console.log('[custom shim] addThreadMessage (noop)'));
  const updateThreadMessage = async (_id: string, _msg: customThreadMessage) =>
    void (process.env.NODE_ENV === 'development' && console.log('[custom shim] updateThreadMessage (noop)'));
  const switchCurrentThread = async (_id: string) =>
    void (process.env.NODE_ENV === 'development' && console.log('[custom shim] switchCurrentThread (noop)'));
  const startNewThread = () =>
    void (process.env.NODE_ENV === 'development' && console.log('[custom shim] startNewThread (noop)'));
  const sendMessage = async (text: string, _opts?: any) =>
    void (process.env.NODE_ENV === 'development' && console.log('[custom shim] sendMessage (noop):', text));

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

export function usecustomThreadInput(_contextKey?: string) {
  const [value, setValue] = React.useState('');
  const [isPending, setPending] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    lastSetInputValue = setValue;
    return () => {
      if (lastSetInputValue === setValue) lastSetInputValue = null;
    };
  }, [setValue]);

  const submit = React.useCallback(async (_opts?: { contextKey?: string; streamResponse?: boolean }) => {
    setPending(true);
    setError(null);
    try {
      const msg = value.trim();
      if (!msg) return;

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
    } catch (e) {
      setError(e as Error);
    } finally {
      setPending(false);
    }
  }, [value, setValue]);

  React.useEffect(() => {
    lastSubmit = submit;
    return () => {
      if (lastSubmit === submit) lastSubmit = null;
    };
  }, [submit]);

  return { value, setValue, submit, isPending, error };
}

export function usecustomSuggestions(_opts?: { maxSuggestions?: number }) {
  const [selectedSuggestionId, setSelectedSuggestionId] = React.useState<string | null>(null);
  const suggestions: Suggestion[] = [];
  const accept = ({ suggestion }: { suggestion: Suggestion }) => {
    setSelectedSuggestionId(suggestion.id);
    if (lastSetInputValue) lastSetInputValue(suggestion.text);
  };
  const generateResult = { isPending: false, error: null as Error | null };
  return { suggestions, selectedSuggestionId, accept, generateResult };
}

export function usecustomMessageContext(): { messageId?: string } {
  return { messageId: undefined };
}

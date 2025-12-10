'use client';

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { useDataChannel } from '@livekit/components-react';

// =============================================================================
// Types
// =============================================================================

export interface Transcript {
  id: string;
  text: string;
  speaker: string;
  timestamp: number;
  isFinal: boolean;
  source?: 'agent' | 'user' | 'system';
  type?: 'speech' | 'system_call';
  isReplay?: boolean;
}

interface TranscriptState {
  transcripts: Transcript[];
  /** Latest interim transcript per speaker (for live typing indicators) */
  interimBySpaker: Map<string, Transcript>;
}

type TranscriptAction =
  | { type: 'ADD_OR_UPDATE'; payload: Transcript }
  | { type: 'BATCH_ADD'; payload: Transcript[] }
  | { type: 'CLEAR' }
  | { type: 'SET_ALL'; payload: Transcript[] };

// =============================================================================
// Reducer
// =============================================================================

const MAX_TRANSCRIPTS = 200;

function transcriptReducer(state: TranscriptState, action: TranscriptAction): TranscriptState {
  switch (action.type) {
    case 'ADD_OR_UPDATE': {
      const transcript = action.payload;
      const { transcripts, interimBySpaker } = state;

      // Exact ID match - update in place
      const idIndex = transcripts.findIndex((t) => t.id === transcript.id);
      if (idIndex >= 0) {
        // Already exists with same ID - update if newer or final
        const existing = transcripts[idIndex];
        if (existing.isFinal && transcript.isFinal) {
          // Both final, same ID - skip duplicate
          return state;
        }
        const updated = [...transcripts];
        updated[idIndex] = { ...existing, ...transcript };
        return { transcripts: updated, interimBySpaker };
      }

      // For interim transcripts, replace any existing interim from same speaker
      if (!transcript.isFinal) {
        const newInterim = new Map(interimBySpaker);
        newInterim.set(transcript.speaker, transcript);

        // Remove old interim from same speaker, add new one
        const filtered = transcripts.filter(
          (t) => !(t.speaker === transcript.speaker && !t.isFinal)
        );
        const newTranscripts = [...filtered, transcript].slice(-MAX_TRANSCRIPTS);
        return { transcripts: newTranscripts, interimBySpaker: newInterim };
      }

      // Final transcript - remove any interim from same speaker, add final
      const newInterim = new Map(interimBySpaker);
      newInterim.delete(transcript.speaker);

      const filtered = transcripts.filter(
        (t) => !(t.speaker === transcript.speaker && !t.isFinal)
      );
      const newTranscripts = [...filtered, transcript].slice(-MAX_TRANSCRIPTS);
      return { transcripts: newTranscripts, interimBySpaker: newInterim };
    }

    case 'BATCH_ADD': {
      const incoming = action.payload;
      if (incoming.length === 0) return state;

      const byId = new Map(state.transcripts.map((t) => [t.id, t]));
      for (const t of incoming) {
        const existing = byId.get(t.id);
        if (existing) {
          byId.set(t.id, { ...existing, ...t });
        } else {
          byId.set(t.id, t);
        }
      }
      const merged = Array.from(byId.values()).slice(-MAX_TRANSCRIPTS);
      return { ...state, transcripts: merged };
    }

    case 'CLEAR':
      return { transcripts: [], interimBySpaker: new Map() };

    case 'SET_ALL':
      return { transcripts: action.payload.slice(-MAX_TRANSCRIPTS), interimBySpaker: new Map() };

    default:
      return state;
  }
}

// =============================================================================
// Context
// =============================================================================

interface TranscriptContextValue {
  state: TranscriptState;
  addTranscript: (transcript: Transcript) => void;
  batchAddTranscripts: (transcripts: Transcript[]) => void;
  clearTranscripts: () => void;
  setAllTranscripts: (transcripts: Transcript[]) => void;
}

const TranscriptContext = createContext<TranscriptContextValue | null>(null);

// =============================================================================
// Hook
// =============================================================================

export function useTranscriptStore() {
  const context = useContext(TranscriptContext);
  if (!context) {
    throw new Error('useTranscriptStore must be used within a TranscriptProvider');
  }
  return context;
}

/** Convenience hook - returns only final transcripts */
export function useFinalTranscripts() {
  const { state } = useTranscriptStore();
  return state.transcripts.filter((t) => t.isFinal);
}

/** Convenience hook - returns all transcripts including interim */
export function useAllTranscripts() {
  const { state } = useTranscriptStore();
  return state.transcripts;
}

/** Convenience hook - returns interim transcript for a specific speaker */
export function useInterimTranscript(speaker: string) {
  const { state } = useTranscriptStore();
  return state.interimBySpaker.get(speaker);
}

// =============================================================================
// Provider (with DataChannel listener)
// =============================================================================

interface TranscriptProviderProps {
  children: ReactNode;
}

export function TranscriptProvider({ children }: TranscriptProviderProps) {
  const [state, dispatch] = useReducer(transcriptReducer, {
    transcripts: [],
    interimBySpaker: new Map(),
  });

  // Track processed message IDs to avoid duplicates from multiple sources
  const processedIds = useRef(new Set<string>());

  const addTranscript = useCallback((transcript: Transcript) => {
    // Dedup by ID
    if (processedIds.current.has(transcript.id) && transcript.isFinal) {
      return;
    }
    if (transcript.isFinal) {
      processedIds.current.add(transcript.id);
      // Keep set from growing unbounded
      if (processedIds.current.size > 500) {
        const arr = Array.from(processedIds.current);
        processedIds.current = new Set(arr.slice(-300));
      }
    }
    dispatch({ type: 'ADD_OR_UPDATE', payload: transcript });
  }, []);

  const batchAddTranscripts = useCallback((transcripts: Transcript[]) => {
    dispatch({ type: 'BATCH_ADD', payload: transcripts });
  }, []);

  const clearTranscripts = useCallback(() => {
    processedIds.current.clear();
    dispatch({ type: 'CLEAR' });
  }, []);

  const setAllTranscripts = useCallback((transcripts: Transcript[]) => {
    dispatch({ type: 'SET_ALL', payload: transcripts });
  }, []);

  // Single DataChannel listener for all transcript messages
  useDataChannel('transcription', (message) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(message.payload));

      if (data.type === 'live_transcription') {
        const transcriptId = `${data.speaker}-${data.timestamp}`;
        const transcript: Transcript = {
          id: transcriptId,
          text: data.text,
          speaker: data.speaker,
          timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
          isFinal: data.is_final ?? false,
          source: data.speaker === 'voice-agent' ? 'agent' : 'user',
          type: 'speech',
          isReplay: data.replay ?? false,
        };
        addTranscript(transcript);
      }
    } catch (error) {
      console.error('[TranscriptStore] Failed to parse transcript message:', error);
    }
  });

  // Listen for replay events from use-session-sync
  useEffect(() => {
    const handler = (evt: Event) => {
      try {
        const { speaker, text, timestamp } = (evt as CustomEvent).detail || {};
        if (!text) return;
        const transcriptId = `${speaker || 'unknown'}-${timestamp}`;
        const transcript: Transcript = {
          id: transcriptId,
          text,
          speaker: speaker || 'unknown',
          timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
          isFinal: true,
          source: speaker === 'voice-agent' ? 'agent' : 'user',
          type: 'speech',
          isReplay: true,
        };
        addTranscript(transcript);
      } catch {
        // ignore
      }
    };
    window.addEventListener('livekit:transcription-replay', handler as EventListener);
    return () => window.removeEventListener('livekit:transcription-replay', handler as EventListener);
  }, [addTranscript]);

  const value: TranscriptContextValue = {
    state,
    addTranscript,
    batchAddTranscripts,
    clearTranscripts,
    setAllTranscripts,
  };

  return (
    <TranscriptContext.Provider value={value}>
      {children}
    </TranscriptContext.Provider>
  );
}











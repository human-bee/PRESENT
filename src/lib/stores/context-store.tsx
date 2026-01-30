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

// =============================================================================
// Types
// =============================================================================

export interface ContextDocument {
    id: string;
    title: string;
    content: string;
    type: 'markdown' | 'text';
    timestamp: number;
    source: 'file' | 'paste' | 'mcp';
}

interface ContextState {
    documents: ContextDocument[];
}

type ContextAction =
    | { type: 'ADD_DOCUMENT'; payload: ContextDocument }
    | { type: 'REMOVE_DOCUMENT'; payload: string }
    | { type: 'CLEAR_DOCUMENTS' }
    | { type: 'SET_ALL'; payload: ContextDocument[] };

// =============================================================================
// Reducer
// =============================================================================

const MAX_DOCUMENTS = 50;
const MAX_DOCUMENT_SIZE = 100_000; // 100KB per document

function contextReducer(state: ContextState, action: ContextAction): ContextState {
    switch (action.type) {
        case 'ADD_DOCUMENT': {
            const doc = action.payload;
            // Truncate content if too large
            const truncatedDoc = {
                ...doc,
                content: doc.content.slice(0, MAX_DOCUMENT_SIZE),
            };
            // Check for duplicate by ID
            const existing = state.documents.find((d) => d.id === doc.id);
            if (existing) {
                return {
                    documents: state.documents.map((d) =>
                        d.id === doc.id ? truncatedDoc : d
                    ),
                };
            }
            // Add new, cap at max
            return {
                documents: [...state.documents, truncatedDoc].slice(-MAX_DOCUMENTS),
            };
        }

        case 'REMOVE_DOCUMENT':
            return {
                documents: state.documents.filter((d) => d.id !== action.payload),
            };

        case 'CLEAR_DOCUMENTS':
            return { documents: [] };

        case 'SET_ALL':
            return { documents: action.payload.slice(-MAX_DOCUMENTS) };

        default:
            return state;
    }
}

// =============================================================================
// Context
// =============================================================================

interface ContextContextValue {
    state: ContextState;
    addDocument: (doc: Omit<ContextDocument, 'id' | 'timestamp'>) => string;
    removeDocument: (id: string) => void;
    clearDocuments: () => void;
    getFormattedContext: () => string;
}

const ContextContext = createContext<ContextContextValue | null>(null);

// =============================================================================
// Hooks
// =============================================================================

export function useContextStore() {
    const context = useContext(ContextContext);
    if (!context) {
        throw new Error('useContextStore must be used within a ContextProvider');
    }
    return context;
}

/** Convenience hook - returns all context documents */
export function useContextDocuments() {
    const { state } = useContextStore();
    return state.documents;
}

// =============================================================================
// Provider
// =============================================================================

interface ContextProviderProps {
    children: ReactNode;
    sessionId?: string;
}

export function ContextProvider({ children, sessionId }: ContextProviderProps) {
    const [state, dispatch] = useReducer(contextReducer, { documents: [] });
    const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSyncedRef = useRef<string>('');

    // Sync to server when documents change
    useEffect(() => {
        if (!sessionId) return;

        const docsJson = JSON.stringify(state.documents);
        if (docsJson === lastSyncedRef.current) return;

        // Debounce sync
        if (syncTimeoutRef.current) {
            clearTimeout(syncTimeoutRef.current);
        }

        syncTimeoutRef.current = setTimeout(async () => {
            try {
                const res = await fetch('/api/session/context', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId,
                        contextDocuments: state.documents,
                    }),
                });
                if (res.ok) {
                    lastSyncedRef.current = docsJson;
                }
            } catch (err) {
                console.error('[ContextStore] Failed to sync context documents:', err);
            }
        }, 1000);

        return () => {
            if (syncTimeoutRef.current) {
                clearTimeout(syncTimeoutRef.current);
            }
        };
    }, [state.documents, sessionId]);

    // Load initial documents from server
    useEffect(() => {
        if (!sessionId) return;

        (async () => {
            try {
                const res = await fetch(`/api/session/context?sessionId=${sessionId}`);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data.contextDocuments) && data.contextDocuments.length > 0) {
                        dispatch({ type: 'SET_ALL', payload: data.contextDocuments });
                        lastSyncedRef.current = JSON.stringify(data.contextDocuments);
                    }
                }
            } catch {
                // Ignore load errors
            }
        })();
    }, [sessionId]);

    // Listen for ContextFeeder DOM events
    useEffect(() => {
        const handleDocumentAdded = (e: CustomEvent) => {
            if (e.detail) {
                dispatch({ type: 'ADD_DOCUMENT', payload: e.detail });
            }
        };

        const handleDocumentRemoved = (e: CustomEvent) => {
            if (e.detail?.id) {
                dispatch({ type: 'REMOVE_DOCUMENT', payload: e.detail.id });
            }
        };

        const handleDocumentsCleared = () => {
            dispatch({ type: 'CLEAR_DOCUMENTS' });
        };

        const handleDocumentsUpdated = (e: CustomEvent) => {
            if (e.detail?.documents && Array.isArray(e.detail.documents)) {
                dispatch({ type: 'SET_ALL', payload: e.detail.documents });
            }
        };

        window.addEventListener('context:document-added', handleDocumentAdded as EventListener);
        window.addEventListener('context:document-removed', handleDocumentRemoved as EventListener);
        window.addEventListener('context:documents-cleared', handleDocumentsCleared);
        window.addEventListener('context:documents-updated', handleDocumentsUpdated as EventListener);

        return () => {
            window.removeEventListener('context:document-added', handleDocumentAdded as EventListener);
            window.removeEventListener('context:document-removed', handleDocumentRemoved as EventListener);
            window.removeEventListener('context:documents-cleared', handleDocumentsCleared);
            window.removeEventListener('context:documents-updated', handleDocumentsUpdated as EventListener);
        };
    }, []);

    const addDocument = useCallback(
        (doc: Omit<ContextDocument, 'id' | 'timestamp'>): string => {
            const id = crypto.randomUUID();
            const fullDoc: ContextDocument = {
                ...doc,
                id,
                timestamp: Date.now(),
            };
            dispatch({ type: 'ADD_DOCUMENT', payload: fullDoc });
            return id;
        },
        []
    );

    const removeDocument = useCallback((id: string) => {
        dispatch({ type: 'REMOVE_DOCUMENT', payload: id });
    }, []);

    const clearDocuments = useCallback(() => {
        dispatch({ type: 'CLEAR_DOCUMENTS' });
    }, []);

    const getFormattedContext = useCallback((): string => {
        if (state.documents.length === 0) return '';

        return state.documents
            .map((doc) => {
                const typeLabel = doc.type === 'markdown' ? 'Markdown' : 'Text';
                return `[${typeLabel}: ${doc.title}]\n${doc.content}`;
            })
            .join('\n\n---\n\n');
    }, [state.documents]);

    const value: ContextContextValue = {
        state,
        addDocument,
        removeDocument,
        clearDocuments,
        getFormattedContext,
    };

    return (
        <ContextContext.Provider value={value}>{children}</ContextContext.Provider>
    );
}

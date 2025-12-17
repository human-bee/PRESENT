'use client';

import { useMemo } from 'react';
import { useTranscriptStore, useAllTranscripts, type Transcript } from '@/lib/stores/transcript-store';
import { useContextDocuments, type ContextDocument } from '@/lib/stores/context-store';
import { useContextKey } from '@/components/RoomScopedProviders';
import { useComponentList, type ComponentInfo } from '@/lib/component-registry';

// =============================================================================
// Types
// =============================================================================

export interface CanvasContext {
    // Session info
    sessionId: string;
    roomName: string;

    // Transcripts
    transcripts: Transcript[];
    recentTranscript: string;

    // Context documents (from ContextFeeder)
    documents: ContextDocument[];
    formattedDocuments: string;

    // Widgets (registered components)
    widgets: ComponentInfo[];

    // Combined prompt context helper
    getPromptContext: (options?: PromptContextOptions) => string;
}

export interface PromptContextOptions {
    /** Number of recent transcript lines to include (default: 20) */
    transcriptLines?: number;
    /** Max characters per document (default: 5000) */
    maxDocumentLength?: number;
    /** Include widget summaries (default: false) */
    includeWidgets?: boolean;
    /** Custom sections to append */
    customSections?: Array<{ title: string; content: string }>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Unified hook for accessing all canvas context sources.
 * Use this in widgets to get transcripts, documents, widgets, and session info.
 */
export function useCanvasContext(): CanvasContext {
    const sessionId = useContextKey() || 'default';
    const transcripts = useAllTranscripts();
    const documents = useContextDocuments();
    const widgets = useComponentList();

    // Format recent transcript lines
    const recentTranscript = useMemo(() => {
        return transcripts
            .filter((t) => t.isFinal)
            .slice(-20)
            .map((t) => {
                const name = t.speaker || 'Speaker';
                return `${name}: ${t.text}`;
            })
            .join('\n');
    }, [transcripts]);

    // Format context documents
    const formattedDocuments = useMemo(() => {
        if (documents.length === 0) return '';
        return documents
            .map((doc) => {
                const typeLabel = doc.type === 'markdown' ? 'Markdown' : 'Text';
                return `[${typeLabel}: ${doc.title}]\n${doc.content}`;
            })
            .join('\n\n---\n\n');
    }, [documents]);

    // Combined prompt context generator
    const getPromptContext = useMemo(() => {
        return (options: PromptContextOptions = {}) => {
            const {
                transcriptLines = 20,
                maxDocumentLength = 5000,
                includeWidgets = false,
                customSections = [],
            } = options;

            const sections: string[] = [];

            // Transcripts section
            const recentLines = transcripts
                .filter((t) => t.isFinal)
                .slice(-transcriptLines)
                .map((t) => `${t.speaker || 'Speaker'}: ${t.text}`)
                .join('\n');

            if (recentLines) {
                sections.push(`## Conversation\n${recentLines}`);
            }

            // Documents section
            if (documents.length > 0) {
                const docsContent = documents
                    .map((doc) => {
                        const typeLabel = doc.type === 'markdown' ? 'Markdown' : 'Text';
                        const content = doc.content.slice(0, maxDocumentLength);
                        const truncated = doc.content.length > maxDocumentLength ? '...(truncated)' : '';
                        return `### ${typeLabel}: ${doc.title}\n${content}${truncated}`;
                    })
                    .join('\n\n');
                sections.push(`## Context Documents\n${docsContent}`);
            }

            // Widgets section (optional)
            if (includeWidgets && widgets.length > 0) {
                const widgetSummaries = widgets
                    .map((w) => `- ${w.componentType} (${w.messageId})`)
                    .join('\n');
                sections.push(`## Active Widgets\n${widgetSummaries}`);
            }

            // Custom sections
            for (const section of customSections) {
                sections.push(`## ${section.title}\n${section.content}`);
            }

            return sections.join('\n\n');
        };
    }, [transcripts, documents, widgets]);

    return {
        sessionId,
        roomName: sessionId,
        transcripts,
        recentTranscript,
        documents,
        formattedDocuments,
        widgets,
        getPromptContext,
    };
}

// =============================================================================
// Convenience hooks for specific data
// =============================================================================

/** Get just the session/room ID */
export function useSessionId(): string {
    return useContextKey() || 'default';
}

/** Check if there's any context available */
export function useHasContext(): boolean {
    const transcripts = useAllTranscripts();
    const documents = useContextDocuments();
    return transcripts.length > 0 || documents.length > 0;
}

'use client';

import { cn } from '@/lib/utils';
import { useComponentRegistration } from '@/lib/component-registry';
import { z } from 'zod';
import {
    FileText,
    Upload,
    X,
    Type,
    Trash2,
    ChevronDown,
    ChevronUp,
    FileUp,
} from 'lucide-react';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';

// =============================================================================
// Schema
// =============================================================================

export const contextDocumentSchema = z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    type: z.enum(['markdown', 'text']),
    timestamp: z.number(),
    source: z.enum(['file', 'paste']),
});

export const contextFeederSchema = z.object({
    documents: z.array(contextDocumentSchema).optional().describe('Array of context documents'),
    allowMarkdown: z.boolean().optional().describe('Allow markdown file uploads'),
    allowText: z.boolean().optional().describe('Allow plain text paste'),
    title: z.string().optional().describe('Title for the widget'),
});

export type ContextDocument = z.infer<typeof contextDocumentSchema>;
export type ContextFeederProps = z.infer<typeof contextFeederSchema>;

type ContextFeederHostProps = ContextFeederProps &
    React.HTMLAttributes<HTMLDivElement> & { __custom_message_id?: string };

// =============================================================================
// Component
// =============================================================================

export function ContextFeeder(props: ContextFeederHostProps) {
    const {
        className,
        __custom_message_id,
        documents: incomingDocuments,
        allowMarkdown = true,
        allowText = true,
        title: incomingTitle,
        ...restDomProps
    } = props;

    // Strip custom shape injection props
    const domProps = { ...(restDomProps as Record<string, unknown>) };
    delete domProps.updateState;
    delete domProps.state;
    delete domProps.__custom_message_id;

    const [documents, setDocuments] = useState<ContextDocument[]>(
        Array.isArray(incomingDocuments) ? incomingDocuments : []
    );
    const [textInput, setTextInput] = useState('');
    const [textTitle, setTextTitle] = useState('');
    const [isTextExpanded, setIsTextExpanded] = useState(false);
    const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

    const fallbackMessageIdRef = useRef<string>();
    if (!fallbackMessageIdRef.current) {
        fallbackMessageIdRef.current = `context-feeder-${crypto.randomUUID()}`;
    }
    const messageId = (__custom_message_id?.trim() || fallbackMessageIdRef.current)!;

    // Sync incoming documents
    useEffect(() => {
        if (Array.isArray(incomingDocuments)) {
            setDocuments(incomingDocuments);
        }
    }, [incomingDocuments]);

    const handleRegistryUpdate = useCallback((patch: Record<string, unknown>) => {
        if (patch.documents && Array.isArray(patch.documents)) {
            setDocuments(patch.documents as ContextDocument[]);
        }
    }, []);

    const registryPayload = useMemo(
        () => ({
            documents,
            allowMarkdown,
            allowText,
            title: incomingTitle ?? 'Context Feeder',
        }),
        [documents, allowMarkdown, allowText, incomingTitle]
    );

    useComponentRegistration(
        messageId,
        'ContextFeeder',
        registryPayload,
        'canvas',
        handleRegistryUpdate
    );

    // File drop handler
    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            acceptedFiles.forEach((file) => {
                if (!file.name.endsWith('.md') && !file.name.endsWith('.markdown') && !file.name.endsWith('.txt')) {
                    console.warn('[ContextFeeder] Skipping non-markdown/text file:', file.name);
                    return;
                }

                const reader = new FileReader();
                reader.onload = () => {
                    const content = reader.result as string;
                    const isMarkdown = file.name.endsWith('.md') || file.name.endsWith('.markdown');

                    const newDoc: ContextDocument = {
                        id: crypto.randomUUID(),
                        title: file.name,
                        content,
                        type: isMarkdown ? 'markdown' : 'text',
                        timestamp: Date.now(),
                        source: 'file',
                    };

                    setDocuments((prev) => [...prev, newDoc]);

                    // Dispatch event for other systems to pick up
                    window.dispatchEvent(
                        new CustomEvent('context:document-added', { detail: newDoc })
                    );
                };
                reader.readAsText(file);
            });
        },
        []
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'text/markdown': ['.md', '.markdown'],
            'text/plain': ['.txt'],
        },
        noClick: false,
    });

    // Add pasted text
    const handleAddText = useCallback(() => {
        if (!textInput.trim()) return;

        const newDoc: ContextDocument = {
            id: crypto.randomUUID(),
            title: textTitle.trim() || `Text snippet ${documents.length + 1}`,
            content: textInput,
            type: 'text',
            timestamp: Date.now(),
            source: 'paste',
        };

        setDocuments((prev) => [...prev, newDoc]);
        setTextInput('');
        setTextTitle('');
        setIsTextExpanded(false);

        window.dispatchEvent(
            new CustomEvent('context:document-added', { detail: newDoc })
        );
    }, [textInput, textTitle, documents.length]);

    const handleRemoveDocument = useCallback((id: string) => {
        setDocuments((prev) => prev.filter((d) => d.id !== id));
        window.dispatchEvent(new CustomEvent('context:document-removed', { detail: { id } }));
    }, []);

    const handleClearAll = useCallback(() => {
        setDocuments([]);
        window.dispatchEvent(new CustomEvent('context:documents-cleared'));
    }, []);

    // Sync documents to context store via event
    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent('context:documents-updated', { detail: { documents } })
        );
    }, [documents]);

    return (
        <div
            className={cn(
                'w-full max-w-lg bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden',
                className
            )}
            {...(domProps as any)}
        >
            {/* Header */}
            <div className="px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <FileText className="w-5 h-5" />
                        {incomingTitle ?? 'Context Feeder'}
                    </h2>
                    {documents.length > 0 && (
                        <button
                            onClick={handleClearAll}
                            className="text-white/80 hover:text-white text-sm flex items-center gap-1"
                            title="Clear all documents"
                        >
                            <Trash2 className="w-4 h-4" />
                            Clear
                        </button>
                    )}
                </div>
                <p className="text-sm text-white/80 mt-1">
                    {documents.length} document{documents.length !== 1 ? 's' : ''} loaded
                </p>
            </div>

            <div className="p-4 space-y-4">
                {/* File Upload Zone */}
                {allowMarkdown && (
                    <div
                        {...getRootProps()}
                        className={cn(
                            'border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer',
                            isDragActive
                                ? 'border-indigo-500 bg-indigo-50'
                                : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
                        )}
                    >
                        <input {...getInputProps()} />
                        <FileUp className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                        <p className="text-sm text-gray-600">
                            {isDragActive
                                ? 'Drop markdown files here...'
                                : 'Drag & drop .md or .txt files, or click to select'}
                        </p>
                    </div>
                )}

                {/* Text Paste Section */}
                {allowText && (
                    <div className="space-y-2">
                        <button
                            onClick={() => setIsTextExpanded(!isTextExpanded)}
                            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-indigo-600"
                        >
                            <Type className="w-4 h-4" />
                            Paste Text
                            {isTextExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                            ) : (
                                <ChevronDown className="w-4 h-4" />
                            )}
                        </button>

                        {isTextExpanded && (
                            <div className="space-y-2 p-3 bg-gray-50 rounded-lg">
                                <input
                                    type="text"
                                    placeholder="Title (optional)"
                                    value={textTitle}
                                    onChange={(e) => setTextTitle(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <textarea
                                    placeholder="Paste your text here..."
                                    value={textInput}
                                    onChange={(e) => setTextInput(e.target.value)}
                                    className="w-full h-32 px-3 py-2 text-sm border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <button
                                    onClick={handleAddText}
                                    disabled={!textInput.trim()}
                                    className={cn(
                                        'w-full py-2 rounded-md text-sm font-medium transition-colors',
                                        textInput.trim()
                                            ? 'bg-indigo-500 text-white hover:bg-indigo-600'
                                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    )}
                                >
                                    Add Text
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Document List */}
                {documents.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-700">Documents</h3>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {documents.map((doc) => (
                                <div
                                    key={doc.id}
                                    className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg group"
                                >
                                    <div className="flex-shrink-0 mt-0.5">
                                        {doc.type === 'markdown' ? (
                                            <FileText className="w-4 h-4 text-indigo-500" />
                                        ) : (
                                            <Type className="w-4 h-4 text-purple-500" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <button
                                            onClick={() =>
                                                setExpandedDocId(expandedDocId === doc.id ? null : doc.id)
                                            }
                                            className="w-full text-left"
                                        >
                                            <p className="text-sm font-medium text-gray-900 truncate">
                                                {doc.title}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                {doc.source === 'file' ? 'File' : 'Pasted'} •{' '}
                                                {(doc.content.length / 1024).toFixed(1)}KB
                                            </p>
                                        </button>
                                        {expandedDocId === doc.id && (
                                            <pre className="mt-2 p-2 text-xs bg-white rounded border border-gray-200 max-h-40 overflow-auto whitespace-pre-wrap">
                                                {doc.content.slice(0, 2000)}
                                                {doc.content.length > 2000 && '...'}
                                            </pre>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleRemoveDocument(doc.id)}
                                        className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Remove document"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Empty State */}
                {documents.length === 0 && (
                    <div className="text-center py-4 text-gray-500 text-sm">
                        <p>No context documents added yet.</p>
                        <p className="text-xs mt-1">
                            Upload markdown files or paste text to add context.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ContextFeeder;

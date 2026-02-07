import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Room } from 'livekit-client';
import { createLiveKitBus } from '../lib/livekit/livekit-bus';
import { Button } from '@/components/ui/shared/button';
import { Card } from '@/components/ui/shared/card';
import { X, Loader2, ImageIcon } from 'lucide-react';
import { useEditor } from '@tldraw/tldraw';
import { useInfographicDrop, DRAG_MIME_TYPE } from '@/hooks/use-infographic-drop';
import { usePromotable } from '@/hooks/use-promotable';
import { useCanvasContext } from '@/lib/hooks/use-canvas-context';
import {
    DEFAULT_FAIRY_CONTEXT_PROFILE,
    getFairyContextLimits,
    normalizeFairyContextProfile,
} from '@/lib/fairy-context/profiles';
import { formatFairyContextParts, type FairyContextPart } from '@/lib/fairy-context/format';
import { waitForMcpReady } from '@/lib/mcp-bridge';
import { buildMemoryPayload } from '@/lib/mcp/memory';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';

const DEFAULT_MEMORY_TOOL = process.env.NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_TOOL;
const DEFAULT_MEMORY_COLLECTION = process.env.NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_COLLECTION;
const DEFAULT_MEMORY_INDEX = process.env.NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_INDEX;
const DEFAULT_MEMORY_NAMESPACE = process.env.NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_NAMESPACE;
const DEFAULT_MEMORY_AUTO_SEND = process.env.NEXT_PUBLIC_INFOGRAPHIC_MEMORY_AUTO_SEND === 'true';
const MAX_MEMORY_SUMMARY_CHARS = 600;
const MAX_MEMORY_CONTENT_CHARS = 2000;

interface InfographicWidgetProps {
    room: Room | null;
    isShape?: boolean;
    __custom_message_id?: string;
    messageId?: string;
    contextKey?: string;
}

// Helper to stop pointer events from bubbling to TLDraw
// const stopPointerPropagation = (e: React.PointerEvent) => {
//     e.stopPropagation();
// };


export function InfographicWidget({ room, isShape = false, __custom_message_id, messageId: propMessageId, contextKey }: InfographicWidgetProps) {
    const widgetIdRef = useRef<string>(crypto.randomUUID());
    const [isOpen, setIsOpen] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [providerUsed, setProviderUsed] = useState<string | null>(null);
    const [fallbackReason, setFallbackReason] = useState<string | null>(null);
    // History state: stores array of generated images
    const [history, setHistory] = useState<Array<{ id: string, url: string, timestamp: number }>>([]);
    const [currentIndex, setCurrentIndex] = useState(-1);

    const [error, setError] = useState<string | null>(null);
    const [transcripts, setTranscripts] = useState<any[]>([]);
    const [useGrounding, setUseGrounding] = useState(true);
    const [contextProfile, setContextProfile] = useState(DEFAULT_FAIRY_CONTEXT_PROFILE);
    const [contextBundleParts, setContextBundleParts] = useState<FairyContextPart[] | null>(null);
    const [memoryToolName, setMemoryToolName] = useState(DEFAULT_MEMORY_TOOL);
    const [memoryCollection, setMemoryCollection] = useState(DEFAULT_MEMORY_COLLECTION);
    const [memoryIndex, setMemoryIndex] = useState(DEFAULT_MEMORY_INDEX);
    const [memoryNamespace, setMemoryNamespace] = useState(DEFAULT_MEMORY_NAMESPACE);
    const [memoryAutoSend, setMemoryAutoSend] = useState(DEFAULT_MEMORY_AUTO_SEND);
    const lastPromptRef = useRef<string>('');
    const lastMemorySentRef = useRef<string>('');

    const bus = useMemo(() => createLiveKitBus(room), [room]);
    const editor = useEditor();
    const messageId = propMessageId || __custom_message_id || (room as any)?.messageId || widgetIdRef.current;
    const registryContext = contextKey || (isShape ? 'canvas' : 'default');

    const memoryTarget = useMemo(
        () => ({
            collection: memoryCollection,
            index: memoryIndex,
            namespace: memoryNamespace,
        }),
        [memoryCollection, memoryIndex, memoryNamespace],
    );

    const sendInfographicMemory = useCallback(
        async (image: { id: string; timestamp: number }, promptText: string) => {
            const rawToolName = (memoryToolName || '').trim();
            const toolName = rawToolName.startsWith('mcp_') ? rawToolName.slice(4) : rawToolName;
            if (!toolName) return;

            const ready = await waitForMcpReady(200);
            if (!ready) return;

            const key = `${image.id}-${image.timestamp}-${promptText.length}`;
            if (lastMemorySentRef.current === key) return;

            const title = 'Infographic Summary';
            const summary = promptText
                ? promptText.slice(0, MAX_MEMORY_SUMMARY_CHARS)
                : 'Infographic generated from conversation context.';
            const content = [
                `Infographic image id: ${image.id}`,
                `Widget messageId: ${messageId}`,
                promptText ? `Prompt:\n${promptText}` : '',
            ]
                .filter(Boolean)
                .join('\n\n');
            const trimmedContent =
                content.length > MAX_MEMORY_CONTENT_CHARS
                    ? `${content.slice(0, MAX_MEMORY_CONTENT_CHARS)}...`
                    : content;

            const payload = buildMemoryPayload(
                toolName,
                {
                    id: image.id,
                    title,
                    content: trimmedContent,
                    summary,
                    highlights: [],
                    decisions: [],
                    actionItems: [],
                    tags: ['infographic', 'conversation'],
                    contextProfile,
                    contextKey: registryContext,
                    messageId,
                    lastUpdated: image.timestamp,
                },
                memoryTarget,
            );

            try {
                await (window as any).callMcpTool?.(toolName, payload);
                lastMemorySentRef.current = key;
            } catch (error) {
                console.warn('[InfographicWidget] memory send failed', error);
            }
        },
        [contextProfile, memoryTarget, memoryToolName, messageId, registryContext],
    );

    // Get unified canvas context (transcripts, documents, etc.)
    const { documents: contextDocuments, getPromptContext } = useCanvasContext();

    // Listen for transcripts
    useEffect(() => {
        const off = bus.on('transcription', (data: any) => {
            if (data && (typeof data.text === 'string')) {
                setTranscripts((prev) => {
                    const newTranscripts = [...prev, data];
                    // Keep last 20 lines to avoid memory issues
                    return newTranscripts.slice(-20);
                });
            }
        });
        return off;
    }, [bus]);

    const handleGenerate = useCallback(async () => {
        if (isGenerating) return;
        setIsGenerating(true);
        setError(null);
        if (!isShape) setIsOpen(true); // Ensure widget is open only if not a shape

        try {
            // Get combined context using unified hook
            const limits = getFairyContextLimits(contextProfile);
            const context = getPromptContext({
                transcriptLines: limits.TRANSCRIPT_LINES,
                maxDocumentLength: limits.MAX_DOCUMENT_LENGTH,
            });

            // Also check local transcripts state (separate from unified context for real-time updates)
            const recentLines = transcripts.slice(-limits.TRANSCRIPT_LINES).map((t: any) => {
                const name = t.participantName || t.participantId || 'Speaker';
                return `${name}: ${t.text}`;
            }).join('\n');

            const scorecardContext = (() => {
                try {
                    if (!editor) return '';
                    const shapes = (editor as any).getCurrentPageShapes?.() ?? [];
                    const scorecards = shapes
                        .filter((shape: any) => shape?.type === 'custom' && shape?.props?.name === 'DebateScorecard')
                        .map((shape: any) => ({
                            shape,
                            state: (shape?.props?.state ?? {}) as any,
                        }))
                        .filter((entry: any) => entry.state && typeof entry.state === 'object');

                    if (!scorecards.length) return '';

                    scorecards.sort((a: any, b: any) => Number(b.state?.lastUpdated ?? 0) - Number(a.state?.lastUpdated ?? 0));
                    const state = scorecards[0].state as any;

                    const topic = typeof state.topic === 'string' ? state.topic : '';
                    const round = typeof state.round === 'string' ? state.round : '';

                    const players = Array.isArray(state.players) ? state.players : [];
                    const claims = Array.isArray(state.claims) ? state.claims : [];
                    const sources = Array.isArray(state.sources) ? state.sources : [];
                    const factCheckEnabled = state.factCheckEnabled === true;
                    const metrics = state.metrics ?? {};
                    const rfd = state.rfd ?? {};

                    const formatPlayer = (side: string) => {
                        const player = players.find((p: any) => p?.side === side) ?? {};
                        const label = typeof player.label === 'string' ? player.label : side;
                        const score = Number.isFinite(player.score) ? player.score : 0;
                        return `${side}: ${label} (score ${score})`;
                    };

                    const pickClaims = (side: string) => {
                        const sideClaims = claims.filter((c: any) => c?.side === side);
                        sideClaims.sort((a: any, b: any) => Number(b.updatedAt ?? b.createdAt ?? 0) - Number(a.updatedAt ?? a.createdAt ?? 0));
                        return sideClaims.slice(0, 6).map((c: any) => {
                            const status = typeof c.status === 'string' ? c.status : '';
                            const verdict = typeof c.verdict === 'string' ? c.verdict : '';
                            const speech = typeof c.speech === 'string' ? c.speech : '';
                            const summary = typeof c.summary === 'string' ? c.summary : '';
                            const quote = typeof c.quote === 'string' ? c.quote : '';
                            const text = summary || quote;
                            const tag = [speech, status, verdict].filter(Boolean).join(' · ');
                            return `- ${tag ? `[${tag}] ` : ''}${text}`.trim();
                        });
                    };

                    const pickSources = () => {
                        const items = sources.slice(0, 8).map((s: any) => {
                            const title = typeof s.title === 'string' ? s.title : '';
                            const url = typeof s.url === 'string' ? s.url : '';
                            const credibility = typeof s.credibility === 'string' ? s.credibility : '';
                            const type = typeof s.type === 'string' ? s.type : '';
                            const meta = [credibility, type].filter(Boolean).join(' / ');
                            return `- ${title || url}${meta ? ` (${meta})` : ''}${url ? ` — ${url}` : ''}`;
                        });
                        return items;
                    };

                    const judgeLean = typeof metrics.judgeLean === 'string' ? metrics.judgeLean : '';
                    const roundScore = Number.isFinite(metrics.roundScore) ? metrics.roundScore : null;
                    const evidenceQuality = Number.isFinite(metrics.evidenceQuality) ? metrics.evidenceQuality : null;

                    const rfdSummary = typeof rfd.summary === 'string' ? rfd.summary : '';

                    const sections: string[] = [];
                    sections.push('## Debate Scorecard Snapshot (authoritative)');
                    if (topic) sections.push(`Topic: ${topic}`);
                    if (round) sections.push(`Round: ${round}`);
                    sections.push(`Players:\n- ${formatPlayer('AFF')}\n- ${formatPlayer('NEG')}`);
                    if (judgeLean || roundScore !== null || evidenceQuality !== null) {
                        sections.push(
                            `Metrics: judgeLean=${judgeLean || 'N/A'}, roundScore=${roundScore ?? 'N/A'}, evidenceQuality=${evidenceQuality ?? 'N/A'}`,
                        );
                    }
                    sections.push(`Fact-check enabled: ${factCheckEnabled ? 'yes' : 'no'}`);

                    const affClaims = pickClaims('AFF');
                    const negClaims = pickClaims('NEG');
                    if (affClaims.length || negClaims.length) {
                        sections.push(`Top claims (use these as the core content):\nAFF:\n${affClaims.join('\n') || '- (none)'}\n\nNEG:\n${negClaims.join('\n') || '- (none)'}`);
                    }

                    if (rfdSummary) {
                        sections.push(`Judge / RFD summary:\n${rfdSummary}`);
                    }

                    const sourceLines = pickSources();
                    if (sourceLines.length) {
                        sections.push(`Sources referenced:\n${sourceLines.join('\n')}`);
                    }

                    return sections.join('\n\n');
                } catch {
                    return '';
                }
            })();

            const bundleText = contextBundleParts ? formatFairyContextParts(contextBundleParts, limits.MAX_CONTEXT_CHARS) : '';

            const hasUnifiedContext = Boolean(context && context.trim().length > 0);
            const hasLocalTranscript = Boolean(recentLines && recentLines.trim().length > 0);
            const hasContextDocs = contextDocuments.length > 0;
            const hasBundle = Boolean(bundleText && bundleText.trim().length > 0);

            // Allow generation if we have ANY available context source.
            if (!hasUnifiedContext && !hasLocalTranscript && !hasContextDocs && !scorecardContext && !hasBundle) {
                throw new Error('No conversation context available yet. Start talking or add context documents!');
            }

            const prompt = [
                `Based on the context below, create a visually appealing infographic that summarizes the debate's key claims, evidence, and outcome.`,
                `Focus on: topic specificity, clear structure (AFF vs NEG), and faithful representation of the provided claims/sources.`,
                scorecardContext ? `\n${scorecardContext}\n` : '',
                recentLines ? `\n## Live Transcript (recent)\n${recentLines}\n` : '',
                context ? `\n## Additional Context\n${context}\n` : '',
                bundleText ? `\n## Context Bundle\n${bundleText}\n` : '',
            ].filter(Boolean).join('\n');
            lastPromptRef.current = prompt;

            const response = await fetchWithSupabaseAuth('/api/generateImages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    model: 'gemini-3-pro-image-preview',
                    useGrounding,
                    iterativeMode: false,
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Generation failed: ${response.status} ${errText}`);
            }

            const data = await response.json();
            setProviderUsed(typeof data?.providerUsed === 'string' ? data.providerUsed : null);
            setFallbackReason(typeof data?.fallbackReason === 'string' ? data.fallbackReason : null);
            if (data.b64_json) {
                const newImage = {
                    id: crypto.randomUUID(),
                    url: `data:image/png;base64,${data.b64_json}`,
                    timestamp: Date.now()
                };
                setHistory(prev => {
                    const next = [...prev, newImage];
                    setCurrentIndex(next.length - 1); // Always show latest
                    return next;
                });
                if (memoryAutoSend) {
                    void sendInfographicMemory(newImage, lastPromptRef.current || prompt);
                }
            } else {
                throw new Error('No image data received');
            }
        } catch (err: any) {
            console.error('Infographic generation error:', err);
            setError(err.message || 'Failed to generate infographic');
        } finally {
            setIsGenerating(false);
        }
    }, [
        contextBundleParts,
        contextDocuments,
        contextProfile,
        editor,
        getPromptContext,
        isGenerating,
        isShape,
        memoryAutoSend,
        sendInfographicMemory,
        transcripts,
        useGrounding,
    ]);

    useEffect(() => {
        if (!isShape) {
            const handleOpen = () => setIsOpen(true);
            window.addEventListener('present:open_infographic_widget', handleOpen);
            return () => window.removeEventListener('present:open_infographic_widget', handleOpen);
        }
    }, [isShape]);

    // ---------------------------------------------------------------------------
    // AI Integration: Enable update_component support
    // ---------------------------------------------------------------------------
    const handleAIUpdate = useCallback((patch: any) => {
        console.log('[InfographicWidget] Received AI update:', patch);

        // Update local state based on patch
        if (typeof patch.useGrounding === 'boolean') {
            setUseGrounding(patch.useGrounding);
        }
        if (typeof patch.contextProfile === 'string') {
            const normalized = normalizeFairyContextProfile(patch.contextProfile);
            if (normalized) {
                setContextProfile(normalized);
            }
        }
        if (patch.contextBundle && Array.isArray(patch.contextBundle.parts)) {
            setContextBundleParts(patch.contextBundle.parts as FairyContextPart[]);
        }
        if (typeof patch.memoryToolName === 'string') {
            setMemoryToolName(patch.memoryToolName);
        }
        if (typeof patch.memoryCollection === 'string') {
            setMemoryCollection(patch.memoryCollection);
        }
        if (typeof patch.memoryIndex === 'string') {
            setMemoryIndex(patch.memoryIndex);
        }
        if (typeof patch.memoryNamespace === 'string') {
            setMemoryNamespace(patch.memoryNamespace);
        }
        if (typeof patch.memoryAutoSend === 'boolean') {
            setMemoryAutoSend(patch.memoryAutoSend);
        }

        // Trigger generation if instruction/prompt is provided
        if (patch.instruction || patch.prompt) {
            console.log('[InfographicWidget] Triggering generation from AI update');
            handleGenerate();
        }
    }, [handleGenerate]);

    const activeImage = history[currentIndex];

    // Register component for AI updates
    const promotableItems = React.useMemo(
        () => activeImage ? [{
            id: activeImage.id || 'active-image',
            type: 'image' as const,
            data: {
                url: activeImage.url,
                width: 600,
                height: 400,
                title: 'Infographic'
            },
            label: 'Generated Infographic'
        }] : [],
        [activeImage]
    );

    usePromotable(
        promotableItems,
        {
            messageId,
            componentType: 'InfographicWidget',
            contextKey: registryContext,
            props: {
                messageId,
                currentImage: activeImage ? {
                    url: activeImage.url,
                    width: 600,
                    height: 400
                } : null
            },
            updateCallback: handleAIUpdate
        }
    );

    useEffect(() => {
        const handleAgentAction = (e: CustomEvent) => {
            const envelope: any = e.detail;
            if (!envelope?.actions) return;
            if (envelope.__infographicHandled) return;

            for (const action of envelope.actions) {
                if (action.name !== 'create_infographic') continue;

                const targetId =
                    action.params?.widgetId ??
                    action.params?.component_id ??
                    action.params?.target_id ??
                    action.params?.shape_id;

                const matches = targetId
                    ? targetId === messageId // Use messageId for matching
                    : !envelope.__infographicHandled;

                if (!matches) continue;

                console.log('[InfographicWidget] Received create_infographic action');
                envelope.__infographicHandled = true;
                handleGenerate();
                break;
            }
        };

        window.addEventListener('present:agent_actions', handleAgentAction as EventListener);
        return () => {
            window.removeEventListener('present:agent_actions', handleAgentAction as EventListener);
        };
    }, [handleGenerate, messageId]); // Added messageId to dependencies

    const handleDownload = () => {
        if (!activeImage) return;
        const link = document.createElement('a');
        link.href = activeImage.url;
        link.download = `infographic-${activeImage.timestamp}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Use the custom hook to handle drag-and-drop logic
    // This encapsulates the global listener and shape creation
    useInfographicDrop({ editor, currentImage: activeImage, widgetId: messageId });

    const handleDragStart = (e: React.DragEvent<HTMLImageElement>) => {
        if (!activeImage) return;
        console.log('[InfographicWidget] Drag started', {
            url: `${activeImage.url.substring(0, 50)}...`,
            timestamp: activeImage.timestamp
        });

        try {
            const img = e.currentTarget;
            const width = img.naturalWidth || 600;
            const height = img.naturalHeight || 400;

            // Set a custom payload to identify our drag event
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData(DRAG_MIME_TYPE.IGNORE, 'true');
            e.dataTransfer.setData(DRAG_MIME_TYPE.WIDGET, messageId);

            // Pass dimensions so we can reconstruct the shape correctly
            e.dataTransfer.setData(DRAG_MIME_TYPE.WIDTH, width.toString());
            e.dataTransfer.setData(DRAG_MIME_TYPE.HEIGHT, height.toString());

            // Clear standard types to avoid confusing other handlers
            e.dataTransfer.setData('text/plain', '');
            e.dataTransfer.setData('text/uri-list', '');
            e.dataTransfer.setData('text/html', '');

        } catch (err) {
            console.error('[InfographicWidget] Error in drag start:', err);
        }
    };

    const handlePrev = () => {
        if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
    };

    const handleNext = () => {
        if (currentIndex < history.length - 1) setCurrentIndex(prev => prev + 1);
    };

    // Render content function to reuse between modes
    const renderContent = () => (
        <div className="flex h-full flex-col overflow-y-auto bg-surface-elevated text-primary">
            <div className="flex items-center justify-between border-b border-default p-4">
                <div className="flex items-center gap-2 font-medium">
                    <div className="rounded-lg bg-[var(--present-accent-ring)] p-1.5 text-[var(--present-accent)]">
                        <ImageIcon className="h-4 w-4" />
                    </div>
                    Infographic Generator
                </div>
                {!isShape && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-full text-secondary hover:bg-surface-secondary"
                        onClick={() => setIsOpen(false)}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>

            <div className="flex flex-1 flex-col space-y-4 p-4">
                {(providerUsed || fallbackReason) && (
                    <div className="text-[11px] text-tertiary">
                        {providerUsed ? (
                            <span>
                                Provider: <span className="font-semibold text-secondary">{providerUsed}</span>
                            </span>
                        ) : null}
                        {fallbackReason ? (
                            <span className="ml-2">
                                Fallback: <span className="text-tertiary">{fallbackReason}</span>
                            </span>
                        ) : null}
                    </div>
                )}

                <div className="flex items-center space-x-2 rounded-xl border border-default bg-surface-secondary p-3">
                    <input
                        type="checkbox"
                        id="grounding"
                        checked={useGrounding}
                        onChange={(e) => setUseGrounding(e.target.checked)}
                        className="h-4 w-4 rounded border-default bg-surface accent-[var(--present-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
                    />
                    <label htmlFor="grounding" className="select-none text-sm text-secondary">
                        Use Google Search Grounding
                    </label>
                </div>

                {activeImage ? (
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={handleDownload} className="flex-1">
                            Download
                        </Button>
                        <Button size="sm" onClick={handleGenerate} className="flex-1">
                            Regenerate
                        </Button>
                    </div>
                ) : null}

                {error ? (
                    <div className="flex items-start gap-2 rounded-xl border border-danger-outline bg-danger-surface p-3 text-sm text-danger">
                        <div className="mt-0.5">
                            <X className="h-4 w-4" />
                        </div>
                        {error}
                    </div>
                ) : null}

                <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl border border-default bg-surface-secondary">
                    {isGenerating ? (
                        <div className="flex flex-col items-center gap-4 p-8 text-center">
                            <div className="relative">
                                <div className="absolute inset-0 rounded-full bg-[var(--present-accent-ring)] blur-md animate-pulse" />
                                <Loader2 className="relative h-10 w-10 animate-spin text-[var(--present-accent)]" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-primary">Generating Infographic...</p>
                                <p className="text-xs text-tertiary">Analyzing conversation context</p>
                            </div>
                        </div>
                    ) : activeImage ? (
                        <div className="group relative flex h-full w-full flex-col">
                            <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-surface">
                                <img
                                    src={activeImage.url}
                                    alt="Generated Infographic"
                                    className="max-h-full max-w-full cursor-grab object-contain active:cursor-grabbing"
                                    draggable="true"
                                    onDragStart={handleDragStart}
                                />
                            </div>

                            {history.length > 1 ? (
                                <div className="flex h-12 shrink-0 items-center justify-between border-t border-default bg-surface-secondary px-4">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handlePrev}
                                        disabled={currentIndex === 0}
                                        className="text-secondary hover:bg-surface"
                                    >
                                        Previous
                                    </Button>
                                    <span className="text-xs font-medium text-tertiary">
                                        {currentIndex + 1} / {history.length}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleNext}
                                        disabled={currentIndex === history.length - 1}
                                        className="text-secondary hover:bg-surface"
                                    >
                                        Next
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div className="space-y-4 p-8 text-center">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-default bg-surface">
                                <ImageIcon className="h-8 w-8 text-tertiary" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-primary">Ready to Generate</p>
                                <p className="mx-auto max-w-[240px] text-xs text-tertiary">
                                    Create a visual summary of the current conversation using Gemini.
                                </p>
                            </div>
                            <Button onClick={handleGenerate}>Generate Infographic</Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    if (isShape) {
        return renderContent();
    }

    if (!isOpen) {
        return (
            <div className="fixed bottom-4 right-4 z-50">
                <Button
                    onClick={() => setIsOpen(true)}
                    className="flex items-center gap-2 rounded-full px-6 py-3 shadow-lg"
                >
                    <ImageIcon className="h-4 w-4" />
                    Infographic
                </Button>
            </div>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-50 w-80 md:w-96 shadow-2xl">
            <Card className="h-[500px] overflow-hidden p-0">
                {renderContent()}
            </Card>
        </div>
    );
}

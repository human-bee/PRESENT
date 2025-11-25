import React, { useState, useEffect, useCallback } from 'react';
import { Room } from 'livekit-client';
import { createLiveKitBus } from '../lib/livekit/livekit-bus';
import { Button } from '@/components/ui/shared/button';
import { Card, CardHeader } from '@/components/ui/shared/card';
import { X, Loader2, ImageIcon } from 'lucide-react';
import { useEditor } from '@tldraw/tldraw';
import { useInfographicDrop, DRAG_MIME_TYPE } from '@/hooks/use-infographic-drop';

interface InfographicWidgetProps {
    room: Room | null;
    isShape?: boolean;
}

// Helper to stop pointer events from bubbling to TLDraw
// const stopPointerPropagation = (e: React.PointerEvent) => {
//     e.stopPropagation();
// };


export function InfographicWidget({ room, isShape = false }: InfographicWidgetProps) {
    const widgetIdRef = React.useRef<string>(crypto.randomUUID());
    const [isOpen, setIsOpen] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    // History state: stores array of generated images
    const [history, setHistory] = useState<Array<{ id: string, url: string, timestamp: number }>>([]);
    const [currentIndex, setCurrentIndex] = useState(-1);

    const [error, setError] = useState<string | null>(null);
    const [transcripts, setTranscripts] = useState<any[]>([]);
    const [useGrounding, setUseGrounding] = useState(true);

    const bus = React.useMemo(() => createLiveKitBus(room), [room]);

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
            // Get recent transcripts
            const recentLines = transcripts.slice(-20).map((t: any) => {
                const name = t.participantName || t.participantId || 'Speaker';
                return `${name}: ${t.text}`;
            }).join('\n');

            if (!recentLines) {
                throw new Error('No conversation context available yet. Start talking!');
            }

            const prompt = `
            Based on the following conversation, create a visually appealing infographic that summarizes the key points.
            Focus on clarity, professional design, and accurate information.
            
            Conversation Context:
            ${recentLines}
        `;

            const response = await fetch('/api/generateImages', {
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
            } else {
                throw new Error('No image data received');
            }
        } catch (err: any) {
            console.error('Infographic generation error:', err);
            setError(err.message || 'Failed to generate infographic');
        } finally {
            setIsGenerating(false);
        }
    }, [isGenerating, transcripts, useGrounding, isShape]);

    useEffect(() => {
        if (!isShape) {
            const handleOpen = () => setIsOpen(true);
            window.addEventListener('present:open_infographic_widget', handleOpen);
            return () => window.removeEventListener('present:open_infographic_widget', handleOpen);
        }
    }, [isShape]);

    // Listen for agent actions (scoped to this widget)
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
                    ? targetId === widgetIdRef.current
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
    }, [handleGenerate, isShape]);

    const currentImage = history[currentIndex];

    const handleDownload = () => {
        if (!currentImage) return;
        const link = document.createElement('a');
        link.href = currentImage.url;
        link.download = `infographic-${currentImage.timestamp}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const editor = useEditor();

    // Use the custom hook to handle drag-and-drop logic
    // This encapsulates the global listener and shape creation
    useInfographicDrop({ editor, currentImage, widgetId: widgetIdRef.current });

    const handleDragStart = (e: React.DragEvent<HTMLImageElement>) => {
        if (!currentImage) return;
        console.log('[InfographicWidget] Drag started', {
            url: currentImage.url.substring(0, 50) + '...',
            timestamp: currentImage.timestamp
        });

        try {
            const img = e.currentTarget;
            const width = img.naturalWidth || 600;
            const height = img.naturalHeight || 400;

            // Set a custom payload to identify our drag event
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData(DRAG_MIME_TYPE.IGNORE, 'true');
            e.dataTransfer.setData(DRAG_MIME_TYPE.WIDGET, widgetIdRef.current);

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
        <div className={`flex flex-col h-full overflow-y-auto ${!isShape ? 'bg-zinc-950 text-white' : 'text-white'}`}>
            <div className="flex items-center justify-between p-4 border-b border-white/10">
                <div className="flex items-center gap-2 font-medium text-white/90">
                    <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400">
                        <ImageIcon className="h-4 w-4" />
                    </div>
                    Infographic Generator
                </div>
                {!isShape && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-white/60 hover:text-white hover:bg-white/10 rounded-full"
                        onClick={() => setIsOpen(false)}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>

            <div className="p-4 space-y-4 flex-1 flex flex-col">
                <div className="flex items-center space-x-2 p-3 rounded-xl border border-white/5 bg-white/[0.03]">
                    <input
                        type="checkbox"
                        id="grounding"
                        checked={useGrounding}
                        onChange={(e) => setUseGrounding(e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-0"
                    />
                    <label htmlFor="grounding" className="text-sm text-white/70 cursor-pointer select-none">
                        Use Google Search Grounding
                    </label>
                </div>

                {/* Action Buttons */}
                {currentImage && (
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            onClick={handleDownload}
                            className="flex-1 bg-white/10 hover:bg-white/20 text-white border border-white/20"
                        >
                            Download
                        </Button>
                        <Button
                            size="sm"
                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                            onClick={handleGenerate}
                        >
                            Regenerate
                        </Button>
                    </div>
                )}

                {error && (
                    <div className="p-3 text-sm text-rose-200 bg-rose-500/10 rounded-xl border border-rose-500/20 flex items-start gap-2">
                        <div className="mt-0.5"><X className="h-4 w-4" /></div>
                        {error}
                    </div>
                )}

                <div className="flex-1 min-h-0 flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] relative overflow-hidden">
                    {isGenerating ? (
                        <div className="flex flex-col items-center gap-4 p-8 text-center">
                            <div className="relative">
                                <div className="absolute inset-0 rounded-full blur-md bg-blue-500/30 animate-pulse" />
                                <Loader2 className="relative h-10 w-10 animate-spin text-blue-400" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-white/90">Generating Infographic...</p>
                                <p className="text-xs text-white/50">Analyzing conversation context</p>
                            </div>
                        </div>
                    ) : currentImage ? (
                        <div className="relative group w-full h-full flex flex-col">
                            <div className="flex-1 relative flex items-center justify-center bg-black/20 overflow-hidden">
                                <img
                                    src={currentImage.url}
                                    alt="Generated Infographic"
                                    className="max-w-full max-h-full object-contain cursor-grab active:cursor-grabbing"
                                    draggable="true"
                                    onDragStart={handleDragStart}
                                />
                            </div>

                            {/* Navigation Bar */}
                            {history.length > 1 && (
                                <div className="h-12 border-t border-white/10 bg-white/5 flex items-center justify-between px-4 shrink-0">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handlePrev}
                                        disabled={currentIndex === 0}
                                        className="text-white/70 hover:text-white disabled:opacity-30"
                                    >
                                        Previous
                                    </Button>
                                    <span className="text-xs text-white/50 font-medium">
                                        {currentIndex + 1} / {history.length}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleNext}
                                        disabled={currentIndex === history.length - 1}
                                        className="text-white/70 hover:text-white disabled:opacity-30"
                                    >
                                        Next
                                    </Button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="p-8 text-center space-y-4">
                            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto border border-white/10">
                                <ImageIcon className="h-8 w-8 text-white/20" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-white/80">Ready to Generate</p>
                                <p className="text-xs text-white/40 max-w-[200px] mx-auto">
                                    Create a visual summary of the current conversation using Gemini.
                                </p>
                            </div>
                            <Button
                                onClick={handleGenerate}
                                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/25 border border-white/10"
                            >
                                Generate Infographic
                            </Button>
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
                <Button onClick={() => setIsOpen(true)} className="shadow-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-full px-6 py-3 flex items-center gap-2">
                    <ImageIcon className="h-4 w-4" />
                    Infographic
                </Button>
            </div>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-50 w-80 md:w-96 shadow-2xl">
            <Card className="border-2 border-primary/20 overflow-hidden h-[500px]">
                <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-0">
                    {/* The header content is now part of renderContent, but we apply the background here */}
                    {/* We reuse the content but wrap it in the card for the floating widget */}
                    {renderContent()}
                </CardHeader>
            </Card>
        </div>
    );
}

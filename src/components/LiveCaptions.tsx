'use client';

import * as React from 'react';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shared/avatar';
import { Mic, Clock, User, Copy, Download, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRoomContext, useParticipants } from '@livekit/components-react';
import { useRealtimeSessionTranscript } from '@/hooks/use-realtime-session-transcript';
import { useAllTranscripts, useTranscriptStore, type Transcript as StoreTranscript } from '@/lib/stores/transcript-store';
import { z } from 'zod';

// Component Schema
export const liveCaptionsSchema = z.object({
  showSpeakerAvatars: z
    .boolean()
    .optional()
    .default(true)
    .describe('Show speaker avatars in speech bubbles'),
  showTimestamps: z
    .boolean()
    .optional()
    .default(true)
    .describe('Display timestamps for each transcript'),
  enableDragAndDrop: z
    .boolean()
    .optional()
    .default(true)
    .describe('Allow dragging speech bubbles around the canvas'),
  maxTranscripts: z
    .number()
    .optional()
    .default(50)
    .describe('Maximum number of transcripts to keep on canvas'),
  autoPosition: z
    .boolean()
    .optional()
    .default(true)
    .describe('Automatically position new speech bubbles to avoid overlap'),
  exportFormat: z
    .enum(['txt', 'json', 'srt'])
    .optional()
    .default('txt')
    .describe('Format for exporting transcripts'),
  canvasTheme: z
    .enum(['grid', 'dots', 'clean'])
    .optional()
    .default('dots')
    .describe('Canvas background theme'),
});

export type LiveCaptionsProps = z.infer<typeof liveCaptionsSchema> & {
  className?: string;
};

interface DisplayTranscript {
  id: string;
  text: string;
  speaker: string;
  timestamp: Date;
  isFinal: boolean;
  position?: { x: number; y: number };
}

interface SpeechBubbleProps {
  transcript: DisplayTranscript;
  position: { x: number; y: number };
  showAvatar: boolean;
  showTimestamp: boolean;
  enableDrag: boolean;
  onPositionChange?: (id: string, position: { x: number; y: number }) => void;
  onCopy?: (text: string) => void;
}

const MessageLoading = () => {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="text-muted-foreground"
    >
      <circle cx="4" cy="12" r="2" fill="currentColor">
        <animate
          id="spinner_qFRN"
          begin="0;spinner_OcgL.end+0.25s"
          attributeName="cy"
          calcMode="spline"
          dur="0.6s"
          values="12;6;12"
          keySplines=".33,.66,.66,1;.33,0,.66,.33"
        />
      </circle>
      <circle cx="12" cy="12" r="2" fill="currentColor">
        <animate
          begin="spinner_qFRN.begin+0.1s"
          attributeName="cy"
          calcMode="spline"
          dur="0.6s"
          values="12;6;12"
          keySplines=".33,.66,.66,1;.33,0,.66,.33"
        />
      </circle>
      <circle cx="20" cy="12" r="2" fill="currentColor">
        <animate
          id="spinner_OcgL"
          begin="spinner_qFRN.begin+0.2s"
          attributeName="cy"
          calcMode="spline"
          dur="0.6s"
          values="12;6;12"
          keySplines=".33,.66,.66,1;.33,0,.66,.33"
        />
      </circle>
    </svg>
  );
};

const SpeechBubble: React.FC<SpeechBubbleProps> = ({
  transcript,
  position,
  showAvatar,
  showTimestamp,
  enableDrag,
  onPositionChange,
  onCopy,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const handleCopy = () => {
    if (onCopy) {
      onCopy(transcript.text);
    } else {
      navigator.clipboard.writeText(transcript.text);
    }
  };

  return (
    <motion.div
      className="absolute cursor-pointer"
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: -20 }}
      style={{
        left: position.x,
        top: position.y,
        zIndex: isHovered ? 10 : 1,
      }}
      whileHover={{ scale: 1.02 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      drag={enableDrag}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        if (onPositionChange) {
          onPositionChange(transcript.id, {
            x: position.x + info.offset.x,
            y: position.y + info.offset.y,
          });
        }
      }}
    >
      <div className="flex items-start gap-2 max-w-sm">
        {showAvatar && (
          <Avatar className="h-8 w-8 mt-1 border-2 border-background shadow-sm">
            <AvatarImage
              src={`https://api.dicebear.com/7.x/personas/svg?seed=${transcript.speaker}`}
            />
            <AvatarFallback className="text-xs">
              {transcript.speaker.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}

        <div className="flex flex-col">
          <div
            className={cn(
              'rounded-xl p-3 relative shadow-sm transition-all duration-200',
              transcript.isFinal
                ? 'bg-background border border-border'
                : 'bg-muted/70 border border-dashed border-muted-foreground/40',
            )}
          >
            {transcript.isFinal ? (
              <p className="text-sm leading-relaxed">{transcript.text}</p>
            ) : (
              <div className="flex items-center space-x-2">
                <p className="text-sm text-muted-foreground leading-relaxed">{transcript.text}</p>
                <MessageLoading />
              </div>
            )}

            {/* Speech bubble pointer */}
            <div
              className={cn(
                'absolute -left-1 top-3 w-2 h-2 rotate-45',
                transcript.isFinal
                  ? 'bg-background border-l border-b border-border'
                  : 'bg-muted/70',
              )}
            />
          </div>

          {(showTimestamp || transcript.isFinal) && (
            <div className="flex items-center mt-2 gap-3 text-xs text-muted-foreground">
              <div className="flex items-center">
                <User className="h-3 w-3 mr-1" />
                <span className="font-medium">{transcript.speaker}</span>
              </div>
              {showTimestamp && (
                <div className="flex items-center">
                  <Clock className="h-3 w-3 mr-1" />
                  <span>{formatTime(transcript.timestamp)}</span>
                </div>
              )}
              {transcript.isFinal && (
                <motion.button
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleCopy}
                  title="Copy transcript"
                >
                  <Copy className="h-3 w-3" />
                </motion.button>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const LiveCaptions: React.FC<LiveCaptionsProps> = ({
  className,
  showSpeakerAvatars = true,
  showTimestamps = true,
  enableDragAndDrop = true,
  maxTranscripts = 50,
  autoPosition = true,
  exportFormat = 'txt',
  canvasTheme = 'dots',
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const room = useRoomContext();
  const participants = useParticipants();
  const { transcript: sessionTranscript } = useRealtimeSessionTranscript(room?.name);

  // Use the centralized transcript store
  const storeTranscripts = useAllTranscripts();
  const { batchAddTranscripts, clearTranscripts: storeClear } = useTranscriptStore();

  // Local state for positions (keyed by transcript id)
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  const settings = useMemo(() => ({
    showSpeakerAvatars,
    showTimestamps,
    enableDragAndDrop,
    maxTranscripts,
    autoPosition,
    exportFormat,
    canvasTheme,
  }), [showSpeakerAvatars, showTimestamps, enableDragAndDrop, maxTranscripts, autoPosition, exportFormat, canvasTheme]);

  // Auto-position calculation
  const calculatePosition = useCallback((index: number) => {
    if (!canvasRef.current) return { x: 50, y: 50 };

    const canvasWidth = canvasRef.current.clientWidth - 350;
    const canvasHeight = canvasRef.current.clientHeight - 120;

    const columns = Math.max(1, Math.floor(canvasWidth / 300));
    const rows = Math.max(1, Math.floor(canvasHeight / 140));

    const col = index % columns;
    const row = Math.floor(index / columns) % rows;

    return {
      x: col * 300 + 20,
      y: row * 140 + 20,
    };
  }, []);

  // Convert store transcripts to display format with positions
  const displayTranscripts = useMemo((): DisplayTranscript[] => {
    const limited = storeTranscripts.slice(-maxTranscripts);
    return limited.map((t, index): DisplayTranscript => ({
      id: t.id,
      text: t.text,
      speaker: t.speaker,
      timestamp: new Date(t.timestamp),
      isFinal: t.isFinal,
      position: positions.get(t.id) || (autoPosition ? calculatePosition(index) : undefined),
    }));
  }, [storeTranscripts, maxTranscripts, positions, autoPosition, calculatePosition]);

  // Handle position changes
  const handlePositionChange = useCallback((id: string, newPosition: { x: number; y: number }) => {
    setPositions((prev) => {
      const next = new Map(prev);
      next.set(id, newPosition);
      return next;
    });
  }, []);

  // Export transcripts
  const exportTranscripts = useCallback(() => {
    const finalTranscripts = displayTranscripts.filter((t) => t.isFinal);

    let content = '';
    let filename = '';

    switch (exportFormat) {
      case 'json':
        content = JSON.stringify(finalTranscripts, null, 2);
        filename = `live-captions-${Date.now()}.json`;
        break;
      case 'srt':
        content = finalTranscripts
          .map((t, i) => {
            const start = new Date(t.timestamp);
            const end = new Date(start.getTime() + 5000);
            const formatSRTTime = (date: Date) => {
              const hours = date.getHours().toString().padStart(2, '0');
              const minutes = date.getMinutes().toString().padStart(2, '0');
              const seconds = date.getSeconds().toString().padStart(2, '0');
              const ms = date.getMilliseconds().toString().padStart(3, '0');
              return `${hours}:${minutes}:${seconds},${ms}`;
            };

            return `${i + 1}\n${formatSRTTime(start)} --> ${formatSRTTime(end)}\n[${t.speaker}] ${t.text}\n`;
          })
          .join('\n');
        filename = `live-captions-${Date.now()}.srt`;
        break;
      default:
        content = finalTranscripts
          .map((t) => `[${t.timestamp.toLocaleTimeString()}] ${t.speaker}: ${t.text}`)
          .join('\n');
        filename = `live-captions-${Date.now()}.txt`;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayTranscripts, exportFormat]);

  // Clear transcripts (both local positions and store)
  const clearTranscripts = useCallback(() => {
    setPositions(new Map());
    storeClear();
  }, [storeClear]);

  // Copy transcript text
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  // Hydrate from session API on mount/reload
  useEffect(() => {
    if (!Array.isArray(sessionTranscript) || sessionTranscript.length === 0) return;
    
    const storeFormat: StoreTranscript[] = sessionTranscript.map((t, idx) => ({
      id: `${t.participantId}-${Number(t.timestamp) || idx}`,
      text: t.text,
      speaker: t.participantId,
      timestamp: typeof t.timestamp === 'number' ? t.timestamp : Date.now(),
      isFinal: true,
      source: t.participantId === 'voice-agent' ? 'agent' as const : 'user' as const,
      type: 'speech' as const,
    }));
    
    batchAddTranscripts(storeFormat);
  }, [sessionTranscript, batchAddTranscripts]);

  // Monitor room connection and participants
  useEffect(() => {
    const newConnected = room?.state === 'connected';
    const newParticipantCount = participants.length;

    if (isConnected !== newConnected) setIsConnected(newConnected);
    if (participantCount !== newParticipantCount) setParticipantCount(newParticipantCount);
  }, [room?.state, participants.length, isConnected, participantCount]);

  // Update canvas size when ref changes
  useEffect(() => {
    if (canvasRef.current) {
      const updateCanvasSize = () => {
        const newWidth = canvasRef.current?.clientWidth || 800;
        const newHeight = canvasRef.current?.clientHeight || 600;

        if (canvasSize.width !== newWidth || canvasSize.height !== newHeight) {
          setCanvasSize({ width: newWidth, height: newHeight });
        }
      };

      updateCanvasSize();
      const resizeObserver = new ResizeObserver(updateCanvasSize);
      resizeObserver.observe(canvasRef.current);

      return () => resizeObserver.disconnect();
    }
  }, [canvasSize.width, canvasSize.height]);

  // Canvas background styles
  const getCanvasBackground = () => {
    switch (canvasTheme) {
      case 'grid':
        return {
          backgroundImage:
            'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        };
      case 'dots':
        return {
          backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.1) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        };
      default:
        return {};
    }
  };

  const finalCount = displayTranscripts.filter((t) => t.isFinal).length;

  return (
    <div
      className={cn(
        'w-full h-full flex flex-col bg-background border rounded-lg overflow-hidden',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/20">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Live Captions</h2>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-2 h-2 rounded-full',
                isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500',
              )}
            />
            <span className="text-sm text-muted-foreground">
              {isConnected
                ? `Connected (${participantCount} participants)`
                : 'Disconnected'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {finalCount} captions
          </span>

          {displayTranscripts.length > 0 && (
            <>
              <button
                onClick={exportTranscripts}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors"
                title="Export transcripts"
              >
                <Download className="h-3 w-3" />
                Export
              </button>

              <button
                onClick={clearTranscripts}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors"
                title="Clear all transcripts"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-hidden"
        style={{
          backgroundColor: 'hsl(var(--background))',
          ...getCanvasBackground(),
        }}
      >
        <AnimatePresence mode="popLayout">
          {displayTranscripts.map((transcript, index) => {
            const position = transcript.position || calculatePosition(index);

            return (
              <SpeechBubble
                key={transcript.id}
                transcript={transcript}
                position={position}
                showAvatar={settings.showSpeakerAvatars}
                showTimestamp={settings.showTimestamps}
                enableDrag={settings.enableDragAndDrop}
                onPositionChange={handlePositionChange}
                onCopy={handleCopy}
              />
            );
          })}
        </AnimatePresence>

        {/* Empty state */}
        {displayTranscripts.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Mic className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium mb-1">Waiting for speech...</p>
              <p className="text-sm">
                {isConnected
                  ? 'Start speaking to see live captions appear'
                  : 'Connect to a LiveKit room to begin'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveCaptions;

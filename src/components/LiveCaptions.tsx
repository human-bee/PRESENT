"use client";

import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Mic, Clock, User, Copy, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRoomContext, useDataChannel, useParticipants } from "@livekit/components-react";
import { useRealtimeSessionTranscript } from '@/hooks/use-realtime-session-transcript'
import { z } from "zod";

// Component Schema
export const liveCaptionsSchema = z.object({
  showSpeakerAvatars: z.boolean().optional().default(true).describe("Show speaker avatars in speech bubbles"),
  showTimestamps: z.boolean().optional().default(true).describe("Display timestamps for each transcript"),
  enableDragAndDrop: z.boolean().optional().default(true).describe("Allow dragging speech bubbles around the canvas"),
  maxTranscripts: z.number().optional().default(50).describe("Maximum number of transcripts to keep on canvas"),
  autoPosition: z.boolean().optional().default(true).describe("Automatically position new speech bubbles to avoid overlap"),
  exportFormat: z.enum(["txt", "json", "srt"]).optional().default("txt").describe("Format for exporting transcripts"),
  canvasTheme: z.enum(["grid", "dots", "clean"]).optional().default("dots").describe("Canvas background theme"),
});

export type LiveCaptionsProps = z.infer<typeof liveCaptionsSchema> & {
  className?: string;
};

interface Transcript {
  id: string;
  text: string;
  speaker: string;
  timestamp: Date;
  isFinal: boolean;
  position?: { x: number; y: number };
}

interface LiveCaptionsState {
  transcripts: Transcript[];
  isConnected: boolean;
  participantCount: number;
  canvasSize: { width: number; height: number };
  settings: {
    showSpeakerAvatars: boolean;
    showTimestamps: boolean;
    enableDragAndDrop: boolean;
    maxTranscripts: number;
    autoPosition: boolean;
    exportFormat: "txt" | "json" | "srt";
    canvasTheme: "grid" | "dots" | "clean";
  };
}

interface SpeechBubbleProps {
  transcript: Transcript;
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
  onCopy 
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
        zIndex: isHovered ? 10 : 1
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
            y: position.y + info.offset.y
          });
        }
      }}
    >
      <div className="flex items-start gap-2 max-w-sm">
        {showAvatar && (
          <Avatar className="h-8 w-8 mt-1 border-2 border-background shadow-sm">
            <AvatarImage src={`https://api.dicebear.com/7.x/personas/svg?seed=${transcript.speaker}`} />
            <AvatarFallback className="text-xs">{transcript.speaker.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
        )}
        
        <div className="flex flex-col">
          <div className={cn(
            "rounded-xl p-3 relative shadow-sm transition-all duration-200",
            transcript.isFinal 
              ? "bg-background border border-border" 
              : "bg-muted/70 border border-dashed border-muted-foreground/40"
          )}>
            {transcript.isFinal ? (
              <p className="text-sm leading-relaxed">{transcript.text}</p>
            ) : (
              <div className="flex items-center space-x-2">
                <p className="text-sm text-muted-foreground leading-relaxed">{transcript.text}</p>
                <MessageLoading />
              </div>
            )}
            
            {/* Speech bubble pointer */}
            <div className={cn(
              "absolute -left-1 top-3 w-2 h-2 rotate-45",
              transcript.isFinal ? "bg-background border-l border-b border-border" : "bg-muted/70"
            )} />
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
  exportFormat = "txt",
  canvasTheme = "dots"
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const room = useRoomContext();
  const participants = useParticipants();
  const { transcript: sessionTranscript } = useRealtimeSessionTranscript(room?.name)

  const getCanvasIdFromUrl = React.useCallback(() => {
    if (typeof window === 'undefined') return null as string | null
    const params = new URLSearchParams(window.location.search)
    return params.get('id')
  }, [])

  // Define initial state
  const initialState: LiveCaptionsState = {
    transcripts: [],
    isConnected: false,
    participantCount: 0,
    canvasSize: { width: 800, height: 600 },
    settings: {
      showSpeakerAvatars,
      showTimestamps,
      enableDragAndDrop,
      maxTranscripts,
      autoPosition,
      exportFormat,
      canvasTheme,
    },
  };

  // Local state management
  const [state, setState] = useState<LiveCaptionsState>(initialState);

  // Auto-position calculation (memoized to prevent infinite loops)
  const calculatePosition = useCallback((index: number) => {
    if (!canvasRef.current) return { x: 50, y: 50 };
    
    const canvasWidth = canvasRef.current.clientWidth - 350; // Account for speech bubble width
    const canvasHeight = canvasRef.current.clientHeight - 120; // Account for speech bubble height
    
    const columns = Math.max(1, Math.floor(canvasWidth / 300));
    const rows = Math.max(1, Math.floor(canvasHeight / 140));
    
    const col = index % columns;
    const row = Math.floor(index / columns) % rows;
    
    return {
      x: col * 300 + 20,
      y: row * 140 + 20
    };
  }, []);

  // Handle speech bubble position updates
  const handlePositionChange = useCallback((id: string, newPosition: { x: number; y: number }) => {
    setState(prev => ({
      ...prev,
      transcripts: prev.transcripts.map(transcript => 
        transcript.id === id 
          ? { ...transcript, position: newPosition }
          : transcript
      )
    }));
  }, [setState]);

  // Export transcripts
  const exportTranscripts = useCallback(() => {
    if (!state) return;
    
    const finalTranscripts = state.transcripts.filter(t => t.isFinal);
    
    let content = "";
    let filename = "";
    
    switch (state.settings.exportFormat) {
      case "json":
        content = JSON.stringify(finalTranscripts, null, 2);
        filename = `live-captions-${Date.now()}.json`;
        break;
      case "srt":
        content = finalTranscripts.map((t, i) => {
          const start = new Date(t.timestamp);
          const end = new Date(start.getTime() + 5000); // 5 second duration
          const formatSRTTime = (date: Date) => {
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            const ms = date.getMilliseconds().toString().padStart(3, '0');
            return `${hours}:${minutes}:${seconds},${ms}`;
          };
          
          return `${i + 1}\n${formatSRTTime(start)} --> ${formatSRTTime(end)}\n[${t.speaker}] ${t.text}\n`;
        }).join('\n');
        filename = `live-captions-${Date.now()}.srt`;
        break;
      default: // txt
        content = finalTranscripts.map(t => 
          `[${t.timestamp.toLocaleTimeString()}] ${t.speaker}: ${t.text}`
        ).join('\n');
        filename = `live-captions-${Date.now()}.txt`;
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [state]);

  // Clear all transcripts
  const clearTranscripts = useCallback(() => {
    setState(prev => ({
      ...prev,
      transcripts: []
    }));
  }, [setState]);

  // Copy transcript text
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  // LiveKit data channel for transcription
  useDataChannel("transcription", (message) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(message.payload));
      
      if (data.type === "live_transcription") {
        const transcriptId = `${data.speaker}-${data.timestamp}`;
        
        setState(prevState => {
          if (!prevState) return prevState;
          
          const prevTranscripts = prevState.transcripts;
          // Strong de-dupe by id first (covers session-hydrate/replay collisions)
          const idIndex = prevTranscripts.findIndex(t => t.id === transcriptId);
          
          // Check if this is an update to an existing interim transcript (legacy path)
          // Guard: prevent duplicates when receiving the same final line via multiple paths
          if (data.is_final && prevTranscripts.some(t => t.id === transcriptId && t.isFinal)) {
            return prevState;
          }
          // Check if this is an update to an existing interim transcript
          const existingIndex = prevTranscripts.findIndex(t => 
            t.speaker === data.speaker && !t.isFinal && 
            Math.abs(new Date(t.timestamp).getTime() - new Date(data.timestamp).getTime()) < 5000
          );
          
          const newTranscript: Transcript = {
            id: transcriptId,
            text: data.text,
            speaker: data.speaker,
            timestamp: new Date(data.timestamp),
            isFinal: data.is_final,
            position: prevState.settings.autoPosition ? calculatePosition(prevTranscripts.length) : undefined
          };

          let updatedTranscripts = prevTranscripts;
          if (idIndex >= 0) {
            // Update by exact id match
            updatedTranscripts = [...prevTranscripts];
            updatedTranscripts[idIndex] = {
              ...updatedTranscripts[idIndex],
              text: data.text,
              isFinal: data.is_final
            };
          } else if (existingIndex >= 0) {
            // Update existing interim transcript by proximity
            updatedTranscripts = [...prevTranscripts];
            updatedTranscripts[existingIndex] = {
              ...updatedTranscripts[existingIndex],
              text: data.text,
              isFinal: data.is_final
            };
          } else {
            // Add new transcript
            updatedTranscripts = [...prevTranscripts, newTranscript];
          }

          // Limit the number of transcripts
          if (updatedTranscripts.length > prevState.settings.maxTranscripts) {
            updatedTranscripts = updatedTranscripts.slice(-prevState.settings.maxTranscripts);
          }
          
          return {
            ...prevState,
            transcripts: updatedTranscripts
          };
        });
      }
    } catch (error) {
      console.error("Error parsing transcription data:", error);
    }
  });

  // Hydrate from session API on mount/reload
  useEffect(() => {
    if (!Array.isArray(sessionTranscript)) return
    const nextList: Transcript[] = sessionTranscript.map((t, idx) => ({
      id: `${t.participantId}-${Number(t.timestamp) || idx}`,
      text: t.text,
      speaker: t.participantId,
      timestamp: new Date(t.timestamp),
      isFinal: true,
    }))
    setState(prev => {
      if (!prev) return prev
      const prevList = prev.transcripts
      // Merge by id to avoid duplicates when live data already added entries
      const byId = new Map<string, Transcript>(prevList.map(t => [t.id, t]))
      for (const t of nextList) {
        if (byId.has(t.id)) {
          const existing = byId.get(t.id)!
          byId.set(t.id, { ...existing, text: t.text, isFinal: true, timestamp: t.timestamp })
        } else {
          byId.set(t.id, t)
        }
      }
      const merged = Array.from(byId.values())
      return { ...prev, transcripts: merged }
    })
  }, [sessionTranscript, setState])

  // Replay support: listen for local transcript replay events dispatched on window
  useEffect(() => {
    const handler = (evt: Event) => {
      try {
        const { speaker, text, timestamp } = (evt as CustomEvent).detail || {}
        if (!text) return
        const transcriptId = `${speaker || 'unknown'}-${timestamp}`
        setState(prevState => {
          if (!prevState) return prevState
          const prevTranscripts = prevState.transcripts
          const idIndex = prevTranscripts.findIndex(t => t.id === transcriptId)
          if (idIndex >= 0) {
            const updated = [...prevTranscripts]
            updated[idIndex] = { ...updated[idIndex], text, isFinal: true, timestamp: new Date(timestamp || Date.now()) }
            return { ...prevState, transcripts: updated }
          }
          const newTranscript: Transcript = {
            id: transcriptId,
            text,
            speaker: speaker || 'unknown',
            timestamp: new Date(timestamp || Date.now()),
            isFinal: true,
          }
          return { ...prevState, transcripts: [...prevTranscripts, newTranscript] }
        })
      } catch {}
    }
    window.addEventListener('livekit:transcription-replay', handler as EventListener)
    return () => window.removeEventListener('livekit:transcription-replay', handler as EventListener)
  }, [setState])

  // Monitor room connection and participants
  useEffect(() => {
    const newConnected = room?.state === "connected";
    const newParticipantCount = participants.length;
    
    setState(prev => {
      // Ensure prev is not null and only update if values actually changed
      if (prev && (prev.isConnected !== newConnected || prev.participantCount !== newParticipantCount)) {
        return {
          ...prev,
          isConnected: newConnected,
          participantCount: newParticipantCount
        };
      }
      // If prev is null, or no changes, return prev or initial state if prev is null
      return prev || initialState; 
    });
  }, [room?.state, participants.length, initialState, setState]);

  // Update canvas size when ref changes
  useEffect(() => {
    if (canvasRef.current) {
      const updateCanvasSize = () => {
        const newWidth = canvasRef.current?.clientWidth || 800;
        const newHeight = canvasRef.current?.clientHeight || 600;
        
        setState(prev => {
          if (!prev) return prev;
          // Only update if dimensions actually changed
          if (prev.canvasSize.width !== newWidth || prev.canvasSize.height !== newHeight) {
            return {
              ...prev,
              canvasSize: { width: newWidth, height: newHeight }
            };
          }
          return prev;
        });
      };

      updateCanvasSize();
      const resizeObserver = new ResizeObserver(updateCanvasSize);
      resizeObserver.observe(canvasRef.current);

      return () => resizeObserver.disconnect();
    }
  }, [setState]);

  // Canvas background styles
  const getCanvasBackground = () => {
    if (!state) return {};
    
    switch (state.settings.canvasTheme) {
      case "grid":
        return {
          backgroundImage: "linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)",
          backgroundSize: "20px 20px"
        };
      case "dots":
        return {
          backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.1) 1px, transparent 1px)",
          backgroundSize: "24px 24px"
        };
      default:
        return {};
    }
  };

  // EARLY RETURN MOVED TO AFTER ALL HOOKS
  if (!state) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className={cn("w-full h-full flex flex-col bg-background border rounded-lg overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/20">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Live Captions</h2>
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2 h-2 rounded-full",
              state.isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
            )} />
            <span className="text-sm text-muted-foreground">
              {state.isConnected ? `Connected (${state.participantCount} participants)` : "Disconnected"}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {state.transcripts.filter(t => t.isFinal).length} captions
          </span>
          
          {state.transcripts.length > 0 && (
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
          backgroundColor: "hsl(var(--background))",
          ...getCanvasBackground()
        }}
      >
        <AnimatePresence mode="popLayout">
          {state.transcripts.map((transcript, index) => {
            const position = transcript.position || calculatePosition(index);
            
            return (
              <SpeechBubble
                key={transcript.id}
                transcript={transcript}
                position={position}
                showAvatar={state.settings.showSpeakerAvatars}
                showTimestamp={state.settings.showTimestamps}
                enableDrag={state.settings.enableDragAndDrop}
                onPositionChange={handlePositionChange}
                onCopy={handleCopy}
              />
            );
          })}
        </AnimatePresence>
        
        {/* Empty state */}
        {state.transcripts.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Mic className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium mb-1">Waiting for speech...</p>
              <p className="text-sm">
                {state.isConnected 
                  ? "Start speaking to see live captions appear" 
                  : "Connect to a LiveKit room to begin"
                }
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveCaptions; 

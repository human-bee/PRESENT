"use client";

import {
  MessageInput,
  MessageInputTextarea,
  MessageInputToolbar,
  MessageInputSubmitButton,
  MessageInputError,
} from "@/components/ui/message-input";
import {
  MessageSuggestions,
  MessageSuggestionsStatus,
  MessageSuggestionsList,
} from "@/components/ui/message-suggestions";
import type { messageVariants } from "@/components/ui/message";
import {
  ThreadContent,
  ThreadContentMessages,
} from "@/components/ui/thread-content";
import { ThreadDropdown } from "@/components/ui/thread-dropdown";
import { ScrollableMessageContainer } from "@/components/ui/scrollable-message-container";
import { cn } from "@/lib/utils";
import { MessageSquare, FileText } from "lucide-react";
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
import type { Suggestion } from "@tambo-ai/react";
import { useRoomContext, useDataChannel } from '@livekit/components-react';

/**
 * Props for the MessageThreadCollapsible component
 * @interface
 * @extends React.HTMLAttributes<HTMLDivElement>
 */
export interface MessageThreadCollapsibleProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional context key for the thread */
  contextKey?: string;
  /** Whether the collapsible should be open by default (default: false) */
  defaultOpen?: boolean;
  /**
   * Controls the visual styling of messages in the thread.
   * Possible values include: "default", "compact", etc.
   * These values are defined in messageVariants from "@/components/ui/message".
   * @example variant="compact"
   */
  variant?: VariantProps<typeof messageVariants>["variant"];
  /** Callback when transcript data changes - for persistence */
  onTranscriptChange?: (transcripts: Array<{
    id: string;
    speaker: string;
    text: string;
    timestamp: number;
    isFinal: boolean;
    source: 'agent' | 'user' | 'system';
    type?: 'speech' | 'system_call';
  }>) => void;
}

/**
 * A collapsible chat thread component with keyboard shortcuts and thread management
 * @component
 * @example
 * ```tsx
 * <MessageThreadCollapsible
 *   contextKey="my-thread"
 *   defaultOpen={false}
 *   className="left-4" // Position on the left instead of right
 *   variant="default"
 * />
 * ```
 */

/**
 * Custom hook for managing collapsible state with keyboard shortcuts
 */
const useCollapsibleState = (defaultOpen = false) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
  const shortcutText = isMac ? "⌘K" : "Ctrl+K";

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { isOpen, setIsOpen, shortcutText };
};

export const MessageThreadCollapsible = React.forwardRef<
  HTMLDivElement,
  MessageThreadCollapsibleProps
>(({ className, contextKey, defaultOpen = false, variant, onTranscriptChange, ...props }, ref) => {
  const { isOpen: keyboardOpen, setIsOpen: setKeyboardOpen, shortcutText } = useCollapsibleState(defaultOpen);
  const [activeTab, setActiveTab] = React.useState<'conversations' | 'transcript'>('conversations');
  const [transcriptions, setTranscriptions] = React.useState<Array<{
    id: string;
    speaker: string;
    text: string;
    timestamp: number;
    isFinal: boolean;
    source: 'agent' | 'user' | 'system';
    type?: 'speech' | 'system_call';
  }>>([]);

  // Ref for auto-scroll
  const transcriptContainerRef = React.useRef<HTMLDivElement>(null);

  // LiveKit room context for transcript functionality
  const room = useRoomContext();

  // Listen for transcription data from LiveKit data channel
  useDataChannel("transcription", (message) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(message.payload));
      
      if (data.type === "live_transcription") {
        const transcription = {
          id: `${Date.now()}-${Math.random()}`,
          speaker: data.speaker || "Unknown",
          text: data.text,
          timestamp: data.timestamp || Date.now(),
          isFinal: data.is_final || false,
          source: data.speaker === 'tambo-voice-agent' ? 'agent' : 'user' as const,
          type: 'speech' as const,
        };
        
        setTranscriptions(prev => {
          // Remove old interim results from same speaker if this is final
          if (transcription.isFinal) {
            const filtered = prev.filter(t => 
              !(t.speaker === transcription.speaker && !t.isFinal && t.type === 'speech')
            );
            return [...filtered, transcription];
          }
          
          // For interim results, replace existing interim from same speaker
          const filtered = prev.filter(t => 
            !(t.speaker === transcription.speaker && !t.isFinal && t.type === 'speech')
          );
          return [...filtered, transcription];
        });
      }
    } catch (error) {
      console.error("Error processing transcription data:", error);
    }
  });

  // Listen for Tambo system calls
  React.useEffect(() => {
    const handleTamboComponent = (event: CustomEvent) => {
      const { messageId, component } = event.detail;
      
      // Add system call to transcript
      const systemCall = {
        id: `system-${Date.now()}-${Math.random()}`,
        speaker: 'tambo-voice-agent',
        text: `Generated component: ${messageId || 'Unknown component'}`,
        timestamp: Date.now(),
        isFinal: true,
        source: 'system' as const,
        type: 'system_call' as const,
      };
      
      setTranscriptions(prev => [...prev, systemCall]);
    };

    window.addEventListener('tambo:showComponent', handleTamboComponent as EventListener);
    
    return () => {
      window.removeEventListener('tambo:showComponent', handleTamboComponent as EventListener);
    };
  }, []);

  // Auto-scroll transcript when new entries are added
  React.useEffect(() => {
    if (transcriptContainerRef.current && activeTab === 'transcript') {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcriptions, activeTab]);

  // Clear transcriptions
  const clearTranscriptions = React.useCallback(() => {
    setTranscriptions([]);
  }, []);

  const handleThreadChange = React.useCallback(() => {
    // No longer needed for collapsible behavior
  }, []);

  const defaultSuggestions: Suggestion[] = [
    {
      id: "suggestion-1",
      title: "Get started",
      detailedSuggestion: "What can you help me with?",
      messageId: "welcome-query",
    },
    {
      id: "suggestion-2",
      title: "Learn more",
      detailedSuggestion: "Tell me about your capabilities.",
      messageId: "capabilities-query",
    },
    {
      id: "suggestion-3",
      title: "Examples",
      detailedSuggestion: "Show me some example queries I can try.",
      messageId: "examples-query",
    },
  ];

  // Format timestamp for display
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  React.useEffect(() => {
    if (onTranscriptChange && transcriptions.length > 0) {
      onTranscriptChange(transcriptions);
    }
  }, [transcriptions, onTranscriptChange]);

  return (
    <div
      ref={ref}
      className={cn(
        "bg-background border-l border-gray-200 shadow-lg h-full overflow-hidden flex flex-col",
        className,
      )}
      {...props}
    >
      <div className="h-full flex flex-col">
        {/* Header with title and close button */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {activeTab === 'conversations' ? "Conversations" : "Transcript"}
            </span>
            <ThreadDropdown
        contextKey={contextKey}
        onThreadChange={handleThreadChange}
      />
          </div>
          <span className="text-xs text-muted-foreground">
            {shortcutText} to toggle
          </span>
        </div>

          {/* Tab Navigation */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setActiveTab('conversations')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors",
                  activeTab === 'conversations'
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <MessageSquare className="h-4 w-4" />
                Conversations
              </button>
              <button
                onClick={() => setActiveTab('transcript')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors",
                  activeTab === 'transcript'
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <FileText className="h-4 w-4" />
                Transcript
              </button>
            </div>

          {/* Tab Content */}
          {activeTab === 'conversations' ? (
            <>
              {/* Original Conversations Content */}
              <ScrollableMessageContainer className="p-4">
                <ThreadContent variant={variant}>
                  <ThreadContentMessages />
                </ThreadContent>
              </ScrollableMessageContainer>

              {/* Message Suggestions Status */}
              <MessageSuggestions>
                <MessageSuggestionsStatus />
              </MessageSuggestions>

              {/* Message input */}
              <div className="p-4">
                <MessageInput contextKey={contextKey}>
                  <MessageInputTextarea />
                  <MessageInputToolbar>
                    <MessageInputSubmitButton />
                  </MessageInputToolbar>
                  <MessageInputError />
                </MessageInput>
              </div>

              {/* Message suggestions */}
              <MessageSuggestions initialSuggestions={defaultSuggestions}>
                <MessageSuggestionsList />
              </MessageSuggestions>
            </>
          ) : (
            <>
              {/* Transcript Content */}
              <ScrollableMessageContainer className="flex-1 p-4" ref={transcriptContainerRef}>
                <div className="space-y-2">
                  {transcriptions.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No transcriptions yet</p>
                      <p className="text-sm mt-1">Voice conversations will appear here</p>
                    </div>
                  ) : (
                    transcriptions.map((transcription) => (
                      <div
                        key={transcription.id}
                        className={cn(
                          "p-3 rounded-lg border transition-opacity",
                          transcription.source === 'agent' 
                            ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                            : transcription.source === 'system'
                            ? "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800"
                            : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
                          !transcription.isFinal && "opacity-60 italic"
                        )}
                      >
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium">
                            {transcription.speaker}
                            {transcription.type === 'system_call' && ' → Tambo System'}
                          </span>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            {!transcription.isFinal && <span>(interim)</span>}
                            <span>{formatTime(transcription.timestamp)}</span>
                          </div>
                        </div>
                        <div className="text-sm">
                          {transcription.text}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollableMessageContainer>

              {/* Transcript Info */}
              <div className="p-4 border-t border-gray-200">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Live voice transcription with Tambo</span>
                  <div className="flex items-center gap-3">
                    {transcriptions.length > 0 && (
                      <button
                        onClick={clearTranscriptions}
                        className="text-xs hover:text-foreground transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    {room && (
                      <span className="text-green-600 dark:text-green-400">
                        Connected
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
    </div>
  );
});
MessageThreadCollapsible.displayName = "MessageThreadCollapsible";

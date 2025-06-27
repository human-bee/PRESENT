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
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '../../lib/livekit-bus';
import { useContextKey } from '../RoomScopedProviders';

/**
 * Props for the MessageThreadCollapsible component
 * @interface
 * @extends React.HTMLAttributes<HTMLDivElement>
 */
export interface MessageThreadCollapsibleProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional context key for the thread */
  contextKey?: string;
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
 *   className="left-4" // Position on the left instead of right
 *   variant="default"
 * />
 * ```
 */

export const MessageThreadCollapsible = React.forwardRef<
  HTMLDivElement,
  MessageThreadCollapsibleProps
>(({ className, contextKey, variant, onTranscriptChange, ...props }, ref) => {
  const [activeTab, setActiveTab] = React.useState<'conversations' | 'transcript'>('conversations');
  const [componentStore, setComponentStore] = React.useState(new Map<string, {component: React.ReactNode, contextKey: string}>());
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

  // LiveKit room context and bus for transcript functionality
  const room = useRoomContext();
  const bus = createLiveKitBus(room);
  const roomContextKey = useContextKey();
  const effectiveContextKey = contextKey || roomContextKey;

  // Listen for transcription data via bus
  React.useEffect(() => {
    const off = bus.on('transcription', (data: unknown) => {
      const transcriptionData = data as { type?: string; speaker?: string; text?: string; timestamp?: number; is_final?: boolean };
      if (transcriptionData.type === "live_transcription" && transcriptionData.text) {
        const transcription = {
          id: `${Date.now()}-${Math.random()}`,
          speaker: transcriptionData.speaker || "Unknown",
          text: transcriptionData.text,
          timestamp: transcriptionData.timestamp || Date.now(),
          isFinal: transcriptionData.is_final || false,
          source: (transcriptionData.speaker === 'tambo-voice-agent' ? 'agent' : 'user') as 'agent' | 'user',
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
    });
    return off;
  }, [bus]);

  // Listen for Tambo component creation - register with new system
  const handleTamboComponent = React.useCallback((event: CustomEvent) => {
    const { messageId, component } = event.detail;
    
    // Store the component for this thread/context (for transcript display)
    setComponentStore(prev => {
      const updated = new Map(prev);
      updated.set(messageId, { component, contextKey: effectiveContextKey || 'default' });
      return updated;
    });
    
    // Note: ComponentRegistry integration temporarily disabled to prevent infinite loops
    // Will be re-enabled once tldraw stability issues are resolved
    
    /*
    // Register with the new ComponentRegistry system
    if (component && React.isValidElement(component)) {
      const componentType = typeof component.type === 'function' 
        ? (component.type as { displayName?: string; name?: string }).displayName || 
          (component.type as { displayName?: string; name?: string }).name || 'UnknownComponent'
        : 'UnknownComponent';
      
      // Import ComponentRegistry dynamically to avoid circular imports
      import('@/lib/component-registry').then(({ ComponentRegistry }) => {
        ComponentRegistry.register({
          messageId,
          componentType,
          props: (component.props || {}) as Record<string, unknown>,
          contextKey: effectiveContextKey || 'default',
          timestamp: Date.now(),
          updateCallback: (patch) => {
            console.log(`[MessageThread] Component ${messageId} received update:`, patch);
            // The component should handle its own updates via the registry wrapper
          }
        });
      });
    }
    */
    
    // Also add system call to transcript
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
  }, [effectiveContextKey]);

  React.useEffect(() => {
    window.addEventListener('tambo:showComponent', handleTamboComponent as EventListener);
    
    return () => {
      window.removeEventListener('tambo:showComponent', handleTamboComponent as EventListener);
    };
  }, [handleTamboComponent]);

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

  // Note: Component list requests are now handled directly by ComponentRegistry
  // Old bus-based system removed in favor of direct tool access

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
        contextKey={effectiveContextKey}
        onThreadChange={handleThreadChange}
      />
          </div>
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
                <MessageInput contextKey={effectiveContextKey}>
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
                  {/* Filter components for current context */}
                  {(() => {
                    const contextComponents = Array.from(componentStore.entries())
                      .filter(([, data]) => data.contextKey === effectiveContextKey);
                    
                    return contextComponents.length === 0 && transcriptions.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No activity yet</p>
                        <p className="text-sm mt-1">Voice conversations and components will appear here</p>
                      </div>
                    ) : (
                      <>
                        {/* Show generated components first */}
                        {contextComponents.map(([messageId, data]) => (
                          <div key={messageId} className="mb-4 p-3 rounded-lg border bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800">
                            <div className="text-xs text-purple-600 dark:text-purple-400 mb-2">
                              Component: {messageId}
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded border">
                              {data.component}
                            </div>
                          </div>
                        ))}
                        {/* Then show transcriptions */}
                        {transcriptions.map((transcription) => (
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
                        ))}
                      </>
                    );
                  })()}
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

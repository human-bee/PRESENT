'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  useRoomContext,
  useRemoteParticipants,
  useLocalParticipant,
} from '@livekit/components-react';
import { Mic, MicOff, Loader2, AudioLines } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAllTranscripts, useTranscriptStore } from '@/lib/stores/transcript-store';

interface Transcription {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  source: 'agent' | 'user';
}

interface SpeechTranscriptionProps {
  className?: string;
  maxTranscriptions?: number;
  showInterimResults?: boolean;
  onTranscription?: (transcription: Transcription) => void;
}

export function SpeechTranscription({
  className,
  maxTranscriptions = 50,
  showInterimResults = true,
  onTranscription,
}: SpeechTranscriptionProps) {
  const room = useRoomContext();
  const remoteParticipants = useRemoteParticipants();
  const localParticipant = useLocalParticipant();

  // Get transcripts from centralized store
  const storeTranscripts = useAllTranscripts();
  const { clearTranscripts: storeClearTranscripts } = useTranscriptStore();

  const [isListening, setIsListening] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const [agentStatus, setAgentStatus] = useState<'waiting' | 'active' | 'error'>('waiting');

  const transcriptionContainerRef = useRef<HTMLDivElement>(null);
  const lastNotifiedIdRef = useRef<string | null>(null);

  // Convert store transcripts to local format
  const transcriptions = useMemo((): Transcription[] => {
    return storeTranscripts.slice(-maxTranscriptions).map((t) => ({
      id: t.id,
      speaker: t.speaker,
      text: t.text,
      timestamp: t.timestamp,
      isFinal: t.isFinal,
      source: (t.source === 'agent' || t.speaker === 'voice-agent' ? 'agent' : 'user') as 'agent' | 'user',
    }));
  }, [storeTranscripts, maxTranscriptions]);

  // Check for agent presence with detailed logging
  const agentParticipant = remoteParticipants.find(
    (p) =>
      p.identity === 'voice-agent' ||
      p.identity.startsWith('voice-agent') ||
      p.metadata?.includes('agent') ||
      p.metadata?.includes('type":"agent') ||
      p.name?.toLowerCase().includes('agent') ||
      p.identity.toLowerCase().includes('agent'),
  );

  // Log all participants for debugging
  useEffect(() => {
    console.log('🔍 [SpeechTranscription] Current participants:', {
      total: remoteParticipants.length,
      participants: remoteParticipants.map((p) => ({
        identity: p.identity,
        name: p.name,
        metadata: p.metadata,
        isAgent:
          p.identity === 'voice-agent' ||
          p.identity.startsWith('voice-agent') ||
          p.metadata?.includes('agent') ||
          p.metadata?.includes('type":"agent') ||
          p.name?.toLowerCase().includes('agent') ||
          p.identity.toLowerCase().includes('agent'),
      })),
      agentFound: !!agentParticipant,
      agentIdentity: agentParticipant?.identity || 'none',
    });
  }, [remoteParticipants, agentParticipant]);

  // Update connection status
  useEffect(() => {
    if (room) {
      setConnectionStatus('connected');
    }
  }, [room]);

  // Notify onTranscription callback for new transcripts
  useEffect(() => {
    if (!onTranscription || transcriptions.length === 0) return;
    
    const latest = transcriptions[transcriptions.length - 1];
    if (latest && latest.id !== lastNotifiedIdRef.current) {
      lastNotifiedIdRef.current = latest.id;
      onTranscription(latest);
    }
  }, [transcriptions, onTranscription]);

  // Monitor agent status
  useEffect(() => {
    if (agentParticipant) {
      setAgentStatus('active');
    } else {
      setAgentStatus('waiting');
    }
  }, [agentParticipant]);

  // Auto-scroll to bottom when new transcriptions arrive
  useEffect(() => {
    if (transcriptionContainerRef.current) {
      transcriptionContainerRef.current.scrollTop = transcriptionContainerRef.current.scrollHeight;
    }
  }, [transcriptions]);

  const handleStartListening = useCallback(() => {
    if (!room || !localParticipant) return;

    setIsListening(true);
    console.log('🎤 Started listening for agent transcriptions');
  }, [room, localParticipant]);

  const handleStopListening = useCallback(() => {
    setIsListening(false);
    console.log('🎤 Stopped listening for agent transcriptions');
  }, []);

  const clearTranscriptions = useCallback(() => {
    storeClearTranscripts();
  }, [storeClearTranscripts]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getStatusColor = () => {
    if (agentStatus === 'active' && isListening) return 'text-green-500';
    if (agentStatus === 'waiting') return 'text-yellow-500';
    if (agentStatus === 'error') return 'text-red-500';
    return 'text-gray-500';
  };

  const getStatusText = () => {
    if (agentStatus === 'active' && isListening) return 'Agent Active & Listening';
    if (agentStatus === 'active') return 'Agent Ready';
    if (agentStatus === 'waiting') return 'Waiting for Agent';
    if (agentStatus === 'error') return 'Agent Error';
    return 'Not Connected';
  };

  return (
    <div
      className={cn(
        'flex flex-col space-y-4 p-4 bg-white dark:bg-gray-900 rounded-lg border',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <AudioLines className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Speech Transcription
          </h3>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={clearTranscriptions}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
        <div className="flex items-center space-x-3">
          <div className={cn('w-2 h-2 rounded-full', getStatusColor())} />
          <span className={cn('text-sm font-medium', getStatusColor())}>{getStatusText()}</span>
        </div>

        <div className="flex items-center space-x-2">
          {connectionStatus === 'connected' && (
            <span className="text-xs text-green-600 dark:text-green-400">Room Connected</span>
          )}
          {agentParticipant && (
            <span className="text-xs text-blue-600 dark:text-blue-400">
              Agent: {agentParticipant.identity}
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center space-x-4">
        {!isListening ? (
          <button
            onClick={handleStartListening}
            disabled={!room || !agentParticipant}
            className="flex items-center space-x-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
          >
            <Mic className="h-5 w-5" />
            <span>Start Listening</span>
          </button>
        ) : (
          <button
            onClick={handleStopListening}
            className="flex items-center space-x-2 px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
          >
            <MicOff className="h-5 w-5" />
            <span>Stop Listening</span>
          </button>
        )}
      </div>

      {/* Agent Status Message */}
      {!agentParticipant && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
          <div className="flex items-center space-x-2 mb-2">
            <Loader2 className="h-4 w-4 text-yellow-600 animate-spin" />
            <span className="text-sm text-yellow-800 dark:text-yellow-200">
              Waiting for LiveKit agent to join the room...
            </span>
          </div>
          <div className="text-xs text-yellow-700 dark:text-yellow-300 border-t border-yellow-200 dark:border-yellow-700 pt-2">
            <div className="font-medium mb-1">💡 Agent Worker Required:</div>
            <div>Make sure to run the agent worker in a separate terminal:</div>
            <code className="block bg-yellow-100 dark:bg-yellow-800/50 p-1 rounded mt-1 text-xs">
              npm run agent:dev
            </code>
            <div className="mt-1">
              The agent dispatch API only creates tokens - the actual worker must be running
              separately.
            </div>
          </div>
        </div>
      )}

      {/* Transcriptions */}
      <div
        ref={transcriptionContainerRef}
        className="flex-1 space-y-2 max-h-96 overflow-y-auto p-3 bg-gray-50 dark:bg-gray-800 rounded-md"
      >
        {transcriptions.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            {isListening ? 'Listening for speech...' : 'No transcriptions yet'}
          </div>
        ) : (
          transcriptions
            .filter((t) => showInterimResults || t.isFinal)
            .map((transcription) => (
              <div
                key={transcription.id}
                className={cn(
                  'p-2 rounded border-l-4 transition-opacity',
                  transcription.source === 'agent'
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-400'
                    : 'bg-green-50 dark:bg-green-900/20 border-green-400',
                  !transcription.isFinal && 'opacity-60 italic',
                )}
              >
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <span className="font-medium">{transcription.speaker}</span>
                  <div className="flex items-center space-x-2">
                    <span>{transcription.source}</span>
                    {!transcription.isFinal && <span>(interim)</span>}
                    <span>{formatTime(transcription.timestamp)}</span>
                  </div>
                </div>
                <div className="text-sm text-gray-900 dark:text-gray-100">{transcription.text}</div>
              </div>
            ))
        )}
      </div>

      {/* Info */}
      <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
        Using LiveKit TypeScript Agent with OpenAI Realtime API
      </div>
    </div>
  );
}

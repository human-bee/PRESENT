'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  useRoomContext,
  useRemoteParticipants,
  useLocalParticipant,
} from '@livekit/components-react';
import { useAllTranscripts, useTranscriptStore } from '@/lib/stores/transcript-store';
import {
  SpeechTranscriptionView,
  type SpeechTranscriptionViewTone,
  type SpeechTranscriptionViewTranscription,
} from './speech-transcription-view';

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
  const debugEnabled =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SPEECH_TRANSCRIPTION_DEBUG === 'true';

  // Get transcripts from centralized store
  const storeTranscripts = useAllTranscripts();
  const { clearTranscripts: storeClearTranscripts } = useTranscriptStore();

  const [isListening, setIsListening] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const [agentStatus, setAgentStatus] = useState<'waiting' | 'active' | 'error'>('waiting');

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

  // Log all participants for debugging (opt-in).
  useEffect(() => {
    if (!debugEnabled) return;
    console.log('[SpeechTranscription] participants', {
      total: remoteParticipants.length,
      participants: remoteParticipants.map((p) => ({
        identity: p.identity,
        name: p.name,
        metadata: p.metadata,
      })),
      agentFound: !!agentParticipant,
      agentIdentity: agentParticipant?.identity || 'none',
    });
  }, [debugEnabled, remoteParticipants, agentParticipant]);

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

  const handleStartListening = useCallback(() => {
    if (!room || !localParticipant) return;

    setIsListening(true);
    if (debugEnabled) console.log('[SpeechTranscription] started listening');
  }, [room, localParticipant]);

  const handleStopListening = useCallback(() => {
    setIsListening(false);
    if (debugEnabled) console.log('[SpeechTranscription] stopped listening');
  }, []);

  const clearTranscriptions = useCallback(() => {
    storeClearTranscripts();
  }, [storeClearTranscripts]);

  const tone: SpeechTranscriptionViewTone = useMemo(() => {
    if (agentStatus === 'active' && isListening) return 'success';
    if (agentStatus === 'waiting') return 'warning';
    if (agentStatus === 'error') return 'danger';
    return 'neutral';
  }, [agentStatus, isListening]);

  const statusText = useMemo(() => {
    if (agentStatus === 'active' && isListening) return 'Agent active and listening';
    if (agentStatus === 'active') return 'Agent ready';
    if (agentStatus === 'waiting') return 'Waiting for agent';
    if (agentStatus === 'error') return 'Agent error';
    return 'Not connected';
  }, [agentStatus, isListening]);

  const viewTranscriptions: SpeechTranscriptionViewTranscription[] = useMemo(
    () =>
      transcriptions
        .filter((t) => (showInterimResults ? true : t.isFinal))
        .map((t) => ({
          id: t.id,
          speaker: t.speaker,
          text: t.text,
          timestamp: t.timestamp,
          isFinal: t.isFinal,
          source: t.source,
        })),
    [transcriptions, showInterimResults],
  );

  return (
    <SpeechTranscriptionView
      className={className}
      isListening={isListening}
      tone={tone}
      statusText={statusText}
      roomConnected={connectionStatus === 'connected'}
      agentIdentity={agentParticipant?.identity ?? null}
      canStart={Boolean(room && agentParticipant)}
      transcriptions={viewTranscriptions}
      onClear={clearTranscriptions}
      onStartListening={handleStartListening}
      onStopListening={handleStopListening}
    />
  );
}

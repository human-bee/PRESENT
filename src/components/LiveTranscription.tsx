'use client';

import { useEffect, useState, useRef } from 'react';
import { Room, RoomEvent, RemoteTrack } from 'livekit-client';
import { createLiveKitBus } from '../lib/livekit-bus';

interface TranscriptionData {
  participantId: string;
  text: string;
  timestamp: number;
}

interface LiveTranscriptionProps {
  room: Room | null;
  onTranscription?: (data: TranscriptionData) => void;
}

export function LiveTranscription({ room, onTranscription }: LiveTranscriptionProps) {
  const [isProcessing] = useState(false);
  const [status, setStatus] = useState<string>('Waiting for room connection...');
  const bus = createLiveKitBus(room);
  const linesRef = useRef<number>(0);

  useEffect(() => {
    if (!room) return;

    setStatus('Connected to room, waiting for audio tracks...');

    const handleTrackSubscribed = async (
      track: RemoteTrack,
      publication: any,
      participant: any
    ) => {
      if (track.kind === 'audio') {
        console.log(`🎙️ Audio track subscribed from ${participant.identity}`);
        setStatus(`Processing audio from ${participant.identity}`);
        
        // For now, send simulated transcriptions
        // In production, you'd process the actual audio
        const interval = setInterval(() => {
          const transcriptionData: TranscriptionData = {
            participantId: participant.identity,
            text: `[Demo transcription from ${participant.identity} at ${new Date().toLocaleTimeString()}]`,
            timestamp: Date.now()
          };
          
          // Send via shared bus
          bus.send('transcription', {
            type: 'transcription',
            ...transcriptionData,
          });
          
          // Also notify via callback
          onTranscription?.(transcriptionData);
        }, 3000);

        // Clean up on track end
        track.on('ended', () => {
          clearInterval(interval);
        });
      }
    };

    const handleTrackUnsubscribed = (
      track: RemoteTrack,
      publication: any,
      participant: any
    ) => {
      if (track.kind === 'audio') {
        console.log(`🔇 Audio track unsubscribed from ${participant.identity}`);
        setStatus('Waiting for audio tracks...');
      }
    };

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

    // Check existing tracks
    room.remoteParticipants.forEach((participant) => {
      participant.audioTrackPublications.forEach((publication) => {
        if (publication.track && publication.isSubscribed) {
          handleTrackSubscribed(publication.track, publication, participant);
        }
      });
    });

    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    };
  }, [room, onTranscription]);

  useEffect(() => {
    const off = bus.on('transcription', (data: any) => {
      if (typeof data?.text === 'string') {
        linesRef.current += 1;
        onTranscription?.(data as TranscriptionData);
      }
    });
    return off;
  }, [bus, onTranscription]);

  // Reply to heartbeat with transcription metrics
  useEffect(() => {
    const offPing = bus.on('state_ping', (msg: any) => {
      if (msg?.type === 'state_ping') {
        bus.send('state_pong', {
          type: 'state_pong',
          source: 'transcription',
          lineCount: linesRef.current,
          timestamp: Date.now(),
        });
      }
    });
    return offPing;
  }, [bus]);



  return (
    <div className="text-xs text-gray-500 p-2 bg-gray-50 rounded">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
        <span>Transcription Service: {status}</span>
      </div>
    </div>
  );
} 
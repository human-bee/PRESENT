'use client';

import { useEffect, useState, useRef } from 'react';
import { Room, RoomEvent, RemoteTrack, RemoteAudioTrack, LocalAudioTrack, createLocalAudioTrack } from 'livekit-client';

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('Waiting for room connection...');
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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
          
          // Send via data channel
          const encoder = new TextEncoder();
          const data = encoder.encode(JSON.stringify({
            type: 'transcription',
            ...transcriptionData
          }));
          
          room.localParticipant.publishData(data, { reliable: true });
          
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

  // Browser-based audio processing (for future real implementation)
  const startAudioProcessing = async (audioTrack: RemoteAudioTrack) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      // Get the media stream from the track
      const stream = audioTrack.mediaStream;
      if (!stream) return;

      // Create media recorder for capturing audio
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        // Process accumulated audio
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];
        
        // Here you would send audioBlob to your API endpoint
        // that forwards it to OpenAI Whisper
        console.log('Audio blob ready for transcription:', audioBlob.size, 'bytes');
      };

      // Start recording in 5-second chunks
      mediaRecorderRef.current.start();
      setInterval(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.start();
        }
      }, 5000);

    } catch (error) {
      console.error('Error starting audio processing:', error);
    }
  };

  return (
    <div className="text-xs text-gray-500 p-2 bg-gray-50 rounded">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
        <span>Transcription Service: {status}</span>
      </div>
    </div>
  );
} 
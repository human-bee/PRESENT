"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRoomContext, useRemoteParticipants, useLocalParticipant } from '@livekit/components-react';
import { Track, RemoteParticipant, LocalParticipant, TrackEvent } from 'livekit-client';
import { Mic, MicOff, Loader2, AudioLines } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Transcription {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export function SpeechTranscription() {
  const room = useRoomContext();
  const localParticipant = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Audio processing state
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const lastProcessTimeRef = useRef<number>(0);
  
  // Initialize audio context
  useEffect(() => {
    if (typeof window !== 'undefined' && !audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    return () => {
      if (audioProcessorRef.current) {
        audioProcessorRef.current.disconnect();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);
  
  // Process audio chunks and send to Responses API
  const processAudioChunk = async (audioData: Float32Array, speakerName: string) => {
    const now = Date.now();
    // Process every 1 second
    if (now - lastProcessTimeRef.current < 1000) {
      audioBufferRef.current.push(audioData);
      return;
    }
    
    lastProcessTimeRef.current = now;
    const combinedBuffer = combineAudioBuffers(audioBufferRef.current);
    audioBufferRef.current = [];
    
    if (combinedBuffer.length === 0) return;
    
    setIsProcessing(true);
    
    try {
      // Convert Float32Array to base64 for transmission
      const base64Audio = float32ArrayToBase64(combinedBuffer);
      
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: base64Audio,
          speaker: speakerName,
          sampleRate: audioContextRef.current?.sampleRate || 48000,
        }),
      });
      
      if (!response.ok) throw new Error('Transcription failed');
      
      const data = await response.json();
      
      if (data.transcription) {
        const newTranscription: Transcription = {
          id: `${Date.now()}-${Math.random()}`,
          speaker: speakerName,
          text: data.transcription,
          timestamp: Date.now(),
          isFinal: true,
        };
        
        setTranscriptions(prev => [...prev, newTranscription].slice(-20)); // Keep last 20
      }
    } catch (error) {
      console.error('Transcription error:', error);
    } finally {
      setIsProcessing(false);
    }
  };
  
  // Monitor audio tracks
  useEffect(() => {
    if (!room || !isTranscribing) return;
    
    const processParticipantAudio = (participant: RemoteParticipant | LocalParticipant) => {
      const audioTrack = participant.getTrackPublication(Track.Source.Microphone);
      
      if (audioTrack?.track && audioTrack.track.mediaStreamTrack) {
        const mediaStream = new MediaStream([audioTrack.track.mediaStreamTrack]);
        const source = audioContextRef.current?.createMediaStreamSource(mediaStream);
        
        if (source && audioContextRef.current) {
          const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
          
          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const audioData = new Float32Array(inputData);
            processAudioChunk(audioData, participant.name || participant.identity);
          };
          
          source.connect(processor);
          processor.connect(audioContextRef.current.destination);
          
          // Store processor for cleanup
          audioProcessorRef.current = processor;
        }
      }
    };
    
    // Process local participant
    if (localParticipant.localParticipant) {
      processParticipantAudio(localParticipant.localParticipant);
    }
    
    // Process remote participants
    remoteParticipants.forEach(participant => {
      processParticipantAudio(participant);
    });
    
    return () => {
      if (audioProcessorRef.current) {
        audioProcessorRef.current.disconnect();
        audioProcessorRef.current = null;
      }
    };
  }, [room, isTranscribing, localParticipant, remoteParticipants]);
  
  const toggleTranscription = () => {
    setIsTranscribing(!isTranscribing);
    if (!isTranscribing) {
      setTranscriptions([]); // Clear when starting
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 w-96 max-h-96 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-2 border-b">
        <h3 className="font-semibold flex items-center gap-2">
          <AudioLines className="w-4 h-4" />
          Speech Transcription
        </h3>
        
        <button
          onClick={toggleTranscription}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            isTranscribing
              ? "bg-red-100 text-red-700 hover:bg-red-200"
              : "bg-blue-100 text-blue-700 hover:bg-blue-200"
          )}
        >
          {isTranscribing ? (
            <>
              <MicOff className="w-3.5 h-3.5" />
              Stop
            </>
          ) : (
            <>
              <Mic className="w-3.5 h-3.5" />
              Start
            </>
          )}
        </button>
      </div>
      
      {/* Status */}
      {isTranscribing && (
        <div className="text-sm text-gray-600 mb-2 flex items-center gap-2">
          {isProcessing ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing audio...
            </>
          ) : (
            <>
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Listening...
            </>
          )}
        </div>
      )}
      
      {/* Transcriptions */}
      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {transcriptions.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            {isTranscribing ? "Waiting for speech..." : "Click Start to begin transcription"}
          </div>
        ) : (
          transcriptions.map((trans) => (
            <div
              key={trans.id}
              className="p-2 bg-gray-50 rounded-md text-sm"
            >
              <div className="font-medium text-gray-700 mb-0.5">
                {trans.speaker}
              </div>
              <div className="text-gray-900">{trans.text}</div>
              <div className="text-xs text-gray-400 mt-1">
                {new Date(trans.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Helper functions
function combineAudioBuffers(buffers: Float32Array[]): Float32Array {
  const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;
  
  for (const buffer of buffers) {
    result.set(buffer, offset);
    offset += buffer.length;
  }
  
  return result;
}

function float32ArrayToBase64(float32Array: Float32Array): string {
  const buffer = new ArrayBuffer(float32Array.length * 2); // 2 bytes per sample
  const view = new DataView(buffer);
  
  // Convert float32 to int16
  for (let i = 0; i < float32Array.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, sample * 0x7FFF, true); // true = little endian
  }
  
  // Convert to base64
  const uint8Array = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < uint8Array.byteLength; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  
  return btoa(binary);
} 
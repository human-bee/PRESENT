'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
const LivekitRoom = dynamic(() => import('@livekit/components-react').then((m) => m.LiveKitRoom), {
  ssr: false,
});
const RoomAudioRenderer = dynamic(
  () => import('@livekit/components-react').then((m) => m.RoomAudioRenderer),
  { ssr: false },
);
const ControlBar = dynamic(() => import('@livekit/components-react').then((m) => m.ControlBar), {
  ssr: false,
});
const useDataChannel = (...args: any[]) => {
  // lazy hook accessor
  const mod = require('@livekit/components-react');
  return mod.useDataChannel(...(args as any));
};
const AudioPresets = require('@livekit/components-react').AudioPresets;
const useRoomContext = require('@livekit/components-react').useRoomContext;
import { Room } from 'livekit-client';
import { motion, AnimatePresence } from 'framer-motion';
import { LiveTranscription } from './LiveTranscription';

interface SpeechTranscriptionProps {
  roomName: string;
  username: string;
}

interface TranscriptionEntry {
  id: string;
  participantId: string;
  text: string;
  timestamp: number;
}

export function SpeechTranscription({ roomName, username }: SpeechTranscriptionProps) {
  const [token, setToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptions, setTranscriptions] = useState<TranscriptionEntry[]>([]);
  const [room, setRoom] = useState<Room | null>(null);

  // Fetch token for room connection
  const fetchToken = async () => {
    try {
      const response = await fetch(`/api/token?roomName=${roomName}&username=${username}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get token');
      }

      setToken(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get token');
      console.error('Token fetch error:', err);
    }
  };

  useEffect(() => {
    fetchToken();
  }, [roomName, username]);

  const handleConnect = async () => {
    if (!token) {
      setError('No token available');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // Dispatch agent connection
      const response = await fetch('/api/agent/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName,
          trigger: 'participant_connected',
          timestamp: Date.now(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        console.warn('Agent dispatch warning:', data.message || 'Agent may not be available');
      }
    } catch (err) {
      console.error('Agent dispatch error:', err);
      // Continue anyway - the agent is optional
    }
  };

  const handleDisconnect = () => {
    setIsConnecting(false);
    setIsConnected(false);
    setRoom(null);
  };

  // DataChannel component to receive transcriptions
  function TranscriptionReceiver() {
    useDataChannel((msg) => {
      if (typeof msg.payload === 'string') {
        try {
          const data = JSON.parse(msg.payload);
          if (data.type === 'transcription') {
            const entry: TranscriptionEntry = {
              id: `${data.participantId}-${data.timestamp}`,
              participantId: data.participantId,
              text: data.text,
              timestamp: data.timestamp,
            };
            setTranscriptions((prev) => [...prev, entry]);
          }
        } catch (e) {
          console.error('Failed to parse data channel message:', e);
        }
      }
    });
    return null;
  }

  // Room tracking component
  function RoomTracker() {
    const roomContext = useRoomContext();
    useEffect(() => {
      setRoom(roomContext);
    }, [roomContext]);
    return null;
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Speech Transcription</h2>

      <LivekitRoom
        token={token}
        serverUrl={process.env.NEXT_PUBLIC_LK_SERVER_URL}
        connect={isConnecting}
        options={{
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: {
            audioPreset: AudioPresets.music,
          },
        }}
        onConnected={() => {
          setIsConnecting(false);
          setIsConnected(true);
          console.log('Connected to LiveKit room');
        }}
        onDisconnected={() => {
          setIsConnected(false);
          setIsConnecting(false);
          console.log('Disconnected from LiveKit room');
        }}
        onError={(error) => {
          console.error('LiveKit room error:', error);
          setError(`Room error: ${error.message}`);
          setIsConnecting(false);
        }}
      >
        {/* Track room instance */}
        <RoomTracker />

        {/* Browser-based transcription service */}
        <LiveTranscription
          room={room}
          onTranscription={(data) => {
            console.log('Browser transcription:', data);
            // The LiveTranscription component already sends data via LiveKit data channels
            // This callback is for additional local processing if needed
          }}
        />

        {/* Data channel receiver */}
        <TranscriptionReceiver />

        {/* Room connection UI */}
        <div className="mb-4">
          <button
            onClick={isConnected ? handleDisconnect : handleConnect}
            disabled={isConnecting || !token}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              isConnected
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-300'
            }`}
          >
            {isConnecting ? 'Connecting...' : isConnected ? 'Stop' : 'Start'}
          </button>

          {error && <p className="mt-2 text-red-500 text-sm">{error}</p>}

          {isConnected && (
            <p className="mt-2 text-green-600 text-sm">
              Connected as {username} to room: {roomName}
            </p>
          )}
        </div>

        {/* Audio controls when connected */}
        {isConnected && (
          <div className="mb-4">
            <ControlBar variation="minimal" controls={{ microphone: true }} />
            <RoomAudioRenderer />
          </div>
        )}

        {/* Transcription display */}
        <div className="border rounded-lg p-4 h-64 overflow-y-auto bg-gray-50">
          <h3 className="font-semibold mb-2">Transcriptions:</h3>
          <AnimatePresence>
            {transcriptions.length === 0 ? (
              <p className="text-gray-500 italic">Waiting for speech...</p>
            ) : (
              transcriptions.map((entry) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-2 p-2 bg-white rounded shadow-sm"
                >
                  <div className="text-xs text-gray-500">
                    {entry.participantId} - {new Date(entry.timestamp).toLocaleTimeString()}
                  </div>
                  <div className="text-sm">{entry.text}</div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </LivekitRoom>
    </div>
  );
}

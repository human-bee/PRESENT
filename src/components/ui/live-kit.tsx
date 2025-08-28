/*
 * LiveKit UI component with audio/video controls and RPC handling.
 *
 * DEVELOPMENT NOTES:
 * - RPC methods must be registered in useEffect with proper cleanup to avoid memory leaks
 * - Use refs to prevent duplicate registrations and concurrent RPC processing
 * - Always handle MediaDeviceFailure and RpcError exceptions for robust error handling
 */

'use client';

import {
  ControlBar,
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useToken,
} from '@livekit/components-react';
import { useTamboThreadInput } from '@tambo-ai/react';
import { MediaDeviceFailure, RpcError, RpcInvocationData } from 'livekit-client';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { generateRandomUserId } from '../../lib/helper';

// Child component that will handle RPC registration
export function RpcHandler({ contextKey }: { contextKey: string }) {
  const { localParticipant } = useLocalParticipant();
  const { setValue, submit } = useTamboThreadInput();
  const isProcessingRef = useRef(false);
  const methodRegisteredRef = useRef(false);

  // Register RPC method for YouTube search
  useEffect(() => {
    if (localParticipant && !methodRegisteredRef.current) {
      methodRegisteredRef.current = true;

      const rpcMethod = 'youtubeSearch';

      localParticipant.registerRpcMethod(rpcMethod, async (data: RpcInvocationData) => {
        try {
          // Prevent multiple concurrent submissions
          if (isProcessingRef.current) {
            console.log('Already processing a request, ignoring');
            return JSON.stringify({
              success: false,
              error: 'Already processing a request',
            });
          }

          isProcessingRef.current = true;

          const params = JSON.parse(data.payload);
          const query = params.task_prompt;

          // Submit the YouTube search query as a message
          console.log('Submitting YouTube search for:', query);

          // Set the value and ensure it's non-empty before submitting
          await setValue(query);

          // Add a short delay to ensure the value is set
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Check if value is set before submitting
          if (!query) {
            isProcessingRef.current = false;
            throw new Error('Search query is empty');
          }

          try {
            await submit({
              streamResponse: true,
              contextKey: contextKey,
            });

            console.log('Performing YouTube search for:', query);

            // Return search results (mocked for now)
            return JSON.stringify({
              success: true,
              results: [`Search results for: ${query}`],
            });
          } finally {
            // Reset the processing state, even if there's an error
            isProcessingRef.current = false;
          }
        } catch (error) {
          console.error('Error performing YouTube search:', error);
          isProcessingRef.current = false;
          throw new RpcError(1, 'Could not perform YouTube search');
        }
      });

      // Setup was successful; log it
      console.log('Registered RPC method for YouTube search');

      // No explicit cleanup needed - component will be unmounted
      // and LiveKit handles this cleanup internally
    }
  }, [localParticipant, setValue, submit, contextKey]);

  return null; // This component doesn't render anything
}

interface LiveKitProviderProps {
  children: ReactNode;
}

// Provider component that handles connection and authentication
export function LiveKitProvider({ children }: LiveKitProviderProps) {
  const params = typeof window !== 'undefined' ? new URLSearchParams(location.search) : null;
  const roomName = useMemo(
    () => params?.get('room') ?? 'test-room-' + Math.random().toFixed(5),
    [],
  );
  const [shouldConnect, setShouldConnect] = useState(false);

  const tokenOptions = useMemo(() => {
    const userId = params?.get('user') ?? generateRandomUserId();
    return {
      userInfo: {
        identity: userId,
        name: userId,
      },
    };
  }, []);

  const token = useToken(process.env.NEXT_PUBLIC_LK_TOKEN_ENDPOINT, roomName, tokenOptions);

  useEffect(() => {
    console.log('Token endpoint:', process.env.NEXT_PUBLIC_LK_TOKEN_ENDPOINT);
    console.log('Room name:', roomName);
    console.log('Token options:', tokenOptions);
  }, [roomName, tokenOptions]);

  const onDeviceFailure = (e?: MediaDeviceFailure) => {
    console.error(e);
    alert(
      'Error acquiring camera or microphone permissions. Please make sure you grant the necessary permissions in your browser and reload the tab',
    );
  };

  return (
    <LiveKitRoom
      audio={true}
      token={token}
      connect={shouldConnect}
      serverUrl={process.env.NEXT_PUBLIC_LK_SERVER_URL}
      onMediaDeviceFailure={onDeviceFailure}
      onDisconnected={() => setShouldConnect(false)}
    >
      {/* Add a connection handler that can be used by children */}
      {shouldConnect ? children : <ConnectButton onConnect={() => setShouldConnect(true)} />}
    </LiveKitRoom>
  );
}

interface ConnectButtonProps {
  onConnect: () => void;
}

// Simple connection button component
function ConnectButton({ onConnect }: ConnectButtonProps) {
  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="flex flex-col bg-background border border-gray-200 rounded-xl shadow-md p-3 mb-2">
        <div className="flex items-center justify-between">
          <button
            className="px-4 py-2 bg-black/80 hover:bg-black/70 text-white font-medium rounded-lg transition-colors"
            onClick={onConnect}
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}

// UI component that renders the LiveKit interface
export function LiveKitUI() {
  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="flex flex-col bg-background border border-gray-200 rounded-xl shadow-md p-3 mb-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Connected</div>
          <ControlBar
            controls={{
              microphone: false,
              camera: false,
              chat: false,
              screenShare: false,
              leave: true,
              settings: false,
            }}
          />
        </div>
      </div>
      <RoomAudioRenderer />
    </div>
  );
}

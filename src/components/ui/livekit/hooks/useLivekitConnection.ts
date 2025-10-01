import { useEffect, useRef, useState } from 'react';
import { Room, ConnectionState } from 'livekit-client';
import type { User } from '@supabase/supabase-js';

type ConnectionStateType = 'disconnected' | 'connecting' | 'connected' | 'error';

interface ConnectionOptions {
  roomName: string;
  userName: string;
  wsUrl: string;
  audioOnly: boolean;
  user?: User | null;
  identityRef: React.RefObject<string | null>;
}

/**
 * Manages LiveKit room connection lifecycle
 * Handles token fetch, connection, and reconnection logic
 */
export function useLivekitConnection(
  room: Room | undefined,
  options: ConnectionOptions,
  stateRef: React.RefObject<{
    connectionState: ConnectionStateType;
    token: string | null;
  } | null>,
) {
  const tokenFetchInProgress = useRef(false);

  useEffect(() => {
    if (!stateRef.current || !room) return;

    const shouldFetchToken =
      stateRef.current.connectionState === 'connecting' &&
      !stateRef.current.token &&
      !tokenFetchInProgress.current;

    if (!shouldFetchToken) return;

    const fetchTokenAndConnect = async () => {
      tokenFetchInProgress.current = true;

      try {
        console.log(`🎯 [LiveKitConnector-${options.roomName}] Fetching token...`);
        
        const identity = encodeURIComponent(
          options.identityRef.current ||
            `${options.userName.replace(/\s+/g, '-')}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
        );
        
        const metadataPayload = {
          displayName: options.userName,
          fullName: options.userName,
          userId: options.user?.id ?? undefined,
        };
        
        const metadataParam = `&metadata=${encodeURIComponent(JSON.stringify(metadataPayload))}`;
        const response = await fetch(
          `/api/token?roomName=${encodeURIComponent(options.roomName)}&identity=${identity}&username=${encodeURIComponent(options.userName)}&name=${encodeURIComponent(options.userName)}${metadataParam}`,
        );

        if (!response.ok) {
          throw new Error(`Token fetch failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const token = data.accessToken || data.token;

        if (!token) {
          throw new Error('No token received from API');
        }

        console.log(`🔑 [LiveKitConnector-${options.roomName}] Token received, connecting to room...`);

        if (options.wsUrl) {
          console.log(
            `🔌 [LiveKitConnector-${options.roomName}] Calling room.connect() with URL: ${options.wsUrl}`,
          );
          
          const timeoutId = setTimeout(() => {
            if (stateRef.current?.connectionState !== 'connected') {
              try {
                room.disconnect();
              } catch {}
              throw new Error('Connect timeout');
            }
          }, 15000);

          await room.connect(options.wsUrl, token);
          clearTimeout(timeoutId);
          
          console.log(`✅ [LiveKitConnector-${options.roomName}] Room.connect() called successfully`);

          // Enable camera and microphone
          try {
            if (!options.audioOnly) {
              console.log(`🎥 [LiveKitConnector-${options.roomName}] Enabling camera...`);
              await room.localParticipant.enableCameraAndMicrophone();
              console.log(`✅ [LiveKitConnector-${options.roomName}] Camera and microphone enabled`);
            } else {
              console.log(
                `🎤 [LiveKitConnector-${options.roomName}] Enabling microphone only (audio-only mode)...`,
              );
              await room.localParticipant.setMicrophoneEnabled(true);
              console.log(`✅ [LiveKitConnector-${options.roomName}] Microphone enabled`);
            }
          } catch (mediaError) {
            console.warn(`⚠️ [LiveKitConnector-${options.roomName}] Media device error:`, mediaError);
          }
        } else {
          throw new Error('Missing LiveKit server URL');
        }
      } catch (error) {
        console.error(`❌ [LiveKitConnector-${options.roomName}] Connection failed:`, error);
        throw error;
      } finally {
        tokenFetchInProgress.current = false;
      }
    };

    fetchTokenAndConnect().catch(() => {
      // Error handled in the function
    });
  }, [
    stateRef.current?.connectionState,
    stateRef.current?.token,
    room,
    options.roomName,
    options.userName,
    options.wsUrl,
    options.audioOnly,
    options.user,
    options.identityRef,
  ]);
}

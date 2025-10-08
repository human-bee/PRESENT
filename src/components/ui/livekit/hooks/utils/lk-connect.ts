import type { Room } from 'livekit-client';
import { TOKEN_TIMEOUT_MS } from '../../utils';
import type { LivekitRoomConnectorState } from './lk-types';

interface ConnectRoomParams {
  room: Room;
  wsUrl: string;
  token: string;
  audioOnly: boolean;
  roomName: string;
  mergeState: (patch: Partial<LivekitRoomConnectorState>) => void;
  getState: () => LivekitRoomConnectorState;
  scheduleAgentJoin: (room: Room) => void;
}

export async function connectRoomWithToken({
  room,
  wsUrl,
  token,
  audioOnly,
  roomName,
  mergeState,
  getState,
  scheduleAgentJoin,
}: ConnectRoomParams): Promise<void> {
  const timeoutId = setTimeout(async () => {
    const latest = getState();
    if (latest.connectionState !== 'connected') {
      try {
        await room.disconnect();
      } catch {
        // ignore disconnect errors during timeout recovery
      }
      mergeState({
        connectionState: 'error',
        errorMessage: 'Connection timed out.',
      });
    }
  }, TOKEN_TIMEOUT_MS);

  try {
    await room.connect(wsUrl, token);
  } catch (connectError) {
    clearTimeout(timeoutId);
    throw connectError;
  }
  clearTimeout(timeoutId);

  try {
    if (!audioOnly) {
      await room.localParticipant.enableCameraAndMicrophone();
    } else {
      await room.localParticipant.setMicrophoneEnabled(true);
    }
  } catch (mediaError) {
    console.warn(`⚠️ [LiveKitConnector-${roomName}] Media device error:`, mediaError);
  }

  mergeState({
    connectionState: 'connected',
    participantCount: room.numParticipants,
    errorMessage: null,
  });

  scheduleAgentJoin(room);
}

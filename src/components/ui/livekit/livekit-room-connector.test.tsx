import React from 'react';
import { render } from '@testing-library/react';
import {
  CanvasLiveKitContext,
  LivekitRoomConnector,
} from './livekit-room-connector';

jest.mock('@livekit/components-react', () => ({
  AudioConference: () => null,
}));

const useLivekitConnectionMock = jest.fn();
const useRoomEventsMock = jest.fn();

jest.mock('./hooks', () => ({
  useLivekitConnection: (...args: any[]) => useLivekitConnectionMock(...args),
  useRoomEvents: (...args: any[]) => useRoomEventsMock(...args),
}));

jest.mock('./components', () => ({
  RoomConnectorUI: () => null,
}));

function makeConnectionResult(roomName: string) {
  return {
    state: {
      connectionState: 'disconnected',
      isMinimized: false,
      participantCount: 0,
      errorMessage: null,
      token: null,
      agentStatus: 'not-requested',
      agentIdentity: null,
    },
    connect: jest.fn(async () => {}),
    disconnect: jest.fn(async () => {}),
    requestAgent: jest.fn(async () => {}),
    toggleMinimized: jest.fn(),
    copyInviteLink: jest.fn(async () => {}),
    roomEventHandlers: {},
    room: undefined,
    roomName,
    displayName: 'Canvas User',
  };
}

describe('LivekitRoomConnector', () => {
  beforeEach(() => {
    useLivekitConnectionMock.mockReset();
    useRoomEventsMock.mockReset();
  });

  it('prefers CanvasLiveKitContext roomName when props omit it', () => {
    useLivekitConnectionMock.mockReturnValue(makeConnectionResult('canvas-ctx'));

    render(
      <CanvasLiveKitContext.Provider
        value={{ isConnected: false, roomName: 'canvas-ctx', participantCount: 0 }}
      >
        <LivekitRoomConnector />
      </CanvasLiveKitContext.Provider>,
    );

    expect(useLivekitConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomName: 'canvas-ctx',
      }),
    );
  });

  it('uses explicit roomName prop over context', () => {
    useLivekitConnectionMock.mockReturnValue(makeConnectionResult('canvas-prop'));

    render(
      <CanvasLiveKitContext.Provider
        value={{ isConnected: false, roomName: 'canvas-ctx', participantCount: 0 }}
      >
        <LivekitRoomConnector roomName="canvas-prop" />
      </CanvasLiveKitContext.Provider>,
    );

    expect(useLivekitConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomName: 'canvas-prop',
      }),
    );
  });
});


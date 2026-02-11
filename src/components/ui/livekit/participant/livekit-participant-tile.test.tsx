import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LivekitParticipantTile } from './livekit-participant-tile';

const useParticipantsMock = jest.fn();
const useLocalParticipantMock = jest.fn();
const useRoomContextMock = jest.fn();
const useCanvasLiveKitMock = jest.fn();

jest.mock('@livekit/components-react', () => ({
  useParticipants: () => useParticipantsMock(),
  useLocalParticipant: () => useLocalParticipantMock(),
  useRoomContext: () => useRoomContextMock(),
}));

jest.mock('../livekit-room-connector', () => ({
  useCanvasLiveKit: () => useCanvasLiveKitMock(),
}));

jest.mock('./livekit-single-participant-tile', () => ({
  SingleParticipantTile: ({ participant }: any) => (
    <div data-testid="single-participant-tile">{participant.identity}</div>
  ),
}));

describe('LivekitParticipantTile', () => {
  beforeEach(() => {
    useCanvasLiveKitMock.mockReturnValue({
      isConnected: true,
      roomName: 'canvas-room',
      participantCount: 2,
    });
    useRoomContextMock.mockReturnValue({});
    useParticipantsMock.mockReturnValue([{ identity: 'bob', isLocal: false }]);
    useLocalParticipantMock.mockReturnValue({
      localParticipant: { identity: 'alice', isLocal: true },
    });
  });

  it('renders explicit unassigned slot state and allows assignment', () => {
    const onIdentityChange = jest.fn();
    render(
      <LivekitParticipantTile
        slotId="slot-a"
        assignmentStatus="unassigned"
        onIdentityChange={onIdentityChange}
      />,
    );

    expect(screen.getByText('Unassigned Slot')).toBeTruthy();
    expect(screen.getByText(/slot-a/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /assign participant/i }));
    expect(onIdentityChange).toHaveBeenCalledWith('alice');
  });

  it('renders participant tile when shared identity is assigned', () => {
    render(
      <LivekitParticipantTile
        slotId="slot-b"
        assignmentStatus="assigned"
        participantIdentity="bob"
      />,
    );

    expect(screen.getByTestId('single-participant-tile').textContent).toContain('bob');
  });
});

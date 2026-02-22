import type { LivekitRoomConnectorState } from './lk-types';

const normalize = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
};

export const shouldReconnectForRoomSwitch = (input: {
  previousRequestedRoom: string;
  nextRequestedRoom: string;
  connectionState: LivekitRoomConnectorState['connectionState'];
  connectedRoomName: string;
}): boolean => {
  const previousRequestedRoom = normalize(input.previousRequestedRoom);
  const nextRequestedRoom = normalize(input.nextRequestedRoom);
  const connectedRoomName = normalize(input.connectedRoomName);

  if (!previousRequestedRoom || !nextRequestedRoom || previousRequestedRoom === nextRequestedRoom) {
    return false;
  }

  const switchedDuringConnect =
    (input.connectionState === 'connecting' || input.connectionState === 'reconnecting') &&
    previousRequestedRoom !== nextRequestedRoom;
  const connectedToDifferentRoom =
    input.connectionState === 'connected' &&
    connectedRoomName.length > 0 &&
    connectedRoomName !== nextRequestedRoom;

  return switchedDuringConnect || connectedToDifferentRoom;
};

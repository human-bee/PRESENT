export type SyncContract = {
  canvasId: string | null;
  livekitRoomName: string;
  tldrawRoomId: string;
  sessionKey: string;
  invariants: {
    livekitMatchesTldraw: boolean;
    roomMatchesCanvas: boolean;
  };
  errors: string[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  if (!value) return false;
  return UUID_RE.test(value);
}

export function buildCanvasRoomName(canvasId: string): string {
  return `canvas-${canvasId}`;
}

export function extractCanvasIdFromRoomName(roomName: string | null | undefined): string | null {
  if (!roomName) return null;
  const trimmed = roomName.trim();
  const match = trimmed.match(
    /^canvas-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  const parsed = match?.[1] ?? null;
  return isUuid(parsed) ? parsed : null;
}

export function getCanvasIdFromCurrentUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('id');
    return isUuid(raw) ? raw : null;
  } catch {
    return null;
  }
}

type BuildSyncContractInput = {
  roomName: string;
  canvasId?: string | null;
  tldrawRoomId?: string | null;
};

export function buildSyncContract(input: BuildSyncContractInput): SyncContract {
  const roomName = String(input.roomName || '').trim();
  const derivedCanvasId = isUuid(input.canvasId) ? input.canvasId : extractCanvasIdFromRoomName(roomName);
  const livekitRoomName = roomName;
  const tldrawRoomId = String(input.tldrawRoomId || livekitRoomName || '').trim();
  const expectedRoomForCanvas = derivedCanvasId ? buildCanvasRoomName(derivedCanvasId) : null;
  const roomMatchesCanvas = expectedRoomForCanvas ? expectedRoomForCanvas === livekitRoomName : true;
  const livekitMatchesTldraw = livekitRoomName === tldrawRoomId;
  const errors: string[] = [];

  if (!livekitMatchesTldraw) {
    errors.push('LiveKit room does not match TLDraw room id');
  }
  if (!roomMatchesCanvas) {
    errors.push('Room name does not match canonical canvas room');
  }

  return {
    canvasId: derivedCanvasId ?? null,
    livekitRoomName,
    tldrawRoomId,
    sessionKey: `${livekitRoomName}::${derivedCanvasId ?? 'none'}`,
    invariants: {
      livekitMatchesTldraw,
      roomMatchesCanvas,
    },
    errors,
  };
}

type SessionPair = {
  roomName?: string | null;
  canvasId?: string | null;
};

export function validateSessionPair(contract: SyncContract, session: SessionPair): string[] {
  const errors: string[] = [];
  const sessionRoom = String(session.roomName || '').trim();
  const sessionCanvasId = isUuid(session.canvasId) ? session.canvasId : null;

  if (sessionRoom && sessionRoom !== contract.livekitRoomName) {
    errors.push('Session room does not match current LiveKit room');
  }
  if (contract.canvasId && sessionCanvasId && contract.canvasId !== sessionCanvasId) {
    errors.push('Session canvas id does not match URL/room contract');
  }

  return errors;
}


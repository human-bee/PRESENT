export type LocalPinData = {
  pinnedX: number;
  pinnedY: number;
  screenLeft?: number;
  screenTop?: number;
  pinnedLeft?: number;
  pinnedTop?: number;
  screenW?: number;
  screenH?: number;
  shapeW?: number;
  shapeH?: number;
};

const PINS_CHANGED_EVENT = 'present:pins-changed';

function storageKey(roomName: string) {
  const safe = (roomName || 'canvas').trim() || 'canvas';
  return `present:pins:${safe}`;
}

function readRoomPins(roomName: string): Record<string, LocalPinData> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey(roomName));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LocalPinData>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeRoomPins(roomName: string, pins: Record<string, LocalPinData>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(roomName), JSON.stringify(pins));
  } catch {
    // ignore storage failures
  }
}

export function notifyPinsChanged(roomName: string, shapeId?: string) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(PINS_CHANGED_EVENT, {
        detail: {
          roomName: (roomName || 'canvas').trim() || 'canvas',
          shapeId: shapeId || null,
        },
      }),
    );
  } catch {
    // ignore
  }
}

export function getLocalPin(roomName: string, shapeId: string): LocalPinData | null {
  const pins = readRoomPins(roomName);
  const entry = pins[shapeId];
  if (!entry) return null;
  const pinnedX = Number(entry.pinnedX);
  const pinnedY = Number(entry.pinnedY);
  if (!Number.isFinite(pinnedX) || !Number.isFinite(pinnedY)) return null;
  const maybeLeft = Number((entry as any).pinnedLeft);
  const maybeTop = Number((entry as any).pinnedTop);
  const maybeScreenLeft = Number((entry as any).screenLeft);
  const maybeScreenTop = Number((entry as any).screenTop);
  const maybeW = Number((entry as any).screenW);
  const maybeH = Number((entry as any).screenH);
  const maybeShapeW = Number((entry as any).shapeW);
  const maybeShapeH = Number((entry as any).shapeH);
  const pinnedLeft = Number.isFinite(maybeLeft) ? Math.max(0, Math.min(1, maybeLeft)) : undefined;
  const pinnedTop = Number.isFinite(maybeTop) ? Math.max(0, Math.min(1, maybeTop)) : undefined;
  const screenLeft = Number.isFinite(maybeScreenLeft) ? maybeScreenLeft : undefined;
  const screenTop = Number.isFinite(maybeScreenTop) ? maybeScreenTop : undefined;
  const screenW = Number.isFinite(maybeW) && maybeW > 0 ? maybeW : undefined;
  const screenH = Number.isFinite(maybeH) && maybeH > 0 ? maybeH : undefined;
  const shapeW = Number.isFinite(maybeShapeW) && maybeShapeW > 0 ? maybeShapeW : undefined;
  const shapeH = Number.isFinite(maybeShapeH) && maybeShapeH > 0 ? maybeShapeH : undefined;
  return {
    pinnedX: Math.max(0, Math.min(1, pinnedX)),
    pinnedY: Math.max(0, Math.min(1, pinnedY)),
    ...(screenLeft !== undefined ? { screenLeft } : {}),
    ...(screenTop !== undefined ? { screenTop } : {}),
    ...(pinnedLeft !== undefined ? { pinnedLeft } : {}),
    ...(pinnedTop !== undefined ? { pinnedTop } : {}),
    ...(screenW ? { screenW } : {}),
    ...(screenH ? { screenH } : {}),
    ...(shapeW ? { shapeW } : {}),
    ...(shapeH ? { shapeH } : {}),
  };
}

export function setLocalPin(roomName: string, shapeId: string, data: LocalPinData) {
  const pins = readRoomPins(roomName);
  const maybeLeft = Number((data as any).pinnedLeft);
  const maybeTop = Number((data as any).pinnedTop);
  const maybeScreenLeft = Number((data as any).screenLeft);
  const maybeScreenTop = Number((data as any).screenTop);
  const maybeW = Number((data as any).screenW);
  const maybeH = Number((data as any).screenH);
  const maybeShapeW = Number((data as any).shapeW);
  const maybeShapeH = Number((data as any).shapeH);
  const pinnedLeft = Number.isFinite(maybeLeft) ? Math.max(0, Math.min(1, maybeLeft)) : undefined;
  const pinnedTop = Number.isFinite(maybeTop) ? Math.max(0, Math.min(1, maybeTop)) : undefined;
  const screenLeft = Number.isFinite(maybeScreenLeft) ? maybeScreenLeft : undefined;
  const screenTop = Number.isFinite(maybeScreenTop) ? maybeScreenTop : undefined;
  const screenW = Number.isFinite(maybeW) && maybeW > 0 ? maybeW : undefined;
  const screenH = Number.isFinite(maybeH) && maybeH > 0 ? maybeH : undefined;
  const shapeW = Number.isFinite(maybeShapeW) && maybeShapeW > 0 ? maybeShapeW : undefined;
  const shapeH = Number.isFinite(maybeShapeH) && maybeShapeH > 0 ? maybeShapeH : undefined;
  pins[shapeId] = {
    pinnedX: Math.max(0, Math.min(1, Number(data.pinnedX))),
    pinnedY: Math.max(0, Math.min(1, Number(data.pinnedY))),
    ...(screenLeft !== undefined ? { screenLeft } : {}),
    ...(screenTop !== undefined ? { screenTop } : {}),
    ...(pinnedLeft !== undefined ? { pinnedLeft } : {}),
    ...(pinnedTop !== undefined ? { pinnedTop } : {}),
    ...(screenW ? { screenW } : {}),
    ...(screenH ? { screenH } : {}),
    ...(shapeW ? { shapeW } : {}),
    ...(shapeH ? { shapeH } : {}),
  };
  writeRoomPins(roomName, pins);
  notifyPinsChanged(roomName, shapeId);
}

export function clearLocalPin(roomName: string, shapeId: string) {
  const pins = readRoomPins(roomName);
  if (!(shapeId in pins)) return;
  delete pins[shapeId];
  writeRoomPins(roomName, pins);
  notifyPinsChanged(roomName, shapeId);
}

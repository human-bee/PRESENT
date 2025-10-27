export type ScreenshotPayload = {
  sessionId: string;
  requestId: string;
  image: { mime: string; dataUrl: string; bytes: number; width?: number; height?: number };
  bounds: { x: number; y: number; w: number; h: number };
  viewport: { x: number; y: number; w: number; h: number };
  selection: string[];
  docVersion: string;
};

const inbox = new Map<string, ScreenshotPayload>();

export function storeScreenshot(payload: ScreenshotPayload) {
  const key = `${payload.sessionId}::${payload.requestId}`;
  inbox.set(key, payload);
}

export function takeScreenshot(sessionId: string, requestId: string): ScreenshotPayload | null {
  const key = `${sessionId}::${requestId}`;
  return inbox.get(key) || null;
}






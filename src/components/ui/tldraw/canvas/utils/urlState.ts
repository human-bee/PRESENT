export interface CanvasUrlState {
  zoom?: number;
  x?: number;
  y?: number;
}

const PARAM_KEY = 'canvas';

export function parseCanvasStateFromUrl(url: string = typeof window !== 'undefined' ? window.location.href : ''): CanvasUrlState {
  try {
    const { searchParams, hash } = new URL(url);
    const param = searchParams.get(PARAM_KEY) ?? hash.slice(1).split('&').find((chunk) => chunk.startsWith(`${PARAM_KEY}=`))?.split('=')[1];
    if (!param) return {};
    const decoded = JSON.parse(decodeURIComponent(param));
    if (typeof decoded !== 'object' || !decoded) return {};
    return decoded as CanvasUrlState;
  } catch {
    return {};
  }
}

export function serializeCanvasStateToUrl(state: CanvasUrlState): string {
  try {
    const encoded = encodeURIComponent(JSON.stringify(state));
    return `${PARAM_KEY}=${encoded}`;
  } catch {
    return '';
  }
}


const players = new Map<string, () => HTMLIFrameElement | null>();
export function registerVideo(id: string, frame: () => HTMLIFrameElement | null) {
  players.set(id, frame);
  return () => { if (players.get(id) === frame) players.delete(id); };
}
export async function controlVideo(input: { id: string; command: string; seconds?: number; rate?: number }) {
  const target = players.get(input.id)?.()?.contentWindow;
  if (!target) return { ready: false, error: 'Player is not mounted in this view. Bring the video into view and retry.' };
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const receive = (event: MessageEvent) => {
      if (event.source !== target || event.origin !== location.origin || event.data?.type !== 'present:video-result' || event.data.requestId !== requestId) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      const { ready, error, blocked, state, seconds, rate } = event.data;
      resolve({ ready, error, blocked, state, seconds, rate, playbackVerified: state === 1, scope: 'listener-browser' });
    };
    const timer = setTimeout(() => { window.removeEventListener('message', receive); resolve({ ready: false, error: 'Player did not respond. Playback is unverified.' }); }, 3500);
    window.addEventListener('message', receive);
    target.postMessage({ type: 'present:video-command', requestId, ...input }, location.origin);
  });
}

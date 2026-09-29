/** Gather candidates before the non-trickle GPT Live SDP exchange. */
export function waitForIceGathering(peer: RTCPeerConnection, signal: AbortSignal, timeoutMs = 10000): Promise<void> {
  signal.throwIfAborted();
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', changed);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const aborted = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new DOMException('Voice network negotiation timed out.', 'TimeoutError')), timeoutMs);
    peer.addEventListener('icegatheringstatechange', changed);
    signal.addEventListener('abort', aborted, { once: true });
    changed();
  });
}

export type AudioInput = { stream: MediaStream; ready: Promise<void>; update: (remote: MediaStream[]) => void; close: () => void };

// Only caller-supplied human streams enter this mix. Never connect the agent's
// output or the speaker destination, and never stop tracks owned by the call.
export function createAudioInput(microphone: MediaStream): AudioInput {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const sources = new Map<string, { track: MediaStreamTrack; source: MediaStreamAudioSourceNode }>();
  const update = (remote: MediaStream[]) => {
    const tracks = new Map([microphone, ...remote].flatMap(stream => stream.getAudioTracks()).filter(track => track.readyState === 'live').map(track => [track.id, track]));
    for (const [id, entry] of sources) if (!tracks.has(id)) { entry.source.disconnect(); sources.delete(id); }
    for (const [id, track] of tracks) {
      if (sources.has(id)) continue;
      const source = context.createMediaStreamSource(new MediaStream([track]));
      source.connect(destination); sources.set(id, { track, source });
    }
  };
  update([]);
  const ready = context.resume();
  return { stream: destination.stream, ready, update, close: () => {
    sources.forEach(({ source }) => { source.disconnect(); }); sources.clear();
    destination.stream.getTracks().forEach(track => { track.stop(); });
    void context.close().catch(() => {});
  } };
}

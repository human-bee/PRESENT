import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAudioInput } from '../src/voice/audio-input';

test('input mix tracks human membership without playing back or stopping call-owned tracks', async () => {
  const originals = { AudioContext: globalThis.AudioContext, MediaStream: globalThis.MediaStream };
  class Track {
    readyState = 'live'; stops = 0;
    constructor(public id: string) {}
    stop() { this.stops++; this.readyState = 'ended'; }
  }
  class Stream {
    constructor(public tracks: Track[]) {}
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks; }
  }
  const outgoing = new Track('voice-output');
  const destination = { stream: new Stream([outgoing]) };
  const nodes: { track: Track; connected: boolean; disconnected: boolean }[] = [];
  let closed = false;
  class Context {
    createMediaStreamDestination() { return destination; }
    createMediaStreamSource(stream: Stream) {
      const entry = { track: stream.tracks[0], connected: false, disconnected: false }; nodes.push(entry);
      return {
        connect(target: unknown) { assert.equal(target, destination); entry.connected = true; },
        disconnect() { entry.disconnected = true; },
      };
    }
    async resume() {}
    async close() { closed = true; }
  }
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  globalThis.MediaStream = Stream as unknown as typeof MediaStream;
  try {
    const mic = new Track('microphone'); const remote = new Track('human-2'); const later = new Track('human-3');
    const asStream = (...tracks: Track[]) => new Stream(tracks) as unknown as MediaStream;
    const input = createAudioInput(asStream(mic)); await input.ready;
    input.update([asStream(remote), asStream(remote)]);
    assert.deepEqual(nodes.map(node => node.track.id), ['microphone', 'human-2']);
    assert.ok(nodes.every(node => node.connected));
    input.update([asStream(later)]);
    assert.equal(nodes[1].disconnected, true);
    assert.deepEqual(nodes.filter(node => !node.disconnected).map(node => node.track.id), ['microphone', 'human-3']);
    input.close();
    assert.equal(closed, true); assert.equal(outgoing.stops, 1);
    assert.deepEqual([mic.stops, remote.stops, later.stops], [0, 0, 0]);
  } finally {
    globalThis.AudioContext = originals.AudioContext; globalThis.MediaStream = originals.MediaStream;
  }
});

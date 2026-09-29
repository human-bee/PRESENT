import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LocalTrack, Room } from 'livekit-client';
import { MediaSession } from '../src/media/media-session';
import { loadLiveKit, resetLiveKitLoaderForTests } from '../src/media/livekit-loader';

if (!globalThis.MediaStream) (globalThis as typeof globalThis & { MediaStream: typeof MediaStream }).MediaStream = class {
  private tracks: MediaStreamTrack[] = [];
  getTracks() { return this.tracks; }
  addTrack(track: MediaStreamTrack) { this.tracks.push(track); }
  removeTrack(track: MediaStreamTrack) { this.tracks = this.tracks.filter((item) => item !== track); }
  getVideoTracks() { return []; }
  getAudioTracks() { return []; }
} as unknown as typeof MediaStream;

// Replace the device/network boundary so lifecycle tests never touch real devices.
type Boundary = { capture: (device: string) => Promise<LocalTrack[]>; join: () => Promise<Room>; room: Room | null; sdk: unknown };
const session = () => new MediaSession('a'.repeat(32), 'human-1', 'Human');

test('creating a media session leaves every device and connection off', () => {
  const media = session();
  assert.deepEqual(media.getSnapshot(), {
    status: 'idle', error: null, mic: false, camera: false, screen: false, participants: [],
  });
  assert.equal((media as unknown as Boundary).room, null);
});

test('listen-only connect reports unsupported WebRTC truthfully', async () => {
  const media = session();
  await media.connect();
  assert.equal(media.getSnapshot().status, 'error');
  assert.match(media.getSnapshot().error ?? '', /WebRTC/);
  assert.equal(media.getSnapshot().mic, false);
});

test('leaving while a permission prompt is pending stops late tracks and never publishes', async () => {
  const media = session();
  const boundary = media as unknown as Boundary;
  let stopped = 0;
  let published = 0;
  let disconnected = 0;
  let resolveCapture!: (tracks: LocalTrack[]) => void;
  const track = { stop: () => { stopped += 1; } } as unknown as LocalTrack;
  const room = {
    remoteParticipants: new Map(),
    localParticipant: { trackPublications: new Map(), getTrackPublication: () => undefined,
      publishTrack: async () => { published += 1; }, unpublishTrack: async () => undefined },
    removeAllListeners: () => undefined,
    disconnect: async () => { disconnected += 1; },
  } as unknown as Room;
  boundary.room = room;
  boundary.sdk = await loadLiveKit();
  boundary.join = async () => room;
  boundary.capture = () => new Promise((resolve) => { resolveCapture = resolve; });
  const pending = media.toggleMic();
  for (let i = 0; i < 200 && !resolveCapture; i++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(resolveCapture);
  media.disconnect();
  resolveCapture([track]);
  await pending;
  assert.equal(stopped, 1);
  assert.equal(published, 0);
  assert.equal(disconnected, 1);
  assert.equal(media.getSnapshot().status, 'idle');
  assert.equal(media.getSnapshot().mic, false);
});

test('screen permission begins in the user gesture and denial does not join the call', async () => {
  const media = session();
  const boundary = media as unknown as Boundary;
  const events: string[] = [];
  boundary.capture = async () => { events.push('capture'); throw new DOMException('Denied', 'NotAllowedError'); };
  boundary.join = async () => { events.push('join'); throw new Error('Must not join'); };
  const pending = media.toggleScreen();
  assert.deepEqual(events, ['capture']);
  await pending;
  assert.deepEqual(events, ['capture']);
  assert.match(media.getSnapshot().error ?? '', /permission was declined/);
  assert.equal(media.getSnapshot().screen, false);
});

test('repeated device presses cannot launch simultaneous capture prompts', async () => {
  const media = session();
  const boundary = media as unknown as Boundary;
  let requests = 0;
  let rejectCapture!: (reason: Error) => void;
  boundary.capture = () => { requests += 1; return new Promise((_, reject) => { rejectCapture = reject; }); };
  const first = media.toggleScreen();
  await media.toggleScreen();
  assert.equal(requests, 1);
  rejectCapture(new DOMException('Denied', 'NotAllowedError'));
  await first;
  assert.equal(media.getSnapshot().screen, false);
});

test('concurrent SDK loads share one resolved module and remain retryable by contract', async () => {
  resetLiveKitLoaderForTests();
  const [first, second] = await Promise.all([loadLiveKit(), loadLiveKit()]);
  assert.equal(first, second);
  resetLiveKitLoaderForTests();
  const retry = await loadLiveKit();
  assert.equal(retry.Room !== undefined, true);
});

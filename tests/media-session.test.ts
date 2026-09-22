import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LocalTrack, Room } from 'livekit-client';
import { MediaSession } from '../src/media/media-session';

// Replace the device/network boundary so lifecycle tests never touch real devices.
type Boundary = { capture: (device: string) => Promise<LocalTrack[]>; join: () => Promise<Room>; room: Room | null };
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
    localParticipant: { trackPublications: new Map(), getTrackPublication: () => undefined,
      publishTrack: async () => { published += 1; }, unpublishTrack: async () => undefined },
    removeAllListeners: () => undefined,
    disconnect: async () => { disconnected += 1; },
  } as unknown as Room;
  boundary.room = room;
  boundary.join = async () => room;
  boundary.capture = () => new Promise((resolve) => { resolveCapture = resolve; });
  const pending = media.toggleMic();
  await Promise.resolve();
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

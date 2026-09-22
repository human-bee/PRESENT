import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { youtubeBridge } from '../server/youtube-bridge';
test('video bridge checks sender and reports actual player state', () => {
  let receive: (event: any) => void = () => {};
  let state = 2, played = 0;
  const results: any[] = [];
  const parent = { postMessage: (value: unknown) => results.push(value) };
  let ready: () => void = () => {};
  const window: any = { addEventListener: (_: string, callback: typeof receive) => { receive = callback; } };
  function Player(this: any, _: string, options: any) {
    ready = options.events.onReady;
    this.getPlayerState = () => state; this.getCurrentTime = () => 12; this.getPlaybackRate = () => 1;
    this.playVideo = () => { played++; state = 1; }; this.pauseVideo = () => { state = 2; };
  }
  runInNewContext(youtubeBridge, { window, parent, location: { origin: 'http://localhost' }, YT: { Player }, setTimeout: (callback: () => void) => callback() });
  window.onYouTubeIframeAPIReady(); ready();
  const data = { type: 'present:video-command', requestId: 'test', command: 'play' };
  receive({ source: {}, origin: 'http://localhost', data });
  receive({ source: parent, origin: 'https://evil.example', data });
  assert.equal(played, 0);
  receive({ source: parent, origin: 'http://localhost', data });
  assert.equal(played, 1); assert.equal(results[0].state, 1); assert.equal(results[0].seconds, 12);
});

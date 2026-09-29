import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { waitForIceGathering } from '../src/voice/ice';

class Peer extends EventTarget {
  iceGatheringState = 'gathering';
  complete() { this.iceGatheringState = 'complete'; this.dispatchEvent(new Event('icegatheringstatechange')); }
  get rtc() { return this as unknown as RTCPeerConnection; }
}
test('ICE negotiation waits for gathered candidates and releases listeners', async () => {
  const peer = new Peer(), controller = new AbortController();
  let finished = false;
  const waiting = waitForIceGathering(peer.rtc, controller.signal).then(() => { finished = true; });
  await Promise.resolve(); assert.equal(finished, false);
  peer.complete(); await waiting;
  assert.equal(finished, true);
  assert.equal(getEventListeners(peer, 'icegatheringstatechange').length, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await waitForIceGathering(peer.rtc, controller.signal);
});
test('ICE negotiation is cancellable, bounded, and never retains a stopped session', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const peer = new Peer(), controller = new AbortController();
  const stopped = waitForIceGathering(peer.rtc, controller.signal);
  controller.abort(); await assert.rejects(stopped, { name: 'AbortError' });
  assert.equal(getEventListeners(peer, 'icegatheringstatechange').length, 0);
  assert.throws(() => waitForIceGathering(peer.rtc, controller.signal), { name: 'AbortError' });
  const next = new AbortController(), timedOut = waitForIceGathering(peer.rtc, next.signal, 50);
  t.mock.timers.tick(50); await assert.rejects(timedOut, { name: 'TimeoutError' });
  assert.equal(getEventListeners(peer, 'icegatheringstatechange').length, 0);
  assert.equal(getEventListeners(next.signal, 'abort').length, 0);
});

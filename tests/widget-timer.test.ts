import assert from 'node:assert/strict';
import test from 'node:test';
import { changeTimer, formatRemaining, readTimer, remainingTime } from '../src/widgets/timer';

test('shared timer follows an absolute clock through pauses, resumes, and late joins', () => {
  const initial = readTimer({ durationMs: 60_000 });
  const started = changeTimer(initial, 'start', 1_000);
  assert.equal(started.endsAt, 61_000);
  assert.equal(remainingTime(started, 11_000), 50_000);
  const paused = changeTimer(started, 'pause', 21_000);
  assert.equal(paused.endsAt, null);
  assert.equal(remainingTime(paused, 100_000), 40_000);
  const resumed = changeTimer(paused, 'start', 100_000);
  assert.equal(resumed.endsAt, 140_000);
  assert.equal(remainingTime(resumed, 139_500), 500);
  assert.equal(remainingTime(resumed, 150_000), 0);
  assert.equal(changeTimer(resumed, 'reset', 150_000).remainingMs, 60_000);
  assert.equal(changeTimer(resumed, 'start', 150_000).endsAt, 210_000);
});

test('timer validates incoming values and rounds display without finishing early', () => {
  assert.deepEqual(readTimer({ durationMs: NaN, remainingMs: Infinity, endsAt: 'invalid' }), { durationMs: 300_000, remainingMs: 300_000, endsAt: null });
  assert.equal(readTimer({ durationMs: -10 }).durationMs, 1000);
  assert.equal(formatRemaining(500), '0:01');
  assert.equal(formatRemaining(0), '0:00');
  assert.equal(formatRemaining(60_001), '1:01');
});

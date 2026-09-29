import assert from 'node:assert/strict';
import test from 'node:test';
import { findOpenPosition } from '../src/tldraw/placement';

test('new widgets retain a clear preferred position and avoid large existing shapes', () => {
  const preferred = { x: 0, y: 0, w: 640, h: 480 };
  assert.deepEqual(findOpenPosition(preferred, []), { x: 0, y: 0 });
  const occupied = [{ x: -1000, y: -1000, w: 2000, h: 2000 }];
  const found = findOpenPosition(preferred, occupied);
  assert.ok(found.x >= 1028 || found.y >= 1028 || found.x + 640 <= -1028 || found.y + 480 <= -1028);
});

test('sprawling mixed-sized canvas places 150 successive widgets without overlap', () => {
  const occupied: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < 150; i++) {
    const size = { w: 240 + i % 4 * 110, h: 180 + i % 3 * 120 };
    const found = { ...findOpenPosition({ x: 0, y: 0, ...size }, occupied), ...size };
    assert.ok(occupied.every(other => found.x + found.w <= other.x || other.x + other.w <= found.x || found.y + found.h <= other.y || other.y + other.h <= found.y));
    occupied.push(found);
  }
  assert.deepEqual(findOpenPosition({ x: 0, y: 0, w: 10, h: 10 }, [{ x: NaN, y: 0, w: 100, h: 100 }]), { x: 0, y: 0 });
});

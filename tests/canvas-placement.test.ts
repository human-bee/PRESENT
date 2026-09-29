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

test('indexed placement agrees with exact candidate search on crowded and extreme canvases', () => {
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 12; trial++) {
    const p = { x: -100, y: 90, w: 640, h: 480 }, gap = 28;
    const boxes = Array.from({ length: 2000 }, (_, i) => trial % 2
      ? { x: (i % 45) * 280 - 3000, y: Math.floor(i / 45) * 220 - 3000, w: 260, h: 200 }
      : { x: random() * 7000 - 3500, y: random() * 7000 - 3500, w: 80 + random() * 600, h: 80 + random() * 400 });
    if (trial % 3 === 0) boxes.push({ x: -8000, y: -8000, w: 16000, h: 16000 });
    boxes.push({ x: 1e100, y: -1e100, w: 400, h: 200 });
    const clear = ({ x, y }: { x: number; y: number }) => boxes.every(b => x + p.w + gap <= b.x || b.x + b.w + gap <= x || y + p.h + gap <= b.y || b.y + b.h + gap <= y);
    const candidates = boxes.flatMap(b => [
      { x: b.x - p.w - gap, y: p.y }, { x: b.x + b.w + gap, y: p.y },
      { x: p.x, y: b.y - p.h - gap }, { x: p.x, y: b.y + b.h + gap },
      { x: b.x - p.w - gap, y: b.y }, { x: b.x + b.w + gap, y: b.y },
      { x: b.x, y: b.y - p.h - gap }, { x: b.x, y: b.y + b.h + gap },
    ]).sort((a, b) => ((a.x - p.x) ** 2 + (a.y - p.y) ** 2) - ((b.x - p.x) ** 2 + (b.y - p.y) ** 2));
    assert.deepEqual(findOpenPosition(p, boxes), clear(p) ? { x: p.x, y: p.y } : candidates.find(clear));
  }
});

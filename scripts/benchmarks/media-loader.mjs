import { performance } from 'node:perf_hooks';

const samples = [];
for (let i = 0; i < 3; i++) await import('../../src/media/livekit-loader.ts');
for (let i = 0; i < 20; i++) {
  const start = performance.now();
  await Promise.all([import('../../src/media/livekit-loader.ts'), import('../../src/media/livekit-loader.ts')]);
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const percentile = (p) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)];
console.log(JSON.stringify({ iterations: samples.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: samples.at(-1), caveat: 'Node module-cache benchmark only; excludes browser network, parse, and permission latency.' }, null, 2));

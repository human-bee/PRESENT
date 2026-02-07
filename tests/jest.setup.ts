import { TextEncoder, TextDecoder } from 'util';
import { webcrypto } from 'crypto';
import { TransformStream, ReadableStream, WritableStream } from 'stream/web';
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder as any;
(global as any).ReadableStream = (global as any).ReadableStream || ReadableStream;
(global as any).TransformStream = (global as any).TransformStream || TransformStream;
(global as any).WritableStream = (global as any).WritableStream || WritableStream;

// Ensure WebCrypto + Web Streams APIs exist in Jest environments (jsdom lacks Node's built-ins).
if (!(globalThis as any).crypto?.subtle || typeof (globalThis as any).crypto?.getRandomValues !== 'function') {
  (globalThis as any).crypto = webcrypto as any;
}
if (typeof (globalThis as any).TransformStream === 'undefined') {
  (globalThis as any).TransformStream = TransformStream as any;
}
if (typeof (globalThis as any).ReadableStream === 'undefined') {
  (globalThis as any).ReadableStream = ReadableStream as any;
}
if (typeof (globalThis as any).WritableStream === 'undefined') {
  (globalThis as any).WritableStream = WritableStream as any;
}

if (typeof window !== 'undefined') {
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => window.setTimeout(cb, 0);
  }
  if (!window.cancelAnimationFrame) {
    window.cancelAnimationFrame = (handle: number): void => {
      window.clearTimeout(handle);
    };
  }
}

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost/supabase';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-key';

// Default tests to demo mode so BYOK-only behavior does not break unrelated unit tests.
// Individual tests can override these to exercise BYOK.
process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE = process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE || 'true';
process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS = process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS || 'true';

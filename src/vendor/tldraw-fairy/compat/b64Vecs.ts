import type { VecModel } from 'tldraw';

// Each point = 3 Float16s = 6 bytes = 8 base64 chars
const POINT_B64_LENGTH = 8;

// O(1) lookup table for base64 decoding (maps char code -> 6-bit value)
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < 64; i++) {
  B64_LOOKUP[BASE64_CHARS.charCodeAt(i)] = i;
}

// Precomputed powers of 2 for Float16 exponents (exp - 15, so indices 0-30 map to 2^-15 to 2^15)
const POW2 = new Float64Array(31);
for (let i = 0; i < 31; i++) {
  POW2[i] = Math.pow(2, i - 15);
}
const POW2_SUBNORMAL = Math.pow(2, -14) / 1024; // For subnormal numbers

// Precomputed mantissa values: 1 + frac/1024 for all 1024 possible frac values
const MANTISSA = new Float64Array(1024);
for (let i = 0; i < 1024; i++) {
  MANTISSA[i] = 1 + i / 1024;
}

function uint16ArrayToBase64(uint16Array: Uint16Array): string {
  const uint8Array = new Uint8Array(uint16Array.buffer, uint16Array.byteOffset, uint16Array.byteLength);
  let result = '';

  // Process bytes in groups of 3 -> 4 base64 chars
  for (let i = 0; i < uint8Array.length; i += 3) {
    const byte1 = uint8Array[i];
    const byte2 = uint8Array[i + 1];
    const byte3 = uint8Array[i + 2];

    const bitmap = (byte1 << 16) | (byte2 << 8) | byte3;
    result +=
      BASE64_CHARS[(bitmap >> 18) & 63] +
      BASE64_CHARS[(bitmap >> 12) & 63] +
      BASE64_CHARS[(bitmap >> 6) & 63] +
      BASE64_CHARS[bitmap & 63];
  }

  return result;
}

function base64ToUint16Array(base64: string): Uint16Array {
  // Calculate exact number of bytes (4 base64 chars = 3 bytes)
  const numBytes = Math.floor((base64.length * 3) / 4);
  const bytes = new Uint8Array(numBytes);
  let byteIndex = 0;

  // Process in groups of 4 base64 characters
  for (let i = 0; i < base64.length; i += 4) {
    const c0 = B64_LOOKUP[base64.charCodeAt(i)];
    const c1 = B64_LOOKUP[base64.charCodeAt(i + 1)];
    const c2 = B64_LOOKUP[base64.charCodeAt(i + 2)];
    const c3 = B64_LOOKUP[base64.charCodeAt(i + 3)];

    const bitmap = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

    bytes[byteIndex++] = (bitmap >> 16) & 255;
    bytes[byteIndex++] = (bitmap >> 8) & 255;
    bytes[byteIndex++] = bitmap & 255;
  }

  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

function float16BitsToNumber(bits: number): number {
  const sign = bits >> 15;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x3ff;

  if (exp === 0) {
    // Subnormal or zero
    return sign ? -frac * POW2_SUBNORMAL : frac * POW2_SUBNORMAL;
  }
  if (exp === 31) {
    // Infinity or NaN
    return frac ? Number.NaN : sign ? -Infinity : Infinity;
  }
  const magnitude = POW2[exp] * MANTISSA[frac];
  return sign ? -magnitude : magnitude;
}

function numberToFloat16Bits(value: number): number {
  if (value === 0) return Object.is(value, -0) ? 0x8000 : 0;
  if (!Number.isFinite(value)) {
    if (Number.isNaN(value)) return 0x7e00;
    return value > 0 ? 0x7c00 : 0xfc00;
  }

  const sign = value < 0 ? 1 : 0;
  value = Math.abs(value);

  const exp = Math.floor(Math.log2(value));
  let expBiased = exp + 15;

  if (expBiased >= 31) {
    return (sign << 15) | 0x7c00;
  }
  if (expBiased <= 0) {
    const frac = Math.round(value * Math.pow(2, 14) * 1024);
    return (sign << 15) | (frac & 0x3ff);
  }

  const mantissa = value / Math.pow(2, exp) - 1;
  let frac = Math.round(mantissa * 1024);

  if (frac >= 1024) {
    frac = 0;
    expBiased++;
    if (expBiased >= 31) {
      return (sign << 15) | 0x7c00;
    }
  }

  return (sign << 15) | (expBiased << 10) | frac;
}

export class b64Vecs {
  static encodePoint(x: number, y: number, z: number): string {
    const xBits = numberToFloat16Bits(x);
    const yBits = numberToFloat16Bits(y);
    const zBits = numberToFloat16Bits(z);

    const b0 = xBits & 0xff;
    const b1 = (xBits >> 8) & 0xff;
    const b2 = yBits & 0xff;
    const b3 = (yBits >> 8) & 0xff;
    const b4 = zBits & 0xff;
    const b5 = (zBits >> 8) & 0xff;

    const bitmap1 = (b0 << 16) | (b1 << 8) | b2;
    const bitmap2 = (b3 << 16) | (b4 << 8) | b5;

    return (
      BASE64_CHARS[(bitmap1 >> 18) & 0x3f] +
      BASE64_CHARS[(bitmap1 >> 12) & 0x3f] +
      BASE64_CHARS[(bitmap1 >> 6) & 0x3f] +
      BASE64_CHARS[bitmap1 & 0x3f] +
      BASE64_CHARS[(bitmap2 >> 18) & 0x3f] +
      BASE64_CHARS[(bitmap2 >> 12) & 0x3f] +
      BASE64_CHARS[(bitmap2 >> 6) & 0x3f] +
      BASE64_CHARS[bitmap2 & 0x3f]
    );
  }

  static encodePoints(points: VecModel[]): string {
    const uint16s = new Uint16Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      uint16s[i * 3] = numberToFloat16Bits(point.x);
      uint16s[i * 3 + 1] = numberToFloat16Bits(point.y);
      uint16s[i * 3 + 2] = numberToFloat16Bits(point.z ?? 0.5);
    }
    return uint16ArrayToBase64(uint16s);
  }

  static decodePoints(base64: string): VecModel[] {
    const uint16s = base64ToUint16Array(base64);
    const result: VecModel[] = [];
    for (let i = 0; i < uint16s.length; i += 3) {
      result.push({
        x: float16BitsToNumber(uint16s[i]),
        y: float16BitsToNumber(uint16s[i + 1]),
        z: float16BitsToNumber(uint16s[i + 2]),
      });
    }
    return result;
  }

  static decodePointAt(b64Points: string, charOffset: number): VecModel {
    const c0 = B64_LOOKUP[b64Points.charCodeAt(charOffset)];
    const c1 = B64_LOOKUP[b64Points.charCodeAt(charOffset + 1)];
    const c2 = B64_LOOKUP[b64Points.charCodeAt(charOffset + 2)];
    const c3 = B64_LOOKUP[b64Points.charCodeAt(charOffset + 3)];
    const c4 = B64_LOOKUP[b64Points.charCodeAt(charOffset + 4)];
    const c5 = B64_LOOKUP[b64Points.charCodeAt(charOffset + 5)];
    const c6 = B64_LOOKUP[b64Points.charCodeAt(charOffset + 6)];
    const c7 = B64_LOOKUP[b64Points.charCodeAt(charOffset + 7)];

    const bitmap1 = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    const bitmap2 = (c4 << 18) | (c5 << 12) | (c6 << 6) | c7;

    const xBits = ((bitmap1 >> 16) & 0xff) | (bitmap1 & 0xff00);
    const yBits = (bitmap1 & 0xff) | ((bitmap2 >> 8) & 0xff00);
    const zBits = ((bitmap2 >> 8) & 0xff) | ((bitmap2 << 8) & 0xff00);

    return {
      x: float16BitsToNumber(xBits),
      y: float16BitsToNumber(yBits),
      z: float16BitsToNumber(zBits),
    };
  }

  static decodeFirstPoint(b64Points: string): VecModel | null {
    if (b64Points.length < POINT_B64_LENGTH) return null;
    return b64Vecs.decodePointAt(b64Points, 0);
  }

  static decodeLastPoint(b64Points: string): VecModel | null {
    if (b64Points.length < POINT_B64_LENGTH) return null;
    return b64Vecs.decodePointAt(b64Points, b64Points.length - POINT_B64_LENGTH);
  }
}

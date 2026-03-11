import {
  bytesToBase64,
  downsampleFloat32,
  encodePcmBase64,
  float32ToPcm16,
} from './audio-command-recorder';

describe('audio command recorder utils', () => {
  it('downsamples float audio deterministically', () => {
    const input = new Float32Array([0, 0.5, 1, 0.5]);
    expect(Array.from(downsampleFloat32(input, 4, 2))).toEqual([0.25, 0.75]);
  });

  it('converts float samples to pcm16 with clamping', () => {
    expect(Array.from(float32ToPcm16(new Float32Array([-2, -1, 0, 1, 2])))).toEqual([
      -32768, -32768, 0, 32767, 32767,
    ]);
  });

  it('encodes merged chunks into base64 pcm output', () => {
    const encoded = encodePcmBase64({
      chunks: [new Float32Array([0, 1]), new Float32Array([-1, 0])],
      inputSampleRate: 16_000,
      targetSampleRate: 16_000,
      startedAt: 0,
      endedAt: 100,
    });

    expect(encoded.sampleRate).toBe(16_000);
    expect(encoded.sampleCount).toBe(4);
    expect(encoded.durationMs).toBeGreaterThan(0);
    expect(encoded.audioBase64).toBe(
      bytesToBase64(new Uint8Array(float32ToPcm16(new Float32Array([0, 1, -1, 0])).buffer)),
    );
  });

  it('preserves the true sample rate when the input device is below 16 kHz', () => {
    const encoded = encodePcmBase64({
      chunks: [new Float32Array([0, 0.5, -0.5, 0])],
      inputSampleRate: 8_000,
      targetSampleRate: 16_000,
      startedAt: 0,
      endedAt: 100,
    });

    expect(encoded.sampleRate).toBe(8_000);
    expect(encoded.sampleCount).toBe(4);
  });
});

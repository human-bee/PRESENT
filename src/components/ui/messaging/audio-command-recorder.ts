export type RecordedCommandAudio = {
  audioBase64: string;
  sampleRate: number;
  durationMs: number;
  sampleCount: number;
};

type RecorderInternals = {
  stream: MediaStream | null;
  audioContext: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  processor: ScriptProcessorNode | null;
  chunks: Float32Array[];
  startedAt: number;
  inputSampleRate: number;
  generation: number;
};

const TARGET_SAMPLE_RATE = 16_000;

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function downsampleFloat32(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = TARGET_SAMPLE_RATE,
): Float32Array {
  if (!input.length) return new Float32Array(0);
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new Error('Invalid input sample rate');
  }
  if (!Number.isFinite(targetSampleRate) || targetSampleRate <= 0) {
    throw new Error('Invalid target sample rate');
  }
  if (targetSampleRate >= inputSampleRate) {
    return input;
  }

  const sampleRateRatio = inputSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / sampleRateRatio));
  const output = new Float32Array(outputLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < outputLength) {
    const nextOffsetBuffer = Math.min(
      input.length,
      Math.round((offsetResult + 1) * sampleRateRatio),
    );
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i += 1) {
      accum += input[i];
      count += 1;
    }
    output[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return output;
}

export function float32ToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return output;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  throw new Error('Base64 encoding is unavailable in this environment');
}

export function encodePcmBase64(input: {
  chunks: Float32Array[];
  inputSampleRate: number;
  targetSampleRate?: number;
  startedAt?: number;
  endedAt?: number;
}): RecordedCommandAudio {
  const merged = mergeChunks(input.chunks);
  const requestedSampleRate = input.targetSampleRate ?? TARGET_SAMPLE_RATE;
  const sampleRate =
    requestedSampleRate >= input.inputSampleRate
      ? Math.round(input.inputSampleRate)
      : requestedSampleRate;
  const downsampled = downsampleFloat32(merged, input.inputSampleRate, requestedSampleRate);
  const pcm = float32ToPcm16(downsampled);
  const bytes = new Uint8Array(pcm.buffer);
  const durationFromSamples = (downsampled.length / sampleRate) * 1000;
  const durationFromClock =
    Number.isFinite(input.startedAt) && Number.isFinite(input.endedAt)
      ? Math.max(0, (input.endedAt as number) - (input.startedAt as number))
      : 0;

  return {
    audioBase64: bytesToBase64(bytes),
    sampleRate,
    durationMs: Math.max(durationFromSamples, durationFromClock),
    sampleCount: downsampled.length,
  };
}

export function createAudioCommandRecorder(targetSampleRate = TARGET_SAMPLE_RATE) {
  const state: RecorderInternals = {
    stream: null,
    audioContext: null,
    source: null,
    processor: null,
    chunks: [],
    startedAt: 0,
    inputSampleRate: targetSampleRate,
    generation: 0,
  };

  const cleanup = async () => {
    state.processor?.disconnect();
    state.source?.disconnect();
    state.stream?.getTracks().forEach((track) => track.stop());
    if (state.audioContext) {
      try {
        await state.audioContext.close();
      } catch {
        // ignore close failures
      }
    }
    state.stream = null;
    state.audioContext = null;
    state.source = null;
    state.processor = null;
  };

  return {
    async start(): Promise<boolean> {
      if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone capture is unavailable in this browser');
      }

      await cleanup();
      const generation = state.generation + 1;
      state.generation = generation;

      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('AudioContext is unavailable in this browser');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });

      if (state.generation !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      state.stream = stream;
      state.audioContext = audioContext;
      state.source = source;
      state.processor = processor;
      state.chunks = [];
      state.startedAt = Date.now();
      state.inputSampleRate = audioContext.sampleRate;

      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        state.chunks.push(new Float32Array(channel));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      return true;
    },

    async stop(): Promise<RecordedCommandAudio | null> {
      const endedAt = Date.now();
      state.generation += 1;
      const capturedChunks = state.chunks.slice();
      const inputSampleRate = state.inputSampleRate;
      const startedAt = state.startedAt;
      await cleanup();
      state.chunks = [];
      state.startedAt = 0;

      if (!capturedChunks.length) {
        return null;
      }

      return encodePcmBase64({
        chunks: capturedChunks,
        inputSampleRate,
        targetSampleRate,
        startedAt,
        endedAt,
      });
    },

    async cancel() {
      state.generation += 1;
      state.chunks = [];
      state.startedAt = 0;
      await cleanup();
    },
  };
}

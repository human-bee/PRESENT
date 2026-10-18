import type { SessionUpdateEvent } from 'openai/resources/realtime/realtime';

type Socket = {
  readyState: number;
  on: (event: string, callback: (data?: unknown) => void) => unknown;
  send: (data: string) => void;
  close: () => void;
};
type Pending = { id: string; endedAt: number; resolve: (value: AudioTranscript) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };
export type AudioTranscript = { id: string; text: string; endedAt: number; completedAt: number };
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function pcmFromWave(bytes: Buffer) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected a WAV file.');
  let validFormat = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (kind === 'fmt ' && length >= 16 && start + 16 <= bytes.length) {
      validFormat = bytes.readUInt16LE(start) === 1 && bytes.readUInt16LE(start + 2) === 1
        && bytes.readUInt32LE(start + 4) === 24000 && bytes.readUInt16LE(start + 14) === 16;
    }
    if (kind === 'data') {
      if (!validFormat || start + length > bytes.length) throw new Error('Expected complete mono, 24 kHz, 16-bit PCM.');
      return bytes.subarray(start, start + length);
    }
    offset = start + length + (length % 2);
  }
  throw new Error('The WAV file has no PCM audio.');
}

// Audio bytes are the only utterance input. The source script never enters this session.
export class InterviewAudioStream {
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private commits: Pending[] = [];
  private items = new Map<string, Pending>();
  private stopped = false;
  private startup: ReturnType<typeof setTimeout>;
  constructor(private socket: Socket, model = 'gpt-4o-mini-transcribe') {
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.startup = setTimeout(() => this.fail('Realtime transcription did not become ready.'), 20000);
    const configure = () => {
      const event: SessionUpdateEvent = { type: 'session.update', session: {
        type: 'transcription', audio: { input: {
          format: { type: 'audio/pcm', rate: 24000 }, transcription: { model, language: 'en' }, turn_detection: null,
        } },
      } };
      this.send(event);
    };
    socket.on('open', configure);
    socket.on('message', (data) => {
      try { this.receive(JSON.parse(String(data))); } catch { this.fail('Realtime transcription returned an invalid event.'); }
    });
    socket.on('error', () => this.fail('The Realtime transcription connection failed.'));
    socket.on('close', () => this.fail('The Realtime transcription connection closed.'));
    if (socket.readyState === 1) configure();
  }
  private send(event: object) {
    if (this.stopped) throw new Error('The transcription session is closed.');
    this.socket.send(JSON.stringify(event));
  }
  private receive(event: { type?: string; item_id?: string; transcript?: string }) {
    if (event.type === 'session.updated') { clearTimeout(this.startup); this.resolveReady(); }
    if (event.type === 'error') this.fail('The Realtime service rejected the transcription session.');
    if (event.type === 'input_audio_buffer.committed' && event.item_id) {
      const pending = this.commits.shift();
      if (pending) this.items.set(event.item_id, pending);
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed' && event.item_id) {
      const pending = this.items.get(event.item_id);
      if (!pending) return;
      this.items.delete(event.item_id); clearTimeout(pending.timer);
      if (!event.transcript?.trim()) pending.reject(new Error('The transcription was empty.'));
      else pending.resolve({ id: pending.id, text: event.transcript.trim(), endedAt: pending.endedAt, completedAt: Date.now() });
    }
    if (event.type === 'conversation.item.input_audio_transcription.failed') this.fail('A Realtime audio transcription failed.');
  }
  async transcribe(id: string, pcm: Buffer, paced = true): Promise<AudioTranscript> {
    await this.ready;
    if (pcm.length < 4800 || pcm.length % 2) throw new Error('Expected at least 100 ms of 16-bit PCM.');
    const start = performance.now();
    for (let offset = 0; offset < pcm.length; offset += 4800) {
      const chunk = pcm.subarray(offset, offset + 4800);
      this.send({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') });
      if (paced) await wait((offset + chunk.length) / 48 - (performance.now() - start));
    }
    return new Promise((resolve, reject) => {
      const pending: Pending = { id, endedAt: Date.now(), resolve, reject };
      pending.timer = setTimeout(() => { this.fail('A Realtime transcription exceeded the response timeout.'); }, 30000);
      this.commits.push(pending);
      try { this.send({ type: 'input_audio_buffer.commit' }); } catch (error) { this.fail(error instanceof Error ? error.message : 'Could not commit audio.'); }
    });
  }
  private fail(message: string) {
    if (this.stopped) return;
    this.stopped = true; clearTimeout(this.startup);
    const failure = new Error(message);
    this.rejectReady(failure);
    for (const pending of [...this.commits, ...this.items.values()]) { clearTimeout(pending.timer); pending.reject(failure); }
    this.commits = []; this.items.clear(); this.socket.close();
  }
  close() { this.fail('The transcription session was stopped.'); }
}

import { TranscriptionBuffer, type PendingTranscriptionMessage } from '../transcription-buffer';

const makeMessage = (text: string): PendingTranscriptionMessage => ({
  text,
  isManual: false,
  isFinal: true,
  receivedAt: Date.now(),
});

describe('TranscriptionBuffer', () => {
  it('queues entries and drains in order when enabled', async () => {
    const buffer = new TranscriptionBuffer(10, 30_000);
    buffer.enqueue(makeMessage('one'));
    buffer.enqueue(makeMessage('two'));
    buffer.setEnabled(true);

    const seen: string[] = [];
    await buffer.drain(async (message) => {
      seen.push(message.text);
    });

    expect(seen).toEqual(['one', 'two']);
    expect(buffer.size()).toBe(0);
  });
});

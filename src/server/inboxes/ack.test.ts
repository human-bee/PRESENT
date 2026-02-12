import { clearAcks, getAck, recordAck } from '@/server/inboxes/ack';

describe('ack inbox', () => {
  afterEach(() => {
    clearAcks();
  });

  test('records and retrieves ack entries', () => {
    recordAck('session-a', 1, 'client-a', 1000, { envelopeHash: 'hash-a' });
    expect(getAck('session-a', 1)).toMatchObject({
      seq: 1,
      clientId: 'client-a',
      ts: 1000,
      envelopeHash: 'hash-a',
    });
  });

  test('replaces stale ack record when newer hash arrives for same seq', () => {
    recordAck('session-a', 2, 'client-a', 1000, { envelopeHash: 'hash-old' });
    recordAck('session-a', 2, 'client-a', 1100, { envelopeHash: 'hash-new' });

    expect(getAck('session-a', 2)).toMatchObject({
      seq: 2,
      envelopeHash: 'hash-new',
      ts: 1100,
    });
  });

  test('does not replace latest ack with an older mismatched hash', () => {
    recordAck('session-a', 3, 'client-a', 1100, { envelopeHash: 'hash-new' });
    recordAck('session-a', 3, 'client-a', 1000, { envelopeHash: 'hash-old' });

    expect(getAck('session-a', 3)).toMatchObject({
      seq: 3,
      envelopeHash: 'hash-new',
      ts: 1100,
    });
  });
});

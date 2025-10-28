import { saveViewportSelection, getLatestViewportSelection, gcViewportEntries } from './viewport';

describe('viewport inbox', () => {
  const roomId = 'room-A';
  const sessionId = 'sess-1';
  const entry = {
    roomId,
    sessionId,
    viewport: { x: 10, y: 20, w: 100, h: 80 },
    selection: ['a', 'b'],
    ts: Date.now(),
  };

  afterEach(() => {
    gcViewportEntries();
  });

  it('stores and returns latest entry', async () => {
    await saveViewportSelection(entry);
    const got = await getLatestViewportSelection(roomId, sessionId);
    expect(got?.viewport).toEqual(entry.viewport);
    expect(got?.selection).toEqual(entry.selection);
  });

  it('gc removes old entries', async () => {
    await saveViewportSelection({ ...entry, ts: Date.now() - 60_000 });
    gcViewportEntries();
    const got = await getLatestViewportSelection(roomId, sessionId);
    expect(got).toBeNull();
  });
});


import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import {
  getCollaborationDocument,
  resetCollaborationDocumentsForTests,
  upsertCollaborationDocument,
} from './collaboration-docs';

describe('collaboration docs', () => {
  beforeEach(() => {
    process.env.PRESENT_RESET_COLLABORATION_PATH = path.join(
      os.tmpdir(),
      `present-reset-collaboration-${Date.now()}-${Math.random()}.json`,
    );
    resetCollaborationDocumentsForTests();
  });

  afterEach(() => {
    resetCollaborationDocumentsForTests();
    delete process.env.PRESENT_RESET_COLLABORATION_PATH;
  });

  const encodeDoc = (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');

  it('stores the shared document state and collaborator roster', async () => {
    const doc = new Y.Doc();
    doc.getText('source').insert(0, 'first');

    const initial = await upsertCollaborationDocument({
      workspaceSessionId: 'ws_123',
      filePath: 'README.md',
      sourceUpdatedAt: '2026-03-11T00:00:00.000Z',
      encodedState: encodeDoc(doc),
      identity: 'operator-1',
      displayName: 'Mission One',
    });

    doc.getText('source').insert(doc.getText('source').length, ' second');
    const next = await upsertCollaborationDocument({
      workspaceSessionId: 'ws_123',
      filePath: 'README.md',
      sourceUpdatedAt: '2026-03-11T00:00:00.000Z',
      encodedState: encodeDoc(doc),
      identity: 'operator-2',
      displayName: 'Mission Two',
    });

    const stored = await getCollaborationDocument('ws_123', 'README.md', '2026-03-11T00:00:00.000Z');
    const recovered = new Y.Doc();
    Y.applyUpdate(recovered, Uint8Array.from(Buffer.from(stored?.encodedState ?? '', 'base64')));

    expect(initial.version).toBe(1);
    expect(next.version).toBe(2);
    expect(recovered.getText('source').toString()).toBe('first second');
    expect(stored?.collaborators.map((collaborator) => collaborator.displayName)).toEqual(
      expect.arrayContaining(['Mission One', 'Mission Two']),
    );
  });

  it('merges concurrent Yjs updates instead of dropping earlier edits', async () => {
    const base = new Y.Doc();
    base.getText('source').insert(0, 'Hello');
    const baseUpdate = Y.encodeStateAsUpdate(base);

    const left = new Y.Doc();
    Y.applyUpdate(left, baseUpdate);
    left.getText('source').insert(0, 'A');

    const right = new Y.Doc();
    Y.applyUpdate(right, baseUpdate);
    right.getText('source').insert(right.getText('source').length, 'B');

    await upsertCollaborationDocument({
      workspaceSessionId: 'ws_merge',
      filePath: 'README.md',
      sourceUpdatedAt: '2026-03-11T01:00:00.000Z',
      encodedState: encodeDoc(left),
      identity: 'operator-left',
      displayName: 'Mission Left',
    });

    await upsertCollaborationDocument({
      workspaceSessionId: 'ws_merge',
      filePath: 'README.md',
      sourceUpdatedAt: '2026-03-11T01:00:00.000Z',
      encodedState: encodeDoc(right),
      identity: 'operator-right',
      displayName: 'Mission Right',
    });

    const stored = await getCollaborationDocument('ws_merge', 'README.md', '2026-03-11T01:00:00.000Z');
    const merged = new Y.Doc();
    Y.applyUpdate(merged, Uint8Array.from(Buffer.from(stored?.encodedState ?? '', 'base64')));

    expect(merged.getText('source').toString()).toBe('AHelloB');
  });

  it('resets stale collaboration state when the backing file revision changes', async () => {
    const original = new Y.Doc();
    original.getText('source').insert(0, 'before');

    await upsertCollaborationDocument({
      workspaceSessionId: 'ws_reset',
      filePath: 'README.md',
      sourceUpdatedAt: '2026-03-11T02:00:00.000Z',
      encodedState: encodeDoc(original),
      identity: 'operator-1',
      displayName: 'Mission One',
    });

    await expect(
      getCollaborationDocument('ws_reset', 'README.md', '2026-03-11T03:00:00.000Z'),
    ).resolves.toBeNull();

    const replacement = new Y.Doc();
    replacement.getText('source').insert(0, 'after');

    const next = await upsertCollaborationDocument({
      workspaceSessionId: 'ws_reset',
      filePath: 'README.md',
      sourceUpdatedAt: '2026-03-11T03:00:00.000Z',
      encodedState: encodeDoc(replacement),
      identity: 'operator-2',
      displayName: 'Mission Two',
    });

    const stored = await getCollaborationDocument('ws_reset', 'README.md', '2026-03-11T03:00:00.000Z');
    const recovered = new Y.Doc();
    Y.applyUpdate(recovered, Uint8Array.from(Buffer.from(stored?.encodedState ?? '', 'base64')));

    expect(next.version).toBe(1);
    expect(recovered.getText('source').toString()).toBe('after');
    expect(stored?.collaborators.map((collaborator) => collaborator.displayName)).toEqual(['Mission Two']);
  });

  it('boots a single canonical seed when multiple operators open the file at once', async () => {
    const [first, second] = await Promise.all([
      upsertCollaborationDocument({
        workspaceSessionId: 'ws_seed',
        filePath: 'README.md',
        sourceUpdatedAt: '2026-03-11T04:00:00.000Z',
        encodedState: '',
        seedContent: 'hello reset',
        identity: 'operator-1',
        displayName: 'Mission One',
      }),
      upsertCollaborationDocument({
        workspaceSessionId: 'ws_seed',
        filePath: 'README.md',
        sourceUpdatedAt: '2026-03-11T04:00:00.000Z',
        encodedState: '',
        seedContent: 'hello reset',
        identity: 'operator-2',
        displayName: 'Mission Two',
      }),
    ]);

    const stored = await getCollaborationDocument('ws_seed', 'README.md', '2026-03-11T04:00:00.000Z');
    const recovered = new Y.Doc();
    Y.applyUpdate(recovered, Uint8Array.from(Buffer.from(stored?.encodedState ?? '', 'base64')));

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(recovered.getText('source').toString()).toBe('hello reset');
    expect(stored?.collaborators.map((collaborator) => collaborator.displayName)).toEqual(
      expect.arrayContaining(['Mission One', 'Mission Two']),
    );
  });
});

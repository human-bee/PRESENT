import os from 'node:os';
import path from 'node:path';
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

  it('stores the shared document state and collaborator roster', () => {
    const initial = upsertCollaborationDocument({
      workspaceSessionId: 'ws_123',
      filePath: 'README.md',
      encodedState: 'Zmlyc3Q=',
      identity: 'operator-1',
      displayName: 'Mission One',
    });

    const next = upsertCollaborationDocument({
      workspaceSessionId: 'ws_123',
      filePath: 'README.md',
      encodedState: 'c2Vjb25k',
      identity: 'operator-2',
      displayName: 'Mission Two',
    });

    const stored = getCollaborationDocument('ws_123', 'README.md');

    expect(initial.version).toBe(1);
    expect(next.version).toBe(2);
    expect(stored?.encodedState).toBe('c2Vjb25k');
    expect(stored?.collaborators.map((collaborator) => collaborator.displayName)).toEqual(
      expect.arrayContaining(['Mission One', 'Mission Two']),
    );
  });
});

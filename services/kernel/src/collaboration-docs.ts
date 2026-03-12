import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { z } from 'zod';

const collaboratorSchema = z.object({
  identity: z.string().min(1),
  displayName: z.string().min(1),
  updatedAt: z.string().min(1),
});

const collaborationDocumentSchema = z.object({
  workspaceSessionId: z.string().min(1),
  filePath: z.string().min(1),
  sourceUpdatedAt: z.string().nullable().default(null),
  encodedState: z.string().default(''),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
  collaborators: z.array(collaboratorSchema).default([]),
});

const collaborationStoreSchema = z.object({
  schemaVersion: z.literal(1),
  documents: z.record(z.string(), collaborationDocumentSchema).default({}),
});

export type CollaborationDocument = z.infer<typeof collaborationDocumentSchema>;

const COLLABORATOR_TTL_MS = 30_000;
let storeLock: Promise<void> = Promise.resolve();

const getStorePath = () =>
  process.env.PRESENT_RESET_COLLABORATION_PATH ??
  path.join(process.cwd(), '.tmp', 'present-reset-collaboration.json');

const ensureParentDirectory = (storePath: string) => {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
};

const createDefaultStore = () => ({
  schemaVersion: 1 as const,
  documents: {},
});

const readStore = () => {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return createDefaultStore();
  }

  try {
    const text = fs.readFileSync(storePath, 'utf8');
    if (!text.trim()) {
      return createDefaultStore();
    }
    return collaborationStoreSchema.parse(JSON.parse(text));
  } catch {
    return createDefaultStore();
  }
};

const writeStore = (store: z.infer<typeof collaborationStoreSchema>) => {
  const storePath = getStorePath();
  ensureParentDirectory(storePath);
  fs.writeFileSync(storePath, JSON.stringify(collaborationStoreSchema.parse(store), null, 2), 'utf8');
};

const withStoreLock = async <T>(operation: () => T | Promise<T>) => {
  const previousLock = storeLock;
  let releaseLock = () => {};
  storeLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  await previousLock;
  try {
    return await operation();
  } finally {
    releaseLock();
  }
};

const buildDocumentKey = (workspaceSessionId: string, filePath: string) =>
  `${workspaceSessionId}:${filePath}`;

const pruneCollaborators = (collaborators: CollaborationDocument['collaborators']) => {
  const cutoff = Date.now() - COLLABORATOR_TTL_MS;
  return collaborators.filter((collaborator) => Date.parse(collaborator.updatedAt) >= cutoff);
};

const decodeUpdate = (encodedState: string) => Uint8Array.from(Buffer.from(encodedState, 'base64'));

const encodeUpdate = (update: Uint8Array) => Buffer.from(update).toString('base64');

const createSeededEncodedState = (seedContent: string) => {
  const doc = new Y.Doc();
  if (seedContent) {
    doc.getText('source').insert(0, seedContent);
  }
  return encodeUpdate(Y.encodeStateAsUpdate(doc));
};

const mergeEncodedStates = (previousState: string | undefined, incomingState: string) => {
  if (!previousState) {
    return incomingState;
  }

  try {
    return encodeUpdate(Y.mergeUpdates([decodeUpdate(previousState), decodeUpdate(incomingState)]));
  } catch {
    return incomingState;
  }
};

const shouldResetForSourceVersion = (
  document: CollaborationDocument | undefined,
  sourceUpdatedAt: string | null | undefined,
) => Boolean(sourceUpdatedAt && document && document.sourceUpdatedAt !== sourceUpdatedAt);

const resolveNextEncodedState = (input: {
  previousState?: string;
  incomingState: string;
  seedContent?: string;
}) => {
  if (!input.previousState) {
    if (input.incomingState) {
      return input.incomingState;
    }
    return createSeededEncodedState(input.seedContent ?? '');
  }

  if (!input.incomingState) {
    return input.previousState;
  }

  return mergeEncodedStates(input.previousState, input.incomingState);
};

export async function getCollaborationDocument(
  workspaceSessionId: string,
  filePath: string,
  sourceUpdatedAt?: string | null,
) {
  return withStoreLock(() => {
    const store = readStore();
    const key = buildDocumentKey(workspaceSessionId, filePath);
    const document = store.documents[key];
    if (shouldResetForSourceVersion(document, sourceUpdatedAt)) {
      delete store.documents[key];
      writeStore(store);
      return null;
    }
    if (!document) return null;
    const parsed = collaborationDocumentSchema.parse({
      ...document,
      collaborators: pruneCollaborators(document.collaborators),
    });
    store.documents[key] = parsed;
    writeStore(store);
    return parsed;
  });
}

export async function upsertCollaborationDocument(input: {
  workspaceSessionId: string;
  filePath: string;
  sourceUpdatedAt?: string | null;
  encodedState: string;
  identity: string;
  displayName: string;
  seedContent?: string;
}) {
  return withStoreLock(() => {
    const store = readStore();
    const key = buildDocumentKey(input.workspaceSessionId, input.filePath);
    const now = new Date().toISOString();
    const previous = shouldResetForSourceVersion(store.documents[key], input.sourceUpdatedAt)
      ? undefined
      : store.documents[key];
    const collaborators = pruneCollaborators(previous?.collaborators ?? []).filter(
      (collaborator) => collaborator.identity !== input.identity,
    );

    const document = collaborationDocumentSchema.parse({
      workspaceSessionId: input.workspaceSessionId,
      filePath: input.filePath,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      encodedState: resolveNextEncodedState({
        previousState: previous?.encodedState,
        incomingState: input.encodedState,
        seedContent: input.seedContent,
      }),
      version: (previous?.version ?? 0) + 1,
      updatedAt: now,
      collaborators: [
        ...collaborators,
        {
          identity: input.identity,
          displayName: input.displayName,
          updatedAt: now,
        },
      ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    });

    store.documents[key] = document;
    writeStore(store);
    return document;
  });
}

export function resetCollaborationDocumentsForTests() {
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    fs.rmSync(storePath, { force: true });
  }
  storeLock = Promise.resolve();
}

export function getCollaborationDocumentStorePath() {
  return getStorePath();
}

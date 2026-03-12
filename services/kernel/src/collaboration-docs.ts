import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const collaboratorSchema = z.object({
  identity: z.string().min(1),
  displayName: z.string().min(1),
  updatedAt: z.string().min(1),
});

const collaborationDocumentSchema = z.object({
  workspaceSessionId: z.string().min(1),
  filePath: z.string().min(1),
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

const buildDocumentKey = (workspaceSessionId: string, filePath: string) =>
  `${workspaceSessionId}:${filePath}`;

const pruneCollaborators = (collaborators: CollaborationDocument['collaborators']) => {
  const cutoff = Date.now() - COLLABORATOR_TTL_MS;
  return collaborators.filter((collaborator) => Date.parse(collaborator.updatedAt) >= cutoff);
};

export function getCollaborationDocument(workspaceSessionId: string, filePath: string) {
  const store = readStore();
  const key = buildDocumentKey(workspaceSessionId, filePath);
  const document = store.documents[key];
  if (!document) return null;
  const parsed = collaborationDocumentSchema.parse({
    ...document,
    collaborators: pruneCollaborators(document.collaborators),
  });
  store.documents[key] = parsed;
  writeStore(store);
  return parsed;
}

export function upsertCollaborationDocument(input: {
  workspaceSessionId: string;
  filePath: string;
  encodedState: string;
  identity: string;
  displayName: string;
}) {
  const store = readStore();
  const key = buildDocumentKey(input.workspaceSessionId, input.filePath);
  const now = new Date().toISOString();
  const previous = store.documents[key];
  const collaborators = pruneCollaborators(previous?.collaborators ?? []).filter(
    (collaborator) => collaborator.identity !== input.identity,
  );

  const document = collaborationDocumentSchema.parse({
    workspaceSessionId: input.workspaceSessionId,
    filePath: input.filePath,
    encodedState: input.encodedState,
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
}

export function resetCollaborationDocumentsForTests() {
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    fs.rmSync(storePath, { force: true });
  }
}

export function getCollaborationDocumentStorePath() {
  return getStorePath();
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  workspaceFileDocumentSchema,
  workspaceFileEntrySchema,
  type WorkspaceFileDocument,
  type WorkspaceFileEntry,
} from '@present/contracts';
import { createArtifact } from './artifacts';
import { getWorkspaceSession } from './workspace-sessions';

const DIRECTORY_IGNORE = new Set([
  '.git',
  '.next',
  '.turbo',
  '.tmp',
  'coverage',
  'dist',
  'node_modules',
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.cjs': 'javascript',
  '.css': 'css',
  '.html': 'html',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascript',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.sql': 'sql',
  '.svg': 'xml',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.txt': 'plaintext',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

const ensureWorkspacePath = (workspaceSessionId: string) => {
  const workspace = getWorkspaceSession(workspaceSessionId);
  if (!workspace) {
    throw new Error('Workspace session not found');
  }
  return workspace.workspacePath;
};

const normalizeRelativePath = (value?: string | null) => {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed === '.') return '';
  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.') return '';
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Path must stay within the workspace root');
  }
  return normalized;
};

const resolveWorkspaceFilePath = (workspaceSessionId: string, relativePath?: string | null) => {
  const workspaceRoot = ensureWorkspacePath(workspaceSessionId);
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(workspaceRoot, normalizedRelativePath);
  const relative = path.relative(workspaceRoot, absolutePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Path must stay within the workspace root');
  }
  return {
    workspaceRoot,
    absolutePath,
    relativePath: normalizedRelativePath,
  };
};

const inferLanguage = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
};

export function listWorkspaceFiles(input: {
  workspaceSessionId: string;
  directoryPath?: string | null;
  limit?: number;
}) {
  const { absolutePath, relativePath } = resolveWorkspaceFilePath(input.workspaceSessionId, input.directoryPath);
  const stats = fs.statSync(absolutePath, { throwIfNoEntry: false });
  if (!stats) {
    throw new Error('Directory not found');
  }
  if (!stats.isDirectory()) {
    throw new Error('Path is not a directory');
  }

  const entries = fs
    .readdirSync(absolutePath, { withFileTypes: true })
    .filter((entry) => !DIRECTORY_IGNORE.has(entry.name))
    .map((entry) => {
      const nextRelativePath = path.posix.join(relativePath, entry.name).replace(/^\/+/, '');
      const nextAbsolutePath = path.join(absolutePath, entry.name);
      const nextStats = fs.statSync(nextAbsolutePath, { throwIfNoEntry: false });
      return workspaceFileEntrySchema.parse({
        path: nextRelativePath,
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file',
        size: nextStats?.isFile() ? nextStats.size : null,
        updatedAt: nextStats ? new Date(nextStats.mtimeMs).toISOString() : null,
        language: entry.isFile() ? inferLanguage(entry.name) : null,
      });
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });

  return entries.slice(0, input.limit ?? 200);
}

export function readWorkspaceFile(input: {
  workspaceSessionId: string;
  filePath: string;
}) {
  const { absolutePath, relativePath } = resolveWorkspaceFilePath(input.workspaceSessionId, input.filePath);
  const stats = fs.statSync(absolutePath, { throwIfNoEntry: false });
  if (!stats) {
    throw new Error('File not found');
  }
  if (!stats.isFile()) {
    throw new Error('Path is not a file');
  }

  return workspaceFileDocumentSchema.parse({
    path: relativePath,
    name: path.basename(relativePath),
    kind: 'file',
    size: stats.size,
    updatedAt: new Date(stats.mtimeMs).toISOString(),
    language: inferLanguage(relativePath),
    content: fs.readFileSync(absolutePath, 'utf8'),
  });
}

const buildUnifiedPatch = (targetPath: string, previousContent: string, nextContent: string) => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'present-reset-patch-'));
  const previousPath = path.join(tempDirectory, 'previous');
  const nextPath = path.join(tempDirectory, 'next');
  fs.writeFileSync(previousPath, previousContent, 'utf8');
  fs.writeFileSync(nextPath, nextContent, 'utf8');

  try {
    return execFileSync(
      'diff',
      ['-u', '--label', `a/${targetPath}`, '--label', `b/${targetPath}`, previousPath, nextPath],
      { encoding: 'utf8' },
    );
  } catch (error) {
    const stdoutValue =
      typeof error === 'object' && error !== null && 'stdout' in error
        ? (error as { stdout?: string | Buffer }).stdout
        : undefined;
    const stdout =
      typeof stdoutValue === 'string'
        ? stdoutValue
        : Buffer.isBuffer(stdoutValue)
          ? stdoutValue.toString('utf8')
          : '';
    if (stdout.trim()) {
      return stdout;
    }
    throw error;
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
};

export function createWorkspacePatchArtifact(input: {
  workspaceSessionId: string;
  filePath: string;
  nextContent: string;
  traceId?: string | null;
  title?: string;
  metadata?: Record<string, unknown>;
}) {
  const currentDocument = readWorkspaceFile({
    workspaceSessionId: input.workspaceSessionId,
    filePath: input.filePath,
  });

  if (currentDocument.content === input.nextContent) {
    throw new Error('No file changes to capture');
  }

  const patch = buildUnifiedPatch(currentDocument.path, currentDocument.content, input.nextContent);
  return createArtifact({
    workspaceSessionId: input.workspaceSessionId,
    traceId: input.traceId ?? null,
    kind: 'file_patch',
    title: input.title ?? `Patch ${currentDocument.path}`,
    mimeType: 'text/x-diff',
    content: patch,
    metadata: {
      filePath: currentDocument.path,
      language: currentDocument.language,
      previousSize: currentDocument.size,
      nextSize: input.nextContent.length,
      ...input.metadata,
    },
  });
}

export function writeWorkspaceFile(input: {
  workspaceSessionId: string;
  filePath: string;
  content: string;
}) {
  const { absolutePath, relativePath } = resolveWorkspaceFilePath(input.workspaceSessionId, input.filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, input.content, 'utf8');
  return readWorkspaceFile({ workspaceSessionId: input.workspaceSessionId, filePath: relativePath });
}

export function listWorkspaceFileBreadcrumbs(filePath: string): WorkspaceFileEntry[] {
  const normalized = normalizeRelativePath(filePath);
  if (!normalized) return [];

  const segments = normalized.split('/');
  return segments.map((segment, index) =>
    workspaceFileEntrySchema.parse({
      path: segments.slice(0, index + 1).join('/'),
      name: segment,
      kind: index === segments.length - 1 ? 'file' : 'directory',
      size: null,
      updatedAt: null,
      language: index === segments.length - 1 ? inferLanguage(segment) : null,
    }),
  );
}

export type { WorkspaceFileDocument, WorkspaceFileEntry };

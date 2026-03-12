'use client';

import Editor from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

type SyncStatus = 'connecting' | 'synced' | 'offline' | 'error';

type CollaborationSnapshot = {
  document: {
    encodedState: string;
    version: number;
    collaborators: Array<{
      identity: string;
      displayName: string;
      updatedAt: string;
    }>;
  };
};

export type ResetMonacoEditorProps = {
  workspaceSessionId: string;
  filePath: string;
  initialValue: string;
  language?: string | null;
  identity: string;
  displayName: string;
  onValueChange: (value: string) => void;
};

const POLL_INTERVAL_MS = 1_500;
const HEARTBEAT_INTERVAL_MS = 10_000;
const COLLABORATOR_COLORS = ['#f6a566', '#7cc7ff', '#7ee0b5', '#ff8aa6', '#c9a5ff', '#ffd166'];

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function resolveColor(identity: string) {
  let hash = 0;
  for (let index = 0; index < identity.length; index += 1) {
    hash = (hash * 31 + identity.charCodeAt(index)) >>> 0;
  }
  return COLLABORATOR_COLORS[hash % COLLABORATOR_COLORS.length];
}

function inferLanguage(filePath: string, explicitLanguage?: string | null) {
  if (explicitLanguage && explicitLanguage.trim()) {
    return explicitLanguage;
  }

  const normalized = filePath.toLowerCase();
  if (normalized.endsWith('.tsx') || normalized.endsWith('.ts')) return 'typescript';
  if (normalized.endsWith('.jsx') || normalized.endsWith('.js')) return 'javascript';
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.md')) return 'markdown';
  if (normalized.endsWith('.css')) return 'css';
  if (normalized.endsWith('.html')) return 'html';
  return 'plaintext';
}

class ResetYjsSyncSession {
  private readonly ydoc: Y.Doc;
  private readonly workspaceSessionId: string;
  private readonly filePath: string;
  private readonly identity: string;
  private readonly displayName: string;
  private readonly seedContent: string;
  private readonly setStatus: (status: SyncStatus) => void;
  private readonly setCollaborators: (
    collaborators: Array<{ identity: string; displayName: string; updatedAt: string }>,
  ) => void;
  private remoteVersion = 0;
  private destroyed = false;
  private flushTimer: number | null = null;
  private pollTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private readonly handleUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === this || this.destroyed) {
      return;
    }
    this.scheduleFlush();
  };

  constructor(input: {
    ydoc: Y.Doc;
    workspaceSessionId: string;
    filePath: string;
    identity: string;
    displayName: string;
    seedContent: string;
    setStatus: (status: SyncStatus) => void;
    setCollaborators: (
      collaborators: Array<{ identity: string; displayName: string; updatedAt: string }>,
    ) => void;
  }) {
    this.ydoc = input.ydoc;
    this.workspaceSessionId = input.workspaceSessionId;
    this.filePath = input.filePath;
    this.identity = input.identity;
    this.displayName = input.displayName;
    this.seedContent = input.seedContent;
    this.setStatus = input.setStatus;
    this.setCollaborators = input.setCollaborators;
  }

  async start() {
    this.setStatus('connecting');
    try {
      const snapshot = await this.fetchSnapshot();
      this.remoteVersion = snapshot.document.version;
      this.setCollaborators(snapshot.document.collaborators);

      const ytext = this.ydoc.getText('source');
      if (snapshot.document.encodedState) {
        Y.applyUpdate(this.ydoc, fromBase64(snapshot.document.encodedState), this);
      } else if (ytext.length === 0 && this.seedContent) {
        this.ydoc.transact(() => {
          ytext.insert(0, this.seedContent);
        }, this);
      }

      this.ydoc.on('update', this.handleUpdate);

      if (!snapshot.document.encodedState && this.seedContent) {
        await this.pushSnapshot();
      } else {
        this.setStatus('synced');
      }

      this.pollTimer = window.setInterval(() => {
        void this.pullLatest();
      }, POLL_INTERVAL_MS);

      this.heartbeatTimer = window.setInterval(() => {
        void this.pushSnapshot();
      }, HEARTBEAT_INTERVAL_MS);
    } catch (error) {
      console.error('[present-reset] Failed to start collaborative editor session:', error);
      this.setStatus('error');
    }
  }

  destroy() {
    this.destroyed = true;
    this.ydoc.off('update', this.handleUpdate);
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
    }

    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.pushSnapshot();
    }, 120);
  }

  private async pullLatest() {
    try {
      const snapshot = await this.fetchSnapshot();
      this.setCollaborators(snapshot.document.collaborators);
      if (snapshot.document.version > this.remoteVersion && snapshot.document.encodedState) {
        this.remoteVersion = snapshot.document.version;
        Y.applyUpdate(this.ydoc, fromBase64(snapshot.document.encodedState), this);
      }
      this.setStatus('synced');
    } catch (error) {
      console.error('[present-reset] Failed to poll collaborative editor session:', error);
      this.setStatus('offline');
    }
  }

  private async pushSnapshot() {
    const encodedState = toBase64(Y.encodeStateAsUpdate(this.ydoc));
    try {
      const response = await fetch(
        `/api/reset/workspaces/${encodeURIComponent(this.workspaceSessionId)}/collaboration`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: this.filePath,
            encodedState,
            identity: this.identity,
            displayName: this.displayName,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const snapshot = (await response.json()) as CollaborationSnapshot;
      this.remoteVersion = snapshot.document.version;
      this.setCollaborators(snapshot.document.collaborators);
      this.setStatus('synced');
    } catch (error) {
      console.error('[present-reset] Failed to push collaborative editor session:', error);
      this.setStatus('offline');
    }
  }

  private async fetchSnapshot() {
    const search = new URLSearchParams({ filePath: this.filePath });
    const response = await fetch(
      `/api/reset/workspaces/${encodeURIComponent(this.workspaceSessionId)}/collaboration?${search.toString()}`,
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as CollaborationSnapshot;
  }
}

export function ResetMonacoEditor({
  workspaceSessionId,
  filePath,
  initialValue,
  language,
  identity,
  displayName,
  onValueChange,
}: ResetMonacoEditorProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [collaborators, setCollaborators] = useState<
    Array<{ identity: string; displayName: string; updatedAt: string }>
  >([]);
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<{ destroy: () => void } | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const syncSessionRef = useRef<ResetYjsSyncSession | null>(null);

  const editorLanguage = useMemo(() => inferLanguage(filePath, language), [filePath, language]);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const ytext = ydoc.getText('source');

    awareness.setLocalStateField('user', {
      name: displayName,
      color: resolveColor(identity),
    });

    ydocRef.current = ydoc;
    awarenessRef.current = awareness;

    const handleTextChange = () => {
      onValueChange(ytext.toString());
    };

    ytext.observe(handleTextChange);
    onValueChange(initialValue);

    const syncSession = new ResetYjsSyncSession({
      ydoc,
      workspaceSessionId,
      filePath,
      identity,
      displayName,
      seedContent: initialValue,
      setStatus: setSyncStatus,
      setCollaborators,
    });
    syncSessionRef.current = syncSession;
    void syncSession.start();

    return () => {
      ytext.unobserve(handleTextChange);
      bindingRef.current?.destroy();
      bindingRef.current = null;
      syncSession.destroy();
      syncSessionRef.current = null;
      awareness.destroy();
      ydoc.destroy();
      awarenessRef.current = null;
      ydocRef.current = null;
    };
  }, [displayName, filePath, identity, initialValue, onValueChange, workspaceSessionId]);

  const handleMount = (
    editor: MonacoEditor.editor.IStandaloneCodeEditor,
    monaco: typeof MonacoEditor,
  ) => {
    editorRef.current = editor;
    const ydoc = ydocRef.current;
    const awareness = awarenessRef.current;
    const model = editor.getModel();
    if (!ydoc || !awareness || !model) {
      return;
    }

    void (async () => {
      const { MonacoBinding } = await import('y-monaco');
      if (editorRef.current !== editor) {
        return;
      }
      bindingRef.current?.destroy();
      bindingRef.current = new MonacoBinding(ydoc.getText('source'), model, new Set([editor]), awareness);
    })();

    monaco.editor.setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs');
  };

  return (
    <div className="reset-code-editor reset-code-editor--surface reset-monaco">
      <div className="reset-monaco__status">
        <span className={`reset-pill reset-pill--${syncStatus === 'synced' ? 'approved' : 'pending'}`}>
          {syncStatus}
        </span>
        <span>
          {collaborators.length > 0
            ? collaborators.map((collaborator) => collaborator.displayName).join(' / ')
            : 'No collaborators yet'}
        </span>
      </div>
      <Editor
        key={filePath}
        height="100%"
        path={filePath}
        defaultLanguage={editorLanguage}
        defaultValue={initialValue}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontLigatures: true,
          roundedSelection: false,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          padding: { top: 18, bottom: 18 },
        }}
        onMount={handleMount}
      />
    </div>
  );
}

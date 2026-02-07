import { atom, Atom } from 'tldraw';
import type { PersistedFairyState, ChatHistoryItem, FairyConfig } from '@tldraw/fairy-shared';
import { supabase } from '@/lib/supabase';

const FAIRY_CONFIG_KEY = (userId: string) => `present:fairy-configs:${userId}`;
const FAIRY_STATE_KEY = (fileId: string) => `present:fairy-state:${fileId}`;
const FAIRY_CHAT_KEY = (fileId: string) => `present:fairy-chat:${fileId}`;

export interface PresentUserRecord {
  id: string;
  fairies: string;
  fairyAccessExpiresAt: number | null;
  fairyLimit: number | null;
}

export interface PresentFileState {
  fairyState?: string;
  fairyStateUpdatedAt?: number;
  fairyChat?: ChatHistoryItem[];
}

export class TldrawApp {
  private user$: Atom<PresentUserRecord>;
  private fileStates$: Atom<Record<string, PresentFileState>>;

  readonly z: {
    mutate: {
      user: {
        updateFairyConfig: (args: { id: string; properties: Record<string, unknown> | FairyConfig }) => void;
        deleteFairyConfig: (args: { id: string }) => void;
      };
    };
  };

  constructor(public readonly userId: string) {
    const storedFairies = this.readFairyConfigs();
    this.user$ = atom('present-fairy-user', {
      id: userId,
      fairies: storedFairies,
      fairyAccessExpiresAt: null,
      fairyLimit: null,
    });
    this.fileStates$ = atom('present-fairy-filestates', {});

    this.z = {
      mutate: {
        user: {
          updateFairyConfig: ({ id, properties }) => {
            this.updateFairyConfig(id, properties);
          },
          deleteFairyConfig: ({ id }) => {
            this.deleteFairyConfig(id);
          },
        },
      },
    };
  }

  dispose() {
    // No-op for now
  }

  getUser(): PresentUserRecord {
    return this.user$.get();
  }

  getIntl() {
    return {
      formatMessage: (message: { defaultMessage?: string; id?: string }) =>
        message?.defaultMessage ?? message?.id ?? '',
    };
  }

  getMessage(key: string) {
    return { id: key, defaultMessage: key };
  }

  getFileState(fileId: string): PresentFileState | undefined {
    return this.fileStates$.get()[fileId];
  }

  async loadFileState(fileId: string) {
    if (!fileId) return;

    const existing = this.fileStates$.get()[fileId];
    if (existing?.fairyState) return;

    const fromWindow = this.getWindowExtras().fairyState;
    if (typeof fromWindow === 'string') {
      this.setFileState(fileId, { fairyState: fromWindow, fairyStateUpdatedAt: Date.now() });
      return;
    }

    const fromStorage = this.readFairyStateFromStorage(fileId);
    if (fromStorage) {
      this.setFileState(fileId, { fairyState: fromStorage, fairyStateUpdatedAt: Date.now() });
    }

    // Best-effort fetch from Supabase document (canvas snapshot)
    try {
      const { data, error } = await supabase
        .from('canvases')
        .select('document')
        .eq('id', fileId)
        .maybeSingle();
      if (error || !data?.document) return;

      const document = data.document as Record<string, unknown>;
      const fairyState = typeof document.fairyState === 'string' ? document.fairyState : null;
      const fairyChat = Array.isArray(document.fairyChat) ? (document.fairyChat as ChatHistoryItem[]) : null;
      if (fairyState) {
        this.setFileState(fileId, {
          fairyState,
          fairyStateUpdatedAt: Date.now(),
          fairyChat: fairyChat ?? undefined,
        });
        this.writeFairyStateToStorage(fileId, fairyState);
        if (fairyChat) {
          this.writeFairyChatToStorage(fileId, fairyChat);
        }
        this.updateWindowExtras({ fairyState, fairyChat });
      }
    } catch {
      // Ignore fetch errors
    }
  }

  onFairyStateUpdate(fileId: string, fairyState: PersistedFairyState) {
    if (!fileId) return;
    const serialized = JSON.stringify(fairyState);
    this.setFileState(fileId, { fairyState: serialized, fairyStateUpdatedAt: Date.now() });
    this.writeFairyStateToStorage(fileId, serialized);
    this.updateWindowExtras({ fairyState: serialized, fairyStateUpdatedAt: Date.now() });
    this.dispatchCanvasSaveHint();
  }

  appendFairyChatMessages(fileId: string, messages: ChatHistoryItem[]) {
    if (!fileId || messages.length === 0) return;
    const current = this.fileStates$.get()[fileId]?.fairyChat ?? this.readFairyChatFromStorage(fileId) ?? [];
    const next = [...current, ...messages].slice(-500);
    this.setFileState(fileId, { fairyChat: next });
    this.writeFairyChatToStorage(fileId, next);
    this.updateWindowExtras({ fairyChat: next });
    this.dispatchCanvasSaveHint();
  }

  private setFileState(fileId: string, next: Partial<PresentFileState>) {
    this.fileStates$.update((prev) => ({
      ...prev,
      [fileId]: {
        ...(prev[fileId] ?? {}),
        ...next,
      },
    }));
  }

  private updateFairyConfig(id: string, properties: Record<string, unknown> | FairyConfig) {
    const user = this.user$.get();
    const parsed = this.safeParseConfigs(user.fairies);
    parsed[id] = { ...(parsed[id] ?? {}), ...properties };
    const serialized = JSON.stringify(parsed);
    this.user$.set({ ...user, fairies: serialized });
    this.writeFairyConfigs(serialized);
  }

  private deleteFairyConfig(id: string) {
    const user = this.user$.get();
    const parsed = this.safeParseConfigs(user.fairies);
    delete parsed[id];
    const serialized = JSON.stringify(parsed);
    this.user$.set({ ...user, fairies: serialized });
    this.writeFairyConfigs(serialized);
  }

  private safeParseConfigs(raw: string) {
    try {
      const parsed = JSON.parse(raw || '{}');
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
      return {};
    }
  }

  private readFairyConfigs(): string {
    if (typeof window === 'undefined') return '{}';
    try {
      return window.localStorage.getItem(FAIRY_CONFIG_KEY(this.userId)) || '{}';
    } catch {
      return '{}';
    }
  }

  private writeFairyConfigs(value: string) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(FAIRY_CONFIG_KEY(this.userId), value);
    } catch {}
  }

  private readFairyStateFromStorage(fileId: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(FAIRY_STATE_KEY(fileId));
    } catch {
      return null;
    }
  }

  private writeFairyStateToStorage(fileId: string, value: string) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(FAIRY_STATE_KEY(fileId), value);
    } catch {}
  }

  private readFairyChatFromStorage(fileId: string): ChatHistoryItem[] | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(FAIRY_CHAT_KEY(fileId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private writeFairyChatToStorage(fileId: string, value: ChatHistoryItem[]) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(FAIRY_CHAT_KEY(fileId), JSON.stringify(value));
    } catch {}
  }

  private getWindowExtras(): Record<string, any> {
    if (typeof window === 'undefined') return {};
    const w = window as any;
    if (!w.__presentCanvasExtras) w.__presentCanvasExtras = {};
    return w.__presentCanvasExtras;
  }

  private updateWindowExtras(update: Record<string, unknown>) {
    if (typeof window === 'undefined') return;
    const extras = this.getWindowExtras();
    Object.assign(extras, update);
    try {
      window.dispatchEvent(new Event('present:canvas-extras-updated'));
    } catch {}
  }

  private dispatchCanvasSaveHint() {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new Event('present:fairy-state-updated'));
    } catch {}
  }
}

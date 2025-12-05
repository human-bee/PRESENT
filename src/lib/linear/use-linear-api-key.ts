'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const LINEAR_KEY_STORAGE_KEY = 'present.linear.apiKey';

export type KeySyncStatus = 'idle' | 'loading' | 'saved' | 'error';

export interface UseLinearApiKeyReturn {
  apiKey: string;
  keyDraft: string;
  setKeyDraft: (value: string) => void;
  showApiKey: boolean;
  setShowApiKey: (value: boolean) => void;
  keySyncStatus: KeySyncStatus;
  keySyncError: string | null;
  hasApiKey: boolean;
  saveApiKey: () => void;
  clearApiKey: () => void;
  showKeyPanel: boolean;
  setShowKeyPanel: (value: boolean) => void;
}

interface UseLinearApiKeyOptions {
  onSave?: () => void;
  onClear?: () => void;
}

export function useLinearApiKey(options: UseLinearApiKeyOptions = {}): UseLinearApiKeyReturn {
  const { onSave, onClear } = options;
  
  const [apiKey, setApiKey] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [keySyncStatus, setKeySyncStatus] = useState<KeySyncStatus>('idle');
  const [keySyncError, setKeySyncError] = useState<string | null>(null);
  const [showKeyPanel, setShowKeyPanel] = useState(true);
  const serverKeyFetchAttemptedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(LINEAR_KEY_STORAGE_KEY);
    if (stored) {
      setApiKey(stored);
      setKeyDraft(stored);
    }
  }, []);

  useEffect(() => {
    if (serverKeyFetchAttemptedRef.current) return;
    serverKeyFetchAttemptedRef.current = true;

    let cancelled = false;

    const load = async () => {
      setKeySyncStatus('loading');
      try {
        const res = await fetch('/api/linear-key', { credentials: 'include' });
        if (!res.ok) {
          if (res.status === 401) {
            setKeySyncStatus('idle');
            return;
          }
          throw new Error(await res.text());
        }

        const data = await res.json();
        if (cancelled) return;

        if (data?.apiKey) {
          setApiKey(data.apiKey);
          setKeyDraft(data.apiKey);
          setKeySyncStatus('saved');
          setKeySyncError(null);
        } else {
          setKeySyncStatus('idle');
        }
      } catch (error) {
        if (cancelled) return;
        console.warn('[LinearKanban] Skipping server key load', error instanceof Error ? error.message : error);
        setKeySyncStatus('idle');
        setKeySyncError(null);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist key locally
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const cleaned = apiKey?.trim();
    if (cleaned) {
      window.localStorage.setItem(LINEAR_KEY_STORAGE_KEY, cleaned);
    } else {
      window.localStorage.removeItem(LINEAR_KEY_STORAGE_KEY);
    }
  }, [apiKey]);

  useEffect(() => {
    setKeyDraft(apiKey || '');
  }, [apiKey]);

  const hasApiKey = Boolean(apiKey?.trim());

  const saveApiKey = useCallback(() => {
    const cleaned = keyDraft.trim();
    setApiKey(cleaned);
    
    if (cleaned) {
      setKeySyncStatus('loading');
      fetch('/api/linear-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ apiKey: cleaned }),
      })
        .then((res) => {
          if (res.status === 401) {
            setKeySyncStatus('idle');
            setKeySyncError(null);
            setShowKeyPanel(false);
            return;
          }
          if (!res.ok) return res.text().then((t) => { throw new Error(t); });
          setKeySyncStatus('saved');
          setKeySyncError(null);
          setShowKeyPanel(false);
        })
        .catch(() => {
          setKeySyncStatus('idle');
          setKeySyncError(null);
          setShowKeyPanel(false);
        });
      onSave?.();
    } else {
      onClear?.();
    }
  }, [keyDraft, onSave, onClear]);

  const clearApiKey = useCallback(() => {
    setKeyDraft('');
    setApiKey('');
    setShowKeyPanel(true);
    setKeySyncStatus('loading');
    
    fetch('/api/linear-key', { method: 'DELETE', credentials: 'include' })
      .then(() => setKeySyncStatus('idle'))
      .catch((err) => {
        console.error('[LinearKanban] Failed to clear key in Supabase', err);
        setKeySyncStatus('error');
        setKeySyncError(err?.message || 'Failed to clear key');
      });
    
    onClear?.();
  }, [onClear]);

  return {
    apiKey,
    keyDraft,
    setKeyDraft,
    showApiKey,
    setShowApiKey,
    keySyncStatus,
    keySyncError,
    hasApiKey,
    saveApiKey,
    clearApiKey,
    showKeyPanel,
    setShowKeyPanel,
  };
}



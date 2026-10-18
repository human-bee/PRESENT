'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { BriefField, InterviewEnvelope } from '@present/contracts/interviews';
import type { InterviewScene } from '@present/contracts/interview-studio';
import { decodeState, editBriefField, encodeState, readBrief, setBriefSource } from '@/lib/interviews/document';
import { briefRequest, type BriefSession } from './api';

export function useBriefDocument(session: BriefSession) {
  const [doc] = useState(() => {
    const document = new Y.Doc();
    Y.applyUpdate(document, decodeState(session.interview.encodedState), 'server');
    return document;
  });
  const [snapshot, setSnapshot] = useState(() => readBrief(doc));
  const [interview, setInterview] = useState(session.interview);
  const [status, setStatus] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [error, setError] = useState('');
  const endpoint = `/api/interviews/${session.interview.id}`;
  const [identity] = useState(() => crypto.randomUUID());
  const latest = useRef(interview);
  const generation = useRef(0);
  const savedGeneration = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);
  const draftKey = `present:interview-draft:${session.interview.id}`;

  const apply = useCallback((next: InterviewEnvelope) => {
    if (!mounted.current) return;
    Y.applyUpdate(doc, decodeState(next.encodedState), 'server');
    latest.current = next;
    setInterview(next);
  }, [doc]);

  const sync = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const sentGeneration = generation.current;
    const dirty = sentGeneration !== savedGeneration.current;
    const operation = briefRequest<{ interview: InterviewEnvelope }>(endpoint, session.token,
      dirty ? { action: 'sync', encodedState: encodeState(doc) } : undefined, identity)
      .then((result) => {
        apply(result.interview);
        savedGeneration.current = sentGeneration;
        if (mounted.current) {
          const clean = generation.current === sentGeneration;
          setStatus(clean ? 'saved' : 'saving');
          if (clean) sessionStorage.removeItem(draftKey);
        }
        return true;
      }).catch((failure: Error) => {
        if (mounted.current) { setStatus('offline'); setError(failure.message); }
        return false;
      }).finally(() => { inFlight.current = null; });
    inFlight.current = operation;
    return operation;
  }, [apply, doc, draftKey, endpoint, identity, session.token]);

  const flush = useCallback(async () => {
    if (!await sync()) return false;
    while (savedGeneration.current !== generation.current) if (!await sync()) return false;
    return true;
  }, [sync]);

  useEffect(() => {
    mounted.current = true;
    const update = (_update: Uint8Array, origin: unknown) => {
      setSnapshot(readBrief(doc));
      if (origin !== 'server') {
        generation.current++;
        setStatus('saving');
        try { sessionStorage.setItem(draftKey, encodeState(doc)); } catch { /* Server sync still works without browser storage. */ }
      }
    };
    doc.on('update', update);
    try {
      const pending = sessionStorage.getItem(draftKey);
      if (pending) Y.applyUpdate(doc, decodeState(pending), 'recovery');
    } catch { sessionStorage.removeItem(draftKey); }
    void sync();
    const timer = setInterval(() => { if (!inFlight.current) void sync(); }, 850);
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (savedGeneration.current !== generation.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      doc.off('update', update);
      window.removeEventListener('beforeunload', warnUnsaved);
    };
  }, [doc, draftKey, sync]);

  const act = useCallback(async (mutation: Record<string, unknown>) => {
    if (!await flush()) throw new Error('Wait for your changes to save before continuing.');
    try {
      const body = mutation.action === 'review' ? { ...mutation, revision: latest.current.revision } : mutation;
      const result = await briefRequest<{ interview: InterviewEnvelope }>(endpoint, session.token, body);
      apply(result.interview);
      setError('');
      return result.interview;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update the brief.');
      throw failure;
    }
  }, [apply, endpoint, flush, session.token]);

  return {
    doc, snapshot, interview, status, error, setError, flush, act, apply,
    scene: (scene: InterviewScene) => doc.getMap('studio').set('scene', scene),
    focus: (field: BriefField) => doc.getMap('studio').set('focus', field),
    moveAsset: (id: string, x: number, y: number) => doc.getMap('asset-layout').set(id, { x, y }),
    edit: (field: BriefField, text: string) => {
      doc.transact(() => {
        editBriefField(doc, field, text);
        if (['location', 'experience', 'availability', 'story', 'work', 'aiWork', 'research', 'motivation', 'compensation', 'workplace', 'timing', 'roleContext', 'questions'].includes(field)) {
          const sourceId = `edited-${session.interview.role}`;
          if (!doc.getMap('sources').has(`${field}:${sourceId}`)) setBriefSource(doc, field, {
            kind: 'shared', label: `${session.interview.role === 'candidate' ? 'Candidate' : 'Recruiter'} edited this detail`,
          }, sourceId);
        }
      }, 'editor');
    },
  };
}

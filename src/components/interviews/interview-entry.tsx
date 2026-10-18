'use client';

import { useEffect, useState } from 'react';
import type { InterviewEnvelope } from '@present/contracts/interviews';
import { briefPath, briefRequest, openExampleInterview, type BriefSession } from './api';
import { InterviewWorkspace } from './interview-workspace';

export function InterviewEntry() {
  const [session, setSession] = useState<BriefSession | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function open() {
      const id = new URLSearchParams(window.location.search).get('brief');
      const token = new URLSearchParams(window.location.hash.slice(1)).get('access');
      if (id && !token) throw new Error('Open the complete invitation link to join this brief.');
      const result = id && token
        ? { token, ...await briefRequest<{ interview: InterviewEnvelope }>(`/api/interviews/${encodeURIComponent(id)}`, token) }
        : await openExampleInterview();
      if (cancelled) return;
      history.replaceState(null, '', briefPath(result.interview.id, result.token));
      setSession(result);
    }
    void open().catch((failure: Error) => { if (!cancelled) setError(failure.message); });
    return () => { cancelled = true; };
  }, []);
  if (error) return (
    <main className="ob ob-loading"><div className="ob-brand">PRESENT</div><h1>Let’s get you back to the brief.</h1>
      <p role="alert">{error}</p><a className="ob-button" href={error.startsWith('Sign in') ? '/auth/signin' : '/interviews'}>{error.startsWith('Sign in') ? 'Sign in to PRESENT' : 'Open an example interview'}</a></main>
  );
  if (!session) return <main className="ob ob-loading"><div className="ob-brand">PRESENT</div><h1>Opening your shared brief…</h1><p>The same story, written together.</p></main>;
  return <InterviewWorkspace key={session.interview.id} session={session} />;
}

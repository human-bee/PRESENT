'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { briefPath, briefRequest, type BriefSession } from './api';
import { BriefDialog } from './brief-dialog';

export function NewBriefDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <BriefDialog title="Start a shared brief" onClose={onClose}><p className="ob-muted">Bring what you know. Leave room for what you’ll learn together.</p>
    <form className="ob-new-form" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('');
      const data = new FormData(event.currentTarget);
      try {
        const result = await briefRequest<BriefSession>('/api/interviews', '', {
          profile: Object.fromEntries(['name', 'title', 'company', 'roleContext', 'research', 'sourceUrl'].map((key) => [key, data.get(key) || ''])),
        });
        window.location.assign(briefPath(result.interview.id, result.token));
      } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not create your brief.'); setBusy(false); }
    }}>
      <label>Candidate name<input autoFocus name="name" placeholder="Full name" required maxLength={120} /></label>
      <div className="ob-form-row"><label>Role<input name="title" placeholder="Role title" required maxLength={160} /></label><label>Company<input name="company" placeholder="Company name" maxLength={120} /></label></div>
      <label>Role context<textarea name="roleContext" rows={3} maxLength={6000} placeholder="The opportunity, expectations, constraints, and open questions." /></label>
      <label>Profile research<textarea name="research" rows={4} maxLength={10000} placeholder="Paste your pre-call research. The candidate can check and correct it." /></label>
      <label>Research source<input name="sourceUrl" type="url" placeholder="https://…" maxLength={2000} /></label>
      <p className="ob-editor-note">Everything you add will be visible to the candidate.</p>
      {error && <p role="alert" className="ob-error-inline">{error}</p>}
      <button className="ob-button ob-button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create shared brief'}<ArrowRight /></button>
    </form>
  </BriefDialog>;
}

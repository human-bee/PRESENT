'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Check, Copy, FileText, UserPlus, X } from 'lucide-react';
import type { BriefField, InterviewEnvelope, InterviewTranscript } from '@present/contracts/interviews';
import type { InterviewAsset, InterviewScene } from '@present/contracts/interview-studio';
import { briefPath, briefRequest, type BriefSession } from './api';
import { useBriefDocument } from './use-brief-document';
import { useInterviewCall } from './use-interview-call';
import { BriefDocument } from './brief-document';
import { ActivityPanel, ConversationPanel, ResearchPanel } from './brief-panels';
import { ConversationRail } from './conversation-rail';
import { BriefDialog } from './brief-dialog';
import { NewBriefDialog } from './new-brief-dialog';
import { ReviewDialog } from './review-dialog';
import { EvidencePanel } from './evidence-panel';
import { useEvidenceMenu } from './use-evidence-menu';
import type { EvidenceSelection } from '@/lib/interviews/evidence';
import { StudioSidebar, type StudioPanel } from './studio-sidebar';
import { MeetScene } from './studio-call';
import { StudioCanvas } from './studio-canvas';
import { AddMaterialDialog, MaterialDetailDialog } from './material-dialog';
import { MaterialSession } from './material-preview';
import { useWorkboard } from './use-workboard';
import { PipelineInspector } from './pipeline-inspector';
import { useRenderTraces } from './use-render-traces';

type Dialog = 'invite' | 'new' | 'review' | 'evidence' | 'add' | 'material' | 'inspector' | null;
const CallAudio = dynamic(() => import('./call-media').then((module) => module.CallAudio),{ ssr: false });
export function InterviewWorkspace({ session }: { session: BriefSession }) {
  const document = useBriefDocument(session);
  const { snapshot, interview, status, error, setError, act, edit, flush, apply } = document;
  const [panel,setPanel] = useState<StudioPanel>('scene'); const [dialog,setDialog] = useState<Dialog>(null);
  const [selection,setSelection] = useState<EvidenceSelection>(); const [materialId,setMaterialId] = useState('');
  const [addKind,setAddKind] = useState<'link' | 'note'>('link'); const [busy,setBusy] = useState(false); const [copied,setCopied] = useState(false); const [notice,setNotice] = useState('');
  const evidenceMenu = useEvidenceMenu((next) => { setSelection(next); setDialog('evidence'); });
  const scene = snapshot.studio.scene; const close = () => setDialog(null);
  function showScene(next: InterviewScene) { document.scene(next); setPanel('scene'); }
  function focusField(field: BriefField) {
    document.focus(field); showScene('brief');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = window.document.querySelector<HTMLElement>(`#ob-document [data-guide-field="${field}"]`) || window.document.querySelector<HTMLElement>(`#ob-document [data-brief-field="${field}"]`);
      target?.scrollIntoView({ behavior: 'smooth',block: 'center' });
    }));
  }
  async function run(action: () => Promise<unknown>) { setBusy(true); try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update the shared brief.'); } finally { setBusy(false); } }
  async function suggest(id: string, draft = false) {
    try { const result = await briefRequest<{ interview?: InterviewEnvelope }>(`/api/interviews/${interview.id}/agent`,session.token,{ transcriptId: id,draft }); if (result.interview) apply(result.interview); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The agent could not process this note.'); throw failure; }
  }
  async function capture(transcript: InterviewTranscript) {
    await act({ action: 'note',transcript });
    if (interview.agentAvailable && interview.notesConsent.candidate && interview.notesConsent.recruiter && interview.role === 'recruiter') await suggest(transcript.id,true).catch(() => {});
  }
  const call = useInterviewCall({ interview,token: session.token,sharedDocument: document.doc,onTranscript: capture,onError: setError });
  async function upload(file: File) {
    if (file.size > 8 * 1024 * 1024) throw new Error('Choose a file smaller than 8 MB.');
    if (!await flush()) throw new Error('Wait for changes to save before uploading.');
    const response = await fetch(`/api/interviews/${interview.id}/assets`,{ method: 'POST',headers: { Authorization: `Bearer ${session.token}`,'Content-Type': file.type,'X-File-Name': encodeURIComponent(file.name),'X-Brief-Field': snapshot.studio.focus },body: file });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not upload this material.');
    apply(result.interview); setNotice('Material saved. Open it to add a caption or include it in the brief.');
  }
  const workboard = useWorkboard(call.room,upload,setError);
  const showScreen = () => { void workboard.show().then((started) => { if (started) showScene('canvas'); }); };
  const add = (kind: 'link' | 'note' = 'link') => { setAddKind(kind); setDialog('add'); };
  const openAsset = (asset: InterviewAsset) => { setMaterialId(asset.id); setDialog('material'); };
  const updateAsset = async (id: string,changes: Record<string,unknown>) => { await act({ action: 'asset-update',id,changes }); };
  const decide = (id: string,decision: 'accepted' | 'dismissed') => void run(() => act({ action: 'suggestion',id,decision }));
  useRenderTraces(interview,session.token,panel === 'scene' ? scene : 'meet');
  async function exportBrief(format = 'html') {
    if (!await flush()) throw new Error('Wait for changes to save before exporting.');
    const response = await fetch(`/api/interviews/${interview.id}/handoff?format=${format}`,{ headers: { Authorization: `Bearer ${session.token}` },cache: 'no-store' });
    if (!response.ok) { const data = await response.json(); setError(data.error); throw new Error(data.error); }
    const url = URL.createObjectURL(await response.blob()); const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = format === 'evidence' ? 'candidate-evidence.json' : 'candidate-brief.html'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const invite = typeof window !== 'undefined' && interview.candidateToken ? `${window.location.origin}${briefPath(interview.id,interview.candidateToken)}` : '';
  const selectedAsset = snapshot.studio.assets.find((item) => item.id === materialId);
  return <MaterialSession.Provider value={{ id: interview.id,token: session.token }}><main className="ob st-studio">
    {call.room && <CallAudio room={call.room} />}
    <header className="ob-header st-header"><a className="ob-brand" href="/" aria-label="PRESENT workspace">PRESENT</a><div className="st-interview-context"><span>{snapshot.fields.name}</span><small>{interview.example ? 'Example interview' : snapshot.fields.company || 'Shared interview'}</small></div>
      <div className="st-scenes" role="group" aria-label="Shared interview scene">{(['meet','brief','canvas'] as const).map((item) => <button key={item} aria-pressed={panel === 'scene' && scene === item} onClick={() => showScene(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
      <div className="ob-header-actions"><span className={`ob-save-status ${status}`} role="status"><i />{status === 'saved' ? 'All changes saved' : status === 'saving' ? 'Saving changes…' : 'Reconnecting…'}</span>{interview.role === 'recruiter' && <button className="ob-button" onClick={() => { setCopied(false); setDialog('invite'); }}><UserPlus /><span className="ob-invite-label">Invite candidate</span></button>}<button className="ob-button ob-button-primary" onClick={() => setDialog('review')}><FileText />Review handoff</button></div>
    </header>
    <div className="st-layout"><StudioSidebar snapshot={snapshot} panel={panel} onFocus={focusField} onPanel={setPanel} onAdd={() => add()} onAsset={openAsset} onInspector={() => setDialog('inspector')} onNew={() => setDialog('new')} />
      <div className={`st-stage ${panel === 'scene' ? `is-${scene}` : 'is-panel'}`}>
        {error && <div className="ob-error" role="alert"><p>{error}</p><button className="ob-icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X /></button></div>}{notice && <div className="ob-notice" role="status">{notice}<button className="ob-icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}><X /></button></div>}
        <div className={`st-scene-layout ${panel === 'scene' && scene === 'meet' ? 'is-meet' : panel === 'scene' && scene === 'canvas' ? 'is-canvas' : ''}`}>
          <div className="ob-document st-document" id="ob-document" onContextMenu={evidenceMenu.onContextMenu}>
            {panel === 'scene' && scene === 'meet' && <MeetScene snapshot={snapshot} interview={interview} call={call} onBrief={() => showScene('brief')} onScreen={showScreen} busy={busy} onConsent={(enabled) => void run(() => act({ action: 'consent',enabled }))} />}
            {panel === 'scene' && scene === 'brief' && <BriefDocument snapshot={snapshot} onEdit={edit} onFocus={(field) => { if (snapshot.studio.focus !== field) document.focus(field); }} onAdd={() => add()} onAsset={openAsset} />}
            {panel === 'scene' && scene === 'canvas' && <StudioCanvas snapshot={snapshot} onEdit={edit} onFocus={document.focus} onAdd={() => add()} onNote={() => add('note')} onAsset={openAsset} onMove={document.moveAsset} onInclude={(id,value) => void run(() => updateAsset(id,{ included: value }))} onBrief={() => showScene('brief')} onEvidence={() => setDialog('evidence')} onScreen={showScreen} workboard={workboard} />}
            {panel === 'research' && <ResearchPanel snapshot={snapshot} onEdit={edit} />}{panel === 'activity' && <ActivityPanel snapshot={snapshot} />}
            {panel === 'conversation' && <ConversationPanel snapshot={snapshot} interview={interview} onNote={(text,speaker) => capture({ id: crypto.randomUUID(),text,speaker,timestamp: Date.now(),example: false,origin: 'manual' })} onDecision={decide} onSuggest={suggest} onQuote={(transcript,field) => void run(() => act({ action: 'quote',transcriptId: transcript.id,field }))} />}
          </div>
          {!(panel === 'scene' && (scene === 'meet' || scene === 'canvas')) && <ConversationRail snapshot={snapshot} interview={interview} selection={selection} onEvidence={() => setDialog('evidence')} call={call} busy={busy} onConsent={(enabled) => void run(() => act({ action: 'consent',enabled }))} onConversation={() => setPanel('conversation')} onFocus={focusField} onScreen={showScreen} workboard={workboard} />}
        </div>
      </div>
    </div>
    {dialog === 'new' && <NewBriefDialog onClose={close} />}
    {dialog === 'add' && <AddMaterialDialog initial={addKind} onClose={close} onFile={upload} onLink={async (asset) => { const count = snapshot.studio.assets.length; await act({ action: 'asset-add',asset: { ...asset,field: snapshot.studio.focus,x: count % 2 ? 1180 : 30,y: 80 + Math.floor(count / 2) * 310 } }); }} />}
    {dialog === 'material' && selectedAsset && <MaterialDetailDialog key={selectedAsset.id} asset={selectedAsset} onClose={close} onUpdate={updateAsset} onRemove={async (id) => { await act({ action: 'asset-remove',id }); }} />}
    {dialog === 'inspector' && <PipelineInspector id={interview.id} token={session.token} onClose={close} />}
    {dialog === 'invite' && <BriefDialog title="Write the story together" onClose={close}><p className="ob-muted">This invitation opens the same scenes, document, materials, and review state as the candidate.</p><label className="ob-invite-field">Candidate invitation<input readOnly value={invite} onFocus={(event) => event.target.select()} /></label><div className="ob-inline-actions"><button className="ob-button ob-button-primary" onClick={async () => { try { await navigator.clipboard.writeText(invite); setCopied(true); } catch { setNotice('Select the invitation link and copy it to share.'); } }}>{copied ? <Check /> : <Copy />}{copied ? 'Link copied' : 'Copy invitation'}</button><a className="ob-button" href={invite} target="_blank" rel="noreferrer">Open candidate view</a></div></BriefDialog>}
    {dialog === 'review' && <ReviewDialog snapshot={snapshot} interview={interview} error={error} saving={status !== 'saved'} onApprove={async () => { await act({ action: 'review' }); }} onExport={() => exportBrief()} onEvidenceExport={() => exportBrief('evidence')} onClose={close} onAsset={openAsset} />}
    {dialog === 'evidence' && <BriefDialog title="Evidence behind the brief" onClose={close} wide><EvidencePanel key={`${selection?.field}:${selection?.text}`} snapshot={snapshot} selection={selection} expanded onMaterial={openAsset} /></BriefDialog>}{evidenceMenu.element}
  </main></MaterialSession.Provider>;
}

'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Clock3, ScanLine } from 'lucide-react';
import type { PipelineTrace } from '@present/contracts/interview-studio';
import { briefRequest } from './api';
import { BriefDialog } from './brief-dialog';

type Inspection = { readiness: { credentialConfigured: boolean; networkAllowsOpenAI: boolean }; traces: PipelineTrace[]; models: { speech: string; transcription: string; decision: string } };
const duration = (start?: number, end?: number) => start !== undefined && end !== undefined ? `${Math.max(0, end - start)} ms` : 'Not measured';
export function PipelineInspector({ id, token, onClose }: { id: string; token: string; onClose: () => void }) {
  const [data, setData] = useState<Inspection>(); const [error, setError] = useState(''); const [selected, setSelected] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => briefRequest<Inspection>(`/api/interviews/${id}/pipeline`, token).then((result) => { if (active) setData(result); }).catch((failure) => { if (active) setError(failure.message); });
    void refresh(); const timer = setInterval(() => void refresh(), 1500);
    return () => { active = false; clearInterval(timer); };
  }, [id, token]);
  const trace = data?.traces.find((item) => item.id === selected) || data?.traces.at(-1);
  const ready = data?.readiness.credentialConfigured && data?.readiness.networkAllowsOpenAI;
  const stages = [
    { label: 'Two natural voices', detail: trace?.speechGeneration ? `${trace.speechGeneration.model} · ${trace.speechGeneration.voice}` : data?.models.speech || 'OpenAI TTS', value: trace?.speechGeneration ? `${Math.round(trace.speechGeneration.firstByteMs)} ms to first audio` : 'Test preparation' },
    { label: 'Audio only', detail: '24 kHz PCM · two participant channels', value: trace?.speechEndedAt ? 'Speech observed' : 'Awaiting audio' },
    { label: 'Realtime transcript', detail: data?.models.transcription || 'Realtime transcription', value: duration(trace?.speechEndedAt, trace?.transcribedAt) },
    { label: 'Decision', detail: data?.models.decision || 'Decision model', value: duration(trace?.decisionStartedAt, trace?.decisionCompletedAt) },
    { label: 'Evidence + save', detail: 'Verbatim quote validation · durable revision', value: duration(trace?.decisionCompletedAt, trace?.savedAt) },
    { label: 'Brief + widgets', detail: 'Visible client render acknowledgements', value: duration(trace?.savedAt, trace?.renderedAt) },
  ];
  return <BriefDialog title="What happened between speech and the brief?" onClose={onClose} wide>
    <p className="ob-muted">The original script goes to text-to-speech. Only audio bytes enter transcription; only returned text reaches the decision model.</p>
    {!ready && <p className="st-pipeline-blocked" role="status"><ScanLine />Live audio test blocked. {!data?.readiness.credentialConfigured ? 'No OpenAI credential is configured. ' : ''}{data && !data.readiness.networkAllowsOpenAI ? 'The environment does not allow the OpenAI API host.' : ''} No model timings are estimated.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="st-pipeline-flow" role="group" aria-label="Speech to living document pipeline">{stages.map((stage,index) => <div className="st-pipeline-stage" key={stage.label}><span>{index + 1}</span><h3>{stage.label}</h3><p>{stage.detail}</p><strong>{stage.value}</strong>{index < stages.length - 1 && <ArrowRight />}</div>)}</div>
    {data && data.traces.length > 0 && <label className="st-trace-picker">Inspect an actual turn<select value={trace?.id || ''} onChange={(event) => setSelected(event.target.value)}>{data.traces.slice().reverse().map((item) => <option key={item.id} value={item.id}>{item.origin} · {item.input.slice(0,70)}</option>)}</select></label>}
    {trace ? <div className="st-trace-detail"><div><h3>{trace.origin === 'manual' ? 'Manually entered note' : 'Input returned by transcription'}</h3><p>{trace.input}</p><small>{trace.origin === 'manual' ? 'This is not an audio transcription test.' : trace.origin === 'audio-test' ? 'Synthetic audio test; text returned by the transcription service.' : 'Live participant audio.'}</small></div><div><h3>Document patches</h3>{trace.patches.length ? trace.patches.map((patch,index) => <p key={index}><strong>{patch.field} · {patch.accepted ? 'saved' : 'review pending'}</strong><br />{patch.text}</p>) : <p>No document change proposed.</p>}</div>
      <div><h3><Clock3 />Measured observations</h3>{trace.speechGeneration && <p>Complete TTS clip: <strong>{Math.round(trace.speechGeneration.completeMs)} ms</strong> before playback</p>}<p>Speech end → first visible brief update: <strong>{duration(trace.speechEndedAt,trace.renderedAt)}</strong></p>{Object.entries(trace.widgetObservedAt || {}).map(([widget,at]) => <p key={widget}>{widget}: {duration(trace.savedAt,at)} after save</p>)}<small>Render times include network delivery and the first visible client acknowledgement. Hidden scenes are not reported as rendered.</small></div></div> : <p className="st-widget-muted">No live audio/model turn has run. The graph above describes the implemented path; empty stages have no measured values.</p>}
  </BriefDialog>;
}

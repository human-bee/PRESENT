import { useEditor, useValue, TLDOCUMENT_ID } from 'tldraw';
import { readRoomOS } from '../../shared/activity';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ObjectPatch, RoomObject } from '../../shared/room';
import { workExecutionSchema, type WorkExecution } from '../../shared/work-execution';

type WorkStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
type Work = {
  jobId: string;
  requestId?: string;
  actor?: string;
  status: WorkStatus;
  prompt: string;
  provider: 'spark' | 'codex' | 'luna' | 'terra';
  error?: string;
  artifactIds: string[];
  execution?: WorkExecution;
};
type Action = 'start' | 'cancel' | 'resume';
export type WorkCardProps = {
  roomId: string;
  object: RoomObject;
  patch: (patch: ObjectPatch) => void;
  selfId: string;
  onOpenArtifact?: (id: string) => void;
};

const statuses: WorkStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'];
const field: CSSProperties = {
  width: '100%',
  minWidth: 0,
  padding: '7px 9px',
  border: '1px solid #dce2d4',
  borderRadius: 7,
  background: '#fffef9',
  color: '#28342a',
  font: 'inherit',
};
const label: CSSProperties = { display: 'grid', gap: 4, fontSize: 12, color: '#66725f' };
const button: CSSProperties = { border: 0, borderRadius: 7, padding: '8px 12px', fontSize: 12, cursor: 'pointer' };

function readWork(value: unknown): Work | null {
  if (!value || typeof value !== 'object') return null;
  const work = value as Record<string, unknown>;
  if (typeof work.jobId !== 'string' || !statuses.includes(work.status as WorkStatus)) return null;
  const execution = workExecutionSchema.safeParse(work.execution);
  return {
    jobId: work.jobId,
    requestId: typeof work.requestId === 'string' ? work.requestId : undefined,
    actor: typeof work.actor === 'string' ? work.actor : undefined,
    status: work.status as WorkStatus,
    prompt: typeof work.prompt === 'string' ? work.prompt : '',
    provider: ['codex', 'spark', 'luna', 'terra'].includes(String(work.provider)) ? work.provider as Work['provider'] : 'luna',
    error: typeof work.error === 'string' ? work.error : undefined,
    artifactIds: Array.isArray(work.artifactIds)
      ? work.artifactIds.filter((id): id is string => typeof id === 'string')
      : [],
    ...(execution.success ? { execution: execution.data } : {}),
  };
}

function useWorkRefresh(roomId: string, jobId: string | undefined, status: WorkStatus | undefined) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    const active = status === 'queued' || status === 'running';
    if (!jobId || (!active && status !== 'failed' && status !== 'interrupted')) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timeout: number | undefined;
    const refresh = async () => {
      if (disposed || controller) return;
      controller = new AbortController();
      const requestController = controller;
      timeout = window.setTimeout(() => requestController.abort(), 10_000);
      try {
        const response = await fetch(`/api/work/${encodeURIComponent(jobId)}?roomId=${encodeURIComponent(roomId)}`, {
          signal: requestController.signal,
          cache: 'no-store',
        });
        if (!response.ok)
          throw new Error(response.status === 404 ? 'This work run is unavailable.' : 'Could not refresh work status.');
        if (!disposed) setError(null);
        // The GET reconciles restored jobs; room broadcasts remain the status authority.
      } catch (cause) {
        if (!disposed)
          setError(
            cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Work status refresh timed out.',
          );
      } finally {
        window.clearTimeout(timeout);
        controller = null;
      }
    };
    void refresh();
    const interval = active ? window.setInterval(() => void refresh(), 3000) : undefined;
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      controller?.abort();
    };
  }, [roomId, jobId, status]);
  return error;
}

export function WorkCard({ roomId, object, patch, selfId, onOpenArtifact }: WorkCardProps) {
  const work = readWork(object.data.work);
  const prompt = typeof object.data.prompt === 'string' ? object.data.prompt : (work?.prompt ?? '');
  // The human assignee is distinct from the actor that executes the job.
  const editor = useEditor();
  const storedOwner = typeof object.data.owner === 'string' ? object.data.owner : '';
  const owner = useValue('human-work-owner', () => {
    const document = editor.store.get(TLDOCUMENT_ID);
    const activities = readRoomOS(document ? [document] : []).activities;
    return activities.flatMap((a) => a.seats).find((s) => s.actor === storedOwner)?.name ?? storedOwner;
  }, [editor, storedOwner]);
  const [pending, setPending] = useState<Action | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState('');
  const inFlight = useRef(false);
  const startRequest = useRef<{ objectId: string; prompt: string; requestId: string } | null>(null);
  const active = work?.status === 'queued' || work?.status === 'running';
  const resumable = work && ['failed', 'cancelled', 'interrupted'].includes(work.status);
  const canControl = !work?.actor || work.actor === selfId;
  const refreshError = useWorkRefresh(roomId, work?.jobId, work?.status);
  const error = requestError ?? work?.error ?? refreshError;
  const nextPrompt = work ? followUp : prompt;

  useEffect(() => {
    if (work?.requestId && startRequest.current?.requestId === work.requestId) {
      startRequest.current = null;
      setFollowUp('');
    }
  }, [work?.requestId]);

  async function request(action: Action) {
    if (
      inFlight.current ||
      !selfId ||
      (action === 'start' ? !nextPrompt.trim() || active || !canControl : !work || !canControl)
    )
      return;
    inFlight.current = true;
    setPending(action);
    setRequestError(null);
    try {
      if (
        action === 'start' &&
        (startRequest.current?.objectId !== object.id || startRequest.current.prompt !== nextPrompt.trim())
      ) {
        startRequest.current = { objectId: object.id, prompt: nextPrompt.trim(), requestId: crypto.randomUUID() };
      }
      const body =
        action === 'start'
          ? {
              roomId,
              actor: selfId,
              objectId: object.id,
              requestId: startRequest.current?.requestId,
              prompt: nextPrompt.trim(),
              provider: work?.provider ?? 'spark',
            }
          : { roomId, actor: selfId, jobId: work?.jobId };
      const response = await fetch(`/api/work/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        const message =
          result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
            ? result.error
            : `Could not ${action} work (${response.status}).`;
        throw new Error(message);
      }
      // Status and artifacts arrive through the canonical room state, never an optimistic completion.
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : `Could not ${action} work.`);
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  return (
    <section
      aria-label="Work card"
      style={{
        height: '100%',
        overflow: 'auto',
        padding: '12px 18px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          role="status"
          aria-live="polite"
          style={{ color: active ? '#426627' : '#66725f', textTransform: 'capitalize' }}
        >
          {work?.status ?? 'Ready to start'}
        </span>
        {work && (
          <span style={{ color: '#85907c', fontSize: 11 }}>{work.provider === 'spark' ? 'Spark' : 'Codex'}</span>
        )}
      </div>
      <label style={label}>
        Title
        <input
          aria-label="Work title"
          value={object.title}
          maxLength={200}
          style={field}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </label>
      <label style={label}>
        Owner
        <input
          aria-label="Work owner"
          placeholder="Unassigned"
          value={owner}
          maxLength={200}
          style={field}
          onChange={(event) => patch({ data: { owner: event.target.value } })}
        />
      </label>
      {work && !active && (
        <p style={{ margin: 0, color: '#66725f', fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {prompt}
        </p>
      )}
      <label style={{ ...label, flex: '1 0 auto' }}>
        {work && !active ? 'Follow-up request' : 'Request'}
        <textarea
          aria-label={work && !active ? 'Work follow-up' : 'Work request'}
          value={active ? prompt : nextPrompt}
          placeholder={
            work ? 'Describe the next change for this workspace…' : 'Describe the work and the result you need…'
          }
          readOnly={active || pending !== null || !canControl}
          rows={3}
          maxLength={6000}
          style={{ ...field, resize: 'vertical', minHeight: 68, lineHeight: 1.45 }}
          onChange={(event) =>
            work ? setFollowUp(event.target.value) : patch({ data: { prompt: event.target.value } })
          }
        />
      </label>
      {work?.execution && (
        <details style={{ fontSize: 12, color: '#66725f', overflowWrap: 'anywhere' }}>
          <summary style={{ cursor: 'pointer' }}>
            Local workspace · {work.execution.files.length} files · {work.execution.commands.length} commands
          </summary>
          {work.execution.continued && <p>Continued the same Codex task.</p>}
          {work.execution.files.map((file) => (
            <div key={file.path}>
              <code>{file.path}</code> · {file.bytes} bytes
            </div>
          ))}
          {work.execution.commands.map((command) => (
            <div key={command.id} style={{ marginTop: 5 }}>
              <code>{command.command}</code>
              <br />
              {command.status}
              {command.exitCode !== null ? ` · exit ${command.exitCode}` : ''}
            </div>
          ))}
        </details>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, color: '#9b493c', fontSize: 12, overflowWrap: 'anywhere' }}>
          {error}
        </p>
      )}
      <div className="widget-work-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {active ? (
          <button
            type="button"
            className="widget-quiet"
            style={button}
            disabled={pending !== null || !selfId || !canControl}
            title={canControl ? undefined : 'Only the person who started this run can cancel it.'}
            onClick={() => void request('cancel')}
          >
            {pending === 'cancel' ? 'Cancelling…' : 'Cancel'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="widget-primary"
              style={button}
              disabled={pending !== null || !selfId || !nextPrompt.trim() || !canControl}
              onClick={() => void request('start')}
            >
              {pending === 'start' ? 'Starting…' : work ? 'Continue work' : 'Start work'}
            </button>
            {resumable && (
              <button
                type="button"
                className="widget-quiet"
                style={button}
                disabled={pending !== null || !selfId || !canControl}
                title={
                  canControl
                    ? 'Resume the previous run with its original request.'
                    : 'Only the person who started this run can resume it.'
                }
                onClick={() => void request('resume')}
              >
                {pending === 'resume' ? 'Resuming…' : 'Resume'}
              </button>
            )}
          </>
        )}
        {work?.artifactIds.map((id, index) => (
          <button
            key={id}
            type="button"
            className="widget-quiet"
            style={button}
            disabled={!onOpenArtifact}
            onClick={() => onOpenArtifact?.(id)}
          >
            {work.artifactIds.length === 1 ? 'Open artifact' : `Open artifact ${index + 1}`}
          </button>
        ))}
      </div>
    </section>
  );
}

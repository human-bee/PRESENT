import { ActivitySettings } from './activity-config';
import { ActivityHeader } from './activity-header';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useEditor, useValue } from 'tldraw';
import { activityTemplates, readRoomOS, type Activity } from '../../shared/activity';
import { useWidgetRuntime } from '../tldraw/widget-runtime';
import { useActions } from './activity-api';
import { DebateFloor } from './debate-floor';
import { MeetingFloor } from './meeting-floor';
import { AudienceFloor } from './audience-floor';
import { ConversationEntry } from './conversation-entry';
import { EvidenceSpace } from './evidence-space';
import './activity.css';
export { ActivityController } from './activity-controller';

export function ActivityWidget({ activityId }: { activityId: string }) {
  const editor = useEditor(),
    runtime = useWidgetRuntime();
  const os = useValue('native-activity', () => readRoomOS(editor.store.allRecords()), [editor]);
  const a = os.activities.find((a) => a.id === activityId);
  return a ? (
    <ActivityStage
      activity={a}
      roomId={runtime.roomId}
      selfId={runtime.selfId}
      name={localStorage.getItem('present:name') || 'Guest'}
      active={os.activeId === a.id}
      embedded
    />
  ) : null;
}
export function ActivityStage({
  activity: a,
  roomId,
  selfId,
  name,
  active,
  close,
  embedded = false,
}: {
  activity: Activity;
  roomId: string;
  selfId: string;
  name: string;
  active: boolean;
  close?: () => void;
  embedded?: boolean;
}) {
  const { send, error } = useActions(roomId, a.id, selfId);
  const [settings, setSettings] = useState(false),
    [history, setHistory] = useState(false),
    [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState(''),
    [posting, setPosting] = useState(false),
    joined = useRef('');
  const seat = a.seats.find((s) => s.actor === selfId),
    pending = a.utterances.some((u) => u.epoch === a.epoch && ['pending', 'running'].includes(u.extraction));
  useEffect(() => {
    if (embedded || seat || joined.current === a.id) return;
    joined.current = a.id;
    void send({ type: 'seat', sideId: null, name });
  }, [a.id, embedded, name, seat, send]);
  const current = {
    ...a,
    claims: a.claims.filter((c) => c.epoch === a.epoch),
    visuals: a.visuals.filter((v) => v.epoch === a.epoch),
    charts: a.charts.filter((c) => c.epoch === a.epoch),
    observations: a.observations.filter((o) => o.source.epoch === a.epoch),
    comparisons: a.comparisons.filter((c) => c.source.epoch === a.epoch),
  };
  async function say(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || posting) return;
    setPosting(true);
    if (await send({ type: 'say', text: draft })) setDraft('');
    setPosting(false);
  }
  return (
    <section
      className={`room-activity room-activity-${a.kind}`}
      aria-label={`${activityTemplates[a.kind].label} activity`}
    >
      <ActivityHeader a={a} active={active} send={send} close={close} onSettings={() => setSettings(!settings)} />
      {settings && <ActivitySettings a={a} send={send} onClose={() => setSettings(false)} />}
      <nav className="activity-flow-nav" aria-label="Activity views">
        <span>{pending ? '✦ Following that thought…' : '✦ Ready for the next thought'}</span>
        <div>
          <button
            type="button"
            onClick={() => {
              setHistory(false);
              setAdvanced(false);
            }}
          >
            The floor
          </button>
          <button
            type="button"
            aria-pressed={history}
            onClick={() => {
              setHistory(!history);
              setAdvanced(false);
            }}
          >
            Room memory
          </button>
          <button
            type="button"
            aria-label="Evidence & comparisons"
            aria-pressed={advanced}
            onClick={() => {
              setAdvanced(!advanced);
              setHistory(false);
            }}
          >
            Tools & sources
          </button>
        </div>
      </nav>
      <div className="activity-body">
        {history ? (
          <section className="activity-memory">
            <h2>How we got here</h2>
            <p>
              Original words and source quotes travel with every interpretation. {a.omitted} older conversation entries
              have left the retained window.
            </p>
            {[...a.events].reverse().map((e) => (
              <article key={e.id}>
                <time>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                <div>
                  <strong>{a.seats.find((s) => s.actor === e.actor)?.name ?? e.actor}</strong>
                  <p>{e.text}</p>
                </div>
              </article>
            ))}
          </section>
        ) : advanced ? (
          <EvidenceSpace activity={current} send={send} />
        ) : a.kind === 'standup' ? (
          <MeetingFloor activity={a} selfId={selfId} name={name} roomId={roomId} send={send} />
        ) : a.kind === 'live' ? (
          <AudienceFloor
            activity={a}
            selfId={selfId}
            name={name}
            roomId={roomId}
            send={send}
            viewer={new URLSearchParams(location.search).get('audience') === a.id}
          />
        ) : (
          <DebateFloor activity={current} selfId={selfId} name={name} send={send} />
        )}
        {a.kind !== 'live' && !history && (
          <section className="activity-conversation">
            <header>
              <h2>
                In the conversation <span>{a.utterances.length}</span>
              </h2>
              <p>Say it naturally. The room keeps the thread.</p>
            </header>
            <div className="conversation-feed" role="log" aria-label="Raw conversation">
              {a.utterances.slice(-8).map((u) => (
                <ConversationEntry key={u.id} utterance={u} activity={a} send={send} />
              ))}
            </div>
          </section>
        )}
      </div>
      {a.kind !== 'live' && (
        <form className="live-room-composer" onSubmit={say}>
          <span className="conversation-avatar">{(seat?.name ?? name).slice(0, 1)}</span>
          <textarea
            aria-label="Add to the conversation"
            placeholder="Speak, or add a thought here…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            maxLength={1500}
          />
          <button type="submit" disabled={!draft.trim() || posting}>
            {posting ? 'Saving…' : 'Add thought ↗'}
          </button>
        </form>
      )}
      {error && (
        <div className="activity-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

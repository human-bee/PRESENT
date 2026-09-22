import { shapeIdForObject } from '../../shared/tldraw-adapter';
import { fitCanvas } from '../tldraw/focus';
import { useEffect, useState, useRef } from 'react';
import { useValue, type Editor } from 'tldraw';
import { activityKinds, activityTemplates, readRoomOS, type ActivityKind } from '../../shared/activity';
import { post } from './activity-api';
import { ActivityStage } from './activity-stage';
const palette = ['#f39376', '#93b8f1', '#c7b0ed', '#8bc9b2', '#e8c878', '#e8a5cb'];
export function ActivityController({
  editor,
  roomId,
  selfId,
  name,
  connected,
}: {
  editor: Editor | null;
  roomId: string;
  selfId: string;
  name: string;
  connected: boolean;
}) {
  const os = useValue('activity-controller', () => readRoomOS(editor?.store.allRecords() ?? []), [editor]);
  const [menu, setMenu] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(
    () => new URLSearchParams(location.search).get('activity') ?? new URLSearchParams(location.search).get('audience') ?? sessionStorage.getItem(`present:activity:${roomId}`),
  );
  const [error, setError] = useState(''),
    [launching, setLaunching] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<{ objectId: string }>).detail.objectId;
      if (editor?.getShape(shapeIdForObject(id))) {
        setFocusId(null);
        fitCanvas(editor, [shapeIdForObject(id)]);
      }
    };
    window.addEventListener('present:open-work', open);
    return () => window.removeEventListener('present:open-work', open);
  }, [editor]);
  const focused = os.activities.find((a) => a.id === focusId),
    active = os.activities.find((a) => a.id === os.activeId);
  const focusedId = focused?.id;
  useEffect(() => {
    void fetch(`/api/activity/state?roomId=${roomId}`);
  }, [roomId]);
  useEffect(() => {
    if (focusId) sessionStorage.setItem(`present:activity:${roomId}`, focusId);
    else sessionStorage.removeItem(`present:activity:${roomId}`);
  }, [focusId, roomId]);
  useEffect(() => {
    if (!focusedId) return;
    dialog.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select')) {
        setFocusId(null);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [focusedId]);
  async function launch(kind: ActivityKind) {
    if (!editor || launching) return;
    setLaunching(true);
    setError('');
    try {
      const viewport = editor.getViewportPageBounds();
      const result = await post('launch', {
        roomId,
        actor: selfId,
        requestId: crypto.randomUUID(),
        kind,
        pageId: editor.getCurrentPageId(),
        position: { x: viewport.x + 100, y: viewport.y + 100 },
      });
      setFocusId(result.activityId);
      setMenu(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The activity could not open.');
    } finally {
      setLaunching(false);
    }
  }
  return (
    <>
      <div className="activity-switcher overlay">
        <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu}>
          ◈ Activities
        </button>
        {active && !focused && (
          <button type="button" className="activity-reopen" onClick={() => setFocusId(active.id)}>
            Open {activityTemplates[active.kind].label}
          </button>
        )}
      </div>
      {menu && (
        <section className="activity-menu overlay" aria-label="Choose an activity">
          <p className="activity-eyebrow">THE ROOM IS READY WHEN YOU ARE</p>
          <h2>What brings you together?</h2>
          <div className="activity-template-grid">
            {activityKinds.map((kind, index) => (
              <button type="button" key={kind} disabled={!connected || launching} onClick={() => void launch(kind)}>
                <span style={{ color: palette[index] }}>{['↔', '◒', '◉', '◇', '↺'][index]}</span>
                <strong>{activityTemplates[kind].label}</strong>
                <small>{activityTemplates[kind].description}</small>
              </button>
            ))}
          </div>
          {os.activities.length > 0 && (
            <div className="activity-existing">
              <small>IN THIS ROOM</small>
              {os.activities.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  onClick={() => {
                    setFocusId(a.id);
                    setMenu(false);
                  }}
                >
                  {a.topic} →
                </button>
              ))}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
      {focused && (
        <div
          ref={dialog}
          tabIndex={-1}
          className="activity-focus overlay"
          role="dialog"
          aria-label={`${activityTemplates[focused.kind].label} room`}
        >
          <ActivityStage
            activity={focused}
            roomId={roomId}
            selfId={selfId}
            name={name}
            active={os.activeId === focused.id}
            close={() => setFocusId(null)}
          />
        </div>
      )}
    </>
  );
}

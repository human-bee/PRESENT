import type { TLRecord, TLShape } from '@tldraw/tlschema';
import { getIndexAbove, type JsonObject } from '@tldraw/utils';
import {
  readRoomOS,
  retainActivity,
  makeActivity,
  type RoomOS,
  type Activity,
  type ActivityKind,
} from '../../shared/activity';
import { makeObject } from '../../shared/room';
import { objectToShape } from '../../shared/tldraw-adapter';
import { getCanvasRecords, transactCanvas, RoomError, type RoomStore, type NativeMutation } from '../room-store';
import { requireCanvasPage } from '../tldraw-operations';
import { activityEvent, failActivity } from './activity-mutations';
export type ActivityStore = Pick<RoomStore, 'getCanvasRecords' | 'transactCanvas'>;
type Update = ((os: RoomOS, records: TLRecord[]) => NativeMutation) | ((os: RoomOS, records: TLRecord[]) => void);
export class NativeActivities {
  private recovered = new Set<string>();
  constructor(private store: ActivityStore = { getCanvasRecords, transactCanvas }) {}
  read(room: string) {
    return readRoomOS(this.store.getCanvasRecords(room));
  }
  activity(os: RoomOS, id: string) {
    return os.activities.find((a) => a.id === id) ?? failActivity('This activity is no longer available.');
  }
  commit(room: string, actor: string, input: unknown, update: Update, requestId?: string) {
    return this.store.transactCanvas(
      room,
      input,
      actor,
      (records) => {
        const os = readRoomOS(records),
          mutation = update(os, records) ?? {};
        os.activities = os.activities.map(retainActivity);
        if (Buffer.byteLength(JSON.stringify(os)) > 650000)
          throw new RoomError('Activity history is full. Start a new room to preserve this history.', 413);
        const document = records.find((r) => r.typeName === 'document'),
          present = document?.meta.present;
        return {
          ...mutation,
          documentMeta: {
            present: {
              ...(present && typeof present === 'object' && !Array.isArray(present) ? present : {}),
              roomOS: os,
            } as unknown as JsonObject,
          },
        };
      },
      requestId ? { requestId } : {},
    );
  }
  update(room: string, id: string, update: (a: Activity) => void) {
    this.commit(room, 'room:enrichment', { activity: id }, (os) => update(this.activity(os, id)));
  }
  stage(
    records: TLRecord[],
    actor: string,
    id: string,
    kind: ActivityKind,
    topic: string | undefined,
    position: { x: number; y: number },
    page?: string,
  ) {
    const a = makeActivity(kind, actor, id, topic),
      pageId = requireCanvasPage(records, page);
    const indices = records
      .filter((r): r is TLShape => r.typeName === 'shape' && r.parentId === pageId)
      .map((r) => r.index)
      .sort();
    const object = {
      ...makeObject('widget', actor, position, { capability: 'activity-stage', activityId: id }),
      id,
      title: a.topic,
      w: 1180,
      h: 780,
    };
    return { a, shape: objectToShape(object, { parentId: pageId, index: getIndexAbove(indices.at(-1)) }) };
  }
  recover(room: string) {
    if (this.recovered.has(room)) return;
    this.recovered.add(room);
    const os = this.read(room);
    const active = (a: Activity) =>
      a.utterances.some((u) => ['pending', 'running'].includes(u.extraction)) ||
      a.claims.some((c) => ['pending', 'running'].includes(c.research.status)) ||
      a.visuals.some((v) => v.status === 'pending') ||
      a.comparisons.some((c) => ['pending', 'running'].includes(c.status)) ||
      a.resolutionSuggestions.some((s) => ['pending', 'checking'].includes(s.status)) ||
      a.meeting.members.some((m) => m.status === 'pending') ||
      a.meeting.commitments.some((c) => c.status === 'dispatching') ||
      ['connecting', 'connected'].includes(a.audience.connection?.status ?? '');
    if (!os.activities.some(active)) return;
    this.commit(room, 'room:system', { recovery: true }, (next) => {
      for (const a of next.activities) {
        for (const u of a.utterances)
          if (['pending', 'running'].includes(u.extraction)) {
            u.extraction = 'failed';
            u.error = 'Server restarted. Retry interpretation when ready.';
          }
        for (const c of a.claims)
          if (['pending', 'running'].includes(c.research.status)) {
            c.research.status = 'failed';
            c.research.error = 'Server restarted. Retry the source check.';
          }
        for (const v of a.visuals)
          if (v.status === 'pending') {
            v.status = 'failed';
            v.error = 'Server restarted before this image arrived.';
          }
        for (const c of a.comparisons)
          if (['pending', 'running'].includes(c.status)) {
            c.status = 'failed';
            c.error = 'Server restarted before the source comparison finished.';
          }
        for (const s of a.resolutionSuggestions)
          if (['pending', 'checking'].includes(s.status)) {
            s.status = 'review';
            s.reason = 'Server restarted; the owner can review this interpretation.';
          }
        for (const m of a.meeting.members)
          if (m.status === 'pending') {
            m.status = 'failed';
            m.error = 'Read this profile again when ready.';
          }
        for (const c of a.meeting.commitments)
          if (c.status === 'dispatching' && !c.jobId) {
            c.status = 'failed';
            c.error = 'Retry dispatch to reconcile the existing work request.';
          }
        if (a.audience.connection && ['connecting', 'connected'].includes(a.audience.connection.status)) {
          a.audience.connection.status = 'failed';
          a.audience.connection.error = 'Reconnect the audience feed when ready.';
        }
        activityEvent(a, 'room:system', 'Restored the room; interrupted enrichments need review or retry.');
      }
    });
  }
}

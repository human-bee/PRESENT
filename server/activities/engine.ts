import { sealUtterance } from './speech-provenance';
import { activityLaunchSchema, activityRequestSchema } from '../../shared/activity';
import { NativeActivities, type ActivityStore } from './activity-store';
import { ActivityEffects, type EffectProviders } from './activity-effects';
import { MeetingCoordinator } from './meeting';
import { AudienceCoordinator } from './audience';
import { appendUtterance, applyActivityCommand, activityEvent, failActivity, hashId } from './activity-mutations';

export type VoiceProvenance = { actor: string; name: string; capture: 'personal' | 'shared' };
/** Orchestration only. All transitions commit to the existing native document. */
export class ActivityEngine {
  private native: NativeActivities;
  private effects: ActivityEffects;
  readonly meetings: MeetingCoordinator;
  readonly audience: AudienceCoordinator;
  constructor(
    store?: ActivityStore,
    providers: Partial<EffectProviders> = {},
    meetingServices?: ConstructorParameters<typeof MeetingCoordinator>[1],
  ) {
    this.native = new NativeActivities(store);
    const access = {
      read: (room: string) => this.native.read(room).activities,
      update: this.native.update.bind(this.native),
    };
    this.meetings = new MeetingCoordinator(access, meetingServices);
    this.audience = new AudienceCoordinator(access);
    this.effects = new ActivityEffects(access, this.meetings, providers);
  }
  read(room: string) {
    return this.native.read(room);
  }
  recover(room: string) {
    this.native.recover(room);
  }
  launch(raw: unknown) {
    const input = activityLaunchSchema.parse(raw);
    this.recover(input.roomId);
    const id = `activity-${hashId([input.roomId, input.requestId])}`;
    this.native.commit(
      input.roomId,
      input.actor,
      input,
      (os, records) => {
        if (os.activities.length >= 4) failActivity('This room already has four activities.');
        const { a, shape } = this.native.stage(
          records,
          input.actor,
          id,
          input.kind,
          input.topic,
          input.position,
          input.pageId,
        );
        os.activities.push(a);
        os.activeId = id;
        activityEvent(a, input.actor, `Opened ${input.kind}`, input.requestId);
        return { creates: [shape] };
      },
      `activity:${hashId([input.actor, input.requestId])}`,
    );
    return { activityId: id };
  }
  act(raw: unknown) {
    const input = activityRequestSchema.parse(raw);
    this.recover(input.roomId);
    this.native.commit(
      input.roomId,
      input.actor,
      input,
      (os) => {
        const a = this.native.activity(os, input.activityId);
        const handled =
          this.audience.reduce(input.roomId, a, input.command, input.actor, input.requestId) ||
          this.meetings.reduce(input.roomId, a, input.command, input.actor, input.requestId);
        if (!handled) applyActivityCommand(a, input.command, input.actor, input.requestId);
        else activityEvent(a, input.actor, `Room action: ${input.command.type}`, input.requestId);
        if (input.command.type === 'say') {
          const u = a.utterances.find((u) => u.id === `speech-${hashId([input.actor, input.requestId])}`);
          if (u) sealUtterance(input.roomId, a, u);
        }
        if (input.command.type === 'activate') os.activeId = a.id;
      },
      `activity:${hashId([input.actor, input.requestId])}`,
    );
    this.effects.schedule(input.roomId);
    this.meetings.afterAction(input.roomId);
    this.audience.afterAction(input.roomId);
    return { accepted: true, requestId: input.requestId };
  }
  ingestVoice(
    room: string,
    session: string,
    entry: { id: string; text: string; role: string },
    provenance?: VoiceProvenance,
  ) {
    if (entry.role !== 'user') return;
    this.recover(room);
    const os = this.read(room),
      a = os.activities.find((a) => a.id === os.activeId);
    if (!a?.ambient) return;
    const personal = provenance?.capture === 'personal',
      actor = personal ? provenance.actor : null;
    const id = `voice-${hashId([session, entry.id])}`;
    this.native.commit(
      room,
      actor ?? 'room:audio',
      { id, text: entry.text, actor },
      (next) => {
        const current = this.native.activity(next, a.id);
        if (actor && !current.seats.some((s) => s.actor === actor) && current.seats.length < 24)
          current.seats.push({ actor, name: provenance?.name ?? 'Participant', sideId: null });
        appendUtterance(current, {
          id,
          text: entry.text.slice(0, 1500),
          at: Date.now(),
          source: personal ? 'participant-voice' : 'room-voice',
          speakerId: actor,
          speakerName: personal
            ? (current.seats.find((s) => s.actor === actor)?.name ?? provenance.name)
            : 'Shared microphone · speaker unknown',
          sideId: current.seats.find((s) => s.actor === actor)?.sideId ?? null,
        });
        const u = current.utterances.find((u) => u.id === id);
        if (u) sealUtterance(room, current, u);
      },
      id,
    );
    this.effects.schedule(room);
  }
  async settled() {
    await this.effects.settled();
    await this.meetings.settled();
  }
  close() {
    this.effects.close();
    this.meetings.close();
    this.audience.close();
  }
}
export const activityEngine = new ActivityEngine();

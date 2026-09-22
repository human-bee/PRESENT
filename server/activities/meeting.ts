import { enrichProfiles } from './profile-enrichment';
import { reduceMeeting } from './meeting-transitions';
import { grant, resolution, signResolution } from './meeting-authorization';
import {hashId as hash,failActivity as fail} from './activity-mutations';
import type { Activity, ActivityCommand, Utterance } from '../../shared/activity';
import { type Meeting } from '../../shared/meeting';
import { startWork, getWork, cancelWork } from '../agents/work-jobs';

import { ActivityAuthority } from './authority';
import { fetchLinearProfile } from './linear';

type Access = {
  read: (roomId: string) => Activity[];
  update: (roomId: string, activityId: string, update: (activity: Activity) => void) => void;
};
type Services = {
  start: typeof startWork;
  cancel?: typeof cancelWork;
  get: typeof getWork;
  profile: typeof fetchLinearProfile;
  authority: ActivityAuthority;
};
type Blocker = Meeting['blockers'][number];

export class MeetingCoordinator {
  private pending = new Map<string, Promise<void>>();
  private controllers = new Set<AbortController>();
  private monitored = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(
    private access: Access,
    private services: Services = {
      start: startWork,
      get: getWork,
      profile: fetchLinearProfile,
      authority: new ActivityAuthority(),
    },
  ) {}
  private signResolution(
    roomId: string,
    a: Activity,
    b: Blocker,
    actor: string,
    text: string,
    utteranceId: string | null,
  ) {
    signResolution(roomId, a, b, actor, text, utteranceId, this.services.authority);
  }
  applyResolution(roomId: string, a: Activity, u: Utterance, blockerId: string, decision: 'confirm' | 'retract') {
    const blocker = a.meeting.blockers.find((b) => b.id === blockerId) ?? fail('That blocker is missing.');
    if (!u.speakerId || u.speakerId !== blocker.ownerId) fail('Only the known blocker owner can resolve it.');
    if (decision === 'confirm') this.signResolution(roomId, a, blocker, u.speakerId as string, u.text, u.id);
    else {
      blocker.status = 'open';
      blocker.proof = '';
      blocker.resolution = null;
    }
  }
  cancelDependents(roomId: string, activityId: string, blockerId: string) {
    const a = this.access.read(roomId).find((a) => a.id === activityId);
    if (!a) return;
    for (const c of a.meeting.commitments.filter(
      (c) =>
        c.blockedBy.includes(blockerId) && c.jobId && c.authorizedBy && ['running', 'dispatching'].includes(c.status),
    )) {
      try {
        (this.services.cancel ?? cancelWork)(roomId, c.jobId as string, c.authorizedBy as string);
      } catch {
        this.access.update(roomId, a.id, (next) => {
          const target = next.meeting.commitments.find((x) => x.id === c.id);
          if (target) target.error = 'A blocker was retracted. Review the existing work card before continuing.';
        });
      }
    }
  }

  reduce(roomId: string, a: Activity, command: ActivityCommand, actor: string, requestId: string) {
    return reduceMeeting(roomId, a, command, actor, requestId, this.services.authority, this.signResolution.bind(this));
  }
  afterAction(roomId: string) {
    if (this.closed) return;
    for (const a of this.access.read(roomId)) {
      enrichProfiles(roomId, a, this.access, this.services.profile, this.pending, this.controllers);
      for (const c of a.meeting.commitments) {
        if (c.jobId) {
          this.monitor(roomId);
          continue;
        }
        if (
          c.status !== 'blocked' ||
          !c.authorizedBy ||
          !this.services.authority.verify(grant(roomId, a.id, c), c.authorization)
        )
          continue;
        if (
          c.authorizedDependencies.length !== c.blockedBy.length ||
          c.authorizedDependencies.some(
            (expected) =>
              !a.meeting.blockers.some(
                (b) => b.id === expected.id && b.title === expected.title && b.ownerId === expected.ownerId,
              ),
          )
        )
          continue;
        const blockers = c.blockedBy.map((id) => a.meeting.blockers.find((b) => b.id === id));
        if (
          blockers.some(
            (b) => b?.status !== 'resolved' || !this.services.authority.verify(resolution(roomId, a.id, b), b.proof),
          )
        )
          continue;
        // WorkJobs owns persistence, deduplication, workspace confinement, cancellation and resumption.
        this.access.update(roomId, a.id, (next) => {
          const target = next.meeting.commitments.find((t) => t.id === c.id);
          if (target) target.status = 'dispatching';
        });
        try {
          const job = this.services.start({
            roomId,
            actor: c.authorizedBy,
            requestId: `meeting-${hash([roomId, a.id, c.id])}`,
            title: c.title,
            prompt: c.prompt,
            owner: c.ownerId,
            provider: 'spark',
            position: {
              x: 100,
              y: 1000 + a.meeting.commitments.indexOf(c) * 430,
            },
          });
          this.access.update(roomId, a.id, (next) => {
            const target = next.meeting.commitments.find((t) => t.id === c.id);
            if (target) {
              target.jobId = job.jobId;
              target.objectId = job.objectId;
              target.status = job.status === 'queued' ? 'running' : job.status;
            }
          });
          this.monitor(roomId);
        } catch (error) {
          this.access.update(roomId, a.id, (next) => {
            const target = next.meeting.commitments.find((t) => t.id === c.id);
            if (target) {
              target.status = 'failed';
              target.error = String(error instanceof Error ? error.message : 'Dispatch failed.').slice(0, 250);
            }
          });
        }
      }
    }
  }
  private monitor(roomId: string) {
    this.monitored.add(roomId);
    if (!this.timer) {
      this.timer = setInterval(() => {
        for (const room of this.monitored) this.refresh(room);
      }, 1500);
      this.timer.unref();
    }
  }
  refresh(roomId: string) {
    let running = false;
    for (const a of this.access.read(roomId))
      for (const c of a.meeting.commitments) {
        if (!c.jobId) continue;
        try {
          const job = this.services.get(roomId, c.jobId),
            status = job.status === 'queued' ? 'running' : job.status;
          if (status === 'running') running = true;
          if (c.status !== status || c.error !== job.error)
            this.access.update(roomId, a.id, (next) => {
              const target = next.meeting.commitments.find((t) => t.id === c.id);
              if (target) {
                target.status = status;
                target.error = job.error?.slice(0, 250) ?? null;
              }
            });
        } catch {
          /* An unavailable private job must not be replayed automatically. */
        }
      }
    if (running) this.monitor(roomId);
    else this.monitored.delete(roomId);
    if (!this.monitored.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  async settled() {
    await Promise.allSettled(this.pending.values());
  }
  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const c of this.controllers) c.abort();
  }
}

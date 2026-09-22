import {pendingEffects,type Effect} from './pending-effects';
import { effectFailure } from './effect-failure';
import { resolveSpoken } from './spoken-resolution';

import type { Activity } from '../../shared/activity';
import { chartSchema } from '../../shared/activity';
import { interpretConversation, verifyResolution } from './interpret-conversation';
import { researchClaim } from './research-claim';
import { searchImages } from './search-images';
import { researchComparison } from './research-comparison';
import { applyInterpretation } from './apply-interpretation';

import type { MeetingCoordinator } from './meeting';
type Access = {
  read: (room: string) => Activity[];
  update: (room: string, activity: string, update: (a: Activity) => void) => void;
};
export type EffectProviders = {
  extract: typeof interpretConversation;
  research: typeof researchClaim;
  images: typeof searchImages;
  data: typeof researchComparison;
  verify: typeof verifyResolution;
};

export class ActivityEffects {
  private tasks = new Map<string, { promise: Promise<void>; controller: AbortController }>();
  private rooms = new Set<string>();
  private closed = false;
  private providers: EffectProviders;
  constructor(
    private access: Access,
    private meetings: MeetingCoordinator,
    providers: Partial<EffectProviders> = {},
  ) {
    this.providers = {
      extract: interpretConversation,
      research: researchClaim,
      images: searchImages,
      data: researchComparison,
      verify: verifyResolution,
      ...providers,
    };
  }
  schedule(room: string) {
    if (!this.closed) {
      this.rooms.add(room);
      queueMicrotask(() => this.drain());
    }
  }

  private drain() {
    if (this.closed) return;
    for (const room of this.rooms) {
      let waiting = false;
      for (const a of this.access.read(room))
        for (const effect of pendingEffects(a)) {
          const prefix = `${room}:${a.id}:${effect.type}:`,
            key = prefix + effect.id;
          if (this.tasks.has(key)) continue;
          if (effect.type === 'extract' && [...this.tasks.keys()].some((k) => k.startsWith(prefix))) {
            waiting = true;
            continue;
          }
          if (this.tasks.size >= 4) {
            waiting = true;
            continue;
          }
          const controller = new AbortController();
          const promise = Promise.resolve()
            .then(() => this.run(room, a.id, effect, controller.signal))
            .catch(() => {})
            .finally(() => {
              this.tasks.delete(key);
              this.schedule(room);
            });
          this.tasks.set(key, { promise, controller });
        }
      if (!waiting) this.rooms.delete(room);
    }
  }
  private async run(room: string, activityId: string, effect: Effect, signal: AbortSignal) {
    const a = this.access.read(room).find((a) => a.id === activityId);
    if (!a) return;
    const epoch = a.epoch,
      started = Date.now(),
      combined = AbortSignal.any([signal, AbortSignal.timeout(65000)]);
    const update = (fn: (a: Activity) => void) => {
      if (!this.closed)
        this.access.update(room, activityId, (next) => {
          if (next.epoch === epoch) fn(next);
        });
    };
    const u = a.utterances.find((u) => u.id === effect.id),
      c = a.claims.find((c) => c.id === effect.id),
      v = a.visuals.find((v) => v.id === effect.id);
    try {
      if (effect.type === 'extract' && u) {
        update((next) => {
          const target = next.utterances.find((x) => x.id === u.id);
          if (target) target.extraction = 'running';
        });
        const result = await this.providers.extract(a, u, combined);
        combined.throwIfAborted();
        update((next) => {
          const target = next.utterances.find((x) => x.id === u.id);
          if (target) applyInterpretation(next, target, result, Date.now() - started);
        });
      } else if (effect.type === 'research' && c) {
        update((next) => {
          const target = next.claims.find((x) => x.id === c.id);
          if (target) target.research.status = 'running';
        });
        const evidence = await this.providers.research(c.text, combined);
        combined.throwIfAborted();
        update((next) => {
          const target = next.claims.find((x) => x.id === c.id);
          if (!target || target.version !== c.version || target.research.token !== c.research.token) return;
          target.evidence = evidence;
          target.research.status = 'done';
          target.research.elapsedMs = Date.now() - started;
        });
      } else if (effect.type === 'images' && v) {
        const images = await this.providers.images(v.query, combined);
        combined.throwIfAborted();
        update((next) => {
          const target = next.visuals.find((x) => x.id === v.id);
          if (target) {
            target.images = images;
            target.status = 'done';
          }
        });
      } else if (effect.type === 'data') {
        const comparison = a.comparisons.find((x) => x.id === effect.id);
        if (!comparison) return;
        update((next) => {
          const target = next.comparisons.find((x) => x.id === effect.id);
          if (target) target.status = 'running';
        });
        const result = await this.providers.data(comparison, combined);
        combined.throwIfAborted();
        update((next) => {
          const target = next.comparisons.find((x) => x.id === effect.id);
          if (!target) return;
          target.evidence = result.evidence; target.dataset = { proposal: result.dataset, issues: result.issues ?? [], attempts: result.attempts ?? 1, readSources: result.readSources };
          if (result.rows && next.charts.length < 6) {
            const id = `chart-${target.id}`;
            if (!next.charts.some((c) => c.id === id))
              next.charts.push(
                chartSchema.parse({
                  id,
                  epoch,
                  title: result.dataset.title,
                  unit: result.dataset.unit,
                  sourceUrl: result.rows[0].sourceUrl,
                  sourceTitle: 'Original source measurements',
                  suppliedBy: 'agent:source-reader',
                  provenance: 'source-extracted',
                  scope: result.dataset.scope,
                  caveats: result.dataset.caveats,
                  sourceRows: result.rows,
                  values: result.rows.map((r) => ({ label: r.label, value: r.value })),
                }),
              );
            target.chartId = id;
            target.status = 'ready';
          } else {
            target.status = 'uncertain';
            target.error =
              (result.issues?.length ? 'The proposed chart could not be matched to exact source evidence. The source assessment remains available.' : result.dataset.reason) ||
              'Comparable source measurements could not be established. The evidence is available without a manufactured chart.';
          }
        });
      } else if (effect.type === 'resolution')
        await resolveSpoken(room, a, effect.id, combined, update, this.providers.verify, this.meetings);
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'Enrichment failed. Your conversation is saved.').slice(
        0,
        250,
      );
      update((next) => effectFailure(next, effect, message, c));
    }
  }

  async settled() {
    do {
      await Promise.resolve();
      await Promise.allSettled([...this.tasks.values()].map((t) => t.promise));
    } while (this.tasks.size || this.rooms.size);
  }
  close() {
    this.closed = true;
    this.rooms.clear();
    for (const task of this.tasks.values()) task.controller.abort();
  }
}

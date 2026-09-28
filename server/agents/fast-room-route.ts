import type { Scene } from '../../shared/scenes';
import { decide } from './semantic-decisions';
import { decideReactive, type ReactiveContext } from './reactive-decisions';
import { decideSceneControl } from '../scenes/decide';

type Creation = Awaited<ReturnType<typeof decide>>;
type Reactive = Awaited<ReturnType<typeof decideReactive>>;
type Playback = NonNullable<Awaited<ReturnType<typeof decideSceneControl>>>;
type Dependencies = { creation: typeof decide; reactive: typeof decideReactive; playback: typeof decideSceneControl };
export type FastRoomRoute = { kind: 'creation'; decision: Creation } | { kind: 'reactive'; decision: Reactive } |
  { kind: 'playback'; decision: Playback } | { kind: 'defer'; failure?: string };

/** Selection and existing scenes must not disable the new-instrument fast path.
 * Read-only judgments share one deadline. Ambiguous matches never mutate data.
 */
export async function routeFastRoom(context: ReactiveContext, scenes: Scene[], signal: AbortSignal,
  dependencies: Dependencies = { creation: decide, reactive: decideReactive, playback: decideSceneControl }, budgetMs = 800): Promise<FastRoomRoute> {
  const budget = AbortSignal.any([signal, AbortSignal.timeout(budgetMs)]);
  let failed = false;
  const guarded = async <T>(run: () => Promise<T>) => {
    try { return await run(); } catch { failed = true; return undefined; }
  };
  const [creation, reactive, playback] = await Promise.all([
    guarded(() => dependencies.creation(context.request, 'jev', budget)),
    context.shapes.length ? guarded(() => dependencies.reactive(context, 'jev', budget)) : undefined,
    scenes.length ? guarded(() => dependencies.playback(context.request, scenes, budget)) : undefined,
  ]);
  signal.throwIfAborted();
  const matches: FastRoomRoute[] = [];
  if (creation && creation.route !== 'defer') matches.push({ kind: 'creation', decision: creation });
  if (reactive && reactive.route !== 'defer') matches.push({ kind: 'reactive', decision: reactive });
  if (playback) matches.push({ kind: 'playback', decision: playback });
  if (matches.length === 1 && !failed && !budget.aborted) return matches[0];
  return { kind: 'defer', failure: matches.length > 1 ? 'Conflicting fast routes; using the room model' :
    failed || budget.aborted ? `TypeSafe unavailable or exceeded the ${budgetMs}ms routing budget` : undefined };
}

import { judge } from '../agents/choice-judgments';
import type { Scene, SceneControl } from '../../shared/scenes';
export async function decideSceneControl(request: string, scenes: Scene[], signal: AbortSignal) {
  if (!scenes.length) return null;
  const result = await judge({ request, scenes: scenes.map(s => ({ id: s.id, title: s.plan.title, beats: s.plan.beats })) }, {
    action: { type: 'choice', instructions: 'Select a playback-only operation. New content, revisions, what-if questions, movements of individual objects, compound instructions, or unsupported controls MUST defer.', criteria: {
      play: 'Resume playback', pause: 'Pause playback', restart: 'Replay from the beginning', slow: 'Play at half speed', normal: 'Play at normal speed', fast: 'Play at double speed', defer: 'Any new content, scene change, ambiguous or unsupported request',
    } },
    target: { type: 'choice', instructions: 'Choose the scene explicitly referred to. If there is only one scene and a playback command, choose it. Otherwise choose none when unclear.', criteria: Object.fromEntries([...scenes.map(s => [s.id, s.plan.title]), ['none', 'No unambiguous target']]) },
  }, 'jev', signal);
  const action = result.get('action'), sceneId = result.get('target');
  if (!action || action === 'defer' || !sceneId || sceneId === 'none') return null;
  return { control: { sceneId, action } as SceneControl, modelMs: result.modelMs };
}

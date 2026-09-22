import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { json } from '../http';
import { scenesInRoom } from './store';
import { controlScene, playbackState } from './playback';
import { sceneControlSchema } from '../../shared/scenes';
const input = z.object({ roomId: z.string().regex(/^[a-f0-9]{24,64}$/), control: sceneControlSchema });
export async function handleSceneRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/api/scenes') return false;
  try {
    if (req.method === 'GET') {
      const roomId = z.string().regex(/^[a-f0-9]{24,64}$/).parse(url.searchParams.get('roomId'));
      json(res, 200, { scenes: scenesInRoom(roomId).map(s => ({ id: s.id, pageId: s.pageId, title: s.plan.title, explanation: s.plan.explanation, epistemic: s.plan.epistemic, duration: s.plan.duration, beats: s.plan.beats, sources: s.evidence?.sources ?? [], revision: s.revision, revisions: s.history.length + 1, ...playbackState(roomId, s) })) });
    } else if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2000) throw new Error('Control too large'); }
      const v = input.parse(JSON.parse(raw)); json(res, 200, controlScene(v.roomId, v.control));
    } else json(res, 405, { error: 'Use GET or POST' });
  } catch (e) { json(res, 400, { error: e instanceof Error ? e.message : 'Scene request failed' }); }
  return true;
}

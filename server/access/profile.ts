import type { IncomingMessage, ServerResponse } from 'node:http';
import { configuredAccess, assertAccessOrigin, sessionToken, watchAuthorization, AccessError } from './index';
import { prepareAccessDispatch, dispatchAuthorized } from './dispatch';
import { hostedTemplates } from './templates';
import { mediaRevocations } from '../media-routes';
import { json } from '../http';
import { agentModels } from '../../shared/agent-models';
import { openAIAvailability, usesOpenAIResponses } from '../agents/openai-responses';

export function createInviteProfile(alpha: NonNullable<ReturnType<typeof configuredAccess>>) {
  let streams = 0;
  return async (req: IncomingMessage, res: ServerResponse, dispatch: (req: IncomingMessage) => Promise<void>) => {
    assertAccessOrigin(req, alpha.origin, !['GET', 'HEAD'].includes(req.method ?? ''));
    const url = new URL(req.url ?? '/', alpha.origin);
    if (decodeURIComponent(url.pathname) !== url.pathname) throw new AccessError('Use a canonical path.');
    if (url.pathname === '/api/health' && req.method === 'GET') { json(res, 200, { ok: true, service: 'present', profile: 'invite' }); return; }
    const live = /^\/api\/access\/rooms\/([a-f0-9]{48})\/events$/.exec(url.pathname);
    if (live && req.method === 'GET') {
      const token = sessionToken(req); alpha.access.authorize(token, live[1], 'read');
      if (streams >= 128) throw new AccessError('Connection capacity reached.', 503);
      streams++;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      res.write('event: ready\ndata: {}\n\n');
      const stop = watchAuthorization(alpha.access, token, live[1], () => { res.end('event: ended\ndata: {}\n\n'); });
      const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000); heartbeat.unref();
      res.once('close', () => { streams--; clearInterval(heartbeat); stop(); }); return;
    }
    if (url.pathname === '/api/profile' && req.method === 'GET') { json(res, 200, { profile: 'invite' }); return; }
    const media = /^\/api\/access\/rooms\/([a-f0-9]{48})\/media$/.exec(url.pathname);
    if (media && req.method === 'GET') {
      alpha.access.authorize(sessionToken(req), media[1], 'revoke');
      json(res, 200, mediaRevocations.status(media[1])); return;
    }
    if (await alpha.handleRequest(req, res)) return;
    if (url.pathname.startsWith('/api/templates')) {
      if (!await hostedTemplates(alpha.access, req, res)) throw new AccessError('Unknown template API.', 404);
      return;
    }
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      alpha.access.identity(sessionToken(req));
      await dispatch(req); return; // Coordinator mounts handleProjectRequest in dispatch.
    }
    if (url.pathname === '/api/agents' && req.method === 'GET') {
      alpha.access.identity(sessionToken(req));
      // Bounded API discovery only. Never start a local Codex process in hosted mode.
      const api = usesOpenAIResponses() ? await openAIAvailability() : { providers: [] };
      json(res, 200, { defaultProvider: usesOpenAIResponses() ? 'luna' : 'cerebras', providers: [...api.providers, { id: 'cerebras', name: 'Cerebras', model: agentModels.cerebras, configured: !!process.env.CEREBRAS_API_KEY, reasoning: ['none', 'low', 'medium', 'high'], fast: false, reason: process.env.CEREBRAS_API_KEY ? undefined : 'Cerebras API key not configured.' }], voice: { configured: !!process.env.OPENAI_API_KEY, name: 'GPT-Live', model: 'gpt-live-1' } }); return;
    }
    if (url.pathname === '/api/activity/connectors' && req.method === 'GET') {
      alpha.access.identity(sessionToken(req)); json(res, 200, { linear: { configured: !!process.env.LINEAR_API_KEY }, youtube: { configured: !!process.env.YOUTUBE_API_KEY } }); return;
    }
    if (url.pathname.startsWith('/api/')) {
      const prepared = await prepareAccessDispatch(alpha.access, req);
      await dispatchAuthorized(prepared, res, dispatch); return;
    }
    if (/^\/(mcp|playbook|media|connect)(\/|$)/.test(url.pathname)) throw new AccessError('This local-only surface is unavailable in the invite profile.');
    await dispatch(req);
  };
}

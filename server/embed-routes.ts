import { youtubeBridge } from './youtube-bridge';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { RoomState } from '../shared/room';
import { readVideoReference, videoWrapperPath, youtubeEmbedURL } from '../shared/video-reference';
import { isLocalRequest } from './http';
import { getRoom, RoomError } from './room-store';

const style = 'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}iframe{display:block;width:100%;height:100%;border:0}';
const styleHash = createHash('sha256').update(style).digest('base64');
const scriptHash = createHash('sha256').update(youtubeBridge).digest('base64');
const policy = `default-src 'none'; script-src 'sha256-${scriptHash}' https://www.youtube.com https://s.ytimg.com; style-src 'sha256-${styleHash}'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;

function send(res: ServerResponse, method: string | undefined, status: number, body: string, html = false) {
  res.writeHead(status, {
    'content-type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy': policy,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'cross-origin-resource-policy': 'same-origin',
    // Only the local origin, never the room/object path, reaches the YouTube player.
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), autoplay=(self "https://www.youtube-nocookie.com"), fullscreen=(self "https://www.youtube-nocookie.com"), encrypted-media=(self "https://www.youtube-nocookie.com"), picture-in-picture=(self "https://www.youtube-nocookie.com")',
  });
  res.end(method === 'HEAD' ? undefined : body);
}

export function createEmbedHandler(readRoom: (roomId: string) => RoomState = getRoom) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/embed' && !path.startsWith('/embed/')) return false;
    // Opaque generated iframes cannot navigate into this trusted wrapper. Ordinary
    // non-browser local clients may omit Fetch Metadata, just like other room reads.
    const site = req.headers['sec-fetch-site'];
    if (!isLocalRequest(req, req.socket.localPort ?? 0) || (site !== undefined && site !== 'same-origin')) {
      send(res, req.method, 403, 'Video embeds require a same-origin local frame.'); return true;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD'); send(res, req.method, 405, 'Method not allowed.'); return true;
    }
    const match = /^\/embed\/([a-f0-9]{24,64})\/([^/]+)$/.exec(path);
    let objectId = '';
    try { objectId = match ? decodeURIComponent(match[2]) : ''; } catch { /* Invalid escaped IDs are unavailable. */ }
    if (!match || !videoWrapperPath(match[1], objectId)) { send(res, req.method, 404, 'Video not found.'); return true; }
    try {
      const object = readRoom(match[1]).objects.find(item => item.id === objectId);
      const reference = object?.kind === 'widget' ? readVideoReference(object.data) : null;
      const source = reference && youtubeEmbedURL(reference);
      if (!source) { send(res, req.method, 404, 'Video not found.'); return true; }
      // Every interpolated value is generated from validated ID/integer data.
      // The request query, saved title and arbitrary object fields never enter HTML.
      const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube video</title><style>${style}</style></head><body><iframe id="player" title="YouTube video player" src="${(source + "&enablejsapi=1").replaceAll('&', '&amp;')}" allow="fullscreen; encrypted-media; picture-in-picture; autoplay; camera 'none'; microphone 'none'; geolocation 'none'" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><script>${youtubeBridge}</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
      send(res, req.method, 200, body, true); return true;
    } catch (error) {
      send(res, req.method, error instanceof RoomError ? error.status : 500, 'This video could not be loaded.'); return true;
    }
  };
}

export const handleEmbedRequest = createEmbedHandler();

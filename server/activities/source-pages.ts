import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
export type SourcePage = { id: string; url: string; title: string; text: string; sha256: string };
export const normalizeSource = (value: string) => value.replace(/\s+/g, ' ').trim();
function publicAddress(ip: string) {
  const [a, b] = ip.split('.').map(Number);
  return (
    Number.isInteger(a) &&
    ![0, 10, 127].includes(a) &&
    a < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && b === 168) &&
    !(a === 100 && b >= 64 && b <= 127)
  );
}
async function download(raw: string, signal: AbortSignal, redirects = 0): Promise<string> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('Only public HTTPS source pages can be read.');
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error('Source does not resolve to public addresses.');
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        signal,
        timeout: 8000,
        family: 4,
        headers: { 'User-Agent': 'PRESENT-RoomOS/0.2 (source verification)', 'Accept-Encoding': 'identity' },
        lookup: (_host, _options, done) => done(null, addresses[0].address, 4),
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects >= 2) return reject(new Error('Too many source redirects.'));
          download(new URL(res.headers.location, url).href, signal, redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200 || !/text\/html|text\/plain/.test(res.headers['content-type'] ?? '')) {
          res.resume();
          reject(new Error('This source has no readable HTML text.'));
          return;
        }
        const parts: Buffer[] = [];
        let bytes = 0;
        res.on('data', (part) => {
          bytes += part.length;
          if (bytes > 800000) req.destroy(new Error('Source page is too large.'));
          else parts.push(part);
        });
        res.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Source timed out.')));
    req.on('error', reject);
    req.end();
  });
}
export async function readSourcePage(
  source: { id: string; url: string; title: string },
  signal: AbortSignal,
): Promise<SourcePage> {
  const html = await download(source.url, signal);
  const text = normalizeSource(
    html
      .replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, String.fromCharCode(34))
      .replace(/&#39;|&apos;/g, String.fromCharCode(39)),
  );
  return { ...source, text: text.slice(0, 45000), sha256: createHash('sha256').update(text).digest('hex') };
}

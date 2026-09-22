import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';
export function publicAddress(address: string) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
/** Resolve and pin every redirect destination, preventing DNS rebinding and private-network access. */
export async function publicFetch(raw: string, maxBytes: number, signal?: AbortSignal, redirects = 0): Promise<{ bytes: Buffer; mime: string; url: string }> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || redirects > 3) throw new Error('Unsupported public source URL.');
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Source is not a public internet address.');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, { signal, hostname: address.address, servername: url.hostname, headers: { Host: url.host, 'User-Agent': 'PRESENT/0.1 reference-import', Accept: 'text/html,image/png,image/jpeg,image/webp' } }, res => {
      if ([301,302,303,307,308].includes(res.statusCode ?? 0) && res.headers.location) {
        res.resume(); resolve(publicFetch(new URL(res.headers.location, url).href, maxBytes, signal, redirects + 1)); return;
      }
      if (res.statusCode !== 200 || Number(res.headers['content-length']) > maxBytes) { res.destroy(); reject(new Error('Source unavailable or too large.')); return; }
      let size = 0; const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) res.destroy(new Error('Source is too large.')); else chunks.push(chunk); });
      res.on('error', reject); res.on('end', () => resolve({ bytes: Buffer.concat(chunks), mime: String(res.headers['content-type'] ?? '').split(';')[0], url: url.href }));
    });
    req.setTimeout(10000, () => req.destroy(new Error('Source timed out.'))); req.on('error', reject); req.end();
  });
}

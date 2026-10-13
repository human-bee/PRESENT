import { execFileSync } from 'node:child_process';
import { discoverLaunchCapabilities } from '../server/launch/capabilities';
import { launchReadiness } from '../server/launch/readiness';

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const git = (...arguments_: string[]) => { try { return execFileSync('git', arguments_, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return undefined; } };
let health: 'healthy' | 'unavailable' | 'not-checked' = 'not-checked', observedRevision: string | undefined;
const target = option('--url');
if (target) {
  try {
    const url = new URL(target);
    if (url.origin !== target || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw new Error('Use an exact HTTPS target or explicit loopback origin.');
    const response = await fetch(`${target}/healthz`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    const body = await response.text(); if (body.length > 10000) throw new Error('Health response too large.');
    const value = JSON.parse(body); health = response.ok && value.ok === true ? 'healthy' : 'unavailable'; observedRevision = value.revision;
  } catch { health = 'unavailable'; }
}
const capabilities = args.includes('--offline') ? undefined : await discoverLaunchCapabilities();
const report = launchReadiness({ revision: option('--revision') ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), observedRevision, health, capabilities, replicas: option('--replicas') ? Number(option('--replicas')) : undefined, persistentRoot: option('--persistent-root') ?? process.env.RAILWAY_VOLUME_MOUNT_PATH });
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.gaps.length ? 2 : 0;

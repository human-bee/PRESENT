import { isAbsolute, relative, resolve } from 'node:path';
import type { discoverLaunchCapabilities } from './capabilities';

type Capabilities = Awaited<ReturnType<typeof discoverLaunchCapabilities>>;
type Inputs = { env?: NodeJS.ProcessEnv; revision?: string; branch?: string; observedRevision?: string; health?: 'healthy' | 'unavailable' | 'not-checked'; capabilities?: Capabilities; replicas?: number; persistentRoot?: string };
const under = (root: string, path: string) => { const child = relative(resolve(root), resolve(path)); return child === '' || (!child.startsWith('..') && !isAbsolute(child)); };
const revision = (value?: string) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
/** Operator report only: values of keys, sessions, private records and credentials never enter it. */
export function launchReadiness(input: Inputs = {}) {
  const env = input.env ?? process.env, gaps: string[] = [];
  let origin: string | null = null;
  try { const url = new URL(env.PRESENT_ACCESS_ORIGIN ?? ''); if (url.protocol === 'https:' && url.origin === env.PRESENT_ACCESS_ORIGIN) origin = url.origin; } catch { /* Report below. */ }
  if (env.NODE_ENV !== 'production') gaps.push('NODE_ENV must be production for the public build.');
  if (env.PRESENT_ACCESS_MODE !== 'invite') gaps.push('Public hosting requires the signed invite access profile.');
  if (!origin) gaps.push('PRESENT_ACCESS_ORIGIN must be the exact public HTTPS origin.');
  if ((env.PRESENT_ACCESS_SECRET?.length ?? 0) < 32) gaps.push('A stable high-entropy access secret of at least 32 characters is required; presence/length do not verify entropy.');
  const data = env.PRESENT_DATA_DIRECTORY, access = env.PRESENT_ACCESS_DIRECTORY;
  if (!data || !isAbsolute(data) || !access || !isAbsolute(access)) gaps.push('Both native data and access directories must be explicit absolute private durable paths.');
  for (const path of [data, access]) if (path && ['public', 'dist'].some(root => under(resolve(root), path))) gaps.push('Private storage must be outside static public/dist roots.');
  if (!input.persistentRoot) gaps.push('Persistent mount is not established. Supply the inspected mount with --persistent-root; this records operator evidence, not a filesystem durability test.');
  else if (!isAbsolute(input.persistentRoot) || !data || !access || !under(input.persistentRoot, data) || !under(input.persistentRoot, access)) gaps.push('Native data and access records must both be covered by the inspected absolute persistent mount.');
  if (input.replicas !== 1) gaps.push('Confirm exactly one long-lived writer/replica for this data topology; horizontal replicas and shared network storage are unsupported.');
  const requested = revision(input.revision), observed = revision(input.observedRevision);
  if (!requested) gaps.push('An exact requested source revision is required.');
  if (input.health !== 'healthy') gaps.push('Target health is not verified.');
  if (!observed || observed !== requested) gaps.push('Target must serve the exact requested revision; another healthy revision does not count.');
  const licensePresent = !!env.VITE_TLDRAW_LICENSE_KEY;
  if (!licensePresent) gaps.push('Supply a legitimate VITE_TLDRAW_LICENSE_KEY at build time, then rebuild the frontend. NEXT_PUBLIC_TLDRAW_LICENSE_KEY alone is not the declared native Docker build argument.');
  gaps.push('Verify the built frontend has an active tldraw license valid for the actual public host and appropriate use. Key presence is not license validity; public browser editor acceptance remains required.');
  if (!input.capabilities) gaps.push('Provider account/catalog discovery was not checked.');
  else {
    const sol = input.capabilities.providers.find(provider => provider.id === 'sol');
    if (!sol?.configured) gaps.push('The configured planning transport has not verified the default Sol model.');
    if (!input.capabilities.workspace.supported) gaps.push('Workspace execution is unsupported by the observed runtime/account/default model; API planning does not supply a Codex executor.');
    gaps.push('A separately authorized real planning and workspace run must verify generation, workspace profile, commands and canonical artifact publication; catalog reads do not prove execution.');
  }
  return { status: 'blocked', scope: 'single-operator public launch', configurationSource: 'Current operator process environment; not proof of remote deployment variables.', source: { requestedRevision: requested, branch: input.branch ?? null, observedRevision: observed, exactRevision: !!requested && observed === requested, health: input.health ?? 'not-checked' }, publicOrigin: origin,
    topology: { dataDirectory: data ?? null, accessDirectory: access ?? null, persistentRoot: input.persistentRoot ?? null, replicas: input.replicas ?? null, requirement: 'One long-lived writer; private persistent native rooms, access records, assets and workspaces backed up together.' },
    providers: input.capabilities ?? { status: 'not-checked' },
    license: { buildKeyName: 'VITE_TLDRAW_LICENSE_KEY', buildKeyPresent: licensePresent, alternateKeyPresent: !!env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY, validity: 'unverified', productionRequired: true, documentation: 'https://tldraw.dev/sdk-features/license-key' },
    gaps };
}

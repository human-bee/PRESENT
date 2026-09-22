import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { AgentError } from './contract';

export type WireMessage = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown };
export const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type WireOptions = { cwd?: string; config?: Record<string, unknown> };
function toml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined && item !== null).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(',')}}`;
  if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  throw new AgentError('Invalid server-owned Codex configuration.');
}
// Pass server-owned tables intact. Effective config can merge inherited entries;
// workspace isolation is also checked against the installed app-server config.
export const codexConfigArguments = (config: Record<string, unknown>): string[] => Object.entries(config).flatMap(([key, value]) => {
  if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new AgentError('Invalid server-owned Codex configuration key.');
  return ['-c', `${key}=${toml(value)}`];
});
export function codexEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(['HOME', 'PATH', 'CODEX_HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT'].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
}

/** Server-owned transports reject client-mediated host requests; native tools use the configured sandbox. */
export class CodexWire {
  private child: ChildProcessWithoutNullStreams;
  private next = 1;
  private requests = new Map<number, Pending>();
  readonly listeners = new Set<(message: WireMessage) => void>();
  private markStopped: () => void = () => {};
  readonly stopped = new Promise<void>(resolve => { this.markStopped = resolve; });
  closed = false;
  constructor(command: string, options: WireOptions = {}) {
    this.child = spawn(command, ['app-server', '--stdio', ...codexConfigArguments(options.config ?? {})], { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: codexEnvironment(), detached: process.platform !== 'win32' });
    this.child.stderr.resume();
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', line => {
      let message: WireMessage;
      try { message = record(JSON.parse(line)); } catch { return; }
      if (message.method && message.id !== undefined) {
        this.send(message.method === 'currentTime/read'
          ? { id: message.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } }
          : { id: message.id, error: { code: -32601, message: 'Client-mediated host requests are unavailable.' } });
      } else if (typeof message.id === 'number') {
        const request = this.requests.get(message.id);
        if (!request) return;
        this.requests.delete(message.id); clearTimeout(request.timer);
        if (message.error) {
          const error = new AgentError(`Codex request failed (RPC ${typeof record(message.error).code === 'number' ? record(message.error).code : 'error'}).`);
          error.cause = message.error; request.reject(error);
        }
        else request.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
    this.child.stdin.on('error', () => this.close());
    this.child.stdout.on('error', () => this.close());
    this.child.once('error', () => this.close());
    this.child.once('exit', () => this.close());
  }
  send(message: WireMessage) {
    if (this.closed) return;
    try { this.child.stdin.write(`${JSON.stringify(message)}\n`, error => { if (error) this.close(); }); }
    catch { this.close(); }
  }
  async request<T>(method: string, params: unknown, timeoutMs = 15000): Promise<T> {
    if (this.closed) throw new AgentError(`Codex ${method} unavailable.`, 503);
    const id = this.next++;
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.requests.delete(id);
          reject(new AgentError(`Codex ${method} timed out.`, 504));
          this.close(); // Do not leave a request that can create an orphaned thread later.
        }, timeoutMs);
        this.requests.set(id, { resolve, reject, timer });
        this.send({ id, method, params });
      }) as T;
    } catch (error) {
      if (error instanceof AgentError && !error.message.includes(method)) {
        const wrapped = new AgentError(`Codex ${method}: ${error.message}`, error.status);
        wrapped.cause = error.cause; throw wrapped;
      }
      throw error;
    }
  }
  private kill(signal: NodeJS.Signals) {
    try {
      if (process.platform !== 'win32' && this.child.pid) process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch { /* The owned process group has already exited. */ }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(new AgentError('Codex transport closed before completion.')); }
    this.requests.clear(); this.child.stdin.destroy(); this.kill('SIGTERM');
    setTimeout(() => { this.kill('SIGKILL'); this.markStopped(); }, 1500);
    for (const listener of this.listeners) listener({ method: 'closed' });
    this.listeners.clear();
  }
}

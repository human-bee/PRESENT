# Logging Contract

## Goals

- Keep production logs actionable (`warn`/`error` first).
- Allow targeted deep debugging without code changes.
- Use one logging API across browser, server routes, and agents.

## API

Import from `@/lib/logging` (or `@/lib/utils` for compatibility):

```ts
import { createLogger } from '@/lib/logging';

const logger = createLogger('CanvasAgent');
logger.info('worker started', { room });
const child = logger.child({ requestId });
child.warn('retrying claim');
```

Supported methods:

- `debug(...args)`
- `info(...args)`
- `log(...args)` alias for `info`
- `warn(...args)`
- `error(...args)`
- `once(key, ...args)` logs at most once per logger instance
- `child(context)` namespace/context derivation

## Runtime Controls

Browser:

- `NEXT_PUBLIC_LOG_LEVEL=debug|info|warn|error|silent`
- `NEXT_PUBLIC_DEBUG_NAMESPACES=CanvasAgent,LiveKitBus`
- `localStorage.setItem('present:logLevel', 'debug')`
- `localStorage.setItem('present:debugNamespaces', 'CanvasAgent,LiveKitBus')`

Server/agents:

- `LOG_LEVEL=debug|info|warn|error|silent`
- `DEBUG_NAMESPACES=Conductor,Queue`

## Policy

- Prefer logger usage over raw `console.log/info/debug`.
- `console.warn/error` may be used at hard boundaries only.
- Never log secrets or raw auth tokens.
- Route-level logs should include stable identifiers (room, task, requestId).

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  once: (key: string, ...args: unknown[]) => void;
  child: (context: string | Record<string, unknown>) => Logger;
}

const LEVEL_TO_NUM: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const parseLogLevel = (value: unknown): LogLevel | null => {
  if (typeof value !== 'string') return null;
  const lowered = value.trim().toLowerCase();
  return lowered in LEVEL_TO_NUM ? (lowered as LogLevel) : null;
};

const listFromCsv = (value: unknown): string[] => {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const getRuntimeLogLevel = (): LogLevel => {
  try {
    if (typeof window !== 'undefined') {
      const fromStorage = parseLogLevel(window.localStorage.getItem('present:logLevel'));
      if (fromStorage) return fromStorage;
      const fromPublicEnv = parseLogLevel(process.env.NEXT_PUBLIC_LOG_LEVEL);
      if (fromPublicEnv) return fromPublicEnv;
      return process.env.NODE_ENV === 'development' ? 'warn' : 'error';
    }
  } catch {}

  const fromServerEnv = parseLogLevel(process.env.LOG_LEVEL);
  if (fromServerEnv) return fromServerEnv;
  const fromPublicEnv = parseLogLevel(process.env.NEXT_PUBLIC_LOG_LEVEL);
  if (fromPublicEnv) return fromPublicEnv;
  return process.env.NODE_ENV === 'development' ? 'warn' : 'error';
};

const getDebugNamespaces = (): Set<string> => {
  const values: string[] = [];
  try {
    if (typeof window !== 'undefined') {
      values.push(...listFromCsv(window.localStorage.getItem('present:debugNamespaces')));
      values.push(...listFromCsv(process.env.NEXT_PUBLIC_DEBUG_NAMESPACES));
    } else {
      values.push(...listFromCsv(process.env.DEBUG_NAMESPACES));
      values.push(...listFromCsv(process.env.NEXT_PUBLIC_DEBUG_NAMESPACES));
    }
  } catch {}
  return new Set(values);
};

const shouldLog = (namespace: string, level: LogLevel): boolean => {
  const current = getRuntimeLogLevel();
  const threshold = LEVEL_TO_NUM[current];
  const requested = LEVEL_TO_NUM[level];
  if (requested <= threshold) return true;
  if (level === 'debug' || level === 'info') {
    return getDebugNamespaces().has(namespace.toLowerCase());
  }
  return false;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  return !Array.isArray(value);
};

const mergeContext = (
  context: Record<string, unknown> | undefined,
  args: unknown[],
): unknown[] => {
  if (!context || Object.keys(context).length === 0) return args;
  if (args.length === 0) return [context];

  const last = args[args.length - 1];
  if (isPlainObject(last)) {
    const merged = { ...context, ...last };
    return [...args.slice(0, -1), merged];
  }
  return [...args, context];
};

const prefixedNamespace = (namespace: string) => `[present] [${namespace}]`;

const callConsole = (level: LogLevel, namespace: string, args: unknown[]) => {
  const prefixedArgs = [prefixedNamespace(namespace), ...args];
  if (level === 'debug') {
    console.debug(...prefixedArgs);
    return;
  }
  if (level === 'info') {
    console.log(...prefixedArgs);
    return;
  }
  if (level === 'warn') {
    console.warn(...prefixedArgs);
    return;
  }
  console.error(...prefixedArgs);
};

export const createLogger = (
  namespace: string,
  context?: Record<string, unknown>,
): Logger => {
  const onceCache = new Set<string>();
  const emit = (level: LogLevel, ...args: unknown[]) => {
    if (!shouldLog(namespace, level)) return;
    const withContext = mergeContext(context, args);
    callConsole(level, namespace, withContext);
  };

  return {
    debug: (...args: unknown[]) => emit('debug', ...args),
    info: (...args: unknown[]) => emit('info', ...args),
    log: (...args: unknown[]) => emit('info', ...args),
    warn: (...args: unknown[]) => emit('warn', ...args),
    error: (...args: unknown[]) => emit('error', ...args),
    once: (key: string, ...args: unknown[]) => {
      const cacheKey = `${namespace}:${key}`;
      if (onceCache.has(cacheKey)) return;
      onceCache.add(cacheKey);
      emit('info', ...args);
    },
    child: (nextContext: string | Record<string, unknown>) => {
      if (typeof nextContext === 'string') {
        const childNamespace = `${namespace}:${nextContext}`;
        return createLogger(childNamespace, context);
      }
      return createLogger(namespace, { ...(context || {}), ...nextContext });
    },
  };
};

export const customLog = (...args: unknown[]) => {
  createLogger('custom').info(...args);
};

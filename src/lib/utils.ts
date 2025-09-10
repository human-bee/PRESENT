import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Centralized logging utilities with levels & namespace gating.
 * Defaults to minimal (warn/error) output to keep console clean.
 *
 * Enable more logs at runtime (no rebuild) via localStorage:
 *   localStorage.setItem('present:logLevel', 'debug' | 'info' | 'warn' | 'error' | 'silent')
 *   localStorage.setItem('present:debugNamespaces', 'CanvasSpace,MCP,LiveKitBus')
 *
 * Or at build/run time via env (NEXT_PUBLIC_* are inlined by Next.js):
 *   NEXT_PUBLIC_LOG_LEVEL=debug
 *   NEXT_PUBLIC_DEBUG_NAMESPACES=CanvasSpace,MCP
 */
type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_TO_NUM: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function getRuntimeLogLevel(): LogLevel {
  try {
    const ls = typeof window !== 'undefined' ? window.localStorage : undefined;
    const fromStorage = (ls?.getItem('present:logLevel') || '').toLowerCase();
    if (fromStorage && fromStorage in LEVEL_TO_NUM) return fromStorage as LogLevel;
  } catch {}

  const fromEnv = (process.env.NEXT_PUBLIC_LOG_LEVEL || '').toLowerCase();
  if (fromEnv && fromEnv in LEVEL_TO_NUM) return fromEnv as LogLevel;

  // Default to warn for trimmed output in development; silent in production
  return process.env.NODE_ENV === 'development' ? 'warn' : 'error';
}

function getDebugNamespaces(): Set<string> {
  const set = new Set<string>();
  try {
    const ls = typeof window !== 'undefined' ? window.localStorage : undefined;
    const fromStorage = (ls?.getItem('present:debugNamespaces') || '').trim();
    if (fromStorage) {
      fromStorage
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .forEach((s) => set.add(s));
    }
  } catch {}

  const fromEnv = (process.env.NEXT_PUBLIC_DEBUG_NAMESPACES || '').trim();
  if (fromEnv) {
    fromEnv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .forEach((s) => set.add(s));
  }
  return set;
}

function shouldLog(prefix: string, level: LogLevel): boolean {
  if (process.env.NODE_ENV !== 'development') {
    // In production, only log errors by default
    return level === 'error';
  }

  const current = getRuntimeLogLevel();
  const threshold = LEVEL_TO_NUM[current];
  const requested = LEVEL_TO_NUM[level];
  if (requested <= threshold) return true;

  // Namespaces can elevate info/debug for specific modules
  if (level === 'info' || level === 'debug') {
    const ns = prefix.toLowerCase();
    return getDebugNamespaces().has(ns);
  }
  return false;
}

export const customLog = (...args: unknown[]) => {
  if (shouldLog('custom', 'info')) {
    console.log('[custom]', ...args);
  }
};

/**
 * Enhanced logger with prefixes & levels. Defaults to warn/error.
 */
export const createLogger = (prefix: string) => {
  return {
    debug: (...args: unknown[]) => {
      if (shouldLog(prefix, 'debug')) console.debug(`[custom] [${prefix}]`, ...args);
    },
    info: (...args: unknown[]) => {
      if (shouldLog(prefix, 'info')) console.log(`[custom] [${prefix}]`, ...args);
    },
    // Back-compat: `.log` maps to info
    log: (...args: unknown[]) => {
      if (shouldLog(prefix, 'info')) console.log(`[custom] [${prefix}]`, ...args);
    },
    warn: (...args: unknown[]) => {
      if (shouldLog(prefix, 'warn')) console.warn(`[custom] [${prefix}]`, ...args);
    },
    error: (...args: unknown[]) => {
      if (shouldLog(prefix, 'error')) console.error(`[custom] [${prefix}]`, ...args);
    },
    /** Log once per session for this prefix+key */
    once: ((logged: Set<string>) => (key: string, ...args: unknown[]) => {
      const k = `${prefix}:${key}`;
      if (logged.has(k)) return;
      logged.add(k);
      if (shouldLog(prefix, 'info')) console.log(`[custom] [${prefix}]`, ...args);
    })(new Set<string>()),
  };
};

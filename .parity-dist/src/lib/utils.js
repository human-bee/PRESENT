import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
const LEVEL_TO_NUM = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
};
function getRuntimeLogLevel() {
    try {
        const ls = typeof window !== 'undefined' ? window.localStorage : undefined;
        const fromStorage = (ls?.getItem('present:logLevel') || '').toLowerCase();
        if (fromStorage && fromStorage in LEVEL_TO_NUM)
            return fromStorage;
    }
    catch { }
    const fromEnv = (process.env.NEXT_PUBLIC_LOG_LEVEL || '').toLowerCase();
    if (fromEnv && fromEnv in LEVEL_TO_NUM)
        return fromEnv;
    // Default to warn for trimmed output in development; silent in production
    return process.env.NODE_ENV === 'development' ? 'warn' : 'error';
}
function getDebugNamespaces() {
    const set = new Set();
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
    }
    catch { }
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
function shouldLog(prefix, level) {
    if (process.env.NODE_ENV !== 'development') {
        // In production, only log errors by default
        return level === 'error';
    }
    const current = getRuntimeLogLevel();
    const threshold = LEVEL_TO_NUM[current];
    const requested = LEVEL_TO_NUM[level];
    if (requested <= threshold)
        return true;
    // Namespaces can elevate info/debug for specific modules
    if (level === 'info' || level === 'debug') {
        const ns = prefix.toLowerCase();
        return getDebugNamespaces().has(ns);
    }
    return false;
}
export const customLog = (...args) => {
    if (shouldLog('custom', 'info')) {
        console.log('[custom]', ...args);
    }
};
/**
 * Enhanced logger with prefixes & levels. Defaults to warn/error.
 */
export const createLogger = (prefix) => {
    return {
        debug: (...args) => {
            if (shouldLog(prefix, 'debug'))
                console.debug(`[custom] [${prefix}]`, ...args);
        },
        info: (...args) => {
            if (shouldLog(prefix, 'info'))
                console.log(`[custom] [${prefix}]`, ...args);
        },
        // Back-compat: `.log` maps to info
        log: (...args) => {
            if (shouldLog(prefix, 'info'))
                console.log(`[custom] [${prefix}]`, ...args);
        },
        warn: (...args) => {
            if (shouldLog(prefix, 'warn'))
                console.warn(`[custom] [${prefix}]`, ...args);
        },
        error: (...args) => {
            if (shouldLog(prefix, 'error'))
                console.error(`[custom] [${prefix}]`, ...args);
        },
        /** Log once per session for this prefix+key */
        once: ((logged) => (key, ...args) => {
            const k = `${prefix}:${key}`;
            if (logged.has(k))
                return;
            logged.add(k);
            if (shouldLog(prefix, 'info'))
                console.log(`[custom] [${prefix}]`, ...args);
        })(new Set()),
    };
};
//# sourceMappingURL=utils.js.map
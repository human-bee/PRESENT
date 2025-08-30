import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Centralized logging utility for consistent debug output
 * Only logs in development mode
 */
export const customLog = (...args: unknown[]) => {
  if (process.env.NODE_ENV === 'development') {
    console.log('[custom]', ...args);
  }
};

/**
 * Enhanced logging with component-specific prefixes
 */
export const createLogger = (prefix: string) => {
  return {
    log: (...args: unknown[]) => customLog(`[${prefix}]`, ...args),
    warn: (...args: unknown[]) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[custom] [${prefix}]`, ...args);
      }
    },
    error: (...args: unknown[]) => {
      if (process.env.NODE_ENV === 'development') {
        console.error(`[custom] [${prefix}]`, ...args);
      }
    },
  };
};

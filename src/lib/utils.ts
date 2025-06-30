import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

/**
 * Centralized logging utility for consistent debug output
 * Only logs in development mode
 */
export const tamboLog = (...args: unknown[]) => {
  if (process.env.NODE_ENV === 'development') {
    console.log('[Tambo]', ...args);
  }
};

/**
 * Enhanced logging with component-specific prefixes
 */
export const createLogger = (prefix: string) => {
  return {
    log: (...args: unknown[]) => tamboLog(`[${prefix}]`, ...args),
    warn: (...args: unknown[]) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[Tambo] [${prefix}]`, ...args);
      }
    },
    error: (...args: unknown[]) => {
      if (process.env.NODE_ENV === 'development') {
        console.error(`[Tambo] [${prefix}]`, ...args);
      }
    }
  };
};
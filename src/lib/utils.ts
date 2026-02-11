import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export { createLogger, customLog } from '@/lib/logging';
export type { LogLevel, Logger } from '@/lib/logging';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

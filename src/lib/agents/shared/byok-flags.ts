import { getBooleanFlag } from '@/lib/feature-flags';

export const DEMO_MODE_ENABLED = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE, false);
export const DEV_BYPASS_ENABLED = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS, false);

export const BYOK_ENABLED = !DEMO_MODE_ENABLED && !DEV_BYPASS_ENABLED;

// Strict mode: when BYOK is enabled, we never fall back to server/env provider keys.
export const BYOK_REQUIRED = BYOK_ENABLED;


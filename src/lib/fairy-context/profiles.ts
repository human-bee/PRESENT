export const FAIRY_CONTEXT_PROFILES = ['glance', 'standard', 'deep', 'archive'] as const;

export type FairyContextProfile = (typeof FAIRY_CONTEXT_PROFILES)[number];

export const DEFAULT_FAIRY_CONTEXT_PROFILE: FairyContextProfile = 'standard';

export type FairyContextSpectrum = {
  profile: FairyContextProfile;
  label: 'instant' | 'fast' | 'balanced' | 'deep';
  value: number;
};

const PROFILE_ALIASES: Record<string, FairyContextProfile> = {
  glance: 'glance',
  lite: 'glance',
  light: 'glance',
  minimal: 'glance',
  quick: 'glance',
  fast: 'glance',
  instant: 'glance',
  realtime: 'glance',
  standard: 'standard',
  normal: 'standard',
  default: 'standard',
  balanced: 'standard',
  deep: 'deep',
  rich: 'deep',
  heavy: 'deep',
  smart: 'deep',
  full: 'archive',
  archive: 'archive',
  exhaustive: 'archive',
  max: 'archive',
};

export function normalizeFairyContextProfile(value: unknown): FairyContextProfile | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase();
  return PROFILE_ALIASES[key];
}

const PROFILE_SPECTRUM: Record<FairyContextProfile, FairyContextSpectrum> = {
  glance: { profile: 'glance', label: 'instant', value: 0.15 },
  standard: { profile: 'standard', label: 'balanced', value: 0.5 },
  deep: { profile: 'deep', label: 'deep', value: 0.8 },
  archive: { profile: 'archive', label: 'deep', value: 1 },
};

export function getFairyContextSpectrum(profile: FairyContextProfile): FairyContextSpectrum {
  return PROFILE_SPECTRUM[profile] ?? PROFILE_SPECTRUM.standard;
}

export function resolveProfileFromSpectrum(value: unknown): FairyContextProfile | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const clamped = Math.max(0, Math.min(1, value));
    if (clamped <= 0.3) return 'glance';
    if (clamped <= 0.6) return 'standard';
    if (clamped <= 0.9) return 'deep';
    return 'archive';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return resolveProfileFromSpectrum(numeric);
    }
    return normalizeFairyContextProfile(trimmed);
  }
  return undefined;
}

export type FairyContextLimits = {
  MAX_CONTEXT_CHARS: number;
  MAX_STATE_CHARS: number;
  MAX_WIDGETS: number;
  MAX_CUSTOM_SHAPES: number;
  MAX_DOCUMENTS: number;
  TRANSCRIPT_LINES: number;
  MAX_DOCUMENT_LENGTH: number;
  MAX_SELECTION_IDS: number;
  MAX_WIDGET_HISTORY: number;
};

const BASE_LIMITS: FairyContextLimits = {
  MAX_CONTEXT_CHARS: 6000,
  MAX_STATE_CHARS: 4000,
  MAX_WIDGETS: 6,
  MAX_CUSTOM_SHAPES: 6,
  MAX_DOCUMENTS: 4,
  TRANSCRIPT_LINES: 16,
  MAX_DOCUMENT_LENGTH: 1200,
  MAX_SELECTION_IDS: 20,
  MAX_WIDGET_HISTORY: 4,
};

const PROFILE_LIMITS: Record<FairyContextProfile, FairyContextLimits> = {
  glance: {
    ...BASE_LIMITS,
    MAX_CONTEXT_CHARS: 1800,
    MAX_STATE_CHARS: 800,
    MAX_WIDGETS: 2,
    MAX_CUSTOM_SHAPES: 2,
    MAX_DOCUMENTS: 1,
    TRANSCRIPT_LINES: 6,
    MAX_DOCUMENT_LENGTH: 600,
    MAX_SELECTION_IDS: 10,
    MAX_WIDGET_HISTORY: 2,
  },
  standard: { ...BASE_LIMITS },
  deep: {
    ...BASE_LIMITS,
    MAX_CONTEXT_CHARS: 12000,
    MAX_STATE_CHARS: 8000,
    MAX_WIDGETS: 12,
    MAX_CUSTOM_SHAPES: 12,
    MAX_DOCUMENTS: 8,
    TRANSCRIPT_LINES: 28,
    MAX_DOCUMENT_LENGTH: 2200,
    MAX_SELECTION_IDS: 30,
    MAX_WIDGET_HISTORY: 6,
  },
  archive: {
    ...BASE_LIMITS,
    MAX_CONTEXT_CHARS: 24000,
    MAX_STATE_CHARS: 14000,
    MAX_WIDGETS: 18,
    MAX_CUSTOM_SHAPES: 18,
    MAX_DOCUMENTS: 12,
    TRANSCRIPT_LINES: 60,
    MAX_DOCUMENT_LENGTH: 3200,
    MAX_SELECTION_IDS: 60,
    MAX_WIDGET_HISTORY: 10,
  },
};

export function getFairyContextLimits(profile: FairyContextProfile): FairyContextLimits {
  return PROFILE_LIMITS[profile] ?? BASE_LIMITS;
}

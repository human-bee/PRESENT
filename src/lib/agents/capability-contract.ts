export const CAPABILITY_PROFILES = ['full', 'lean_adaptive'] as const;
export type CapabilityProfile = (typeof CAPABILITY_PROFILES)[number];

export const WIDGET_TIERS = ['tier1', 'tier2'] as const;
export type WidgetTier = (typeof WIDGET_TIERS)[number];

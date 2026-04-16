import type {
  ApplyMode,
  KnobScope,
  ResolvedFieldScope,
} from '@/lib/agents/control-plane/types';

export type ResolvedFieldSource = {
  scope: ResolvedFieldScope;
  scopeId: string;
  profileId?: string;
  version?: number;
};

export type AdminScopeType = KnobScope;

export type ModelControlStatusResponse = {
  ok: boolean;
  isAdmin: boolean;
  unlockActive: boolean;
  keyringPolicy?: {
    passwordRequired: boolean;
    updatedAt?: string;
  };
  resolved: {
    configVersion: string;
    resolvedAt: string;
    effective: Record<string, unknown>;
    applyModes: Record<string, ApplyMode>;
    fieldSources?: Record<string, ResolvedFieldSource>;
    sources: Array<Record<string, unknown>>;
  };
  keyStatus: Array<{
    provider: string;
    source: string;
    byokConfigured: boolean;
    byokLast4?: string;
    sharedConfigured: boolean;
    sharedEnabled: boolean;
    sharedLast4?: string;
  }>;
};

export type GuidedFieldKind = 'string' | 'int' | 'float' | 'enum' | 'boolean';

export type GuidedField = {
  path: string;
  label: string;
  kind: GuidedFieldKind;
  help: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string }>;
  suggestions?: string[];
};

export type GuidedSection = {
  id: string;
  title: string;
  description: string;
  fields: GuidedField[];
};

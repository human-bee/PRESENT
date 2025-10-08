export type DecisionIntent = 'youtube_search' | 'ui_component' | 'general';

export interface DecisionInput {
  transcript: string;
  context?: string;
}

export interface NormalizedTranscript {
  raw: string;
  trimmed: string;
  lower: string;
  wordCount: number;
}

export interface IntentStructuredContext {
  rawQuery?: string;
  wantsLatest?: boolean;
  wantsOfficial?: boolean;
  contentType?: string;
  artist?: string;
}

export interface IntentResult {
  intent: DecisionIntent;
  structuredContext?: IntentStructuredContext;
}

export interface RuleEvaluation {
  isSingleWord: boolean;
  hasDecisionKeyword: boolean;
}

export interface ScoreBreakdown {
  base: number;
  adjustments: Array<{ reason: string; delta: number }>;
  total: number;
}

export interface DecisionEngineConfig {
  intents?: Record<string, string[]>;
  keywords?: Record<string, string[]>;
}

export interface PlanOutput {
  shouldSend: boolean;
  summary: string;
  confidence: number;
  reason: string;
  intent: DecisionIntent;
  structuredContext?: IntentStructuredContext;
}

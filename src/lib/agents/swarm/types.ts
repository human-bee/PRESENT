import type { JsonObject } from '@/lib/utils/json-schema';

export type SwarmDecisionKind =
  | 'canvas'
  | 'scorecard'
  | 'search'
  | 'summary'
  | 'crowd_pulse'
  | 'flowchart'
  | 'direct';

export type SwarmDecision = {
  kind: SwarmDecisionKind;
  task: string;
  confidence: number;
  reason: string;
  params?: JsonObject;
};

export type SwarmExecutionContext = {
  taskName: string;
  params: JsonObject;
  requestId?: string;
  traceId?: string;
  intentId?: string;
};

export type SwarmOrchestrator = {
  execute(ctx: SwarmExecutionContext): Promise<unknown>;
};

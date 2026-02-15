import { buildSwarmDecision } from './policy';
import type { SwarmOrchestrator, SwarmExecutionContext } from './types';
import type { JsonObject } from '@/lib/utils/json-schema';
import { createLogger } from '@/lib/logging';
import { recordAgentTraceEvent } from '@/lib/agents/shared/trace-events';
import { deriveRequestCorrelation } from '@/lib/agents/shared/request-correlation';

type CreateSwarmOrchestratorArgs = {
  executeLegacy: (taskName: string, params: JsonObject) => Promise<unknown>;
};

const logger = createLogger('agents:swarm:orchestrator');

export function createSwarmOrchestrator(args: CreateSwarmOrchestratorArgs): SwarmOrchestrator {
  return {
    async execute(ctx: SwarmExecutionContext): Promise<unknown> {
      const correlation = deriveRequestCorrelation({
        task: ctx.taskName,
        params: ctx.params,
        requestId: ctx.requestId ?? ctx.params.requestId,
      });
      const decision = await buildSwarmDecision(ctx.taskName, ctx.params);
      const routedTask = decision.task;
      const routedParams = {
        ...ctx.params,
        ...(ctx.taskName === 'conductor.dispatch' && ctx.params.params && typeof ctx.params.params === 'object'
          ? (ctx.params.params as JsonObject)
          : {}),
      };

      await recordAgentTraceEvent({
        stage: 'routed',
        status: 'ok',
        traceId: correlation.traceId,
        requestId: correlation.requestId,
        intentId: correlation.intentId,
        room: typeof routedParams.room === 'string' ? routedParams.room : undefined,
        task: routedTask,
        payload: {
          decisionKind: decision.kind,
          confidence: decision.confidence,
          reason: decision.reason,
          sourceTask: ctx.taskName,
        },
      });

      logger.info('[Swarm] routed task', {
        sourceTask: ctx.taskName,
        routedTask,
        confidence: decision.confidence,
        reason: decision.reason,
      });

      return args.executeLegacy(routedTask, routedParams);
    },
  };
}

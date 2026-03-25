'use client';

import type { ComponentProps, ReactNode } from 'react';
import { z } from 'zod';
import {
  ResearchPanel,
  researchPanelSchema,
} from '@/components/ui/research/research-panel';
import MeetingSummaryWidget from '@/components/ui/productivity/meeting-summary-widget';
import {
  meetingSummaryWidgetSchema,
} from '@/components/ui/productivity/meeting-summary-schema';
import MemoryRecallWidget from '@/components/ui/productivity/memory-recall-widget';
import {
  memoryRecallWidgetSchema,
} from '@/components/ui/productivity/memory-recall-schema';

type RuntimeRenderContext = {
  contextKey: string;
  nodeId: string;
};

type RuntimeParseResult =
  | {
      success: true;
      data: Record<string, unknown>;
    }
  | {
      success: false;
      error: unknown;
    };

type RuntimeComponentEntry = {
  safeParse: (props: Record<string, unknown>) => RuntimeParseResult;
  render: (props: Record<string, unknown>, context: RuntimeRenderContext) => ReactNode;
};

const defineRuntimeComponent = <Props extends Record<string, unknown>>(
  schema: z.ZodType<Props>,
  render: (props: Props, context: RuntimeRenderContext) => ReactNode,
): RuntimeComponentEntry => ({
  safeParse: (props) => schema.safeParse(props) as RuntimeParseResult,
  render: (props, context) => render(props as Props, context),
});

const runtimeComponentRegistry = {
  ResearchPanel: defineRuntimeComponent(researchPanelSchema, (props, context) => (
    <ResearchPanel
      {...(props as unknown as ComponentProps<typeof ResearchPanel>)}
      __custom_message_id={`runtime-${context.nodeId}`}
    />
  )),
  MeetingSummaryWidget: defineRuntimeComponent(meetingSummaryWidgetSchema, (props, context) => (
    <MeetingSummaryWidget
      {...(props as unknown as ComponentProps<typeof MeetingSummaryWidget>)}
      __custom_message_id={`runtime-${context.nodeId}`}
      contextKey={context.contextKey}
    />
  )),
  MemoryRecallWidget: defineRuntimeComponent(memoryRecallWidgetSchema, (props, context) => (
    <MemoryRecallWidget
      {...(props as unknown as ComponentProps<typeof MemoryRecallWidget>)}
      __custom_message_id={`runtime-${context.nodeId}`}
      contextKey={context.contextKey}
    />
  )),
} as const;

export const canvasRuntimeComponentTypes = Object.keys(runtimeComponentRegistry) as Array<
  keyof typeof runtimeComponentRegistry
>;

export function getCanvasRuntimeComponentEntry(componentType: string) {
  return runtimeComponentRegistry[componentType as keyof typeof runtimeComponentRegistry] ?? null;
}

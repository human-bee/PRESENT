import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { activeFlowchartSteward } from '../subagents/flowchart-steward-registry';
import { runCanvasSteward } from '../subagents/canvas-steward';

// Thin router: receives dispatch_to_conductor and hands off to stewards

const dispatchToConductor = tool({
  name: 'dispatch_to_conductor',
  description: 'Ask the Conductor to run a steward for a complex component/task.',
  parameters: z.object({
    task: z.string().describe('Task identifier, e.g., flowchart.update'),
    params: z.record(z.any()).describe('Task parameters'),
  }),
  async execute({ task, params }: { task: string; params: Record<string, unknown> }) {
    if (task.startsWith('flowchart.')) {
      // Delegate to Flowchart Steward
      const result = await run(activeFlowchartSteward, JSON.stringify({ task, params }));
      return result.finalOutput;
    }
    if (task.startsWith('canvas.')) {
      const result = await runCanvasSteward({ task, params });
      return result.finalOutput;
    }
    throw new Error(`No steward for task: ${task}`);
  },
});

export const conductor = new Agent({
  name: 'Conductor',
  model: 'gpt-5-mini',
  instructions:
    'You are the Conductor. You own no business logic. When asked, hand off to the correct steward and return their final output.',
  tools: [dispatchToConductor],
});

export async function callConductor(task: string, params: Record<string, unknown>) {
  const resp = await run(conductor, `Run ${task} with params: ${JSON.stringify(params)}`);
  return resp.finalOutput;
}

// Simple CLI to keep the process alive for local dev
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('index.ts')) {
  console.log('[Conductor] Ready. Waiting for handoffs...');
  setInterval(() => {}, 1 << 30);
}


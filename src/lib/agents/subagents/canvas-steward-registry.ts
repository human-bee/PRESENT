import type { Agent } from '@openai/agents';
import { canvasSteward, runCanvasSteward } from './canvas-steward';

export const activeCanvasSteward: Agent = canvasSteward;

export async function runActiveCanvasSteward(params: { room: string; request: string; summary?: string }) {
  return runCanvasSteward(params);
}

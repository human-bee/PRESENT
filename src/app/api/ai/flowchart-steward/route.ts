import { NextRequest, NextResponse } from 'next/server';
import { runFlowchartInstruction, runFlowchartStewardFast } from '@/lib/agents/subagents/flowchart-steward-fast';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { instruction, room, docId, currentDoc, currentVersion, windowMs } = body;

    let result;

    if (instruction) {
      // Instruction-based update
      result = await runFlowchartInstruction({
        instruction,
        room,
        docId,
        currentDoc,
        currentVersion,
      });
    } else {
      // Full context update from transcript
      result = await runFlowchartStewardFast({
        room,
        docId,
        windowMs,
      });
    }

    return NextResponse.json({ status: 'ok', result });
  } catch (error) {
    console.error('[FlowchartSteward API] Error:', error);
    return NextResponse.json(
      { status: 'error', error: 'Error processing flowchart request' },
      { status: 500 }
    );
  }
}

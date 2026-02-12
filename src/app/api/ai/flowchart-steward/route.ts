import { NextRequest, NextResponse } from 'next/server';
import { runFlowchartInstruction, runFlowchartStewardFast } from '@/lib/agents/subagents/flowchart-steward-fast';
import { runFlowchartSteward } from '@/lib/agents/subagents/flowchart-steward';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { instruction, room, docId, currentDoc, currentVersion, windowMs } = body;

    let billingUserId: string | null = null;
    if (BYOK_ENABLED) {
      const requesterUserId = await resolveRequestUserId(req);
      if (!requesterUserId) {
        return NextResponse.json({ status: 'error', error: 'unauthorized' }, { status: 401 });
      }
      const roomName = typeof room === 'string' ? room.trim() : '';
      const canvasId = roomName ? parseCanvasIdFromRoom(roomName) : null;
      if (canvasId) {
        try {
          const membership = await assertCanvasMember({ canvasId, requesterUserId });
          billingUserId = membership.ownerUserId;
        } catch (error) {
          const code = (error as Error & { code?: string }).code;
          if (code === 'forbidden') {
            return NextResponse.json({ status: 'error', error: 'forbidden' }, { status: 403 });
          }
          throw error;
        }
      } else {
        billingUserId = requesterUserId;
      }
    }

    const hasCerebras = BYOK_ENABLED
      ? (billingUserId
          ? Boolean(await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' }))
          : false)
      : Boolean((process.env.CEREBRAS_API_KEY ?? '').trim());

    let result;

    if (instruction) {
      // Instruction-based update (FAST only)
      if (!hasCerebras) {
        return NextResponse.json(
          { status: 'error', error: 'cerebras_key_required_for_instruction' },
          { status: 400 },
        );
      }
      result = await runFlowchartInstruction({
        instruction,
        room,
        docId,
        currentDoc,
        currentVersion,
        ...(billingUserId ? { billingUserId } : {}),
      });
    } else {
      // Full context update from transcript (FAST if available, else OpenAI)
      result = hasCerebras
        ? await runFlowchartStewardFast({
            room,
            docId,
            windowMs,
            ...(billingUserId ? { billingUserId } : {}),
          })
        : await runFlowchartSteward({
            room,
            docId,
            windowMs,
            ...(billingUserId ? { billingUserId } : {}),
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





import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { briefProfileSchema } from '@present/contracts/interviews';
import { createInterview } from '@present/kernel/interview-store';
import { exampleProfile } from '@/lib/interviews/seed';
import { getRequestUserId } from '@/lib/supabase/server/request-user';
import { consumeWindowedLimit } from '@/lib/server/traffic-guards';
import { interviewRequest, privateJson } from './http';

export const runtime = 'nodejs';
const inputSchema = z.object({ example: z.boolean().default(false), replay: z.boolean().default(false), replayMode: z.enum(['scripted', 'audio']).default('scripted'), profile: briefProfileSchema.optional() });
export async function POST(request: Request) {
  return interviewRequest(async () => {
    if (process.env.NODE_ENV === 'production') {
      const auth = await getRequestUserId(request as NextRequest);
      if (!auth.ok) return privateJson({ error: 'Sign in to PRESENT to create an interview.' }, 401);
      if (!consumeWindowedLimit(`open-brief:create:${auth.userId}`, 12, 60000).ok) {
        return privateJson({ error: 'You’ve created several briefs. Please try again in a minute.' }, 429);
      }
    }
    const body = inputSchema.parse(await request.json());
    const profile = body.example ? exampleProfile : briefProfileSchema.parse(body.profile);
    return privateJson(await createInterview(profile, body.example, body.replay, body.replayMode), 201);
  });
}

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { InterviewError } from '@present/kernel/interview-store';

export const interviewToken = (request: Request) => request.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1] || '';
export const privateJson = (data: unknown, status = 200) => NextResponse.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});
export async function interviewRequest(action: () => Promise<Response>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof InterviewError) return privateJson({ error: error.message }, error.status);
    if (error instanceof ZodError || error instanceof SyntaxError) return privateJson({ error: 'Check the submitted brief details.' }, 400);
    console.error('[open-brief] Request failed', error instanceof Error ? error.name : 'UnknownError');
    return privateJson({ error: 'Could not save the brief. Please try again.' }, 500);
  }
}

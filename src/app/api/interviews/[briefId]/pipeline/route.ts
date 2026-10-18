import { accessInterview } from '@present/kernel/interview-store';
import { openAIReadiness } from '@/lib/agents/openai-readiness';
import { interviewRequest, interviewToken, privateJson } from '../../http';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ briefId: string }> }) {
  return interviewRequest(async () => {
    const { briefId } = await context.params;
    const traces = await accessInterview(briefId, interviewToken(request), (record) => record.pipeline ?? []);
    const readiness = openAIReadiness();
    return privateJson({ readiness, traces, models: {
      speech: process.env.INTERVIEW_TTS_MODEL || 'gpt-4o-mini-tts',
      transcription: process.env.INTERVIEW_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
      decision: process.env.INTERVIEW_AGENT_MODEL || 'gpt-4.1-nano',
    } });
  });
}

import { accessInterview, InterviewError } from '@present/kernel/interview-store';
import { readReplayAudio, readReplayManifest } from '@/lib/interviews/replay';
import { interviewRequest, interviewToken, privateJson } from '../../http';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ briefId: string }> }) {
  return interviewRequest(async () => {
    const { briefId } = await context.params;
    await accessInterview(briefId, interviewToken(request), (record) => {
      if (!record.replay) throw new InterviewError(404, 'This is not a replay interview.');
    });
    if (new URL(request.url).searchParams.get('file') === 'audio') {
      return new Response(readReplayAudio(briefId), { headers: {
        'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    return privateJson({ manifest: readReplayManifest(briefId) });
  });
}

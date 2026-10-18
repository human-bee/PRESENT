import { accessInterview, interviewEnvelope } from '@present/kernel/interview-store';
import { interviewMutationSchema, mutateInterview } from '@present/kernel/interview-operations';
import { interviewRequest, interviewToken, privateJson } from '../http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ briefId: string }> };
export async function GET(request: Request, context: Context) {
  return interviewRequest(async () => {
    const { briefId } = await context.params;
    const identity = request.headers.get('x-brief-participant')?.slice(0, 120);
    const interview = await accessInterview(briefId, interviewToken(request), (record, role) => {
      record.collaborators = record.collaborators.filter((item) => Date.now() - item.seenAt < 15000 && item.identity !== identity);
      if (identity) record.collaborators.push({ identity, role, seenAt: Date.now() });
      return interviewEnvelope(record, role);
    });
    return privateJson({ interview });
  });
}
export async function POST(request: Request, context: Context) {
  return interviewRequest(async () => {
    const { briefId } = await context.params;
    const mutation = interviewMutationSchema.parse(await request.json());
    return privateJson({ interview: await mutateInterview(briefId, interviewToken(request), mutation) });
  });
}

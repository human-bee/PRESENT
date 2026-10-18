import { randomUUID } from 'node:crypto';
import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk';
import { z } from 'zod';
import { accessInterview, InterviewError, interviewEnvelope } from '@present/kernel/interview-store';
import { loadInterviewDocument } from '@present/kernel/interview-store';
import { readBrief } from '@/lib/interviews/document';
import { interviewRequest, interviewToken, privateJson } from '../../http';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ briefId: string }> }) {
  return interviewRequest(async () => {
    const { briefId } = await context.params;
    const body = z.object({ listen: z.boolean().default(false) }).parse(await request.json());
    const info = await accessInterview(briefId, interviewToken(request), (record, role) => {
      if (!interviewEnvelope(record, role).callAvailable) throw new InterviewError(503, 'Video calls are not connected to LiveKit yet. The shared brief is ready to use.');
      const doc = loadInterviewDocument(record);
      try { return { role, name: readBrief(doc).fields.name, consent: record.notesConsent }; }
      finally { doc.destroy(); }
    });
    const serverUrl = process.env.LIVEKIT_URL!;
    const room = `open-brief-${briefId}`;
    if (body.listen) {
      if (info.role !== 'recruiter' || !info.consent.recruiter || !info.consent.candidate) throw new InterviewError(409, 'Both people must enable live notes first.');
      if (!process.env.OPENAI_API_KEY) throw new InterviewError(503, 'The listening agent is not connected to OpenAI yet.');
      const dispatch = new AgentDispatchClient(serverUrl.replace(/^ws/, 'http'), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
      const existing = await dispatch.listDispatch(room);
      if (!existing.some((item) => item.agentName === 'interview-listener')) {
        await dispatch.createDispatch(room, 'interview-listener');
      }
      return privateJson({ requested: true });
    }
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: `${info.role}-${randomUUID()}`, name: info.role === 'candidate' ? info.name : 'Recruiter',
      ttl: '2h', metadata: JSON.stringify({ interviewRole: info.role, briefId }),
      attributes: { 'open-brief.notes-consent': String(info.consent[info.role]) },
    });
    token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: true });
    return privateJson({ token: await token.toJwt(), serverUrl });
  });
}

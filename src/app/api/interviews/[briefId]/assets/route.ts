import { randomUUID } from 'node:crypto';
import { accessInterview, interviewEnvelope, loadInterviewDocument, saveInterviewDocument, InterviewError } from '@present/kernel/interview-store';
import { readAssetBody, writeAssetFile } from '@/lib/interviews/asset-files';
import { briefFieldSchema } from '@present/contracts/interviews';
import { readBrief, addBriefActivity } from '@/lib/interviews/document';
import { interviewToken, interviewRequest, privateJson } from '../../http';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ briefId: string }> }) {
  return interviewRequest(async () => {
    const { briefId } = await context.params; const token = interviewToken(request);
    await accessInterview(briefId, token, () => undefined);
    const { bytes, mime } = await readAssetBody(request);
    let title: string;
    try { title = decodeURIComponent(request.headers.get('x-file-name') || 'Work sample').slice(0, 180).trim() || 'Work sample'; }
    catch { throw new InterviewError(400, 'Choose a valid file name.'); }
    const result = await accessInterview(briefId, token, (record, role) => {
      const doc = loadInterviewDocument(record);
      try {
        if (readBrief(doc).studio.assets.length >= 40) throw new InterviewError(413, 'This interview has reached its material limit.');
        const id = randomUUID();
        writeAssetFile(briefId, id, bytes);
        doc.getMap('assets').set(id, { id, fileId: id, kind: mime === 'application/pdf' ? 'resume' : 'image', title,
          mime, bytes: bytes.length, text: '', caption: '', field: briefFieldSchema.catch('work').parse(request.headers.get('x-brief-field')), included: false,
          x: readBrief(doc).studio.assets.length % 2 ? 1180 : 30, y: 80 + Math.floor(readBrief(doc).studio.assets.length / 2) * 310,
          createdBy: role, createdAt: Date.now() });
        addBriefActivity(doc, `${role === 'candidate' ? 'Candidate' : 'Recruiter'} uploaded ${title}.`);
        saveInterviewDocument(record, doc, role);
        return { interview: interviewEnvelope(record, role), assetId: id };
      } finally { doc.destroy(); }
    });
    return privateJson(result, 201);
  });
}

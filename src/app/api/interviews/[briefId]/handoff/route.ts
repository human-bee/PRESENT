import { accessInterview, InterviewError, loadInterviewDocument } from '@present/kernel/interview-store';
import { readBrief } from '@/lib/interviews/document';
import { renderHandoff, renderEvidencePacket } from '@/lib/interviews/handoff';
import { renderPrintHandoff } from '@/lib/interviews/print-handoff';
import { readAssetFile } from '@/lib/interviews/asset-files';
import { interviewRequest, interviewToken } from '../../http';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ briefId: string }> }) {
  return interviewRequest(async () => {
    const { briefId } = await context.params;
    const format = new URL(request.url).searchParams.get('format');
    const content = await accessInterview(briefId, interviewToken(request), (record) => {
      if (record.approvals.candidate !== record.revision || record.approvals.recruiter !== record.revision) {
        throw new InterviewError(409, 'Both people need to review this version before exporting.');
      }
      const doc = loadInterviewDocument(record);
      try {
        const snapshot = readBrief(doc);
        if (snapshot.suggestions.some((item) => item.status === 'pending')) throw new InterviewError(409, 'Review the remaining suggestions before exporting.');
        if (format === 'evidence') return JSON.stringify(renderEvidencePacket(snapshot, record.revision, record.replay, record.replayMode), null, 2);
        if (format === 'html') return renderPrintHandoff(snapshot, record.replay, record.replayMode,(asset) => readAssetFile(briefId,asset.fileId!));
        return renderHandoff(snapshot, record.replay, record.replayMode);
      } finally { doc.destroy(); }
    });
    return new Response(content, { headers: {
      'Content-Type': format === 'evidence' ? 'application/json; charset=utf-8' : format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${format === 'evidence' ? 'candidate-evidence.json' : format === 'html' ? 'candidate-brief.html' : 'candidate-brief.md'}"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  });
}

import { accessInterview, InterviewError, loadInterviewDocument } from '@present/kernel/interview-store';
import { readBrief } from '@/lib/interviews/document';
import { readAssetFile } from '@/lib/interviews/asset-files';
import { interviewToken, interviewRequest } from '../../../http';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ briefId: string; assetId: string }> }) {
  return interviewRequest(async () => {
    const { briefId, assetId } = await context.params;
    const asset = await accessInterview(briefId, interviewToken(request), (record) => {
      const doc = loadInterviewDocument(record);
      try { return readBrief(doc).studio.assets.find((item) => item.id === assetId); } finally { doc.destroy(); }
    });
    if (!asset?.fileId || !asset.mime) throw new InterviewError(404, 'This material is unavailable.');
    return new Response(readAssetFile(briefId, asset.fileId), { headers: {
      'Content-Type': asset.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.title)}`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    } });
  });
}

import fs from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';

const DOCS_ROOT = path.join(process.cwd(), 'docs');

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export async function GET(req: NextRequest, context: { params: Promise<{ slug?: string[] }> }) {
  const admin = await requireAgentAdminUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const params = await context.params;
  const slug = Array.isArray(params.slug) ? params.slug : [];
  if (slug.length === 0) {
    return NextResponse.json({ error: 'missing_asset_path' }, { status: 400 });
  }

  const resolved = path.normalize(path.join(DOCS_ROOT, ...slug));
  if (!resolved.startsWith(DOCS_ROOT)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const buffer = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}

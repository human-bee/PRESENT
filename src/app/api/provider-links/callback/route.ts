import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider') || 'unknown';
  return NextResponse.json(
    {
      ok: false,
      provider,
      state: 'linked_unsupported',
      message:
        'Provider callback is not configured because official subscription-credit linking is unavailable for this provider.',
    },
    { status: 501 },
  );
}

import { NextRequest, NextResponse } from 'next/server';
import { systemRegistry } from '@/lib/system-registry';

export const dynamic = 'force-dynamic'; // Ensure this route is always up to date

export async function GET(_req: NextRequest) {
  // Optional query param ?roomId=xxx not used yet but future-proof.
  const snapshot = systemRegistry.getSnapshot();
  return NextResponse.json({ snapshot, timestamp: Date.now() });
}

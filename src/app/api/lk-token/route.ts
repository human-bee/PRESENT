import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { GET as baseGet } from '../token/route';

export const runtime = 'nodejs';
export const revalidate = 0;

export function GET(request: NextRequest) {
  return baseGet(request);
}

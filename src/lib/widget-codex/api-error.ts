import { NextResponse } from 'next/server';
import { WidgetCodexResponseError } from '@present/widget-codex/client';

export function toWidgetCodexErrorResponse(error: unknown, fallback: string) {
  if (error instanceof WidgetCodexResponseError) {
    return NextResponse.json(
      {
        error: error.body || fallback,
      },
      { status: error.status || 502 },
    );
  }

  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : fallback,
    },
    { status: 400 },
  );
}

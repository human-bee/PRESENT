import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

type TranscriptSegment = {
  text: string;
  start: number;
  duration: number;
};

const QuerySchema = z.object({
  videoId: z.string().min(6),
  lang: z.string().optional().default('en'),
});

function extractJsonFromAssignment(html: string, varName: string): any | null {
  const idx = html.indexOf(varName);
  if (idx === -1) return null;
  const braceStart = html.indexOf('{', idx);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString: '"' | "'" | null = null;
  let escaped = false;
  for (let i = braceStart; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch as '"' | "'";
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = html.slice(braceStart, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseTimestamp(ts: string): number {
  // 00:00:12.345 or 00:12.345
  const parts = ts.trim().split(':');
  const nums = parts.map((p) => Number(p.replace(',', '.')));
  if (nums.some((n) => Number.isNaN(n))) return 0;
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] || 0;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function parseVtt(vtt: string): TranscriptSegment[] {
  const lines = vtt.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    i += 1;

    if (!line) continue;
    // Optional cue id line
    const maybeTime = line.includes('-->') ? line : lines[i]?.trim();
    if (!maybeTime || !maybeTime.includes('-->')) continue;
    const timeLine = maybeTime;
    if (line !== maybeTime) i += 1;

    const [rawStart, rawEnd] = timeLine.split('-->').map((v) => v.trim().split(/\s+/)[0]);
    if (!rawStart || !rawEnd) continue;
    const start = parseTimestamp(rawStart);
    const end = parseTimestamp(rawEnd);
    const duration = Math.max(0, end - start);

    const textLines: string[] = [];
    while (i < lines.length) {
      const t = lines[i];
      i += 1;
      if (!t.trim()) break;
      textLines.push(t);
    }

    const text = stripTags(textLines.join(' '));
    if (!text) continue;
    segments.push({ text, start, duration: duration || 0 });
  }

  // Light dedupe (YouTube captions can repeat)
  const deduped: TranscriptSegment[] = [];
  for (const seg of segments) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text === seg.text && Math.abs(prev.start - seg.start) < 0.25) {
      continue;
    }
    deduped.push(seg);
  }

  return deduped;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    videoId: searchParams.get('videoId') ?? undefined,
    lang: searchParams.get('lang') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const { videoId, lang } = parsed.data;

  try {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const htmlRes = await fetch(watchUrl, {
      method: 'GET',
      headers: {
        // Best-effort: mimic a normal browser
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await htmlRes.text();
    if (!htmlRes.ok) {
      return NextResponse.json({ transcript: null, error: `watch_http_${htmlRes.status}` }, { status: 502 });
    }

    const playerResponse =
      extractJsonFromAssignment(html, 'ytInitialPlayerResponse') ??
      extractJsonFromAssignment(html, 'var ytInitialPlayerResponse');
    const captionTracks: any[] =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ??
      [];

    if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
      return NextResponse.json({ transcript: null, error: 'no_captions' });
    }

    const desired = String(lang || 'en').toLowerCase();
    const pick = () => {
      const exact = captionTracks.find((t) => String(t?.languageCode || '').toLowerCase() === desired);
      if (exact) return exact;
      const prefix = captionTracks.find((t) => String(t?.languageCode || '').toLowerCase().startsWith(desired));
      if (prefix) return prefix;
      const anyEn = captionTracks.find((t) => String(t?.languageCode || '').toLowerCase().startsWith('en'));
      if (anyEn) return anyEn;
      return captionTracks[0];
    };

    const track = pick();
    const baseUrl = typeof track?.baseUrl === 'string' ? track.baseUrl : '';
    if (!baseUrl) {
      return NextResponse.json({ transcript: null, error: 'no_track_url' });
    }

    const captionsUrl = new URL(baseUrl);
    if (!captionsUrl.searchParams.get('fmt')) {
      captionsUrl.searchParams.set('fmt', 'vtt');
    }

    const vttRes = await fetch(captionsUrl.toString(), { method: 'GET' });
    const vttText = await vttRes.text();
    if (!vttRes.ok) {
      return NextResponse.json({ transcript: null, error: `caption_http_${vttRes.status}` });
    }

    const segments = parseVtt(vttText);
    if (segments.length === 0) {
      return NextResponse.json({ transcript: null, error: 'caption_parse_empty' });
    }

    return NextResponse.json({ transcript: { segments }, track: { lang: track?.languageCode } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ transcript: null, error: message }, { status: 502 });
  }
}


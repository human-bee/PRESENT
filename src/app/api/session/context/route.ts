import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

if (!supabaseUrl || !supabaseKey) {
  console.error('[ContextAPI] Missing Supabase credentials', {
    hasUrl: Boolean(supabaseUrl),
    hasKey: Boolean(supabaseKey),
  });
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
});

export const dynamic = 'force-dynamic';

// GET - Retrieve context documents for a session
export async function GET(request: NextRequest) {
    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json(
            { error: 'Supabase not configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' },
            { status: 500 }
        );
    }

    const sessionId = request.nextUrl.searchParams.get('sessionId');

    if (!sessionId) {
        return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    try {
        // Try lookup by room_name first (most common case)
        const { data, error } = await supabase
            .from('sessions')
            .select('context_documents')
            .eq('room_name', sessionId)
            .maybeSingle();

        if (error) {
            console.error('[ContextAPI] GET error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            contextDocuments: data?.context_documents || [],
        });
    } catch (err) {
        console.error('[ContextAPI] GET exception:', err);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}

// POST - Save context documents for a session
export async function POST(request: NextRequest) {
    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json(
            { error: 'Supabase not configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' },
            { status: 500 }
        );
    }

    try {
        const body = await request.json();
        const { sessionId, contextDocuments } = body;

        if (!sessionId) {
            return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
        }

        if (!Array.isArray(contextDocuments)) {
            return NextResponse.json({ error: 'contextDocuments must be an array' }, { status: 400 });
        }

        // Check if session exists
        const { data: existing } = await supabase
            .from('sessions')
            .select('id')
            .eq('room_name', sessionId)
            .maybeSingle();

        let error;
        if (existing) {
            // Update existing session
            const result = await supabase
                .from('sessions')
                .update({
                    context_documents: contextDocuments,
                    updated_at: new Date().toISOString(),
                })
                .eq('room_name', sessionId);
            error = result.error;
        } else {
            // Insert new session
            const result = await supabase
                .from('sessions')
                .insert({
                    room_name: sessionId,
                    context_documents: contextDocuments,
                    updated_at: new Date().toISOString(),
                });
            error = result.error;
        }

        if (error) {
            console.error('[ContextAPI] POST error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('[ContextAPI] POST exception:', err);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}

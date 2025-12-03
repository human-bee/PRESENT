/**
 * @jest-environment node
 */
import * as dotenv from 'dotenv';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GET, POST, DELETE } from './route';

// Load envs from .env.local so the gate picks up RUN_LINEAR_KEY_API_TEST, Supabase, and Linear keys
dotenv.config({ path: '.env.local' });

// Utility to create a NextRequest with body
const makeRequest = (method: 'GET' | 'POST' | 'DELETE', body?: any) => {
  const init: any = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest('http://localhost/api/linear-key', init);
};

describe('/api/linear-key', () => {
  const hasEnv = Boolean(
    process.env.RUN_LINEAR_KEY_API_TEST === 'true' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const testFn = hasEnv ? it : it.skip;

  testFn('round-trips the Linear key via Supabase', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // Ensure a test user exists so FK constraints pass
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = process.env.TEST_USER_EMAIL || 'linear-test@example.com';

    let list;
    try {
      list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    } catch (err) {
      console.warn('[linear-key test] Supabase unreachable, skipping:', err?.message || err);
      return; // soft-pass if network/Supabase is unavailable
    }

    if (!list?.data || list.error) {
      console.warn('[linear-key test] Supabase listUsers error, skipping:', list?.error?.message || 'unknown');
      return;
    }

    let user = list.data.users.find((u) => u.email === email);
    if (!user) {
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: 'Temp1234!'
      });
      user = created.data.user!;
    }

    process.env.TEST_USER_ID = user!.id;

    const testKey = process.env.LINEAR_API_KEY || 'lin_api_test_key';

    // Save
    const postRes = await POST(makeRequest('POST', { apiKey: testKey }));
    expect(postRes.status).toBe(200);

    // Read
    const getRes = await GET(makeRequest('GET'));
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.apiKey).toBe(testKey);

    // Delete
    const delRes = await DELETE(makeRequest('DELETE'));
    expect(delRes.status).toBe(200);

    // Confirm deletion
    const getAfterDel = await GET(makeRequest('GET'));
    expect(getAfterDel.status).toBe(200);
    const afterJson = await getAfterDel.json();
    expect(afterJson.apiKey).toBeNull();
  });
});

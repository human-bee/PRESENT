/**
 * @jest-environment node
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

dotenv.config({ path: '.env.local' });

const makeRequest = (method: 'GET' | 'POST' | 'DELETE', body?: any) => {
  const init: any = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest('http://localhost/api/model-keys', init);
};

describe('/api/model-keys', () => {
  const hasEnv = Boolean(
    process.env.RUN_MODEL_KEYS_API_TEST === 'true' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.BYOK_ENCRYPTION_KEY_BASE64,
  );

  const testFn = hasEnv ? it : it.skip;

  testFn('round-trips provider keys via Supabase', async () => {
    jest.resetModules();
    const originalDemo = process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE;
    const originalBypass = process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = process.env.TEST_USER_EMAIL || 'model-keys-test@example.com';

    let list;
    try {
      list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    } catch (err: any) {
      console.warn('[model-keys test] Supabase unreachable, skipping:', err?.message || err);
      return;
    }

    if (!list?.data || list.error) {
      console.warn('[model-keys test] Supabase listUsers error, skipping:', list?.error?.message || 'unknown');
      return;
    }

    let user = list.data.users.find((u) => u.email === email);
    if (!user) {
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: 'Temp1234!',
      });
      user = created.data.user!;
    }

    process.env.TEST_USER_ID = user!.id;

    // Force BYOK enabled for the duration of this module.
    process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE = 'false';
    process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS = 'false';

    const { DELETE, GET, POST } = await import('./route');

    const openaiKey = process.env.OPENAI_API_KEY || 'sk-test-openai-1234';

    const postRes = await POST(makeRequest('POST', { provider: 'openai', apiKey: openaiKey }));
    expect(postRes.status).toBe(200);

    const getRes = await GET(makeRequest('GET'));
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.ok).toBe(true);
    const openaiStatus = (getJson.keys || []).find((k: any) => k.provider === 'openai');
    expect(openaiStatus?.configured).toBe(true);
    expect(typeof openaiStatus?.last4).toBe('string');

    const delRes = await DELETE(makeRequest('DELETE', { provider: 'openai' }));
    expect(delRes.status).toBe(200);

    const getAfter = await GET(makeRequest('GET'));
    expect(getAfter.status).toBe(200);
    const afterJson = await getAfter.json();
    const openaiAfter = (afterJson.keys || []).find((k: any) => k.provider === 'openai');
    expect(openaiAfter?.configured).toBe(false);

    delete process.env.TEST_USER_ID;

    if (originalDemo === undefined) {
      delete process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE;
    } else {
      process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE = originalDemo;
    }

    if (originalBypass === undefined) {
      delete process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS;
    } else {
      process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS = originalBypass;
    }
  });
});

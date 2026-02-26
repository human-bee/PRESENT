#!/usr/bin/env -S npx tsx

import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const cwd = process.cwd();
loadDotenv({ path: path.resolve(cwd, '.env.local') });

const nowIso = new Date().toISOString();
const shouldApply = process.argv.includes('--apply');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    'Missing Supabase connection env vars (SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_SERVICE_KEY).',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const expiredCount = async (table: string) => {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .lt('expires_at', nowIso);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
};

const purgeTable = async (table: string) => {
  const { error } = await supabase.from(table).delete().lt('expires_at', nowIso);
  if (error) throw new Error(`${table}: ${error.message}`);
};

const run = async () => {
  const tables = ['agent_model_io', 'agent_tool_io', 'agent_io_blobs'] as const;
  const before = await Promise.all(tables.map((table) => expiredCount(table)));
  const summaryBefore = Object.fromEntries(tables.map((table, index) => [table, before[index]]));

  if (!shouldApply) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          asOf: nowIso,
          expiredRows: summaryBefore,
          hint: 'Run with --apply to delete expired rows.',
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const table of tables) {
    await purgeTable(table);
  }

  const after = await Promise.all(tables.map((table) => expiredCount(table)));
  const summaryAfter = Object.fromEntries(tables.map((table, index) => [table, after[index]]));
  const deleted = Object.fromEntries(
    tables.map((table, index) => [table, Math.max(0, before[index] - after[index])]),
  );

  console.log(
    JSON.stringify(
      {
        mode: 'apply',
        asOf: nowIso,
        deletedRows: deleted,
        remainingExpiredRows: summaryAfter,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

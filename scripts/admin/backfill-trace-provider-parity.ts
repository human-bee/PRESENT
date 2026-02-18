import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { deriveProviderParity } from '../../src/lib/agents/admin/provider-parity';

type JsonRecord = Record<string, unknown>;

type TraceRow = {
  id: string;
  created_at: string;
  task: string | null;
  task_id: string | null;
  stage: string | null;
  status: string | null;
  payload: JsonRecord | null;
  provider: string | null;
  model: string | null;
  provider_source: string | null;
  provider_path: string | null;
  provider_request_id: string | null;
};

type TaskParamRow = {
  id: string;
  params: JsonRecord | null;
};

type UpdateRow = {
  id: string;
  provider: string;
  model: string | null;
  provider_source: string;
  provider_path: string;
  provider_request_id: string | null;
};

type ParsedArgs = {
  apply: boolean;
  days: number;
  batch: number;
};

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  let apply = false;
  let days = 30;
  let batch = 500;

  for (const arg of args) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }
    if (arg.startsWith('--days=')) {
      const raw = Number(arg.slice('--days='.length));
      if (Number.isFinite(raw) && raw > 0) {
        days = Math.max(1, Math.floor(raw));
      }
      continue;
    }
    if (arg.startsWith('--batch=')) {
      const raw = Number(arg.slice('--batch='.length));
      if (Number.isFinite(raw) && raw > 0) {
        batch = Math.max(50, Math.min(2_000, Math.floor(raw)));
      }
      continue;
    }
  }

  return { apply, days, batch };
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isMissingProviderOrModel = (row: TraceRow): boolean => {
  return !normalizeString(row.provider) || !normalizeString(row.model);
};

async function main() {
  loadEnv({ path: '.env.local' });
  loadEnv({ path: '.env.development.local' });

  const { apply, days, batch } = parseArgs();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRole) {
    throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const db = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const now = Date.now();
  const cutoffIso = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  let offset = 0;
  let scanned = 0;
  let candidates = 0;
  let updated = 0;

  while (true) {
    const { data, error } = await db
      .from('agent_trace_events')
      .select(
        [
          'id',
          'created_at',
          'task',
          'task_id',
          'stage',
          'status',
          'payload',
          'provider',
          'model',
          'provider_source',
          'provider_path',
          'provider_request_id',
        ].join(','),
      )
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: false })
      .range(offset, offset + batch - 1);

    if (error) throw error;
    const rows = Array.isArray(data) ? (data as unknown as TraceRow[]) : [];
    if (rows.length === 0) break;
    scanned += rows.length;

    const candidateRows = rows.filter(isMissingProviderOrModel);
    if (candidateRows.length === 0) {
      offset += batch;
      continue;
    }

    const taskIds = Array.from(
      new Set(
        candidateRows
          .map((row) => normalizeString(row.task_id))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const taskParamsById = new Map<string, JsonRecord | null>();
    if (taskIds.length > 0) {
      const { data: taskData, error: taskError } = await db
        .from('agent_tasks')
        .select('id,params')
        .in('id', taskIds);
      if (taskError) throw taskError;
      for (const row of (taskData ?? []) as TaskParamRow[]) {
        taskParamsById.set(row.id, row.params && typeof row.params === 'object' && !Array.isArray(row.params) ? row.params : null);
      }
    }

    const updates: UpdateRow[] = candidateRows.map((row) => {
      const taskId = normalizeString(row.task_id);
      const taskParams = taskId ? taskParamsById.get(taskId) ?? null : null;
      const parity = deriveProviderParity({
        provider: row.provider,
        model: row.model,
        providerSource: row.provider_source,
        providerPath: row.provider_path,
        providerRequestId: row.provider_request_id,
        stage: row.stage,
        status: row.status,
        task: row.task,
        params: taskParams ?? undefined,
        payload: row.payload ?? undefined,
      });
      return {
        id: row.id,
        provider: parity.provider,
        model: parity.model,
        provider_source: parity.providerSource,
        provider_path: parity.providerPath,
        provider_request_id: parity.providerRequestId,
      };
    });

    candidates += updates.length;

    if (apply) {
      for (const updateRow of updates) {
        const { error: updateError } = await db
          .from('agent_trace_events')
          .update({
            provider: updateRow.provider,
            model: updateRow.model,
            provider_source: updateRow.provider_source,
            provider_path: updateRow.provider_path,
            provider_request_id: updateRow.provider_request_id,
          })
          .eq('id', updateRow.id);
        if (updateError) throw updateError;
        updated += 1;
      }
    }

    offset += batch;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: apply ? 'apply' : 'dry-run',
        windowDays: days,
        batch,
        cutoffIso,
        scanned,
        candidates,
        updated,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const toErrorMessage = (value: unknown): string => {
    if (value instanceof Error) return value.message;
    if (!value || typeof value !== 'object') return String(value);
    const record = value as Record<string, unknown>;
    const parts = ['code', 'message', 'details', 'hint']
      .map((key) => (typeof record[key] === 'string' ? String(record[key]).trim() : ''))
      .filter((entry) => entry.length > 0);
    if (parts.length > 0) return parts.join(' | ');
    try {
      return JSON.stringify(record);
    } catch {
      return String(value);
    }
  };
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: toErrorMessage(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

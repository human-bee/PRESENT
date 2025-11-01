import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';

try {
  dotenvConfig({ path: join(process.cwd(), '.env.local') });
} catch {}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY) as string;

const supabase = url && serviceRoleKey ? createClient(url, serviceRoleKey, { auth: { persistSession: false } }) : null;

export type TodoItem = {
  id: string;
  session_id: string;
  text: string;
  status: 'open' | 'done' | 'skipped';
  position: number;
  created_at: string;
  resolved_at: string | null;
};

export async function addTodo(sessionId: string, text: string) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('canvas_agent_todos')
    .insert({ session_id: sessionId, text, status: 'open' })
    .select('*')
    .single();
  if (error) throw error;
  return data as TodoItem;
}

export async function resolveTodo(id: string) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('canvas_agent_todos')
    .update({ status: 'done', resolved_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as TodoItem;
}

export async function listTodos(sessionId: string) {
  if (!supabase) return [] as TodoItem[];
  const { data, error } = await supabase
    .from('canvas_agent_todos')
    .select('*')
    .eq('session_id', sessionId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data || []) as TodoItem[];
}







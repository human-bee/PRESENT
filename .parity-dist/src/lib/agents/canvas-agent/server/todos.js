import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
try {
    dotenvConfig({ path: join(process.cwd(), '.env.local') });
}
catch { }
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
const supabase = url && serviceRoleKey ? createClient(url, serviceRoleKey, { auth: { persistSession: false } }) : null;
export async function addTodo(sessionId, text) {
    if (!supabase)
        return null;
    const { data, error } = await supabase
        .from('canvas_agent_todos')
        .insert({ session_id: sessionId, text, status: 'open' })
        .select('*')
        .single();
    if (error)
        throw error;
    return data;
}
export async function resolveTodo(id) {
    if (!supabase)
        return null;
    const { data, error } = await supabase
        .from('canvas_agent_todos')
        .update({ status: 'done', resolved_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
    if (error)
        throw error;
    return data;
}
export async function listTodos(sessionId) {
    if (!supabase)
        return [];
    const { data, error } = await supabase
        .from('canvas_agent_todos')
        .select('*')
        .eq('session_id', sessionId)
        .order('position', { ascending: true });
    if (error)
        throw error;
    return (data || []);
}
//# sourceMappingURL=todos.js.map
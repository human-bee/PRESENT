import { createClient } from '@supabase/supabase-js'

// Create a function to get Supabase config that works at runtime
function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  // If we're in the browser and missing vars, log the issue
  if (typeof window !== 'undefined') {
    if (!url || !key) {
      console.error('❌ Missing Supabase environment variables!')
      console.error('NEXT_PUBLIC_SUPABASE_URL:', url || 'MISSING')
      console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY:', key ? 'SET' : 'MISSING')
    }
  }
  
  // Use safe fallbacks that won't break the build
  return {
    url: url || 'https://placeholder.supabase.co',
    key: key || 'placeholder-key'
  }
}

const config = getSupabaseConfig()
export const supabase = createClient(config.url, config.key)

export type Canvas = {
  id: string
  user_id: string
  name: string
  description?: string
  document: any
  conversation_key?: string
  thumbnail?: string
  is_public: boolean
  created_at: string
  updated_at: string
  last_modified: string
}

export type Profile = {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
  created_at: string
}

export type CanvasSession = {
  id: string
  canvas_id: string | null
  room_name: string
  participants: Array<{ identity: string; name?: string | null; metadata?: string | null }> | null
  transcript: Array<{ participantId: string; text: string; timestamp: number }> | null
  canvas_state: any | null
  events?: Array<{ type: string; timestamp: number; data?: any; source?: string }>
  created_at?: string
  updated_at?: string
}
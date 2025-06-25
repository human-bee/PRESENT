import { createClient } from '@supabase/supabase-js'

// Use fallback values during build time to prevent errors
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'

// Runtime check for proper configuration (only when window is available)
if (typeof window !== 'undefined') {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('Missing Supabase environment variables. Please check your .env.local file.')
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
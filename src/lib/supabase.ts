import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

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
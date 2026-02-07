import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-auth';

export function useTldrawUser() {
  const { user } = useAuth();

  return useMemo(() => {
    if (!user) return null;
    return {
      id: user.id,
      getToken: async () => {
        try {
          const { data } = await supabase.auth.getSession();
          return data?.session?.access_token;
        } catch {
          return undefined;
        }
      },
    };
  }, [user]);
}

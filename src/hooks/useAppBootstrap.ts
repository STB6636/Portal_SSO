import { useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { queryClient, QUERY_KEYS } from '@/lib/queryClient';
import { authService, setupService } from '@/services/authService';
import { useAuthStore } from '@/stores/useAuthStore';

export function useAppBootstrap() {
  const setBootstrapState = useAuthStore((s) => s.setBootstrapState);
  const setUser = useAuthStore((s) => s.setUser);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        if (!isSupabaseConfigured) {
          if (active) setBootstrapState({ initialized: true, systemHasUsers: true, user: null });
          return;
        }
        const hasUsers = await setupService.isSystemInitialized();
        const { data: sessionData } = await supabase.auth.getSession();
        let profile = null;
        if (sessionData.session) {
          profile = await authService.getMyProfile();
        }
        if (active) {
          setBootstrapState({ initialized: true, systemHasUsers: hasUsers, user: profile });
        }
      } catch {
        if (active) {
          setBootstrapState({ initialized: true, systemHasUsers: true, user: null });
        }
      }
    }

    boot();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;
      if (event === 'SIGNED_OUT' || !session) {
        clearAuth();
        queryClient.removeQueries({ queryKey: QUERY_KEYS.masterData });
        queryClient.removeQueries({ queryKey: ['personnel'] });
        queryClient.removeQueries({ queryKey: ['users'] });
        queryClient.removeQueries({ queryKey: ['app-access'] });
        queryClient.removeQueries({ queryKey: QUERY_KEYS.myApps });
        queryClient.removeQueries({ queryKey: QUERY_KEYS.dashboardStats });
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const profile = await authService.getMyProfile().catch(() => null);
        if (active) {
          setUser(profile);
          void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.masterData });
          void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.publicSettings });
        }
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [setBootstrapState, setUser, clearAuth]);
}

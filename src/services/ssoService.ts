import { supabase, invokeEdgeFunction } from '@/lib/supabaseClient';
import type { MyAppLaunchCard } from '@/types/domain.types';

export const ssoService = {
  async getMyApps(): Promise<MyAppLaunchCard[]> {
    const { data, error } = await supabase.rpc('fn_get_my_apps');
    if (error) throw new Error(error.message);
    return (data ?? []) as MyAppLaunchCard[];
  },

  async generateSsoLaunchUrl(webappId: string): Promise<{ redirect_url: string; expires_at: string }> {
    const res = await invokeEdgeFunction<{ success: boolean; redirect_url: string; expires_at: string }>(
      'portal-sso',
      '/generate',
      { method: 'POST', body: { webapp_id: webappId } }
    );
    return { redirect_url: res.redirect_url, expires_at: res.expires_at };
  },
};

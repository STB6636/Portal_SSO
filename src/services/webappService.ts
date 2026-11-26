import { supabase, invokeEdgeFunction } from '@/lib/supabaseClient';
import type { WebappWithRoles } from '@/types/domain.types';
import type { WebappRoleRow } from '@/types/database.types';

export const webappService = {
  async listAll(): Promise<WebappWithRoles[]> {
    const { data, error } = await supabase.from('v_webapps_with_roles').select('*').order('sort_order').order('name');
    if (error) throw new Error(error.message);
    return (data ?? []) as WebappWithRoles[];
  },

  async saveWithRoles(payload: {
    id?: string;
    app_code: string;
    name: string;
    description?: string;
    url: string;
    icon?: string;
    icon_url?: string;
    color?: string;
    status: string;
    auto_grant_on_provision: boolean;
    sort_order: number;
    roles: Array<Partial<WebappRoleRow>>;
    scopes: string[];
    allowed_origins: string[];
  }): Promise<string> {
    const { data, error } = await supabase.rpc('fn_save_webapp_with_roles', { p_payload: payload });
    if (error) throw new Error(error.message);
    return String(data);
  },

  async rotateApiKey(webappId: string): Promise<{ api_key: string; api_key_prefix: string }> {
    const res = await invokeEdgeFunction<{ success: boolean; api_key: string; api_key_prefix: string }>(
      'portal-admin-users',
      '/rotate-webapp-key',
      { method: 'POST', body: { webapp_id: webappId } }
    );
    return { api_key: res.api_key, api_key_prefix: res.api_key_prefix };
  },

  async deleteWebapp(id: string) {
    const { error } = await supabase.from('webapps').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

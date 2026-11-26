import { supabase } from '@/lib/supabaseClient';

export interface AppAccessMatrixRow {
  permission_id: string;
  user_id: string;
  username: string;
  core_role: string;
  full_name: string | null;
  office_id: string | null;
  office_name: string | null;
  department_id: string | null;
  department_name: string | null;
  webapp_id: string;
  app_code: string;
  webapp_name: string;
  webapp_role_id: string;
  role_code: string;
  role_name_th: string;
  hierarchy_level: number;
  role_color: string | null;
  allow_scoped_admin_grant: boolean;
  is_allowed: boolean;
  expires_at: string | null;
  note: string | null;
  updated_at: string;
}

export const appAccessService = {
  async listMatrix(webappId?: string): Promise<AppAccessMatrixRow[]> {
    let q = supabase.from('v_user_app_access_matrix').select('*').order('updated_at', { ascending: false });
    if (webappId) q = q.eq('webapp_id', webappId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as AppAccessMatrixRow[];
  },

  async bulkGrant(params: {
    webappId: string;
    webappRoleId: string;
    userIds: string[];
    isAllowed: boolean;
    expiresAt?: string | null;
    note?: string | null;
  }): Promise<number> {
    const { data, error } = await supabase.rpc('fn_bulk_grant_webapp_access', {
      p_webapp_id: params.webappId,
      p_webapp_role_id: params.webappRoleId,
      p_user_ids: params.userIds,
      p_is_allowed: params.isAllowed,
      p_expires_at: params.expiresAt || null,
      p_note: params.note || null,
    });
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  },
};

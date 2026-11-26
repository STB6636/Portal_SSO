import { supabase, invokeEdgeFunction } from '@/lib/supabaseClient';
import type { AdminScopeLevelNo, CoreRole, UserAccountStatus } from '@/types/database.types';

export interface ScopedUserViewRow {
  id: string;
  personnel_id: string | null;
  username: string;
  email: string | null;
  role: CoreRole;
  status: UserAccountStatus;
  must_change_credential: boolean;
  account_source: string;
  last_login_at: string | null;
  created_at: string;
  full_name: string | null;
  cid_masked: string | null;
  photo_path?: string | null;
  bureau_id?: string | null;
  bureau_name?: string | null;
  office_id: string | null;
  office_name: string | null;
  department_id: string | null;
  department_name: string | null;
  division_id: string | null;
  division_name: string | null;
  position_type_id?: string | null;
  position_type_code?: string | null;
  position_type_name?: string | null;
  position_id?: string | null;
  position_name: string | null;
  position_level_id?: string | null;
  position_level_name: string | null;
  position_number?: string | null;
  position_display?: string | null;
  scope_level_no: AdminScopeLevelNo | null;
  scope_org_unit_id: string | null;
  scope_org_unit_name: string | null;
}

export const userService = {
  async listScopedUsers(): Promise<ScopedUserViewRow[]> {
    const { data, error } = await supabase.from('v_users_scoped').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ScopedUserViewRow[];
  },

  async provisionAccounts(personnelIds: string[]) {
    return invokeEdgeFunction<{ success: boolean; created: number; skipped: Array<{ personnel_id: string; reason: string }> }>(
      'portal-admin-users',
      '/provision-bulk',
      { method: 'POST', body: { personnel_ids: personnelIds } }
    );
  },

  async toggleUserStatus(userId: string, status: UserAccountStatus) {
    return invokeEdgeFunction<{ success: boolean }>(
      'portal-admin-users',
      '/toggle-status',
      { method: 'POST', body: { user_id: userId, status } }
    );
  },

  async assignRoleAndScope(
    userId: string,
    role: CoreRole,
    scopeLevelNo: AdminScopeLevelNo | null,
    orgUnitId: string | null
  ) {
    const { error } = await supabase.rpc('fn_assign_user_role_and_scope', {
      p_user_id: userId,
      p_role: role,
      p_scope_level_no: scopeLevelNo,
      p_org_unit_id: orgUnitId,
    });
    if (error) throw new Error(error.message);
  },
};

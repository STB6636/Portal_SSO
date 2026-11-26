import { supabase } from '@/lib/supabaseClient';
import { authService } from './authService';
import type { CoreRole, CredentialResetRequestRow } from '@/types/database.types';

export interface ResetRequestUserSnapshot {
  id: string;
  username: string;
  full_name: string | null;
  cid_masked: string | null;
  photo_path?: string | null;
  role: CoreRole;
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
}

export interface ResetRequestEnriched extends CredentialResetRequestRow {
  user?: ResetRequestUserSnapshot | null;
  handled_by_name?: string | null;
}

export const resetRequestService = {
  async list(): Promise<ResetRequestEnriched[]> {
    const { data, error } = await supabase
      .from('credential_reset_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CredentialResetRequestRow[];
    if (rows.length === 0) return [];

    const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
    const handlerIds = Array.from(
      new Set(rows.map((r) => r.handled_by).filter((id): id is string => Boolean(id)))
    );

    const [usersRes, handlersRes] = await Promise.all([
      supabase
        .from('v_users_scoped')
        .select(
          'id, username, full_name, cid_masked, photo_path, role, bureau_id, bureau_name, office_id, office_name, department_id, department_name, division_id, division_name, position_type_id, position_type_code, position_type_name, position_id, position_name, position_level_id, position_level_name, position_number, position_display'
        )
        .in('id', userIds),
      handlerIds.length > 0
        ? supabase.rpc('fn_resolve_user_display_names', { p_user_ids: handlerIds })
        : Promise.resolve({ data: [] as Array<{ user_id: string; display_name: string }>, error: null }),
    ]);

    const userMap = new Map<string, ResetRequestUserSnapshot>(
      ((usersRes.data ?? []) as ResetRequestUserSnapshot[]).map((u) => [u.id, u])
    );

    const handlerNameMap = new Map<string, string>();
    if (!handlersRes.error && Array.isArray(handlersRes.data)) {
      for (const h of handlersRes.data as Array<{ user_id: string; display_name: string }>) {
        if (h.user_id && h.display_name) {
          handlerNameMap.set(h.user_id, h.display_name);
        }
      }
    }

    return rows.map((r) => {
      const requester = userMap.get(r.user_id) ?? null;
      const fallbackHandler = r.handled_by ? userMap.get(r.handled_by)?.full_name || userMap.get(r.handled_by)?.username : null;
      return {
        ...r,
        user: requester,
        handled_by_name: r.handled_by ? handlerNameMap.get(r.handled_by) || fallbackHandler || null : null,
      };
    });
  },

  approveOrReject(requestId: string, approve: boolean, rejectReason?: string) {
    return authService.approveResetRequest(requestId, approve, rejectReason);
  },

  bulkApproveOrReject(requestIds: string[], approve: boolean, rejectReason?: string) {
    return authService.approveResetRequestsBulk(requestIds, approve, rejectReason);
  },
};

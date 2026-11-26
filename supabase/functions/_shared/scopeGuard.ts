import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import type { AuthenticatedActor } from './auth.ts';

export async function isPersonnelInActorScope(
  adminClient: SupabaseClient,
  actor: AuthenticatedActor,
  personnelId: string
): Promise<boolean> {
  if (actor.role === 'SUPERADMIN') return true;
  if (actor.personnel_id && actor.personnel_id === personnelId) return true;
  if (actor.role !== 'ADMIN' || !actor.admin_scope) return false;

  const { data: assignment } = await adminClient
    .from('personnel_assignments')
    .select('office_id, department_id')
    .eq('personnel_id', personnelId)
    .maybeSingle();

  if (!assignment) return false;
  if (actor.admin_scope.scope_level_no === 2) {
    return assignment.office_id === actor.admin_scope.org_unit_id;
  }
  if (actor.admin_scope.scope_level_no === 3) {
    return assignment.department_id === actor.admin_scope.org_unit_id;
  }
  return false;
}

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export interface AuthenticatedAdminScope {
  scope_level_no: 2 | 3;
  org_unit_id: string;
  org_unit_name?: string | null;
  parent_office_id?: string | null;
}

export interface AuthenticatedActor {
  id: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'USER';
  status: string;
  personnel_id: string | null;
  must_change_credential: boolean;
  admin_scope: AuthenticatedAdminScope | null;
}

export async function resolveUserAdminScope(
  adminClient: SupabaseClient,
  userId: string,
  role: string
): Promise<AuthenticatedAdminScope | null> {
  if (role !== 'ADMIN') return null;
  const { data: sc } = await adminClient
    .from('user_admin_scopes')
    .select('scope_level_no, org_unit_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!sc) return null;

  const { data: ou } = await adminClient
    .from('org_units')
    .select('name_th, parent_id')
    .eq('id', sc.org_unit_id)
    .maybeSingle();

  const levelNo = sc.scope_level_no as 2 | 3;
  return {
    scope_level_no: levelNo,
    org_unit_id: sc.org_unit_id as string,
    org_unit_name: (ou?.name_th as string | null) ?? null,
    parent_office_id:
      levelNo === 2
        ? (sc.org_unit_id as string)
        : ((ou?.parent_id as string | null) ?? null),
  };
}

export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const schema = Deno.env.get('PORTAL_SSO_SCHEMA') ?? 'public';
  return createClient(url, serviceKey, {
    db: { schema },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireAuthenticatedActor(
  req: Request,
  adminClient: SupabaseClient
): Promise<AuthenticatedActor | null> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data: userData, error } = await adminClient.auth.getUser(token);
  if (error || !userData?.user) return null;

  const { data: u } = await adminClient
    .from('users')
    .select('id, role, status, personnel_id, must_change_credential')
    .eq('id', userData.user.id)
    .single();

  if (!u || u.status !== 'ACTIVE') return null;

  const adminScope = await resolveUserAdminScope(adminClient, u.id, u.role);

  return {
    id: u.id,
    role: u.role,
    status: u.status,
    personnel_id: u.personnel_id,
    must_change_credential: Boolean(u.must_change_credential),
    admin_scope: adminScope,
  };
}

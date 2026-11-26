import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export interface AuthenticatedActor {
  id: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'USER';
  status: string;
  personnel_id: string | null;
  must_change_credential: boolean;
  admin_scope: { scope_level_no: 2 | 3; org_unit_id: string } | null;
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

  let adminScope: AuthenticatedActor['admin_scope'] = null;
  if (u.role === 'ADMIN') {
    const { data: sc } = await adminClient
      .from('user_admin_scopes')
      .select('scope_level_no, org_unit_id')
      .eq('user_id', u.id)
      .maybeSingle();
    if (sc) {
      adminScope = {
        scope_level_no: sc.scope_level_no as 2 | 3,
        org_unit_id: sc.org_unit_id as string,
      };
    }
  }

  return {
    id: u.id,
    role: u.role,
    status: u.status,
    personnel_id: u.personnel_id,
    must_change_credential: Boolean(u.must_change_credential),
    admin_scope: adminScope,
  };
}

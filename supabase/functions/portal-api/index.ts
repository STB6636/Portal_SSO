import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts';
import {
  createAdminClient,
  requireAuthenticatedActor,
  type AuthenticatedActor,
} from '../_shared/auth.ts';
import { sha256Hex } from '../_shared/crypto.ts';

interface ResolvedWebapp {
  id: string;
  app_code: string;
  scopes: Set<string>;
  origins: string[];
  mode: 'A' | 'B';
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function hasActiveAppPermission(
  admin: AdminClient,
  actor: AuthenticatedActor,
  webappId: string
): Promise<boolean> {
  if (actor.role === 'SUPERADMIN') return true;
  const { data: perm } = await admin
    .from('user_app_permissions')
    .select('is_allowed, expires_at')
    .eq('user_id', actor.id)
    .eq('webapp_id', webappId)
    .maybeSingle();
  if (!perm?.is_allowed) return false;
  if (perm.expires_at && new Date(perm.expires_at).getTime() <= Date.now()) return false;
  return true;
}

/**
 * Mode B (SPA with public `x-app-code`) MUST always present a valid user Bearer JWT.
 * Mode A (`x-app-key` SHA-256 verified secret) is trusted Service-to-Service.
 */
async function resolveModeBActor(
  req: Request,
  admin: AdminClient,
  app: ResolvedWebapp,
  requireAppAccess = false
): Promise<{ actor: AuthenticatedActor | null; errorResponse: Response | null }> {
  if (app.mode === 'A') {
    return { actor: null, errorResponse: null };
  }
  const actor = await requireAuthenticatedActor(req, admin);
  if (!actor) {
    return {
      actor: null,
      errorResponse: jsonResponse(
        { success: false, message: 'Unauthorized: Mode B requests require a valid Bearer JWT' },
        401
      ),
    };
  }
  if (requireAppAccess) {
    const allowed = await hasActiveAppPermission(admin, actor, app.id);
    if (!allowed) {
      return {
        actor: null,
        errorResponse: jsonResponse(
          { success: false, message: 'Forbidden: User does not have active access to this webapp' },
          403
        ),
      };
    }
  }
  return { actor, errorResponse: null };
}

function applyActorScopeToQuery<T extends { eq: (col: string, val: string) => T }>(
  query: T,
  actor: AuthenticatedActor | null,
  idColumn: 'id' | 'person_id' = 'id',
  allowAllForUser = false
): { query: T; empty: boolean } {
  if (!actor || actor.role === 'SUPERADMIN') {
    return { query, empty: false };
  }
  if (actor.role === 'ADMIN' && actor.admin_scope) {
    if (actor.admin_scope.scope_level_no === 2) {
      return { query: query.eq('office_id', actor.admin_scope.org_unit_id), empty: false };
    }
    if (actor.admin_scope.scope_level_no === 3) {
      return { query: query.eq('department_id', actor.admin_scope.org_unit_id), empty: false };
    }
  }
  if (allowAllForUser) {
    return { query, empty: false };
  }
  if (!actor.personnel_id) {
    return { query, empty: true };
  }
  return { query: query.eq(idColumn, actor.personnel_id), empty: false };
}

function maskCid(cid: unknown): string {
  const digits = String(cid ?? '').replace(/\D/g, '');
  if (digits.length !== 13) return 'x-xxxx-xxxxx-xx-x';
  return `${digits[0]}-xxxx-xxxxx-${digits.slice(10, 12)}-${digits[12]}`;
}

/**
 * Mandate 4 (PDPA & Scope Filtering):
 * - Always removes raw `cid` from general endpoints and exposes `cid_masked` instead
 * - Strips salary & disciplinary fields unless `personnel:sensitive` scope is granted
 * - Strips career/service-date fields unless `personnel:career` scope is granted
 * - Strips raw `signature_path` and sets `signature_url: null` unless `personnel:signature` scope is granted
 */
function sanitizePersonnelByScopes(
  row: Record<string, unknown> | null,
  scopes: Set<string>
): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = { ...row };

  if ('cid' in out) {
    out.cid_masked = maskCid(out.cid);
    delete out.cid;
  }

  if (scopes.has('personnel:signature')) {
    out.signature_url = out.signature_path || null;
  } else {
    delete out.signature_path;
    out.signature_url = null;
  }

  if (!scopes.has('personnel:sensitive')) {
    delete out.initial_salary;
    delete out.current_salary;
    delete out.position_allowance;
    delete out.is_max_step;
    delete out.disciplinary_flag;
    delete out.disciplinary_note;
  }

  if (!scopes.has('personnel:career')) {
    delete out.start_service_date;
    delete out.start_service_year_be;
    delete out.re_appointment_date;
    delete out.transfer_in_date;
    delete out.prior_continuous_service_days;
    delete out.double_service_days;
    delete out.initial_position;
  }

  return out;
}

async function authenticateWebapp(req: Request, admin: ReturnType<typeof createAdminClient>): Promise<ResolvedWebapp | null> {
  const apiKey = req.headers.get('x-app-key')?.trim();
  const appCode = req.headers.get('x-app-code')?.trim().toUpperCase();

  let app: { id: string; app_code: string; status: string } | null = null;
  let mode: 'A' | 'B' = 'A';

  if (apiKey) {
    const hash = await sha256Hex(apiKey);
    const { data } = await admin.from('webapps').select('id, app_code, status').eq('api_key_hash', hash).maybeSingle();
    app = data;
    mode = 'A';
  } else if (appCode) {
    const { data } = await admin.from('webapps').select('id, app_code, status').eq('app_code', appCode).maybeSingle();
    app = data;
    mode = 'B';
  }

  if (!app || app.status === 'DISABLED') return null;

  const [{ data: scopes }, { data: origins }] = await Promise.all([
    admin.from('webapp_scopes').select('scope_code').eq('webapp_id', app.id),
    admin.from('webapp_allowed_origins').select('origin_url').eq('webapp_id', app.id),
  ]);

  const originHeader = req.headers.get('origin') || '';
  const allowedOrigins = (origins ?? []).map((o: { origin_url: string }) => o.origin_url);
  if (mode === 'B' && allowedOrigins.length > 0 && originHeader && !allowedOrigins.includes(originHeader)) {
    return null;
  }

  return {
    id: app.id,
    app_code: app.app_code,
    scopes: new Set((scopes ?? []).map((s: { scope_code: string }) => s.scope_code)),
    origins: allowedOrigins,
    mode,
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const apiIdx = parts.indexOf('portal-api');
  const route = '/' + (apiIdx >= 0 ? parts.slice(apiIdx + 1) : parts).join('/');
  const admin = createAdminClient();

  try {
    // 1. GET /health
    if (req.method === 'GET' && (route === '/health' || route === '/')) {
      return jsonResponse({ success: true, service: 'portal-api', version: '2.4.0', timestamp: new Date().toISOString() });
    }

    const app = await authenticateWebapp(req, admin);
    if (!app) {
      return jsonResponse({ success: false, message: 'Invalid app credentials (x-app-key or x-app-code) or disallowed origin' }, 401);
    }

    // 2. POST /sso/verify (Mode A) & 3. POST /sso/exchange (Mode B)
    if (req.method === 'POST' && (route === '/sso/verify' || route === '/sso/exchange')) {
      if (route === '/sso/verify' && app.mode !== 'A') {
        return jsonResponse({ success: false, message: '/sso/verify requires Mode A (x-app-key)' }, 403);
      }
      const body = await req.json().catch(() => ({}));
      const rawToken = String(body?.ssoToken || '').trim();
      if (!rawToken) {
        return jsonResponse({ success: false, message: 'Missing ssoToken' }, 400);
      }
      const tokenHash = await sha256Hex(rawToken);
      const { data: tok } = await admin
        .from('security_tokens')
        .select('*')
        .eq('token_type', 'SSO_HANDSHAKE')
        .eq('token_hash', tokenHash)
        .eq('webapp_id', app.id)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (!tok) {
        return jsonResponse({ success: false, message: 'SSO Token ไม่ถูกต้อง ถูกใช้ไปแล้ว หรือหมดอายุ' }, 401);
      }

      await admin.from('security_tokens').update({ used_at: new Date().toISOString() }).eq('id', tok.id);

      const { data: u } = await admin.from('users').select('id, username, email, auth_email, role, personnel_id').eq('id', tok.user_id).single();
      const { data: person } = u?.personnel_id
        ? await admin.from('v_personnel_directory').select('*').eq('id', u.personnel_id).maybeSingle()
        : { data: null };

      let otpHash: string | null = null;
      if (route === '/sso/exchange' && u?.auth_email) {
        const { data: linkData } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.auth_email });
        otpHash = linkData?.properties?.hashed_token ?? null;
      }

      return jsonResponse({
        success: true,
        user: { id: u?.id, username: u?.username, email: u?.email, role: u?.role },
        personnel: sanitizePersonnelByScopes(person as Record<string, unknown> | null, app.scopes),
        app_permission: tok.payload?.app_permission ?? null,
        ...(route === '/sso/exchange' ? { otp_hash: otpHash } : {}),
      });
    }

    // 4. GET /me (Mode B Bearer JWT)
    if (req.method === 'GET' && route === '/me') {
      const actor = await requireAuthenticatedActor(req, admin);
      if (!actor) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);
      const { data: person } = actor.personnel_id
        ? await admin.from('v_personnel_directory').select('*').eq('id', actor.personnel_id).maybeSingle()
        : { data: null };
      const { data: perm } = await admin
        .from('user_app_permissions')
        .select('is_allowed, expires_at, webapp_roles(role_code, role_name_th, hierarchy_level)')
        .eq('user_id', actor.id)
        .eq('webapp_id', app.id)
        .maybeSingle();
      const permActive = Boolean(
        perm?.is_allowed && (!perm.expires_at || new Date(perm.expires_at).getTime() > Date.now())
      );
      let resolvedAppPerm = permActive ? perm?.webapp_roles ?? null : null;
      if (!resolvedAppPerm && actor.role === 'SUPERADMIN') {
        const { data: topRole } = await admin
          .from('webapp_roles')
          .select('role_code, role_name_th, hierarchy_level')
          .eq('webapp_id', app.id)
          .eq('is_active', true)
          .order('is_app_admin', { ascending: false })
          .order('hierarchy_level', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedAppPerm = topRole ?? null;
      }
      return jsonResponse({
        success: true,
        user: actor,
        personnel: sanitizePersonnelByScopes(person as Record<string, unknown> | null, app.scopes),
        app_permission: resolvedAppPerm,
      });
    }

    // 5. GET /app-roles
    if (req.method === 'GET' && route === '/app-roles') {
      const { data } = await admin
        .from('webapp_roles')
        .select('id, role_code, role_name_th, description, hierarchy_level, color_hex, is_default_on_grant, is_app_admin')
        .eq('webapp_id', app.id)
        .eq('is_active', true)
        .order('hierarchy_level', { ascending: false });
      return jsonResponse({ success: true, data: data ?? [] });
    }

    // 6. GET /authorized-users (permission:read)
    if (req.method === 'GET' && route === '/authorized-users') {
      if (!app.scopes.has('permission:read')) return jsonResponse({ success: false, message: 'Missing scope permission:read' }, 403);
      const { actor, errorResponse } = await resolveModeBActor(req, admin, app, true);
      if (errorResponse) return errorResponse;
      const roleCode = url.searchParams.get('role_code');
      const minLevel = Number(url.searchParams.get('min_hierarchy_level') || 0);
      let q = admin
        .from('v_user_app_access_matrix')
        .select('*')
        .eq('webapp_id', app.id)
        .eq('is_allowed', true);
      if (roleCode) q = q.eq('role_code', roleCode);
      if (minLevel > 0) q = q.gte('hierarchy_level', minLevel);
      if (actor && actor.role === 'ADMIN' && actor.admin_scope) {
        if (actor.admin_scope.scope_level_no === 2) q = q.eq('office_id', actor.admin_scope.org_unit_id);
        else if (actor.admin_scope.scope_level_no === 3) q = q.eq('department_id', actor.admin_scope.org_unit_id);
      } else if (actor && actor.role !== 'SUPERADMIN') {
        q = q.eq('user_id', actor.id);
      }
      const { data } = await q;
      return jsonResponse({ success: true, data: data ?? [] });
    }

    // 7. GET /lookups (reference:read)
    if (req.method === 'GET' && route === '/lookups') {
      if (!app.scopes.has('reference:read')) return jsonResponse({ success: false, message: 'Missing scope reference:read' }, 403);
      const { errorResponse } = await resolveModeBActor(req, admin, app);
      if (errorResponse) return errorResponse;
      const categoryCode = url.searchParams.get('category');
      const [{ data: categories }, { data: items }] = await Promise.all([
        admin.from('lookup_categories').select('*').eq('is_active', true).order('sort_order').order('name_th'),
        admin.from('lookup_items').select('*').eq('is_active', true).order('sort_order').order('rank_order').order('name_th'),
      ]);
      const filteredCats = categoryCode ? (categories ?? []).filter((c: { code: string }) => c.code === categoryCode) : categories ?? [];
      const catIds = new Set(filteredCats.map((c: { id: string }) => c.id));
      return jsonResponse({
        success: true,
        categories: filteredCats,
        items: (items ?? []).filter((i: { category_id: string }) => catIds.has(i.category_id)),
      });
    }

    // 8. GET /org-units (reference:read)
    if (req.method === 'GET' && route === '/org-units') {
      if (!app.scopes.has('reference:read')) return jsonResponse({ success: false, message: 'Missing scope reference:read' }, 403);
      const { errorResponse } = await resolveModeBActor(req, admin, app);
      if (errorResponse) return errorResponse;
      const { data: levels } = await admin.from('org_unit_levels').select('*').order('level_no');
      const { data: units } = await admin.from('org_units').select('*').eq('is_active', true).order('sort_order').order('name_th');
      return jsonResponse({ success: true, levels: levels ?? [], data: units ?? [] });
    }

    // 9. GET /positions (position:read)
    if (req.method === 'GET' && route === '/positions') {
      if (!app.scopes.has('position:read')) return jsonResponse({ success: false, message: 'Missing scope position:read' }, 403);
      const { errorResponse } = await resolveModeBActor(req, admin, app);
      if (errorResponse) return errorResponse;
      const [{ data: types }, { data: positions }, { data: levels }, { data: allowed }] = await Promise.all([
        admin.from('position_types').select('*').eq('is_active', true).order('sort_order').order('name_th'),
        admin.from('positions').select('*').eq('is_active', true).order('sort_order').order('name_th'),
        admin.from('position_levels').select('*').eq('is_active', true).order('sort_order').order('rank_order').order('name_th'),
        admin.from('position_allowed_levels').select('*'),
      ]);
      return jsonResponse({ success: true, position_types: types ?? [], positions: positions ?? [], position_levels: levels ?? [], allowed_levels: allowed ?? [] });
    }

    // 13. GET /personnel/drivers (Deprecated — moved to Fleet sub-app schema in Migration 014)
    if (req.method === 'GET' && route === '/personnel/drivers') {
      return jsonResponse(
        {
          success: false,
          code: 'ENDPOINT_DEPRECATED',
          message: 'Endpoint /personnel/drivers ถูกย้ายไปยังระบบเว็บแอปย่อยรถราชการ (Fleet Sub-App) แล้ว',
        },
        410
      );
    }

    // 14. GET /personnel/approvers
    if (req.method === 'GET' && route === '/personnel/approvers') {
      if (!app.scopes.has('personnel:read')) return jsonResponse({ success: false, message: 'Missing scope personnel:read' }, 403);
      const { actor, errorResponse } = await resolveModeBActor(req, admin, app, true);
      if (errorResponse) return errorResponse;
      let q = admin.from('v_personnel_approvers').select('*');
      const officeId = url.searchParams.get('office_id');
      const deptId = url.searchParams.get('department_id');
      if (officeId) q = q.eq('office_id', officeId);
      if (deptId) q = q.eq('department_id', deptId);
      const scoped = applyActorScopeToQuery(q, actor, 'id', true);
      q = scoped.query;
      const { data } = await q;
      const mapped = (data ?? []).map((row: Record<string, unknown>) =>
        sanitizePersonnelByScopes(row, app.scopes)
      );
      return jsonResponse({ success: true, data: mapped });
    }

    // 15. GET /personnel/decoration-profiles (Deprecated — use /personnel/decoration-source + decoration_app schema)
    if (req.method === 'GET' && route === '/personnel/decoration-profiles') {
      return jsonResponse(
        {
          success: false,
          code: 'ENDPOINT_DEPRECATED',
          message:
            'Endpoint /personnel/decoration-profiles ถูกย้ายไปยังแอปย่อยเครื่องราชฯ แล้ว กรุณาใช้ GET /personnel/decoration-source สำหรับข้อมูล HR กลาง',
        },
        410
      );
    }

    // 16. GET /personnel/decoration-source (ROYAL_DEC — Section 4.2 Full HR & Timelines Contract)
    //     Registered BEFORE catch-all `/personnel/{id}`!
    if (req.method === 'GET' && route === '/personnel/decoration-source') {
      if (!app.scopes.has('personnel:career') || !app.scopes.has('personnel:sensitive')) {
        return jsonResponse({ success: false, message: 'Missing scopes personnel:career + personnel:sensitive' }, 403);
      }
      const { actor, errorResponse } = await resolveModeBActor(req, admin, app, true);
      if (errorResponse) return errorResponse;
      let q = admin.from('v_decoration_hr_source').select('*');
      const officeId = url.searchParams.get('office_id');
      const deptId = url.searchParams.get('department_id');
      const personId = url.searchParams.get('person_id');
      if (officeId) q = q.eq('office_id', officeId);
      if (deptId) q = q.eq('department_id', deptId);
      if (personId) q = q.eq('person_id', personId);
      const scoped = applyActorScopeToQuery(q, actor, 'person_id');
      if (scoped.empty) return jsonResponse({ success: true, data: [] });
      q = scoped.query;
      const { data, error } = await q;
      if (error) return jsonResponse({ success: false, message: error.message }, 500);
      return jsonResponse({ success: true, data: data ?? [] });
    }

    // 12. POST /personnel/batch
    if (req.method === 'POST' && route === '/personnel/batch') {
      if (!app.scopes.has('personnel:read')) return jsonResponse({ success: false, message: 'Missing scope personnel:read' }, 403);
      const { actor, errorResponse } = await resolveModeBActor(req, admin, app, true);
      if (errorResponse) return errorResponse;
      const body = await req.json().catch(() => ({}));
      const ids = Array.isArray(body?.ids) ? body.ids : [];
      if (ids.length === 0) return jsonResponse({ success: true, data: [] });
      let q = admin.from('v_personnel_directory').select('*').in('id', ids);
      const scoped = applyActorScopeToQuery(q, actor, 'id');
      if (scoped.empty) return jsonResponse({ success: true, data: [] });
      q = scoped.query;
      const { data } = await q;
      const mapped = (data ?? []).map((row: Record<string, unknown>) =>
        sanitizePersonnelByScopes(row, app.scopes)
      );
      return jsonResponse({ success: true, data: mapped });
    }

    // 10. GET /personnel
    if (req.method === 'GET' && route === '/personnel') {
      if (!app.scopes.has('personnel:read')) return jsonResponse({ success: false, message: 'Missing scope personnel:read' }, 403);
      const { actor, errorResponse } = await resolveModeBActor(req, admin, app, true);
      if (errorResponse) return errorResponse;
      let q = admin.from('v_personnel_directory').select('*');
      const scoped = applyActorScopeToQuery(q, actor, 'id');
      if (scoped.empty) return jsonResponse({ success: true, data: [] });
      q = scoped.query;
      const { data } = await q.limit(500);
      const mapped = (data ?? []).map((row: Record<string, unknown>) =>
        sanitizePersonnelByScopes(row, app.scopes)
      );
      return jsonResponse({ success: true, data: mapped });
    }

    // 11. GET /personnel/{id}
    if (req.method === 'GET' && route.startsWith('/personnel/')) {
      if (!app.scopes.has('personnel:read')) return jsonResponse({ success: false, message: 'Missing scope personnel:read' }, 403);
      const { actor, errorResponse } = await resolveModeBActor(req, admin, app, true);
      if (errorResponse) return errorResponse;
      const id = route.replace('/personnel/', '');
      let q = admin.from('v_personnel_directory').select('*').eq('id', id);
      const scoped = applyActorScopeToQuery(q, actor, 'id');
      if (scoped.empty) return jsonResponse({ success: false, message: 'Personnel not found' }, 404);
      q = scoped.query;
      const { data } = await q.maybeSingle();
      if (!data) return jsonResponse({ success: false, message: 'Personnel not found' }, 404);
      return jsonResponse({
        success: true,
        data: sanitizePersonnelByScopes(data as Record<string, unknown>, app.scopes),
      });
    }

    return jsonResponse({ success: false, message: `Endpoint ${req.method} ${route} not found` }, 404);
  } catch (err) {
    return jsonResponse({ success: false, message: String(err) }, 500);
  }
});

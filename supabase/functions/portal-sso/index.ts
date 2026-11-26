import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireAuthenticatedActor } from '../_shared/auth.ts';
import { generateRandomToken, sha256Hex } from '../_shared/crypto.ts';

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed' }, 405);
  }

  try {
    const admin = createAdminClient();
    const actor = await requireAuthenticatedActor(req, admin);
    if (!actor) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

    if (actor.must_change_credential) {
      return jsonResponse({ success: false, code: 'MUST_CHANGE_CREDENTIAL', message: 'กรุณาเปลี่ยนรหัสเริ่มต้นก่อนเปิดใช้งานเว็บแอปย่อย' }, 403);
    }

    if (actor.personnel_id) {
      const { data: p } = await admin
        .from('v_personnel_directory')
        .select('allows_account_provision')
        .eq('id', actor.personnel_id)
        .maybeSingle();
      if (p && p.allows_account_provision === false) {
        return jsonResponse({ success: false, code: 'STATUS_BLOCKED', message: 'สถานะบุคลากรไม่อนุญาตให้เข้าใช้งาน SSO' }, 403);
      }
    }

    const { webapp_id } = await req.json();
    const { data: app } = await admin.from('webapps').select('id, app_code, url, status').eq('id', webapp_id).single();
    if (!app || app.status === 'DISABLED') {
      return jsonResponse({ success: false, message: 'เว็บแอปย่อยไม่พร้อมใช้งาน' }, 404);
    }

    let rolePayload: { role_code: string; role_name_th: string; hierarchy_level: number } | null = null;
    if (actor.role === 'SUPERADMIN') {
      const { data: topRole } = await admin
        .from('webapp_roles')
        .select('role_code, role_name_th, hierarchy_level')
        .eq('webapp_id', app.id)
        .eq('is_active', true)
        .order('is_app_admin', { ascending: false })
        .order('hierarchy_level', { ascending: false })
        .limit(1)
        .maybeSingle();
      rolePayload = topRole || { role_code: 'APP_ADMIN', role_name_th: 'ผู้ดูแลสูงสุด', hierarchy_level: 99 };
    } else {
      const { data: perm } = await admin
        .from('user_app_permissions')
        .select('is_allowed, expires_at, webapp_roles(role_code, role_name_th, hierarchy_level, is_active)')
        .eq('user_id', actor.id)
        .eq('webapp_id', app.id)
        .maybeSingle();

      const wr = perm?.webapp_roles as { role_code: string; role_name_th: string; hierarchy_level: number; is_active: boolean } | null;
      const expired = perm?.expires_at ? new Date(perm.expires_at).getTime() <= Date.now() : false;
      if (!perm?.is_allowed || expired || !wr?.is_active) {
        return jsonResponse({ success: false, code: 'NO_APP_ACCESS', message: 'คุณไม่มีสิทธิ์เข้าใช้งานเว็บแอปย่อยนี้' }, 403);
      }
      rolePayload = { role_code: wr.role_code, role_name_th: wr.role_name_th, hierarchy_level: wr.hierarchy_level };
    }

    const rawToken = generateRandomToken(32);
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

    await admin.from('security_tokens').insert({
      token_type: 'SSO_HANDSHAKE',
      token_hash: tokenHash,
      user_id: actor.id,
      webapp_id: app.id,
      payload: { app_code: app.app_code, app_permission: rolePayload },
      expires_at: expiresAt,
    });

    const redirectUrl = new URL(app.url);
    redirectUrl.searchParams.set('sso_token', rawToken);

    return jsonResponse({
      success: true,
      redirect_url: redirectUrl.toString(),
      expires_at: expiresAt,
    });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err) }, 500);
  }
});

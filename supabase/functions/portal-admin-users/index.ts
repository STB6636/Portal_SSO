import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireAuthenticatedActor } from '../_shared/auth.ts';
import { isPersonnelInActorScope } from '../_shared/scopeGuard.ts';
import { generateRandomToken, sha256Hex } from '../_shared/crypto.ts';

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const admin = createAdminClient();
  const actor = await requireAuthenticatedActor(req, admin);
  if (!actor || !['SUPERADMIN', 'ADMIN'].includes(actor.role)) {
    return jsonResponse({ success: false, message: 'Unauthorized' }, 403);
  }

  const url = new URL(req.url);
  const action = url.pathname.split('/').filter(Boolean).pop() || '';

  try {
    if ((action === 'provision' || action === 'provision-bulk') && req.method === 'POST') {
      const body = await req.json();
      const personnelIds: string[] = Array.isArray(body.personnel_ids)
        ? body.personnel_ids
        : body.personnel_id
          ? [body.personnel_id]
          : [];

      const { data: autoApps } = await admin
        .from('webapps')
        .select('id, webapp_roles(id, is_default_on_grant)')
        .eq('auto_grant_on_provision', true)
        .eq('status', 'ACTIVE');

      let created = 0;
      const skipped: Array<{ personnel_id: string; reason: string }> = [];

      for (const pid of personnelIds.slice(0, 25)) {
        const inScope = await isPersonnelInActorScope(admin, actor, pid);
        if (!inScope) {
          skipped.push({ personnel_id: pid, reason: 'OUT_OF_ADMIN_SCOPE' });
          continue;
        }

        const { data: person } = await admin
          .from('v_personnel_directory')
          .select('id, cid, email, allows_account_provision, has_user_account')
          .eq('id', pid)
          .maybeSingle();

        if (!person || person.has_user_account) {
          skipped.push({ personnel_id: pid, reason: 'ALREADY_EXISTS_OR_NOT_FOUND' });
          continue;
        }
        if (!person.allows_account_provision) {
          skipped.push({ personnel_id: pid, reason: 'STATUS_BLOCKS_PROVISION' });
          continue;
        }

        const cid = String(person.cid).replace(/\D/g, '');
        const initialPassword = cid.slice(-6);
        const authEmail = person.email ? String(person.email).toLowerCase() : `${cid}@portal-sso.local`;

        const { data: authCreated, error: authErr } = await admin.auth.admin.createUser({
          email: authEmail,
          password: initialPassword,
          email_confirm: true,
          user_metadata: { username: cid, role: 'USER' },
        });
        if (authErr || !authCreated?.user) {
          skipped.push({ personnel_id: pid, reason: authErr?.message || 'AUTH_CREATE_FAILED' });
          continue;
        }

        const { error: userInsertErr } = await admin.from('users').insert({
          id: authCreated.user.id,
          personnel_id: pid,
          username: cid,
          email: person.email || null,
          auth_email: authEmail,
          role: 'USER',
          status: 'ACTIVE',
          must_change_credential: true,
          account_source: 'AUTO_PROVISION',
          approved_by: actor.id,
          approved_at: new Date().toISOString(),
        });

        if (userInsertErr) {
          // Rollback orphan auth.users account if public.users insert fails
          await admin.auth.admin.deleteUser(authCreated.user.id).catch(() => {});
          skipped.push({ personnel_id: pid, reason: `USER_INSERT_FAILED: ${userInsertErr.message}` });
          continue;
        }

        // Auto-grant active webapps using is_default_on_grant role
        for (const app of autoApps ?? []) {
          const roles = (app.webapp_roles as Array<{ id: string; is_default_on_grant: boolean }>) || [];
          const defaultRole = roles.find((r) => r.is_default_on_grant) || roles[0];
          if (defaultRole) {
            await admin
              .from('user_app_permissions')
              .upsert(
                {
                  user_id: authCreated.user.id,
                  webapp_id: app.id,
                  webapp_role_id: defaultRole.id,
                  is_allowed: true,
                  granted_by: actor.id,
                },
                { onConflict: 'user_id,webapp_id' }
              );
          }
        }
        created += 1;
      }

      return jsonResponse({ success: true, created, skipped });
    }

    if (action === 'toggle-status' && req.method === 'POST') {
      const { user_id, status } = await req.json();
      const { data: target } = await admin.from('users').select('id, role, personnel_id').eq('id', user_id).single();
      if (!target) return jsonResponse({ success: false, message: 'User not found' }, 404);

      if (actor.role === 'ADMIN') {
        if (target.role !== 'USER' || !target.personnel_id || !(await isPersonnelInActorScope(admin, actor, target.personnel_id))) {
          return jsonResponse({ success: false, message: 'OUT_OF_ADMIN_SCOPE' }, 403);
        }
      }

      await admin.from('users').update({ status }).eq('id', user_id);
      return jsonResponse({ success: true });
    }

    if (action === 'rotate-webapp-key' && req.method === 'POST') {
      if (actor.role !== 'SUPERADMIN') {
        return jsonResponse({ success: false, message: 'Only SUPERADMIN can rotate API keys' }, 403);
      }
      const { webapp_id } = await req.json();
      if (!webapp_id) return jsonResponse({ success: false, message: 'webapp_id is required' }, 400);

      const rawKey = `psso_${generateRandomToken(28)}`;
      const keyHash = await sha256Hex(rawKey);
      const keyPrefix = rawKey.slice(0, 12);

      const { error: updErr } = await admin
        .from('webapps')
        .update({ api_key_hash: keyHash, api_key_prefix: keyPrefix })
        .eq('id', webapp_id);
      if (updErr) return jsonResponse({ success: false, message: updErr.message }, 500);

      return jsonResponse({ success: true, api_key: rawKey, api_key_prefix: keyPrefix });
    }

    return jsonResponse({ success: false, message: 'Unknown action' }, 404);
  } catch (err) {
    return jsonResponse({ success: false, message: String(err) }, 500);
  }
});

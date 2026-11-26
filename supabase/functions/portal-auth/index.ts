import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireAuthenticatedActor } from '../_shared/auth.ts';
import { isPersonnelInActorScope } from '../_shared/scopeGuard.ts';

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const action = url.pathname.split('/').filter(Boolean).pop() || '';
  const admin = createAdminClient();

  try {
    if (action === 'resolve-login' && req.method === 'POST') {
      const { identifier } = await req.json();
      const raw = String(identifier || '').trim();
      const cleanedCid = raw.replace(/[\s-]/g, '');

      // Dynamic brute-force threshold from system_settings (fallback = 5, minimum = 3)
      const { data: limitRow } = await admin
        .from('system_settings')
        .select('value')
        .eq('key', 'max_login_attempts')
        .maybeSingle();
      const parsedLimit = Number(limitRow?.value ?? 5);
      const maxAttempts = Number.isFinite(parsedLimit) && parsedLimit >= 3 ? Math.floor(parsedLimit) : 5;

      // Brute-force check (last 15 minutes)
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const { count: failedCount } = await admin
        .from('login_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('identifier', raw.toLowerCase())
        .eq('succeeded', false)
        .gte('attempted_at', since);

      if ((failedCount ?? 0) >= maxAttempts) {
        return jsonResponse({ success: false, message: 'พยายามเข้าสู่ระบบผิดเกินกำหนด กรุณารอ 15 นาที' }, 429);
      }

      let userRow = null;
      if (/^\d{13}$/.test(cleanedCid)) {
        const { data: person } = await admin.from('personnel').select('id').eq('cid', cleanedCid).maybeSingle();
        if (person) {
          const { data } = await admin
            .from('users')
            .select('id, auth_email, status, personnel_id')
            .eq('personnel_id', person.id)
            .maybeSingle();
          userRow = data;
        }
      }
      if (!userRow) {
        const { data } = await admin
          .from('users')
          .select('id, auth_email, status, personnel_id')
          .or(`username.eq.${raw.toLowerCase()},email.eq.${raw.toLowerCase()}`)
          .maybeSingle();
        userRow = data;
      }

      if (!userRow) {
        return jsonResponse({ success: false, message: 'ไม่พบบัญชีผู้ใช้งานในระบบ' }, 404);
      }
      if (userRow.status !== 'ACTIVE') {
        return jsonResponse({ success: false, message: 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' }, 403);
      }

      // Check personnel status allows_account_provision flag (blocks SSO login when false)
      if (userRow.personnel_id) {
        const { data: pStatus } = await admin
          .from('v_personnel_directory')
          .select('allows_account_provision')
          .eq('id', userRow.personnel_id)
          .maybeSingle();
        if (pStatus && pStatus.allows_account_provision === false) {
          return jsonResponse({ success: false, message: 'สถานะบุคลากรไม่อนุญาตให้เข้าใช้งานระบบ SSO' }, 403);
        }
      }

      return jsonResponse({ success: true, auth_email: userRow.auth_email });
    }

    if (action === 'record-login-attempt' && req.method === 'POST') {
      const { identifier, succeeded } = await req.json();
      const raw = String(identifier || '').trim().toLowerCase().slice(0, 120);
      if (!raw) {
        return jsonResponse({ success: false, message: 'Missing identifier' }, 400);
      }

      await admin.from('login_attempts').insert({
        identifier: raw,
        succeeded: Boolean(succeeded),
      });

      return jsonResponse({ success: true });
    }

    if (action === 'change-credential' && req.method === 'POST') {
      const actor = await requireAuthenticatedActor(req, admin);
      if (!actor) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

      const { new_password } = await req.json();
      if (!new_password || String(new_password).length < 8) {
        return jsonResponse({ success: false, message: 'รหัสเข้าใช้ใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' }, 400);
      }

      const { error: updErr } = await admin.auth.admin.updateUserById(actor.id, { password: String(new_password) });
      if (updErr) return jsonResponse({ success: false, message: updErr.message }, 400);

      await admin
        .from('users')
        .update({ must_change_credential: false, credential_changed_at: new Date().toISOString() })
        .eq('id', actor.id);

      return jsonResponse({ success: true, message: 'เปลี่ยนรหัสเข้าใช้เรียบร้อยแล้ว' });
    }

    if (action === 'forgot-request' && req.method === 'POST') {
      const { identifier, reason } = await req.json();
      const raw = String(identifier || '').trim();
      const cleanedCid = raw.replace(/[\s-]/g, '');

      let userRow = null;
      if (/^\d{13}$/.test(cleanedCid)) {
        const { data: p } = await admin.from('personnel').select('id').eq('cid', cleanedCid).maybeSingle();
        if (p) {
          const { data } = await admin
            .from('users')
            .select('id, email, personnel_id')
            .eq('personnel_id', p.id)
            .maybeSingle();
          userRow = data;
        }
      }
      if (!userRow) {
        const { data } = await admin
          .from('users')
          .select('id, email, personnel_id')
          .or(`username.eq.${raw.toLowerCase()},email.eq.${raw.toLowerCase()}`)
          .maybeSingle();
        userRow = data;
      }

      if (!userRow) {
        return jsonResponse({ success: false, message: 'ไม่พบบัญชีผู้ใช้งานตามข้อมูลที่ระบุ' }, 404);
      }

      await admin.from('credential_reset_requests').insert({
        user_id: userRow.id,
        personnel_id: userRow.personnel_id,
        reason: String(reason || 'ผู้ใช้ส่งคำขอรีเซ็ตรหัสเข้าใช้ผ่านหน้าลืมรหัส'),
        status: 'PENDING',
      });

      return jsonResponse({
        success: true,
        channel: 'ADMIN_APPROVAL',
        message: 'ส่งคำขอรีเซ็ตรหัสเข้าใช้ถึงผู้ดูแลในขอบเขตสังกัดเรียบร้อยแล้ว',
      });
    }

    if (action === 'approve-reset' && req.method === 'POST') {
      const actor = await requireAuthenticatedActor(req, admin);
      if (!actor || !['SUPERADMIN', 'ADMIN'].includes(actor.role)) {
        return jsonResponse({ success: false, message: 'Unauthorized' }, 403);
      }

      const body = await req.json();
      const approve = Boolean(body.approve);
      const rejectReason = body.reject_reason ? String(body.reject_reason).trim() : null;
      const isBulkMode = Array.isArray(body.request_ids);
      const rawIds: string[] = isBulkMode
        ? body.request_ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : body.request_id
          ? [String(body.request_id).trim()]
          : [];
      const targetIds = Array.from(new Set(rawIds)).slice(0, 100);

      if (targetIds.length === 0) {
        return jsonResponse({ success: false, message: 'กรุณาระบุรายการคำขอที่ต้องการดำเนินการ' }, 400);
      }

      let processed = 0;
      const skipped: Array<{ id: string; reason: string }> = [];
      const nowIso = new Date().toISOString();

      for (const reqId of targetIds) {
        const { data: reqRow } = await admin
          .from('credential_reset_requests')
          .select('id, user_id, personnel_id, status')
          .eq('id', reqId)
          .maybeSingle();

        if (!reqRow || reqRow.status !== 'PENDING') {
          if (!isBulkMode) {
            return jsonResponse({ success: false, message: 'ไม่พบคำขอที่รออนุมัติ' }, 404);
          }
          skipped.push({ id: reqId, reason: 'ไม่พบคำขอหรือถูกดำเนินการไปแล้ว' });
          continue;
        }

        if (reqRow.personnel_id && !(await isPersonnelInActorScope(admin, actor, reqRow.personnel_id))) {
          if (!isBulkMode) {
            return jsonResponse({ success: false, message: 'OUT_OF_ADMIN_SCOPE' }, 403);
          }
          skipped.push({ id: reqId, reason: 'OUT_OF_ADMIN_SCOPE' });
          continue;
        }

        if (!approve) {
          await admin
            .from('credential_reset_requests')
            .update({
              status: 'REJECTED',
              handled_by: actor.id,
              handled_at: nowIso,
              reject_reason: rejectReason,
            })
            .eq('id', reqRow.id);
          processed += 1;
          continue;
        }

        const { data: p } = await admin
          .from('personnel')
          .select('cid')
          .eq('id', reqRow.personnel_id)
          .maybeSingle();
        const initialCred = String(p?.cid || '').slice(-6);
        if (initialCred.length !== 6) {
          if (!isBulkMode) {
            return jsonResponse({ success: false, message: 'ไม่พบเลข CID สำหรับตั้งรหัสเริ่มต้น 6 หลักท้าย' }, 400);
          }
          skipped.push({ id: reqId, reason: 'ไม่พบเลข CID สำหรับตั้งรหัสเริ่มต้น 6 หลักท้าย' });
          continue;
        }

        const { error: pwdErr } = await admin.auth.admin.updateUserById(reqRow.user_id, { password: initialCred });
        if (pwdErr) {
          if (!isBulkMode) {
            return jsonResponse({ success: false, message: pwdErr.message }, 400);
          }
          skipped.push({ id: reqId, reason: pwdErr.message });
          continue;
        }

        await admin.from('users').update({ must_change_credential: true }).eq('id', reqRow.user_id);
        await admin
          .from('credential_reset_requests')
          .update({ status: 'APPROVED', handled_by: actor.id, handled_at: nowIso })
          .eq('id', reqRow.id);
        processed += 1;
      }

      if (processed === 0) {
        return jsonResponse(
          {
            success: false,
            processed,
            skipped,
            message: skipped[0]?.reason || 'ไม่สามารถดำเนินการรายการที่เลือกได้',
          },
          400
        );
      }

      const verb = approve ? 'อนุมัติรีเซ็ตรหัสเป็นเลข 6 หลักท้าย CID' : 'ปฏิเสธคำขอ';
      return jsonResponse({
        success: true,
        processed,
        skipped,
        message: isBulkMode
          ? `${verb}สำเร็จ ${processed} รายการ${skipped.length > 0 ? ` (ข้าม ${skipped.length} รายการ)` : ''}`
          : `${verb}เรียบร้อยแล้ว`,
      });
    }

    return jsonResponse({ success: false, message: 'Unknown portal-auth action' }, 404);
  } catch (err) {
    return jsonResponse({ success: false, message: String(err) }, 500);
  }
});

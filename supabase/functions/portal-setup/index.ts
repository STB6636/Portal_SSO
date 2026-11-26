import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed' }, 405);
  }

  try {
    const admin = createAdminClient();
    const { count } = await admin.from('users').select('id', { count: 'exact', head: true });
    if ((count ?? 0) > 0) {
      return jsonResponse({ success: false, message: 'ระบบถูกติดตั้งผู้ดูแลสูงสุดไปแล้ว ไม่สามารถรัน Setup ซ้ำได้' }, 409);
    }

    const body = await req.json();
    const cid = String(body.cid || '').replace(/[\s-]/g, '');
    const username = String(body.username || cid).trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const firstName = String(body.first_name || '').trim();
    const lastName = String(body.last_name || '').trim();
    const bureauName = String(body.bureau_name || '').trim();

    if (!/^\d{13}$/.test(cid) || !firstName || !lastName || password.length < 8) {
      return jsonResponse({ success: false, message: 'ข้อมูลไม่ครบถ้วน หรือรหัสผ่านสั้นกว่า 8 ตัวอักษร' }, 400);
    }

    const authEmail = email || `${cid}@portal-sso.local`;
    const { data: createdAuth, error: authErr } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { username, role: 'SUPERADMIN' },
    });
    if (authErr || !createdAuth?.user) {
      return jsonResponse({ success: false, message: authErr?.message || 'สร้างบัญชี Auth ไม่สำเร็จ' }, 400);
    }

    const { data: activeStatus } = await admin
      .from('lookup_items')
      .select('id')
      .eq('code', 'ACTIVE')
      .eq('allows_account_provision', true)
      .limit(1)
      .maybeSingle();

    const { data: person, error: pErr } = await admin
      .from('personnel')
      .insert({
        cid,
        first_name: firstName,
        last_name: lastName,
        email: email || null,
        status_id: activeStatus?.id ?? null,
        created_by: createdAuth.user.id,
        updated_by: createdAuth.user.id,
      })
      .select('id')
      .single();

    if (pErr || !person) {
      await admin.auth.admin.deleteUser(createdAuth.user.id);
      return jsonResponse({ success: false, message: pErr?.message || 'สร้างข้อมูลบุคลากรไม่สำเร็จ' }, 400);
    }

    await admin.from('personnel_assignments').insert({ personnel_id: person.id, updated_by: createdAuth.user.id });

    const { error: uErr } = await admin.from('users').insert({
      id: createdAuth.user.id,
      personnel_id: person.id,
      username,
      email: email || null,
      auth_email: authEmail,
      role: 'SUPERADMIN',
      status: 'ACTIVE',
      must_change_credential: false,
      account_source: 'SETUP_WIZARD',
      approved_by: createdAuth.user.id,
      approved_at: new Date().toISOString(),
    });

    if (uErr) {
      await admin.from('personnel').delete().eq('id', person.id);
      await admin.auth.admin.deleteUser(createdAuth.user.id);
      return jsonResponse({ success: false, message: uErr.message }, 400);
    }

    if (bureauName) {
      await admin.from('system_settings').update({ value: bureauName }).eq('key', 'bureau_name');
    }

    return jsonResponse({ success: true, user_id: createdAuth.user.id, message: 'ติดตั้งผู้ดูแลระบบสูงสุดสำเร็จ' });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err) }, 500);
  }
});

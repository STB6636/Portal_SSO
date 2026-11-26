/**
 * Translates PostgreSQL / PostgREST / Supabase RPC errors into clear, actionable Thai messages.
 */
export function formatDatabaseError(err: unknown, fallback = 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'): string {
  const raw =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message || '')
        : '';

  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';

  const msg = raw.trim();
  const lower = msg.toLowerCase();

  if (!msg && !code) return fallback;

  if (msg.includes('OUT_OF_ADMIN_SCOPE')) {
    return 'ไม่สามารถดำเนินการได้ เนื่องจากสังกัดที่เลือกอยู่นอกขอบเขตสิทธิ์ผู้ดูแลของคุณ';
  }
  if (msg.includes('MULTIPLE_ACTIVE_POSITION_HISTORY') || lower.includes('ux_pos_history_one_active_per_person')) {
    return 'ประวัติการดำรงตำแหน่งสามารถเว้นว่างวันสิ้นสุด (ตำแหน่งปัจจุบัน) ได้เพียง 1 รายการเท่านั้น กรุณาระบุวันสิ้นสุดของตำแหน่งเดิมก่อน';
  }
  if (msg.includes('EXECUTIVE_DUTY_NOT_EXECUTIVE_TYPE')) {
    return 'ตำแหน่งปฏิบัติราชการแทน / รักษาการในตำแหน่ง ต้องเลือกจากตำแหน่งประเภทบริหารเท่านั้น';
  }
  if (msg.includes('REQUIRED_NAME')) {
    return 'กรุณาระบุชื่อจริงและนามสกุลให้ครบถ้วน';
  }
  if (msg.includes('Invalid Thai CID') || msg.includes('CID_MOD11_FAILED')) {
    return 'เลขประจำตัวประชาชน 13 หลักไม่ถูกต้อง (ไม่ผ่านสูตรตรวจสอบหลักที่ 13 Mod 11)';
  }
  if (msg.includes('Only SUPERADMIN')) {
    return 'รายการนี้สงวนสิทธิ์เฉพาะผู้ดูแลระบบสูงสุด (SUPERADMIN) เท่านั้น';
  }
  if (msg.includes('row-level security') || code === '42501') {
    return 'คุณไม่มีสิทธิ์ในการเพิ่ม/แก้ไข/ลบข้อมูลส่วนนี้ (RLS Policy Blocked)';
  }
  if (code === '23505' || lower.includes('duplicate key') || lower.includes('unique constraint')) {
    if (lower.includes('cid')) return 'เลขประจำตัวประชาชนนี้มีอยู่ในระบบแล้ว ไม่สามารถบันทึกซ้ำได้';
    if (lower.includes('ux_pos_history_one_latest')) return 'ประวัติการดำรงตำแหน่งสามารถกำหนด "ตำแหน่งล่าสุด" ได้เพียง 1 รายการเท่านั้น';
    if (lower.includes('ux_pos_history_one_initial')) return 'ประวัติการดำรงตำแหน่งสามารถกำหนด "ตำแหน่งแรกบรรจุ" ได้เพียง 1 รายการเท่านั้น';
    if (lower.includes('app_code')) return 'รหัสเว็บแอป (App Code) นี้ถูกใช้งานแล้ว';
    if (lower.includes('role_code')) return 'รหัสระดับสิทธิ์ (Role Code) ซ้ำกันภายในเว็บแอปนี้';
    if (lower.includes('org_units')) return 'มีชื่อหน่วยงานนี้อยู่ภายใต้หน่วยงานแม่เดียวกันแล้ว';
    return 'พบข้อมูลซ้ำกับที่มีอยู่แล้วในฐานข้อมูล (Duplicate Key)';
  }
  if (code === '23503' || lower.includes('foreign key constraint')) {
    if (lower.includes('delete') || lower.includes('still referenced')) {
      return 'ไม่สามารถลบรายการนี้ได้ เนื่องจากยังมีข้อมูลบุคลากรหรือรายการลูกอ้างอิงใช้งานอยู่ (แนะนำให้ปิดการใช้งานแทน)';
    }
    if (lower.includes('scope_code')) {
      return 'พบ API Scope ที่ไม่มีอยู่ในแค็ตตาล็อกระบบ กรุณาตรวจสอบรายการสิทธิ์ที่เลือก';
    }
    return 'ข้อมูลอ้างอิงไม่ถูกต้องหรือไม่พบข้อมูลแม่ที่เลือก (Foreign Key Violation)';
  }
  if (code === '23514' || lower.includes('check constraint')) {
    if (lower.includes('year_be') || lower.includes('received_year')) {
      return 'ปี พ.ศ. ต้องอยู่ระหว่าง 2450 ถึง 2700';
    }
    if (lower.includes('salary')) {
      return 'จำนวนเงินเดือนต้องมีค่าไม่ติดลบ';
    }
    return 'ข้อมูลไม่ผ่านเงื่อนไขความถูกต้องของฐานข้อมูล (Check Constraint)';
  }
  if (code === '22P02' || lower.includes('invalid input syntax for type uuid')) {
    return 'ข้อมูลรหัสอ้างอิง (UUID) ไม่ถูกต้อง กรุณาเลือกรายการจากตัวเลือกในระบบให้ครบถ้วน';
  }
  if (lower.includes('parent') && lower.includes('level')) {
    return 'หน่วยงานแม่ต้องอยู่สูงกว่าหน่วยงานลูกเพียง 1 ระดับเท่านั้น (เช่น Lv2 ต้องสังกัด Lv1)';
  }

  return msg || fallback;
}

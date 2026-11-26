-- =============================================================================
-- Migration 010: Idempotent Initial Master Data Seed (Zero-Hardcode Architecture)
-- All business dropdowns are seeded here and fully CRUD-managed in /settings/*
-- =============================================================================

-- 1. Lookup Categories
INSERT INTO public.lookup_categories (code, name_th, description, is_system_locked, has_provision_flag, has_approver_flag, has_dispatch_flag, sort_order)
VALUES
  ('PREFIX', 'คำนำหน้าชื่อ', 'คำนำหน้าชื่อบุคลากร (รองรับทั้งชื่อเต็มและคำย่อ)', true, false, false, false, 1),
  ('GENDER', 'เพศ', 'เพศของบุคลากร', true, false, false, false, 2),
  ('EMPLOYMENT_TYPE', 'ประเภทบุคลากร', 'ข้าราชการ / ลูกจ้างประจำ / ลูกจ้างชั่วคราว / พนักงานราชการ', true, false, false, false, 3),
  ('PERSONNEL_STATUS', 'สถานะบุคลากร', 'ควบคุมสิทธิ์สร้างบัญชีและเข้าใช้งาน SSO ผ่าน allows_account_provision', true, true, false, false, 4),
  ('APPROVAL_TIER', 'ระดับผู้มีอำนาจลงนาม', 'ควบคุมรายชื่อผู้อนุมัติใน API ผ่าน is_approver และ rank_order', true, false, true, false, 5),
  ('DRIVER_STATUS', 'สถานะความพร้อม พขร.', 'ควบคุมความพร้อมจัดรถในระบบใบขออนุญาตใช้รถผ่าน is_dispatchable', true, false, false, true, 6),
  ('DECORATION_FAMILY', 'ตระกูลเครื่องราชอิสริยาภรณ์', 'หมวดหมู่หลักของชั้นตราเครื่องราชอิสริยาภรณ์', true, false, false, false, 7)
ON CONFLICT (code) DO NOTHING;

-- 2. Lookup Items
DO $$
DECLARE
  v_cat uuid;
BEGIN
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'PREFIX';
  INSERT INTO public.lookup_items (category_id, code, name_th, short_name, sort_order, is_default) VALUES
    (v_cat, 'MR', 'นาย', 'นาย', 1, true),
    (v_cat, 'MRS', 'นาง', 'นาง', 2, false),
    (v_cat, 'MS', 'นางสาว', 'น.ส.', 3, false)
  ON CONFLICT (category_id, code) DO NOTHING;

  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'GENDER';
  INSERT INTO public.lookup_items (category_id, code, name_th, short_name, sort_order) VALUES
    (v_cat, 'MALE', 'ชาย', 'ช', 1),
    (v_cat, 'FEMALE', 'หญิง', 'ญ', 2)
  ON CONFLICT (category_id, code) DO NOTHING;

  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'EMPLOYMENT_TYPE';
  INSERT INTO public.lookup_items (category_id, code, name_th, sort_order, is_default) VALUES
    (v_cat, 'CIVIL_SERVANT', 'ข้าราชการกรุงเทพมหานครสามัญ', 1, true),
    (v_cat, 'PERM_EMP', 'ลูกจ้างประจำ', 2, false),
    (v_cat, 'TEMP_EMP', 'ลูกจ้างชั่วคราว', 3, false)
  ON CONFLICT (category_id, code) DO NOTHING;

  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'PERSONNEL_STATUS';
  INSERT INTO public.lookup_items (category_id, code, name_th, color_hex, allows_account_provision, sort_order, is_default) VALUES
    (v_cat, 'ACTIVE', 'ปฏิบัติราชการ', '#00744B', true, 1, true),
    (v_cat, 'SECONDED', 'ช่วยราชการ', '#0288D1', true, 2, false),
    (v_cat, 'TRANSFERRED', 'โอน/ย้าย', '#FFB300', false, 3, false),
    (v_cat, 'RETIRED', 'เกษียณอายุราชการ', '#64748B', false, 4, false),
    (v_cat, 'RESIGNED', 'ลาออก/พ้นสภาพ', '#E53935', false, 5, false)
  ON CONFLICT (category_id, code) DO NOTHING;

  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'APPROVAL_TIER';
  INSERT INTO public.lookup_items (category_id, code, name_th, rank_order, is_approver, sort_order) VALUES
    (v_cat, 'NONE', 'ไม่มีอำนาจลงนาม', 0, false, 1),
    (v_cat, 'DEPT_HEAD', 'หัวหน้าฝ่าย/หัวหน้าส่วน', 10, true, 2),
    (v_cat, 'OFFICE_DIRECTOR', 'ผู้อำนวยการสำนักงาน/ผู้อำนวยการกอง', 20, true, 3),
    (v_cat, 'DEPUTY_DIRECTOR', 'รองผู้อำนวยการสำนัก', 30, true, 4),
    (v_cat, 'BUREAU_DIRECTOR', 'ผู้อำนวยการสำนัก', 40, true, 5)
  ON CONFLICT (category_id, code) DO NOTHING;

  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'DRIVER_STATUS';
  INSERT INTO public.lookup_items (category_id, code, name_th, color_hex, is_dispatchable, sort_order, is_default) VALUES
    (v_cat, 'READY', 'พร้อมปฏิบัติงาน', '#00744B', true, 1, true),
    (v_cat, 'ON_LEAVE', 'ลา/พักปฏิบัติงาน', '#FFB300', false, 2, false),
    (v_cat, 'SUSPENDED', 'งดจ่ายงานชั่วคราว', '#E53935', false, 3, false)
  ON CONFLICT (category_id, code) DO NOTHING;

  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'DECORATION_FAMILY';
  INSERT INTO public.lookup_items (category_id, code, name_th, sort_order) VALUES
    (v_cat, 'WHITE_ELEPHANT', 'เครื่องราชอิสริยาภรณ์อันเป็นที่เชิดชูยิ่งช้างเผือก', 1),
    (v_cat, 'CROWN_THAILAND', 'เครื่องราชอิสริยาภรณ์อันมีเกียรติยศยิ่งมงกุฎไทย', 2),
    (v_cat, 'CHAKRAPAT', 'เหรียญจักรพรรดิมาลา', 3)
  ON CONFLICT (category_id, code) DO NOTHING;
END $$;

-- 3. Org Unit Levels (1-4)
INSERT INTO public.org_unit_levels (level_no, code, name_th, is_required) VALUES
  (1, 'BUREAU', 'สำนัก', true),
  (2, 'OFFICE', 'สำนักงาน/กอง', false),
  (3, 'DEPARTMENT', 'ส่วน/ฝ่าย', false),
  (4, 'DIVISION', 'กลุ่มงาน', false)
ON CONFLICT (level_no) DO NOTHING;

-- 4. Position Types & Levels
INSERT INTO public.position_types (code, name_th, color_hex, sort_order) VALUES
  ('GENERAL', 'ประเภททั่วไป', '#00838F', 1),
  ('ACADEMIC', 'ประเภทวิชาการ', '#00744B', 2),
  ('MANAGERIAL', 'ประเภทอำนวยการ', '#4A148C', 3),
  ('EXECUTIVE', 'ประเภทบริหาร', '#C62828', 4),
  ('EMPLOYEE', 'ลูกจ้าง', '#FB8C00', 5)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.position_levels (code, name_th, rank_order, sort_order) VALUES
  ('O1', 'ปฏิบัติงาน', 10, 1),
  ('O2', 'ชำนาญงาน', 20, 2),
  ('O3', 'อาวุโส', 30, 3),
  ('K1', 'ปฏิบัติการ', 40, 4),
  ('K2', 'ชำนาญการ', 50, 5),
  ('K3', 'ชำนาญการพิเศษ', 60, 6),
  ('K4', 'เชี่ยวชาญ', 70, 7),
  ('M1', 'อำนวยการต้น', 80, 8),
  ('M2', 'อำนวยการสูง', 90, 9),
  ('E1', 'บริหารต้น', 100, 10),
  ('E2', 'บริหารสูง', 110, 11)
ON CONFLICT (code) DO NOTHING;

-- 5. API Scope Catalog & Presets
INSERT INTO public.api_scope_catalog (code, name_th, description, is_sensitive, sort_order) VALUES
  ('permission:read', 'อ่านสิทธิ์ผู้ใช้ของแอป', 'ดึงรายชื่อผู้ใช้และระดับสิทธิ์ที่ได้รับอนุญาตในแอปย่อย', false, 1),
  ('reference:read', 'อ่านข้อมูลอ้างอิงกลาง', 'ดึงตัวเลือก Dropdown และโครงสร้างหน่วยงาน 4 ระดับ', false, 2),
  ('position:read', 'อ่านโครงสร้างตำแหน่ง', 'ดึงประเภทตำแหน่ง ตำแหน่ง และระดับที่อนุญาต', false, 3),
  ('personnel:read', 'อ่านข้อมูลบุคลากรพื้นฐาน', 'ดึงข้อมูลบุคลากร สังกัด พขร. และผู้อนุมัติ', false, 4),
  ('personnel:signature', 'เข้าถึงลิงก์ลายเซ็นพื้นใส', 'แนบ signature_url สำหรับพิมพ์เอกสารราชการ', true, 5),
  ('personnel:career', 'อ่านประวัติรับราชการและเครื่องราชฯ', 'ดึงวันบรรจุ ตำแหน่งแรกบรรจุ และประวัติเครื่องราชฯ', true, 6),
  ('personnel:sensitive', 'อ่านข้อมูลอ่อนไหว (เงินเดือน/วินัย)', 'ดึงข้อมูลเงินเดือน 3 ช่วงและประวัติวินัยสำหรับระบบเครื่องราชฯ', true, 7)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.webapp_scope_presets (code, name_th, description, sort_order) VALUES
  ('ROYAL_DEC', 'เทมเพลตระบบเครื่องราชอิสริยาภรณ์', 'สิทธิ์ครบสำหรับระบบเครื่องราชฯ (รวมประวัติรับราชการและเงินเดือน)', 1),
  ('VEHICLE_TAX', 'เทมเพลตระบบต่อภาษีรถราชการ', 'สิทธิ์อ่านบุคลากร สังกัด ลายเซ็น และผู้รับผิดชอบในแอป', 2),
  ('CAR_REQUEST', 'เทมเพลตระบบใบขออนุญาตใช้รถ แบบ 1-6', 'สิทธิ์อ่านบุคลากร พขร. ผู้อนุมัติ และลายเซ็น', 3)
ON CONFLICT (code) DO NOTHING;

-- 6. Initial System Settings (Includes GAS Google Drive 3 Separate Folders — Empty by Default)
INSERT INTO public.system_settings (key, value, value_type, group_name, label_th, description, is_public) VALUES
  ('organization_name', 'กรุงเทพมหานคร', 'string', 'branding', 'ชื่อองค์กรหลัก', 'แสดงบนแถบ Sidebar และ Footer', true),
  ('bureau_name', 'สำนักเทศกิจ', 'string', 'branding', 'ชื่อหน่วยงาน', 'แสดงบนหัวระบบและหน้าล็อกอิน', true),
  ('system_title', 'Portal SSO — ศูนย์กลางข้อมูลบุคลากรและยืนยันตัวตน', 'string', 'branding', 'ชื่อระบบ', 'ชื่อเต็มของระบบ Portal SSO', true),
  ('logo_url', '', 'url', 'branding', 'ลิงก์โลโก้หน่วยงาน', 'URL รูปโลโก้ (อัปโหลดผ่าน GAS Google Drive โฟลเดอร์รูปภาพ)', true),
  ('footer_description', 'ระบบยืนยันตัวตนกลางและทะเบียนประวัติบุคลากรอิเล็กทรอนิกส์ (STB-APP)', 'string', 'branding', 'คำอธิบายท้ายหน้า', 'ข้อความใต้ชื่อหน่วยงานใน Footer', true),
  ('allow_self_register', 'false', 'boolean', 'security', 'เปิดให้ลงทะเบียนด้วยตนเอง', 'อนุญาตการสมัครผ่านหน้า /register', true),
  ('max_login_attempts', '5', 'number', 'security', 'จำนวนครั้งล็อกอินผิดสูงสุด', 'ล็อกชั่วคราวเมื่อกรอกรหัสผิดเกินกำหนด', false),
  ('login_lock_minutes', '15', 'number', 'security', 'ระยะเวลาล็อกบัญชีชั่วคราว (นาที)', 'ป้องกัน Brute Force', false),
  ('Import_Max_Rows', '2000', 'number', 'import', 'จำนวนแถวสูงสุดต่อการนำเข้า', 'จำกัดจำนวนแถวในตาราง Google Sheets Import', true),
  ('Import_Chunk_Size', '200', 'number', 'import', 'จำนวนแถวต่อชุดการบันทึก', 'จำนวนแถวที่ส่งเข้า fn_import_personnel_batch ต่อรอบ', true),
  ('google_drive_script_url', '', 'url', 'google_drive', 'Google Apps Script Web App URL (.../exec)', 'ลิงก์ Web App สำหรับอัปโหลดไฟล์ลง Google Drive (ต้อง Deploy เป็น Anyone)', true),
  ('google_drive_image_folder_id', '', 'string', 'google_drive', 'โฟลเดอร์ Google Drive — ไฟล์รูปภาพ', 'Folder ID หรือลิงก์โฟลเดอร์สำหรับรูปโปรไฟล์ โลโก้ รูปประกาศ และไอคอนแอป', true),
  ('google_drive_signature_folder_id', '', 'string', 'google_drive', 'โฟลเดอร์ Google Drive — ไฟล์ลายเซ็น', 'Folder ID หรือลิงก์โฟลเดอร์สำหรับเก็บลายเซ็นพื้นใส PNG', true),
  ('google_drive_document_folder_id', '', 'string', 'google_drive', 'โฟลเดอร์ Google Drive — ไฟล์เอกสาร', 'Folder ID หรือลิงก์โฟลเดอร์สำหรับเก็บเอกสารแนบ PDF/Office', true),
  ('announcement_enabled', 'false', 'boolean', 'announcement', 'เปิดแสดงประกาศระบบ', 'แสดงหน้าต่างประกาศอัตโนมัติเมื่อเข้าใช้งาน', true),
  ('announcement_mode', 'text', 'string', 'announcement', 'รูปแบบประกาศ', 'text หรือ image', true),
  ('announcement_title', '', 'string', 'announcement', 'หัวข้อประกาศ', 'หัวข้อบน Popup ประกาศ', true),
  ('announcement_body', '', 'text', 'announcement', 'เนื้อหาประกาศ', 'ข้อความประกาศระบบ', true),
  ('announcement_image_url', '', 'url', 'announcement', 'ลิงก์รูปภาพประกาศ', 'URL รูปภาพประกาศบน Google Drive', true),
  ('announcement_start_date', '', 'date', 'announcement', 'วันที่เริ่มแสดงประกาศ', 'YYYY-MM-DD', true),
  ('announcement_end_date', '', 'date', 'announcement', 'วันที่สิ้นสุดแสดงประกาศ', 'YYYY-MM-DD', true),
  ('announcement_updated_at', '', 'string', 'announcement', 'เวลาอัปเดตประกาศล่าสุด', 'ใช้ตรวจการรับทราบประกาศใหม่', true)
ON CONFLICT (key) DO NOTHING;

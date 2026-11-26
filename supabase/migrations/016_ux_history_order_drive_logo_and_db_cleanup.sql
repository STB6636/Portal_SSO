-- =============================================================================
-- Migration 016: Personnel UX & History Ordering (7 Timelines sort_order),
--                Initial Position FK + Exclusive [is_latest, is_initial] Tags,
--                Name History old_prefix_id, Google Drive Logo Folder,
--                Suppress "ไม่มี" Display Helper, API Scope Catalog Refresh,
--                and Dead Column / Table Cleanup (35 -> 33 Active Tables)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Drop All 5 Dependent Views (Child -> Parent Order)
--         (v_webapps_with_roles is independent and remains intact -> 6 Views total)
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_decoration_hr_source;
DROP VIEW IF EXISTS public.v_personnel_approvers;
DROP VIEW IF EXISTS public.v_user_app_access_matrix;
DROP VIEW IF EXISTS public.v_users_scoped;
DROP VIEW IF EXISTS public.v_personnel_directory;

-- -----------------------------------------------------------------------------
-- Step 2: Schema Evolutions (Add New Columns & Backfill Deterministically)
-- -----------------------------------------------------------------------------

-- 2.1 Add sort_order to all 7 history / timeline tables
ALTER TABLE public.personnel_name_history
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS old_prefix_id uuid REFERENCES public.lookup_items(id) ON DELETE RESTRICT;

ALTER TABLE public.personnel_position_history
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_latest boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_initial boolean NOT NULL DEFAULT false;

ALTER TABLE public.personnel_executive_duties
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.personnel_salary_history
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.personnel_evaluations
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.personnel_disciplinary_records
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.personnel_service_interruptions
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- 2.2 Add 3-tier cascading initial position FKs to personnel_career_records
ALTER TABLE public.personnel_career_records
  ADD COLUMN IF NOT EXISTS initial_position_type_id uuid REFERENCES public.position_types(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS initial_position_id uuid REFERENCES public.positions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS initial_position_level_id uuid REFERENCES public.position_levels(id) ON DELETE RESTRICT;

-- 2.3 Backfill sort_order (1 = top/newest, N = bottom/oldest) for all 7 tables
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY personnel_id ORDER BY changed_date DESC, created_at DESC) AS rn
  FROM public.personnel_name_history
)
UPDATE public.personnel_name_history t SET sort_order = r.rn FROM ranked r WHERE t.id = r.id AND t.sort_order = 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY personnel_id ORDER BY (end_date IS NOT NULL) ASC, effective_date DESC, end_date DESC NULLS FIRST, created_at DESC) AS rn
  FROM public.personnel_position_history
)
UPDATE public.personnel_position_history t SET sort_order = r.rn FROM ranked r WHERE t.id = r.id AND t.sort_order = 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY personnel_id ORDER BY (end_date IS NOT NULL) ASC, effective_date DESC NULLS LAST, created_at DESC) AS rn
  FROM public.personnel_executive_duties
)
UPDATE public.personnel_executive_duties t SET sort_order = r.rn FROM ranked r WHERE t.id = r.id AND t.sort_order = 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY personnel_id ORDER BY effective_date DESC, created_at DESC) AS rn
  FROM public.personnel_salary_history
)
UPDATE public.personnel_salary_history t SET sort_order = r.rn FROM ranked r WHERE t.id = r.id AND t.sort_order = 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY personnel_id ORDER BY fiscal_year_be DESC, eval_round DESC, created_at DESC) AS rn
  FROM public.personnel_evaluations
)
UPDATE public.personnel_evaluations t SET sort_order = r.rn FROM ranked r WHERE t.id = r.id AND t.sort_order = 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY personnel_id ORDER BY effective_date DESC, created_at DESC) AS rn
  FROM public.personnel_disciplinary_records
)
UPDATE public.personnel_disciplinary_records t SET sort_order = r.rn FROM ranked r WHERE t.id = r.id AND t.sort_order = 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY personnel_id ORDER BY start_date DESC, created_at DESC) AS rn
  FROM public.personnel_service_interruptions
)
UPDATE public.personnel_service_interruptions t SET sort_order = r.rn FROM ranked r WHERE t.id = r.id AND t.sort_order = 0;

-- 2.4 Backfill is_latest (top row) & is_initial (bottom row) on personnel_position_history
WITH bounds AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY personnel_id ORDER BY sort_order ASC, effective_date DESC, created_at DESC) AS rn_asc,
    COUNT(*) OVER (PARTITION BY personnel_id) AS cnt
  FROM public.personnel_position_history
)
UPDATE public.personnel_position_history t
SET
  is_latest = (b.rn_asc = 1),
  is_initial = (b.rn_asc = b.cnt)
FROM bounds b
WHERE t.id = b.id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_history_one_latest
  ON public.personnel_position_history (personnel_id)
  WHERE is_latest = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_history_one_initial
  ON public.personnel_position_history (personnel_id)
  WHERE is_initial = true;

-- 2.5 Backfill old_prefix_id from lookup_items(PREFIX) when text matches
UPDATE public.personnel_name_history nh
SET old_prefix_id = li.id
FROM public.lookup_items li
JOIN public.lookup_categories lc ON lc.id = li.category_id AND lc.code = 'PREFIX'
WHERE nh.old_prefix_id IS NULL
  AND nh.old_prefix IS NOT NULL
  AND trim(nh.old_prefix) <> ''
  AND lower(trim(nh.old_prefix)) = lower(trim(li.name_th));

-- -----------------------------------------------------------------------------
-- Step 3: Cleanup Approved Unused Columns & Tables (Checkpoints C1-A & C2-A)
--         Note: Import_Max_Rows & Import_Chunk_Size are KEPT per Checkpoint C3-B
-- -----------------------------------------------------------------------------
ALTER TABLE public.personnel
  DROP COLUMN IF EXISTS status_effective_date,
  DROP COLUMN IF EXISTS line_user_id,
  DROP COLUMN IF EXISTS personnel_code;

ALTER TABLE public.lookup_categories
  DROP COLUMN IF EXISTS has_dispatch_flag;

ALTER TABLE public.lookup_items
  DROP COLUMN IF EXISTS is_dispatchable;

DROP TABLE IF EXISTS public.webapp_scope_preset_items CASCADE;
DROP TABLE IF EXISTS public.webapp_scope_presets CASCADE;

-- -----------------------------------------------------------------------------
-- Step 4: Master Settings (Add Logo Folder) & Refresh API Scope Catalog (7 Scopes)
-- -----------------------------------------------------------------------------
INSERT INTO public.system_settings (key, value, value_type, group_name, label_th, description, is_public)
VALUES (
  'google_drive_logo_folder_id',
  '',
  'string',
  'google_drive',
  'โฟลเดอร์รูปโลโก้ระบบ',
  'รหัสหรือลิงก์โฟลเดอร์ Google Drive สำหรับจัดเก็บรูปโลโก้ระบบ',
  true
)
ON CONFLICT (key) DO UPDATE SET
  label_th = EXCLUDED.label_th,
  description = EXCLUDED.description,
  is_public = true;

UPDATE public.system_settings
SET description = 'ลิงก์รูปโลโก้หน่วยงาน (อัปโหลดผ่านโฟลเดอร์รูปโลโก้ระบบบน Google Drive)'
WHERE key = 'logo_url';

UPDATE public.api_scope_catalog SET
  name_th = 'อ่านสิทธิ์ผู้ใช้ของแอป',
  description = 'ดึงรายชื่อผู้ใช้งานและระดับสิทธิ์ที่ได้รับอนุญาตเข้าใช้งานในเว็บแอปย่อย (/authorized-users)'
WHERE code = 'permission:read';

UPDATE public.api_scope_catalog SET
  name_th = 'อ่านข้อมูลอ้างอิงกลาง',
  description = 'ดึงตัวเลือกมาตรฐานและโครงสร้างหน่วยงาน 4 ระดับตามลำดับตั้งค่าระบบ (/lookups, /org-units)'
WHERE code = 'reference:read';

UPDATE public.api_scope_catalog SET
  name_th = 'อ่านโครงสร้างตำแหน่ง',
  description = 'ดึงประเภทตำแหน่ง ตำแหน่งในสายงาน ระดับตำแหน่ง และระดับที่อนุญาต (/positions)'
WHERE code = 'position:read';

UPDATE public.api_scope_catalog SET
  name_th = 'อ่านข้อมูลบุคลากรพื้นฐาน',
  description = 'ดึงทะเบียนบุคลากร ตำแหน่งที่จัดรูปแบบแล้ว สังกัด และรายชื่อผู้มีอำนาจลงนาม (/personnel, /personnel/batch, /personnel/approvers)'
WHERE code = 'personnel:read';

UPDATE public.api_scope_catalog SET
  name_th = 'เข้าถึงลิงก์ลายเซ็นอิเล็กทรอนิกส์',
  description = 'แนบ signature_url (ลิงก์รูปลายเซ็นบน Google Drive) สำหรับพิมพ์เอกสารราชการ'
WHERE code = 'personnel:signature';

UPDATE public.api_scope_catalog SET
  name_th = 'อ่านประวัติรับราชการ',
  description = 'ดึงวันบรรจุ ตำแหน่งแรกบรรจุ ประวัติการดำรงตำแหน่ง ผลการประเมิน และเหตุการณ์กระทบอายุราชการ (/personnel/decoration-source)'
WHERE code = 'personnel:career';

UPDATE public.api_scope_catalog SET
  name_th = 'อ่านข้อมูลอ่อนไหว (เงินเดือนและวินัย)',
  description = 'ดึงข้อมูลเงินเดือนปัจจุบัน เงินประจำตำแหน่ง ประวัติเงินเดือน และประวัติทางวินัย (/personnel/decoration-source)'
WHERE code = 'personnel:sensitive';

-- -----------------------------------------------------------------------------
-- Step 5: Pure Display Helper SQL Functions (Suppress "ไม่มี" everywhere except Import)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_clean_display_segment(p_val text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_val IS NULL THEN NULL
    WHEN trim(p_val) IN ('', '-', 'ไม่มี', 'ไม่มีระดับ', 'ไม่ระบุ') THEN NULL
    ELSE trim(p_val)
  END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_clean_display_segment(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_format_position_display(
  p_position_name text,
  p_level_name text DEFAULT NULL,
  p_type_code text DEFAULT NULL,
  p_type_name text DEFAULT NULL,
  p_bureau_name text DEFAULT NULL,
  p_office_name text DEFAULT NULL,
  p_department_name text DEFAULT NULL,
  p_division_name text DEFAULT NULL,
  p_fallback_bureau_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_pos text := COALESCE(public.fn_clean_display_segment(p_position_name), '');
  v_lvl text := COALESCE(public.fn_clean_display_segment(regexp_replace(COALESCE(p_level_name, ''), '^ระดับ\s*', '', 'i')), '');
  v_tcode text := upper(trim(COALESCE(p_type_code, '')));
  v_tname text := trim(COALESCE(p_type_name, ''));
  v_bureau text := public.fn_clean_display_segment(p_bureau_name);
  v_fallback_bureau text := public.fn_clean_display_segment(p_fallback_bureau_name);
  v_office text := public.fn_clean_display_segment(p_office_name);
  v_dept text := public.fn_clean_display_segment(p_department_name);
  v_div text := public.fn_clean_display_segment(p_division_name);
  v_target_org text := NULL;
  v_prefix text := NULL;
  v_is_exec_tier boolean := false;
  v_suffix text;
  v_cand text;
BEGIN
  IF v_pos = '' THEN
    RETURN '-';
  END IF;

  -- Longest-Prefix-First tier detection (check สำนักงาน BEFORE สำนัก)
  IF v_pos LIKE '%สำนักงาน' THEN
    v_is_exec_tier := true;
    v_prefix := 'สำนักงาน';
    v_target_org := v_office;
  ELSIF v_pos LIKE '%กอง' THEN
    v_is_exec_tier := true;
    v_prefix := 'กอง';
    v_target_org := v_office;
  ELSIF v_pos LIKE '%สำนัก' THEN
    v_is_exec_tier := true;
    v_prefix := 'สำนัก';
    v_target_org := COALESCE(v_bureau, v_fallback_bureau);
  ELSIF v_pos LIKE '%ส่วน' THEN
    v_is_exec_tier := true;
    v_prefix := 'ส่วน';
    v_target_org := v_dept;
  ELSIF v_pos LIKE '%ฝ่าย' THEN
    v_is_exec_tier := true;
    v_prefix := 'ฝ่าย';
    v_target_org := v_dept;
  ELSIF v_pos LIKE '%กลุ่มงาน' THEN
    v_is_exec_tier := true;
    v_prefix := 'กลุ่มงาน';
    v_target_org := v_div;
  ELSIF v_tcode IN ('EXECUTIVE', 'MANAGERIAL') OR v_tname ~ '(อำนวยการ|บริหาร)' THEN
    v_is_exec_tier := true;
    v_target_org := COALESCE(v_div, v_dept, v_office, v_bureau, v_fallback_bureau);
    FOREACH v_cand IN ARRAY ARRAY['สำนักงาน', 'กลุ่มงาน', 'สำนัก', 'กอง', 'ส่วน', 'ฝ่าย'] LOOP
      IF right(v_pos, length(v_cand)) = v_cand AND v_target_org IS NOT NULL AND left(v_target_org, length(v_cand)) = v_cand THEN
        v_prefix := v_cand;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_is_exec_tier THEN
    IF v_target_org IS NULL THEN
      RETURN v_pos;
    END IF;
    IF right(v_pos, length(v_target_org)) = v_target_org THEN
      RETURN v_pos;
    END IF;
    IF v_prefix IS NOT NULL AND left(v_target_org, length(v_prefix)) = v_prefix THEN
      v_suffix := trim(substr(v_target_org, length(v_prefix) + 1));
      IF v_suffix = '' OR right(v_pos, length(v_suffix)) = v_suffix THEN
        RETURN v_pos;
      END IF;
      RETURN v_pos || v_suffix;
    END IF;
    RETURN v_pos || v_target_org;
  END IF;

  -- Standard civil servant / employee formatting
  IF v_lvl = '' THEN
    RETURN v_pos;
  END IF;
  IF right(v_pos, length(v_lvl)) = v_lvl THEN
    RETURN v_pos;
  END IF;

  RETURN v_pos || v_lvl;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_format_position_display(text, text, text, text, text, text, text, text, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Step 6: Recreate All 5 Dependent Views (WITH security_invoker = true)
-- -----------------------------------------------------------------------------

-- 6.1 v_personnel_directory
CREATE VIEW public.v_personnel_directory
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.cid,
  p.prefix_id,
  lp.name_th AS prefix_name,
  p.noble_or_rank_title,
  p.first_name,
  p.last_name,
  trim(concat_ws(' ',
    NULLIF(trim(concat(COALESCE(p.noble_or_rank_title || ' ', ''), COALESCE(lp.name_th, ''), p.first_name)), ''),
    p.last_name
  )) AS full_name,
  p.gender_id,
  lg.name_th AS gender_name,
  p.birth_date,
  p.phone_number,
  p.email,
  p.photo_path,
  p.signature_path,
  p.status_id,
  ls.name_th AS status_name,
  ls.color_hex AS status_color,
  COALESCE(ls.allows_account_provision, true) AS allows_account_provision,
  pa.employment_type_id,
  le.name_th AS employment_type_name,
  pa.position_type_id,
  pt.code AS position_type_code,
  pt.name_th AS position_type_name,
  pa.position_id,
  pos.name_th AS position_name,
  pa.position_level_id,
  pl.name_th AS position_level_name,
  public.fn_format_position_display(
    pos.name_th,
    pl.name_th,
    pt.code,
    pt.name_th,
    ob.name_th,
    oo.name_th,
    od.name_th,
    ov.name_th,
    fb.bureau_name
  ) AS position_display,
  pa.position_number,
  pa.secondary_position,
  pa.acting_position,
  pa.bureau_id,
  public.fn_clean_display_segment(ob.name_th) AS bureau_name,
  pa.office_id,
  public.fn_clean_display_segment(oo.name_th) AS office_name,
  pa.department_id,
  public.fn_clean_display_segment(od.name_th) AS department_name,
  pa.division_id,
  public.fn_clean_display_segment(ov.name_th) AS division_name,
  NULLIF(
    concat_ws(' · ',
      public.fn_clean_display_segment(oo.name_th),
      public.fn_clean_display_segment(od.name_th),
      public.fn_clean_display_segment(ov.name_th)
    ),
    ''
  ) AS org_display,
  pa.approval_tier_id,
  la.name_th AS approval_tier_name,
  pc.start_service_date,
  pc.start_service_year_be,
  pc.initial_position,
  pc.initial_position_type_id,
  pc.initial_position_id,
  pc.initial_position_level_id,
  pc.initial_salary,
  pc.current_salary,
  COALESCE(pc.disciplinary_flag, false) AS disciplinary_flag,
  pc.disciplinary_note,
  (u.id IS NOT NULL) AS has_user_account,
  u.id AS user_id,
  u.role AS user_role,
  u.status AS user_status,
  pa.current_position_date,
  pa.current_level_date,
  pc.re_appointment_date,
  pc.transfer_in_date,
  COALESCE(pc.prior_continuous_service_days, 0) AS prior_continuous_service_days,
  COALESCE(pc.double_service_days, 0) AS double_service_days,
  COALESCE(pc.position_allowance, 0)::numeric(12, 2) AS position_allowance,
  COALESCE(pc.is_max_step, false) AS is_max_step,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', ed.id,
        'duty_type', ed.duty_type,
        'position_type_id', ed.position_type_id,
        'position_type_code', edpt.code,
        'position_type_name', edpt.name_th,
        'position_id', ed.position_id,
        'position_name', edpos.name_th,
        'position_level_id', ed.position_level_id,
        'position_level_name', edpl.name_th,
        'duty_display', public.fn_format_position_display(
          edpos.name_th,
          edpl.name_th,
          edpt.code,
          edpt.name_th,
          edb.name_th,
          edo.name_th,
          edd.name_th,
          edv.name_th,
          fb.bureau_name
        ),
        'bureau_id', ed.bureau_id,
        'bureau_name', public.fn_clean_display_segment(edb.name_th),
        'office_id', ed.office_id,
        'office_name', public.fn_clean_display_segment(edo.name_th),
        'department_id', ed.department_id,
        'department_name', public.fn_clean_display_segment(edd.name_th),
        'division_id', ed.division_id,
        'division_name', public.fn_clean_display_segment(edv.name_th),
        'effective_date', ed.effective_date,
        'end_date', ed.end_date,
        'order_reference', ed.order_reference,
        'sort_order', ed.sort_order
      ) ORDER BY ed.sort_order ASC, (ed.end_date IS NOT NULL) ASC, ed.effective_date DESC NULLS LAST, ed.created_at DESC
    )
    FROM public.personnel_executive_duties ed
    LEFT JOIN public.position_types edpt ON edpt.id = ed.position_type_id
    LEFT JOIN public.positions edpos ON edpos.id = ed.position_id
    LEFT JOIN public.position_levels edpl ON edpl.id = ed.position_level_id
    LEFT JOIN public.org_units edb ON edb.id = ed.bureau_id
    LEFT JOIN public.org_units edo ON edo.id = ed.office_id
    LEFT JOIN public.org_units edd ON edd.id = ed.department_id
    LEFT JOIN public.org_units edv ON edv.id = ed.division_id
    WHERE ed.personnel_id = p.id),
    '[]'::jsonb
  ) AS executive_duties
FROM public.personnel p
LEFT JOIN LATERAL (
  SELECT NULLIF(trim(value), '') AS bureau_name
  FROM public.system_settings
  WHERE key = 'bureau_name'
  LIMIT 1
) fb ON true
LEFT JOIN public.lookup_items lp ON lp.id = p.prefix_id
LEFT JOIN public.lookup_items lg ON lg.id = p.gender_id
LEFT JOIN public.lookup_items ls ON ls.id = p.status_id
LEFT JOIN public.personnel_assignments pa ON pa.personnel_id = p.id
LEFT JOIN public.lookup_items le ON le.id = pa.employment_type_id
LEFT JOIN public.position_types pt ON pt.id = pa.position_type_id
LEFT JOIN public.positions pos ON pos.id = pa.position_id
LEFT JOIN public.position_levels pl ON pl.id = pa.position_level_id
LEFT JOIN public.org_units ob ON ob.id = pa.bureau_id
LEFT JOIN public.org_units oo ON oo.id = pa.office_id
LEFT JOIN public.org_units od ON od.id = pa.department_id
LEFT JOIN public.org_units ov ON ov.id = pa.division_id
LEFT JOIN public.lookup_items la ON la.id = pa.approval_tier_id
LEFT JOIN public.personnel_career_records pc ON pc.personnel_id = p.id
LEFT JOIN public.users u ON u.personnel_id = p.id;

GRANT SELECT ON public.v_personnel_directory TO authenticated, service_role;

-- 6.2 v_users_scoped
CREATE VIEW public.v_users_scoped
WITH (security_invoker = true) AS
SELECT
  u.id,
  u.personnel_id,
  u.username,
  u.email,
  u.role,
  u.status,
  u.must_change_credential,
  u.account_source,
  u.last_login_at,
  u.created_at,
  d.full_name,
  public.fn_mask_cid(d.cid) AS cid_masked,
  d.bureau_id,
  d.bureau_name,
  d.office_id,
  d.office_name,
  d.department_id,
  d.department_name,
  d.division_id,
  d.division_name,
  d.position_type_id,
  d.position_type_code,
  d.position_type_name,
  d.position_id,
  d.position_name,
  d.position_level_id,
  d.position_level_name,
  d.position_number,
  d.position_display,
  s.scope_level_no,
  s.org_unit_id AS scope_org_unit_id,
  public.fn_clean_display_segment(so.name_th) AS scope_org_unit_name
FROM public.users u
LEFT JOIN public.v_personnel_directory d ON d.id = u.personnel_id
LEFT JOIN public.user_admin_scopes s ON s.user_id = u.id
LEFT JOIN public.org_units so ON so.id = s.org_unit_id;

GRANT SELECT ON public.v_users_scoped TO authenticated, service_role;

-- 6.3 v_user_app_access_matrix
CREATE VIEW public.v_user_app_access_matrix
WITH (security_invoker = true) AS
SELECT
  p.id AS permission_id,
  p.user_id,
  u.username,
  u.role AS core_role,
  d.full_name,
  d.office_id,
  d.office_name,
  d.department_id,
  d.department_name,
  p.webapp_id,
  w.app_code,
  w.name AS webapp_name,
  p.webapp_role_id,
  wr.role_code,
  wr.role_name_th,
  wr.hierarchy_level,
  wr.color_hex AS role_color,
  wr.allow_scoped_admin_grant,
  p.is_allowed,
  p.expires_at,
  p.note,
  p.updated_at
FROM public.user_app_permissions p
JOIN public.users u ON u.id = p.user_id
JOIN public.webapps w ON w.id = p.webapp_id
JOIN public.webapp_roles wr ON wr.id = p.webapp_role_id
LEFT JOIN public.v_personnel_directory d ON d.id = u.personnel_id;

GRANT SELECT ON public.v_user_app_access_matrix TO authenticated, service_role;

-- 6.4 v_personnel_approvers
CREATE VIEW public.v_personnel_approvers
WITH (security_invoker = true) AS
SELECT
  d.id,
  d.full_name,
  d.position_type_code,
  d.position_type_name,
  d.position_name,
  d.position_level_name,
  d.position_display,
  d.secondary_position,
  d.acting_position,
  d.executive_duties,
  d.bureau_id,
  d.bureau_name,
  d.office_id,
  d.office_name,
  d.department_id,
  d.department_name,
  d.approval_tier_id,
  la.name_th AS approval_tier_name,
  la.rank_order AS approval_rank_order,
  d.signature_path
FROM public.v_personnel_directory d
JOIN public.lookup_items la ON la.id = d.approval_tier_id
WHERE la.is_approver = true
ORDER BY la.rank_order DESC, d.full_name;

GRANT SELECT ON public.v_personnel_approvers TO authenticated, service_role;

-- 6.5 v_decoration_hr_source (All 7 JSONB timeline arrays ordered by sort_order ASC)
CREATE VIEW public.v_decoration_hr_source
WITH (security_invoker = true) AS
SELECT
  d.id AS person_id,
  d.cid,
  public.fn_mask_cid(d.cid) AS cid_masked,
  d.prefix_id,
  d.prefix_name,
  d.noble_or_rank_title,
  d.first_name,
  d.last_name,
  d.full_name,
  d.gender_id,
  lg.code AS gender_code,
  d.gender_name,
  d.birth_date,
  d.employment_type_id,
  le.code AS employment_type_code,
  d.employment_type_name,
  d.status_id,
  ls.code AS status_code,
  d.status_name,
  d.bureau_id,
  ob.code AS bureau_code,
  d.bureau_name,
  d.office_id,
  oo.code AS office_code,
  d.office_name,
  d.department_id,
  od.code AS department_code,
  d.department_name,
  d.division_id,
  ov.code AS division_code,
  d.division_name,
  d.position_type_id,
  d.position_type_code,
  d.position_type_name,
  d.position_id,
  d.position_name,
  d.position_level_id,
  pl.code AS position_level_code,
  d.position_level_name,
  d.position_display,
  d.position_number,
  d.secondary_position,
  d.acting_position,
  d.executive_duties,
  d.current_position_date,
  d.current_level_date,
  d.email,
  d.phone_number,
  d.start_service_date,
  d.start_service_year_be,
  d.re_appointment_date,
  d.transfer_in_date,
  d.prior_continuous_service_days,
  d.double_service_days,
  d.initial_position,
  d.initial_position_type_id,
  d.initial_position_id,
  d.initial_position_level_id,
  d.initial_salary,
  d.current_salary,
  d.position_allowance,
  d.is_max_step,
  d.disciplinary_flag,
  d.disciplinary_note,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', nh.id,
        'old_prefix_id', nh.old_prefix_id,
        'old_prefix', COALESCE(nhp.name_th, nh.old_prefix),
        'old_first_name', nh.old_first_name,
        'old_last_name', nh.old_last_name,
        'changed_date', nh.changed_date,
        'document_ref', nh.document_ref,
        'sort_order', nh.sort_order
      ) ORDER BY nh.sort_order ASC, nh.changed_date DESC
    )
    FROM public.personnel_name_history nh
    LEFT JOIN public.lookup_items nhp ON nhp.id = nh.old_prefix_id
    WHERE nh.personnel_id = d.id),
    '[]'::jsonb
  ) AS former_names,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', ph.id,
        'position_number', ph.position_number,
        'position_type_id', ph.position_type_id,
        'position_type_code', pht.code,
        'position_type_name', pht.name_th,
        'position_id', ph.position_id,
        'position_name', COALESCE(php.name_th, ph.position_title_snapshot),
        'position_title_snapshot', ph.position_title_snapshot,
        'position_level_id', ph.position_level_id,
        'position_level_code', phl.code,
        'position_level_name', phl.name_th,
        'position_display', public.fn_format_position_display(
          COALESCE(php.name_th, ph.position_title_snapshot),
          phl.name_th,
          pht.code,
          pht.name_th,
          CASE WHEN ol0.level_no = 1 THEN phorg.name_th
               WHEN ol1.level_no = 1 THEN p1.name_th
               WHEN ol2.level_no = 1 THEN p2.name_th
               WHEN ol3.level_no = 1 THEN p3.name_th
               ELSE NULL END,
          CASE WHEN ol0.level_no = 2 THEN phorg.name_th
               WHEN ol1.level_no = 2 THEN p1.name_th
               WHEN ol2.level_no = 2 THEN p2.name_th
               ELSE NULL END,
          CASE WHEN ol0.level_no = 3 THEN phorg.name_th
               WHEN ol1.level_no = 3 THEN p1.name_th
               ELSE NULL END,
          CASE WHEN ol0.level_no = 4 THEN phorg.name_th
               ELSE NULL END,
          fb.bureau_name
        ),
        'org_unit_id', ph.org_unit_id,
        'org_unit_name', public.fn_clean_display_segment(phorg.name_th),
        'effective_date', ph.effective_date,
        'end_date', ph.end_date,
        'order_reference', ph.order_reference,
        'sort_order', ph.sort_order,
        'is_latest', ph.is_latest,
        'is_initial', ph.is_initial
      ) ORDER BY ph.sort_order ASC, ph.effective_date DESC
    )
    FROM public.personnel_position_history ph
    LEFT JOIN public.position_types pht ON pht.id = ph.position_type_id
    LEFT JOIN public.positions php ON php.id = ph.position_id
    LEFT JOIN public.position_levels phl ON phl.id = ph.position_level_id
    LEFT JOIN public.org_units phorg ON phorg.id = ph.org_unit_id
    LEFT JOIN public.org_unit_levels ol0 ON ol0.id = phorg.level_id
    LEFT JOIN public.org_units p1 ON p1.id = phorg.parent_id
    LEFT JOIN public.org_unit_levels ol1 ON ol1.id = p1.level_id
    LEFT JOIN public.org_units p2 ON p2.id = p1.parent_id
    LEFT JOIN public.org_unit_levels ol2 ON ol2.id = p2.level_id
    LEFT JOIN public.org_units p3 ON p3.id = p2.parent_id
    LEFT JOIN public.org_unit_levels ol3 ON ol3.id = p3.level_id
    WHERE ph.personnel_id = d.id),
    '[]'::jsonb
  ) AS position_history,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', sh.id,
        'base_salary', sh.base_salary,
        'position_allowance', sh.position_allowance,
        'is_max_step', sh.is_max_step,
        'effective_date', sh.effective_date,
        'order_reference', sh.order_reference,
        'sort_order', sh.sort_order
      ) ORDER BY sh.sort_order ASC, sh.effective_date DESC
    )
    FROM public.personnel_salary_history sh
    WHERE sh.personnel_id = d.id),
    '[]'::jsonb
  ) AS salary_history,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', ev.id,
        'fiscal_year_be', ev.fiscal_year_be,
        'eval_round', ev.eval_round,
        'score_percent', ev.score_percent,
        'eval_grade_id', ev.eval_grade_id,
        'eval_grade_code', eg.code,
        'eval_grade_name', eg.name_th,
        'note', ev.note,
        'sort_order', ev.sort_order
      ) ORDER BY ev.sort_order ASC, ev.fiscal_year_be DESC, ev.eval_round DESC
    )
    FROM public.personnel_evaluations ev
    LEFT JOIN public.lookup_items eg ON eg.id = ev.eval_grade_id
    WHERE ev.personnel_id = d.id),
    '[]'::jsonb
  ) AS recent_evaluations,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', dr.id,
        'record_type_id', dr.record_type_id,
        'record_type_code', drt.code,
        'record_type_name', drt.name_th,
        'penalty_level_id', dr.penalty_level_id,
        'penalty_level_code', drp.code,
        'penalty_level_name', drp.name_th,
        'case_status_id', dr.case_status_id,
        'case_status_code', drs.code,
        'case_status_name', drs.name_th,
        'effective_date', dr.effective_date,
        'resolved_date', dr.resolved_date,
        'remark', dr.remark,
        'sort_order', dr.sort_order
      ) ORDER BY dr.sort_order ASC, dr.effective_date DESC
    )
    FROM public.personnel_disciplinary_records dr
    LEFT JOIN public.lookup_items drt ON drt.id = dr.record_type_id
    LEFT JOIN public.lookup_items drp ON drp.id = dr.penalty_level_id
    LEFT JOIN public.lookup_items drs ON drs.id = dr.case_status_id
    WHERE dr.personnel_id = d.id),
    '[]'::jsonb
  ) AS disciplinary_records,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', si.id,
        'interruption_type_id', si.interruption_type_id,
        'interruption_type_code', sit.code,
        'interruption_type_name', sit.name_th,
        'start_date', si.start_date,
        'end_date', si.end_date,
        'deductible_days', si.deductible_days,
        'remark', si.remark,
        'sort_order', si.sort_order
      ) ORDER BY si.sort_order ASC, si.start_date DESC
    )
    FROM public.personnel_service_interruptions si
    LEFT JOIN public.lookup_items sit ON sit.id = si.interruption_type_id
    WHERE si.personnel_id = d.id),
    '[]'::jsonb
  ) AS service_interruptions
FROM public.v_personnel_directory d
LEFT JOIN LATERAL (
  SELECT NULLIF(trim(value), '') AS bureau_name
  FROM public.system_settings
  WHERE key = 'bureau_name'
  LIMIT 1
) fb ON true
LEFT JOIN public.lookup_items lg ON lg.id = d.gender_id
LEFT JOIN public.lookup_items le ON le.id = d.employment_type_id
LEFT JOIN public.lookup_items ls ON ls.id = d.status_id
LEFT JOIN public.position_levels pl ON pl.id = d.position_level_id
LEFT JOIN public.org_units ob ON ob.id = d.bureau_id
LEFT JOIN public.org_units oo ON oo.id = d.office_id
LEFT JOIN public.org_units od ON od.id = d.department_id
LEFT JOIN public.org_units ov ON ov.id = d.division_id;

GRANT SELECT ON public.v_decoration_hr_source TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Step 7: Upgrade 4 Critical RPC Functions
-- -----------------------------------------------------------------------------

-- 7.1 fn_get_my_profile() — suppress "ไม่มี" on office_name, department_name, scope_org_unit_name
CREATE OR REPLACE FUNCTION public.fn_get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_fallback_bureau text;
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT NULLIF(trim(value), '') INTO v_fallback_bureau
  FROM public.system_settings
  WHERE key = 'bureau_name'
  LIMIT 1;

  SELECT jsonb_build_object(
    'id', u.id,
    'personnel_id', u.personnel_id,
    'username', u.username,
    'email', COALESCE(u.email, p.email),
    'role', u.role,
    'status', u.status,
    'must_change_credential', u.must_change_credential,
    'full_name', COALESCE(
      NULLIF(trim(concat_ws(' ', concat(COALESCE(lp.name_th, ''), p.first_name), p.last_name)), ''),
      u.username
    ),
    'cid_masked', public.fn_mask_cid(p.cid),
    'photo_path', p.photo_path,
    'signature_path', p.signature_path,
    'position_display', NULLIF(
      public.fn_format_position_display(
        pos.name_th,
        pl.name_th,
        pt.code,
        pt.name_th,
        ob.name_th,
        oo.name_th,
        od.name_th,
        ov.name_th,
        v_fallback_bureau
      ),
      '-'
    ),
    'office_name', public.fn_clean_display_segment(oo.name_th),
    'department_name', public.fn_clean_display_segment(od.name_th),
    'admin_scope', CASE
      WHEN u.role = 'ADMIN' AND sc.user_id IS NOT NULL THEN jsonb_build_object(
        'scope_level_no', sc.scope_level_no,
        'org_unit_id', sc.org_unit_id,
        'org_unit_name', COALESCE(public.fn_clean_display_segment(so.name_th), so.name_th),
        'parent_office_id', so.parent_id
      )
      ELSE NULL
    END
  ) INTO v_res
  FROM public.users u
  LEFT JOIN public.personnel p ON p.id = u.personnel_id
  LEFT JOIN public.lookup_items lp ON lp.id = p.prefix_id
  LEFT JOIN public.personnel_assignments pa ON pa.personnel_id = p.id
  LEFT JOIN public.position_types pt ON pt.id = pa.position_type_id
  LEFT JOIN public.positions pos ON pos.id = pa.position_id
  LEFT JOIN public.position_levels pl ON pl.id = pa.position_level_id
  LEFT JOIN public.org_units ob ON ob.id = pa.bureau_id
  LEFT JOIN public.org_units oo ON oo.id = pa.office_id
  LEFT JOIN public.org_units od ON od.id = pa.department_id
  LEFT JOIN public.org_units ov ON ov.id = pa.division_id
  LEFT JOIN public.user_admin_scopes sc ON sc.user_id = u.id
  LEFT JOIN public.org_units so ON so.id = sc.org_unit_id
  WHERE u.id = v_uid;

  RETURN v_res;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_get_my_profile() TO authenticated;

-- 7.2 fn_check_existing_cids_with_snapshot(text[]) — drop & recreate without personnel_code
DROP FUNCTION IF EXISTS public.fn_check_existing_cids_with_snapshot(text[]);

CREATE FUNCTION public.fn_check_existing_cids_with_snapshot(p_cids text[])
RETURNS TABLE (
  personnel_id uuid,
  cid text,
  full_name text,
  first_name text,
  last_name text,
  phone_number text,
  email text,
  position_name text,
  position_level_name text,
  office_name text,
  department_name text,
  current_salary numeric,
  in_my_scope boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.fn_current_user_role() NOT IN ('SUPERADMIN', 'ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.cid,
    trim(concat_ws(' ', concat(COALESCE(lp.name_th, ''), p.first_name), p.last_name)),
    p.first_name,
    p.last_name,
    p.phone_number,
    p.email,
    pos.name_th,
    pl.name_th,
    oo.name_th,
    od.name_th,
    pc.current_salary,
    public.fn_is_org_in_my_scope(pa.office_id, pa.department_id)
  FROM public.personnel p
  LEFT JOIN public.lookup_items lp ON lp.id = p.prefix_id
  LEFT JOIN public.personnel_assignments pa ON pa.personnel_id = p.id
  LEFT JOIN public.positions pos ON pos.id = pa.position_id
  LEFT JOIN public.position_levels pl ON pl.id = pa.position_level_id
  LEFT JOIN public.org_units oo ON oo.id = pa.office_id
  LEFT JOIN public.org_units od ON od.id = pa.department_id
  LEFT JOIN public.personnel_career_records pc ON pc.personnel_id = p.id
  WHERE p.cid = ANY(p_cids);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_check_existing_cids_with_snapshot(text[]) TO authenticated;

-- 7.3 fn_save_personnel_bundle(jsonb) — sort_order on all 7 timelines, exclusive [is_latest, is_initial], initial_position FK sync
CREATE OR REPLACE FUNCTION public.fn_save_personnel_bundle(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := public.fn_current_user_role();
  v_p jsonb := COALESCE(p_payload->'personnel', '{}'::jsonb);
  v_a jsonb := COALESCE(p_payload->'assignment', '{}'::jsonb);
  v_c jsonb := COALESCE(p_payload->'career', '{}'::jsonb);
  v_name_hist jsonb := p_payload->'name_history';
  v_pos_hist jsonb := p_payload->'position_history';
  v_exec_duties jsonb := p_payload->'executive_duties';
  v_sal_hist jsonb := p_payload->'salary_history';
  v_evals jsonb := p_payload->'evaluations';
  v_disc jsonb := p_payload->'disciplinary_records';
  v_interr jsonb := p_payload->'service_interruptions';
  v_pid uuid := NULLIF(v_p->>'id', '')::uuid;
  v_cid text := regexp_replace(COALESCE(v_p->>'cid', ''), '[\s-]', '', 'g');
  v_first_name text := NULLIF(trim(COALESCE(v_p->>'first_name', '')), '');
  v_last_name text := NULLIF(trim(COALESCE(v_p->>'last_name', '')), '');
  v_office_id uuid := NULLIF(v_a->>'office_id', '')::uuid;
  v_dept_id uuid := NULLIF(v_a->>'department_id', '')::uuid;
  v_start_date date := NULLIF(v_c->>'start_service_date', '')::date;
  v_start_year_be smallint;
  v_fallback_bureau text;
  v_item jsonb;
  v_idx integer;
  v_total integer;
  v_active_pos_count integer := 0;
  v_exec_pos_id uuid;
  v_exec_pt_id uuid;
  v_exec_pt_code text;
  v_exec_bureau_id uuid;
  v_exec_office_id uuid;
  v_old_prefix_id uuid;
  v_old_prefix_text text;
  v_init_pos_type_id uuid := NULLIF(v_c->>'initial_position_type_id', '')::uuid;
  v_init_pos_id uuid := NULLIF(v_c->>'initial_position_id', '')::uuid;
  v_init_pos_lvl_id uuid := NULLIF(v_c->>'initial_position_level_id', '')::uuid;
  v_init_pos_text text := NULLIF(trim(COALESCE(v_c->>'initial_position', '')), '');
  -- Authoritative sync variables
  v_latest_pos RECORD;
  v_initial_pos RECORD;
  v_initial_pos_display text;
  v_pos_row RECORD;
  v_cont_pos_date date;
  v_cont_lvl_date date;
  v_pos_chain_broken boolean;
  v_lvl_chain_broken boolean;
  v_deputizing_summary text;
  v_acting_summary text;
  v_latest_sal RECORD;
  v_has_active_disc boolean := false;
  v_disc_summary text;
BEGIN
  IF v_role NOT IN ('SUPERADMIN', 'ADMIN') THEN
    RAISE EXCEPTION 'Insufficient privileges to save personnel';
  END IF;

  IF NOT public.fn_valid_cid(v_cid) THEN
    RAISE EXCEPTION 'Invalid Thai CID (Mod 11 check failed)';
  END IF;

  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'REQUIRED_NAME: กรุณาระบุชื่อจริงและนามสกุลให้ครบถ้วน';
  END IF;

  IF NOT public.fn_is_org_in_my_scope(v_office_id, v_dept_id) THEN
    RAISE EXCEPTION 'OUT_OF_ADMIN_SCOPE: Target org unit is outside your assigned admin scope';
  END IF;

  SELECT NULLIF(trim(value), '') INTO v_fallback_bureau
  FROM public.system_settings
  WHERE key = 'bureau_name'
  LIMIT 1;

  IF v_start_date IS NOT NULL THEN
    v_start_year_be := (EXTRACT(YEAR FROM v_start_date)::integer + 543)::smallint;
  ELSE
    v_start_year_be := NULLIF(v_c->>'start_service_year_be', '')::smallint;
  END IF;

  -- Compute cached initial_position display when FK is provided without explicit text
  IF v_init_pos_id IS NOT NULL AND v_init_pos_text IS NULL THEN
    SELECT NULLIF(public.fn_format_position_display(pos.name_th, pl.name_th, pt.code, pt.name_th, NULL, NULL, NULL, NULL, v_fallback_bureau), '-')
    INTO v_init_pos_text
    FROM public.positions pos
    LEFT JOIN public.position_types pt ON pt.id = COALESCE(v_init_pos_type_id, pos.position_type_id)
    LEFT JOIN public.position_levels pl ON pl.id = v_init_pos_lvl_id
    WHERE pos.id = v_init_pos_id;
  END IF;

  IF v_pid IS NULL THEN
    INSERT INTO public.personnel (
      cid, prefix_id, noble_or_rank_title, first_name, last_name,
      gender_id, birth_date, phone_number, email, photo_path, signature_path, status_id,
      created_by, updated_by
    ) VALUES (
      v_cid,
      NULLIF(v_p->>'prefix_id', '')::uuid,
      NULLIF(trim(v_p->>'noble_or_rank_title'), ''),
      v_first_name,
      v_last_name,
      NULLIF(v_p->>'gender_id', '')::uuid,
      NULLIF(v_p->>'birth_date', '')::date,
      NULLIF(trim(v_p->>'phone_number'), ''),
      NULLIF(lower(trim(v_p->>'email')), ''),
      NULLIF(trim(v_p->>'photo_path'), ''),
      NULLIF(trim(v_p->>'signature_path'), ''),
      NULLIF(v_p->>'status_id', '')::uuid,
      auth.uid(),
      auth.uid()
    ) RETURNING id INTO v_pid;
  ELSE
    IF NOT public.fn_is_personnel_in_my_scope(v_pid) THEN
      RAISE EXCEPTION 'OUT_OF_ADMIN_SCOPE: Existing personnel is outside your scope';
    END IF;

    UPDATE public.personnel SET
      cid = v_cid,
      prefix_id = NULLIF(v_p->>'prefix_id', '')::uuid,
      noble_or_rank_title = NULLIF(trim(v_p->>'noble_or_rank_title'), ''),
      first_name = v_first_name,
      last_name = v_last_name,
      gender_id = NULLIF(v_p->>'gender_id', '')::uuid,
      birth_date = NULLIF(v_p->>'birth_date', '')::date,
      phone_number = NULLIF(trim(v_p->>'phone_number'), ''),
      email = NULLIF(lower(trim(v_p->>'email')), ''),
      photo_path = CASE WHEN v_p ? 'photo_path' THEN NULLIF(trim(v_p->>'photo_path'), '') ELSE photo_path END,
      signature_path = CASE WHEN v_p ? 'signature_path' THEN NULLIF(trim(v_p->>'signature_path'), '') ELSE signature_path END,
      status_id = NULLIF(v_p->>'status_id', '')::uuid,
      updated_by = auth.uid()
    WHERE id = v_pid;
  END IF;

  INSERT INTO public.personnel_assignments (
    personnel_id, employment_type_id, position_type_id, position_id, position_level_id,
    position_number, secondary_position, acting_position,
    bureau_id, office_id, department_id, division_id,
    approval_tier_id, current_position_date, current_level_date, updated_by
  ) VALUES (
    v_pid,
    NULLIF(v_a->>'employment_type_id', '')::uuid,
    NULLIF(v_a->>'position_type_id', '')::uuid,
    NULLIF(v_a->>'position_id', '')::uuid,
    NULLIF(v_a->>'position_level_id', '')::uuid,
    NULLIF(trim(v_a->>'position_number'), ''),
    NULLIF(trim(v_a->>'secondary_position'), ''),
    NULLIF(trim(v_a->>'acting_position'), ''),
    NULLIF(v_a->>'bureau_id', '')::uuid,
    v_office_id,
    v_dept_id,
    NULLIF(v_a->>'division_id', '')::uuid,
    NULLIF(v_a->>'approval_tier_id', '')::uuid,
    NULLIF(v_a->>'current_position_date', '')::date,
    NULLIF(v_a->>'current_level_date', '')::date,
    auth.uid()
  )
  ON CONFLICT (personnel_id) DO UPDATE SET
    employment_type_id = EXCLUDED.employment_type_id,
    position_type_id = EXCLUDED.position_type_id,
    position_id = EXCLUDED.position_id,
    position_level_id = EXCLUDED.position_level_id,
    position_number = EXCLUDED.position_number,
    secondary_position = EXCLUDED.secondary_position,
    acting_position = EXCLUDED.acting_position,
    bureau_id = EXCLUDED.bureau_id,
    office_id = EXCLUDED.office_id,
    department_id = EXCLUDED.department_id,
    division_id = EXCLUDED.division_id,
    approval_tier_id = EXCLUDED.approval_tier_id,
    current_position_date = CASE
      WHEN v_a ? 'current_position_date' THEN EXCLUDED.current_position_date
      ELSE public.personnel_assignments.current_position_date
    END,
    current_level_date = CASE
      WHEN v_a ? 'current_level_date' THEN EXCLUDED.current_level_date
      ELSE public.personnel_assignments.current_level_date
    END,
    updated_by = auth.uid();

  INSERT INTO public.personnel_career_records (
    personnel_id, start_service_date, start_service_year_be,
    initial_position, initial_position_type_id, initial_position_id, initial_position_level_id,
    initial_salary, current_salary, disciplinary_flag, disciplinary_note,
    re_appointment_date, transfer_in_date, prior_continuous_service_days, double_service_days,
    position_allowance, is_max_step, updated_by
  ) VALUES (
    v_pid,
    v_start_date,
    v_start_year_be,
    v_init_pos_text,
    v_init_pos_type_id,
    v_init_pos_id,
    v_init_pos_lvl_id,
    NULLIF(v_c->>'initial_salary', '')::numeric,
    NULLIF(v_c->>'current_salary', '')::numeric,
    COALESCE((v_c->>'disciplinary_flag')::boolean, false),
    NULLIF(trim(v_c->>'disciplinary_note'), ''),
    NULLIF(v_c->>'re_appointment_date', '')::date,
    NULLIF(v_c->>'transfer_in_date', '')::date,
    COALESCE(NULLIF(v_c->>'prior_continuous_service_days', '')::integer, 0),
    COALESCE(NULLIF(v_c->>'double_service_days', '')::integer, 0),
    COALESCE(NULLIF(v_c->>'position_allowance', '')::numeric, 0),
    COALESCE((v_c->>'is_max_step')::boolean, false),
    auth.uid()
  )
  ON CONFLICT (personnel_id) DO UPDATE SET
    start_service_date = EXCLUDED.start_service_date,
    start_service_year_be = EXCLUDED.start_service_year_be,
    initial_position = EXCLUDED.initial_position,
    initial_position_type_id = CASE
      WHEN v_c ? 'initial_position_type_id' THEN EXCLUDED.initial_position_type_id
      ELSE public.personnel_career_records.initial_position_type_id
    END,
    initial_position_id = CASE
      WHEN v_c ? 'initial_position_id' THEN EXCLUDED.initial_position_id
      ELSE public.personnel_career_records.initial_position_id
    END,
    initial_position_level_id = CASE
      WHEN v_c ? 'initial_position_level_id' THEN EXCLUDED.initial_position_level_id
      ELSE public.personnel_career_records.initial_position_level_id
    END,
    initial_salary = EXCLUDED.initial_salary,
    current_salary = EXCLUDED.current_salary,
    disciplinary_flag = CASE
      WHEN v_c ? 'disciplinary_flag' THEN EXCLUDED.disciplinary_flag
      ELSE public.personnel_career_records.disciplinary_flag
    END,
    disciplinary_note = CASE
      WHEN v_c ? 'disciplinary_note' THEN EXCLUDED.disciplinary_note
      ELSE public.personnel_career_records.disciplinary_note
    END,
    re_appointment_date = CASE
      WHEN v_c ? 're_appointment_date' THEN EXCLUDED.re_appointment_date
      ELSE public.personnel_career_records.re_appointment_date
    END,
    transfer_in_date = CASE
      WHEN v_c ? 'transfer_in_date' THEN EXCLUDED.transfer_in_date
      ELSE public.personnel_career_records.transfer_in_date
    END,
    prior_continuous_service_days = CASE
      WHEN v_c ? 'prior_continuous_service_days' THEN EXCLUDED.prior_continuous_service_days
      ELSE public.personnel_career_records.prior_continuous_service_days
    END,
    double_service_days = CASE
      WHEN v_c ? 'double_service_days' THEN EXCLUDED.double_service_days
      ELSE public.personnel_career_records.double_service_days
    END,
    position_allowance = CASE
      WHEN v_c ? 'position_allowance' THEN EXCLUDED.position_allowance
      ELSE public.personnel_career_records.position_allowance
    END,
    is_max_step = CASE
      WHEN v_c ? 'is_max_step' THEN EXCLUDED.is_max_step
      ELSE public.personnel_career_records.is_max_step
    END,
    updated_by = auth.uid();

  -- Timeline 1: Name History (with sort_order & old_prefix_id)
  IF p_payload ? 'name_history' AND v_name_hist IS NOT NULL AND jsonb_typeof(v_name_hist) = 'array' THEN
    DELETE FROM public.personnel_name_history WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_name_hist) LOOP
      IF NULLIF(trim(COALESCE(v_item->>'old_first_name', '')), '') IS NOT NULL
         AND NULLIF(trim(COALESCE(v_item->>'old_last_name', '')), '') IS NOT NULL
         AND NULLIF(v_item->>'changed_date', '') IS NOT NULL THEN
        v_idx := v_idx + 1;
        v_old_prefix_id := NULLIF(v_item->>'old_prefix_id', '')::uuid;
        v_old_prefix_text := NULLIF(trim(COALESCE(v_item->>'old_prefix', '')), '');
        IF v_old_prefix_id IS NOT NULL AND v_old_prefix_text IS NULL THEN
          SELECT name_th INTO v_old_prefix_text FROM public.lookup_items WHERE id = v_old_prefix_id;
        END IF;
        INSERT INTO public.personnel_name_history (
          personnel_id, old_prefix_id, old_prefix, old_first_name, old_last_name, changed_date, document_ref, sort_order
        ) VALUES (
          v_pid,
          v_old_prefix_id,
          v_old_prefix_text,
          trim(v_item->>'old_first_name'),
          trim(v_item->>'old_last_name'),
          (v_item->>'changed_date')::date,
          NULLIF(trim(v_item->>'document_ref'), ''),
          COALESCE(NULLIF(v_item->>'sort_order', '')::integer, v_idx)
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 2: Position History (with sort_order & exclusive is_latest [top] / is_initial [bottom])
  IF p_payload ? 'position_history' AND v_pos_hist IS NOT NULL AND jsonb_typeof(v_pos_hist) = 'array' THEN
    v_active_pos_count := 0;
    v_total := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_pos_hist) LOOP
      IF NULLIF(v_item->>'effective_date', '') IS NOT NULL THEN
        v_total := v_total + 1;
        IF NULLIF(v_item->>'end_date', '') IS NULL THEN
          v_active_pos_count := v_active_pos_count + 1;
        END IF;
      END IF;
    END LOOP;
    IF v_active_pos_count > 1 THEN
      RAISE EXCEPTION 'MULTIPLE_ACTIVE_POSITION_HISTORY: ประวัติการดำรงตำแหน่งสามารถเว้นว่างวันสิ้นสุด (ตำแหน่งปัจจุบัน) ได้เพียง 1 รายการเท่านั้น';
    END IF;

    DELETE FROM public.personnel_position_history WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_pos_hist) LOOP
      IF NULLIF(v_item->>'effective_date', '') IS NOT NULL THEN
        v_idx := v_idx + 1;
        INSERT INTO public.personnel_position_history (
          personnel_id, position_number, position_type_id, position_id, position_level_id,
          position_title_snapshot, org_unit_id, effective_date, end_date, order_reference,
          sort_order, is_latest, is_initial
        ) VALUES (
          v_pid,
          NULLIF(trim(v_item->>'position_number'), ''),
          NULLIF(v_item->>'position_type_id', '')::uuid,
          NULLIF(v_item->>'position_id', '')::uuid,
          NULLIF(v_item->>'position_level_id', '')::uuid,
          COALESCE(
            NULLIF(trim(v_item->>'position_title_snapshot'), ''),
            (SELECT name_th FROM public.positions WHERE id = NULLIF(v_item->>'position_id', '')::uuid)
          ),
          NULLIF(v_item->>'org_unit_id', '')::uuid,
          (v_item->>'effective_date')::date,
          NULLIF(v_item->>'end_date', '')::date,
          NULLIF(trim(v_item->>'order_reference'), ''),
          v_idx,
          (v_idx = 1),
          (v_idx = v_total)
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 2B: Executive Duties (with sort_order)
  IF p_payload ? 'executive_duties' AND v_exec_duties IS NOT NULL AND jsonb_typeof(v_exec_duties) = 'array' THEN
    DELETE FROM public.personnel_executive_duties WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_exec_duties) LOOP
      v_exec_pos_id := NULLIF(v_item->>'position_id', '')::uuid;
      IF NULLIF(trim(COALESCE(v_item->>'duty_type', '')), '') IS NOT NULL AND v_exec_pos_id IS NOT NULL THEN
        SELECT pos.position_type_id, pt.code
        INTO v_exec_pt_id, v_exec_pt_code
        FROM public.positions pos
        JOIN public.position_types pt ON pt.id = pos.position_type_id
        WHERE pos.id = v_exec_pos_id;

        IF v_exec_pt_code IS DISTINCT FROM 'EXECUTIVE' THEN
          RAISE EXCEPTION 'EXECUTIVE_DUTY_NOT_EXECUTIVE_TYPE: ตำแหน่งปฏิบัติราชการแทน / รักษาการในตำแหน่ง ต้องเป็นตำแหน่งประเภทบริหารเท่านั้น';
        END IF;

        v_idx := v_idx + 1;
        v_exec_office_id := NULLIF(v_item->>'office_id', '')::uuid;
        v_exec_bureau_id := COALESCE(
          NULLIF(v_item->>'bureau_id', '')::uuid,
          (SELECT parent_id FROM public.org_units WHERE id = v_exec_office_id)
        );

        INSERT INTO public.personnel_executive_duties (
          personnel_id, duty_type, position_type_id, position_id, position_level_id,
          bureau_id, office_id, department_id, division_id,
          effective_date, end_date, order_reference, sort_order
        ) VALUES (
          v_pid,
          upper(trim(v_item->>'duty_type')),
          v_exec_pt_id,
          v_exec_pos_id,
          NULLIF(v_item->>'position_level_id', '')::uuid,
          v_exec_bureau_id,
          v_exec_office_id,
          NULLIF(v_item->>'department_id', '')::uuid,
          NULLIF(v_item->>'division_id', '')::uuid,
          NULLIF(v_item->>'effective_date', '')::date,
          NULLIF(v_item->>'end_date', '')::date,
          NULLIF(trim(v_item->>'order_reference'), ''),
          COALESCE(NULLIF(v_item->>'sort_order', '')::integer, v_idx)
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 3: Salary History (with sort_order)
  IF p_payload ? 'salary_history' AND v_sal_hist IS NOT NULL AND jsonb_typeof(v_sal_hist) = 'array' THEN
    DELETE FROM public.personnel_salary_history WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sal_hist) LOOP
      IF NULLIF(v_item->>'base_salary', '') IS NOT NULL AND NULLIF(v_item->>'effective_date', '') IS NOT NULL THEN
        v_idx := v_idx + 1;
        INSERT INTO public.personnel_salary_history (
          personnel_id, base_salary, position_allowance, is_max_step, effective_date, order_reference, sort_order
        ) VALUES (
          v_pid,
          (v_item->>'base_salary')::numeric,
          COALESCE(NULLIF(v_item->>'position_allowance', '')::numeric, 0),
          COALESCE((v_item->>'is_max_step')::boolean, false),
          (v_item->>'effective_date')::date,
          NULLIF(trim(v_item->>'order_reference'), ''),
          COALESCE(NULLIF(v_item->>'sort_order', '')::integer, v_idx)
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 4: Evaluations (with sort_order)
  IF p_payload ? 'evaluations' AND v_evals IS NOT NULL AND jsonb_typeof(v_evals) = 'array' THEN
    DELETE FROM public.personnel_evaluations WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_evals) LOOP
      IF NULLIF(v_item->>'fiscal_year_be', '') IS NOT NULL
         AND NULLIF(v_item->>'eval_round', '') IS NOT NULL
         AND NULLIF(v_item->>'eval_grade_id', '') IS NOT NULL THEN
        v_idx := v_idx + 1;
        INSERT INTO public.personnel_evaluations (
          personnel_id, fiscal_year_be, eval_round, score_percent, eval_grade_id, note, sort_order
        ) VALUES (
          v_pid,
          (v_item->>'fiscal_year_be')::smallint,
          (v_item->>'eval_round')::smallint,
          NULLIF(v_item->>'score_percent', '')::numeric,
          (v_item->>'eval_grade_id')::uuid,
          NULLIF(trim(v_item->>'note'), ''),
          COALESCE(NULLIF(v_item->>'sort_order', '')::integer, v_idx)
        )
        ON CONFLICT (personnel_id, fiscal_year_be, eval_round) DO UPDATE SET
          score_percent = EXCLUDED.score_percent,
          eval_grade_id = EXCLUDED.eval_grade_id,
          note = EXCLUDED.note,
          sort_order = EXCLUDED.sort_order;
      END IF;
    END LOOP;
  END IF;

  -- Timeline 5: Disciplinary Records (with sort_order)
  IF p_payload ? 'disciplinary_records' AND v_disc IS NOT NULL AND jsonb_typeof(v_disc) = 'array' THEN
    DELETE FROM public.personnel_disciplinary_records WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_disc) LOOP
      IF NULLIF(v_item->>'record_type_id', '') IS NOT NULL
         AND NULLIF(v_item->>'case_status_id', '') IS NOT NULL
         AND NULLIF(v_item->>'effective_date', '') IS NOT NULL THEN
        v_idx := v_idx + 1;
        INSERT INTO public.personnel_disciplinary_records (
          personnel_id, record_type_id, penalty_level_id, case_status_id, effective_date, resolved_date, remark, sort_order
        ) VALUES (
          v_pid,
          (v_item->>'record_type_id')::uuid,
          NULLIF(v_item->>'penalty_level_id', '')::uuid,
          (v_item->>'case_status_id')::uuid,
          (v_item->>'effective_date')::date,
          NULLIF(v_item->>'resolved_date', '')::date,
          NULLIF(trim(v_item->>'remark'), ''),
          COALESCE(NULLIF(v_item->>'sort_order', '')::integer, v_idx)
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 6: Service Interruptions (with sort_order)
  IF p_payload ? 'service_interruptions' AND v_interr IS NOT NULL AND jsonb_typeof(v_interr) = 'array' THEN
    DELETE FROM public.personnel_service_interruptions WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_interr) LOOP
      IF NULLIF(v_item->>'interruption_type_id', '') IS NOT NULL
         AND NULLIF(v_item->>'start_date', '') IS NOT NULL THEN
        v_idx := v_idx + 1;
        INSERT INTO public.personnel_service_interruptions (
          personnel_id, interruption_type_id, start_date, end_date, deductible_days, remark, sort_order
        ) VALUES (
          v_pid,
          (v_item->>'interruption_type_id')::uuid,
          (v_item->>'start_date')::date,
          NULLIF(v_item->>'end_date', '')::date,
          COALESCE(NULLIF(v_item->>'deductible_days', '')::integer, 0),
          NULLIF(trim(v_item->>'remark'), ''),
          COALESCE(NULLIF(v_item->>'sort_order', '')::integer, v_idx)
        );
      END IF;
    END LOOP;
  END IF;

  -- ===========================================================================
  -- AUTHORITATIVE HISTORY -> PARENT AUTO-SYNC (Honors sort_order + is_latest / is_initial)
  -- ===========================================================================

  -- Guard 1A: Latest Position (is_latest / top sort_order) -> personnel_assignments
  SELECT ph.*
  INTO v_latest_pos
  FROM public.personnel_position_history ph
  WHERE ph.personnel_id = v_pid
  ORDER BY
    ph.is_latest DESC,
    ph.sort_order ASC,
    (ph.end_date IS NOT NULL) ASC,
    ph.effective_date DESC,
    ph.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_cont_pos_date := v_latest_pos.effective_date;
    v_cont_lvl_date := v_latest_pos.effective_date;
    v_pos_chain_broken := false;
    v_lvl_chain_broken := false;

    FOR v_pos_row IN
      SELECT ph.position_id, ph.position_level_id, ph.effective_date
      FROM public.personnel_position_history ph
      WHERE ph.personnel_id = v_pid
      ORDER BY
        ph.is_latest DESC,
        ph.sort_order ASC,
        ph.effective_date DESC,
        ph.created_at DESC
    LOOP
      IF NOT v_pos_chain_broken THEN
        IF v_pos_row.position_id IS NOT DISTINCT FROM v_latest_pos.position_id THEN
          v_cont_pos_date := LEAST(v_cont_pos_date, v_pos_row.effective_date);
        ELSE
          v_pos_chain_broken := true;
        END IF;
      END IF;

      IF NOT v_lvl_chain_broken THEN
        IF v_latest_pos.position_level_id IS NOT NULL
           AND v_pos_row.position_level_id IS NOT DISTINCT FROM v_latest_pos.position_level_id THEN
          v_cont_lvl_date := LEAST(v_cont_lvl_date, v_pos_row.effective_date);
        ELSE
          v_lvl_chain_broken := true;
        END IF;
      END IF;

      EXIT WHEN v_pos_chain_broken AND v_lvl_chain_broken;
    END LOOP;

    UPDATE public.personnel_assignments SET
      position_type_id = v_latest_pos.position_type_id,
      position_id = v_latest_pos.position_id,
      position_level_id = v_latest_pos.position_level_id,
      position_number = v_latest_pos.position_number,
      current_position_date = v_cont_pos_date,
      current_level_date = CASE
        WHEN v_latest_pos.position_level_id IS NOT NULL THEN v_cont_lvl_date
        ELSE NULL
      END,
      updated_by = auth.uid()
    WHERE personnel_id = v_pid;

    -- Guard 1B: Initial Position (is_initial / bottom sort_order) -> personnel_career_records
    SELECT ph.*
    INTO v_initial_pos
    FROM public.personnel_position_history ph
    WHERE ph.personnel_id = v_pid
    ORDER BY
      ph.is_initial DESC,
      ph.sort_order DESC,
      ph.effective_date ASC,
      ph.created_at ASC
    LIMIT 1;

    IF FOUND THEN
      SELECT NULLIF(
        public.fn_format_position_display(
          COALESCE(php.name_th, v_initial_pos.position_title_snapshot),
          phl.name_th,
          pht.code,
          pht.name_th,
          CASE WHEN ol0.level_no = 1 THEN phorg.name_th
               WHEN ol1.level_no = 1 THEN p1.name_th
               WHEN ol2.level_no = 1 THEN p2.name_th
               WHEN ol3.level_no = 1 THEN p3.name_th
               ELSE NULL END,
          CASE WHEN ol0.level_no = 2 THEN phorg.name_th
               WHEN ol1.level_no = 2 THEN p1.name_th
               WHEN ol2.level_no = 2 THEN p2.name_th
               ELSE NULL END,
          CASE WHEN ol0.level_no = 3 THEN phorg.name_th
               WHEN ol1.level_no = 3 THEN p1.name_th
               ELSE NULL END,
          CASE WHEN ol0.level_no = 4 THEN phorg.name_th
               ELSE NULL END,
          v_fallback_bureau
        ),
        '-'
      )
      INTO v_initial_pos_display
      FROM (SELECT 1) _dummy
      LEFT JOIN public.position_types pht ON pht.id = v_initial_pos.position_type_id
      LEFT JOIN public.positions php ON php.id = v_initial_pos.position_id
      LEFT JOIN public.position_levels phl ON phl.id = v_initial_pos.position_level_id
      LEFT JOIN public.org_units phorg ON phorg.id = v_initial_pos.org_unit_id
      LEFT JOIN public.org_unit_levels ol0 ON ol0.id = phorg.level_id
      LEFT JOIN public.org_units p1 ON p1.id = phorg.parent_id
      LEFT JOIN public.org_unit_levels ol1 ON ol1.id = p1.level_id
      LEFT JOIN public.org_units p2 ON p2.id = p1.parent_id
      LEFT JOIN public.org_unit_levels ol2 ON ol2.id = p2.level_id
      LEFT JOIN public.org_units p3 ON p3.id = p2.parent_id
      LEFT JOIN public.org_unit_levels ol3 ON ol3.id = p3.level_id;

      UPDATE public.personnel_career_records SET
        initial_position_type_id = v_initial_pos.position_type_id,
        initial_position_id = v_initial_pos.position_id,
        initial_position_level_id = v_initial_pos.position_level_id,
        initial_position = COALESCE(v_initial_pos_display, v_initial_pos.position_title_snapshot),
        updated_by = auth.uid()
      WHERE personnel_id = v_pid;
    END IF;
  END IF;

  -- Guard 2: Executive Duties -> secondary_position & acting_position (ordered by sort_order ASC)
  IF EXISTS (SELECT 1 FROM public.personnel_executive_duties WHERE personnel_id = v_pid) THEN
    SELECT string_agg(
      NULLIF(
        public.fn_format_position_display(
          pos.name_th, pl.name_th, edpt.code, edpt.name_th,
          edb.name_th, edo.name_th, edd.name_th, edv.name_th, v_fallback_bureau
        ),
        '-'
      ),
      ', ' ORDER BY ed.sort_order ASC, ed.effective_date DESC NULLS LAST, ed.created_at DESC
    )
    INTO v_deputizing_summary
    FROM public.personnel_executive_duties ed
    LEFT JOIN public.position_types edpt ON edpt.id = ed.position_type_id
    LEFT JOIN public.positions pos ON pos.id = ed.position_id
    LEFT JOIN public.position_levels pl ON pl.id = ed.position_level_id
    LEFT JOIN public.org_units edb ON edb.id = ed.bureau_id
    LEFT JOIN public.org_units edo ON edo.id = ed.office_id
    LEFT JOIN public.org_units edd ON edd.id = ed.department_id
    LEFT JOIN public.org_units edv ON edv.id = ed.division_id
    WHERE ed.personnel_id = v_pid
      AND ed.duty_type = 'DEPUTIZING'
      AND ed.end_date IS NULL;

    SELECT string_agg(
      NULLIF(
        public.fn_format_position_display(
          pos.name_th, pl.name_th, edpt.code, edpt.name_th,
          edb.name_th, edo.name_th, edd.name_th, edv.name_th, v_fallback_bureau
        ),
        '-'
      ),
      ', ' ORDER BY ed.sort_order ASC, ed.effective_date DESC NULLS LAST, ed.created_at DESC
    )
    INTO v_acting_summary
    FROM public.personnel_executive_duties ed
    LEFT JOIN public.position_types edpt ON edpt.id = ed.position_type_id
    LEFT JOIN public.positions pos ON pos.id = ed.position_id
    LEFT JOIN public.position_levels pl ON pl.id = ed.position_level_id
    LEFT JOIN public.org_units edb ON edb.id = ed.bureau_id
    LEFT JOIN public.org_units edo ON edo.id = ed.office_id
    LEFT JOIN public.org_units edd ON edd.id = ed.department_id
    LEFT JOIN public.org_units edv ON edv.id = ed.division_id
    WHERE ed.personnel_id = v_pid
      AND ed.duty_type = 'ACTING'
      AND ed.end_date IS NULL;

    UPDATE public.personnel_assignments SET
      secondary_position = NULLIF(trim(COALESCE(v_deputizing_summary, '')), ''),
      acting_position = NULLIF(trim(COALESCE(v_acting_summary, '')), ''),
      updated_by = auth.uid()
    WHERE personnel_id = v_pid;
  END IF;

  -- Guard 3: Salary History -> personnel_career_records (top sort_order = latest)
  SELECT sh.*
  INTO v_latest_sal
  FROM public.personnel_salary_history sh
  WHERE sh.personnel_id = v_pid
  ORDER BY sh.sort_order ASC, sh.effective_date DESC, sh.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.personnel_career_records SET
      current_salary = v_latest_sal.base_salary,
      position_allowance = COALESCE(v_latest_sal.position_allowance, 0),
      is_max_step = COALESCE(v_latest_sal.is_max_step, false),
      updated_by = auth.uid()
    WHERE personnel_id = v_pid;
  END IF;

  -- Guard 4: Disciplinary Records -> disciplinary_flag & disciplinary_note (ordered by sort_order ASC)
  IF EXISTS (SELECT 1 FROM public.personnel_disciplinary_records WHERE personnel_id = v_pid) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.personnel_disciplinary_records dr
      JOIN public.lookup_items li ON li.id = dr.case_status_id
      WHERE dr.personnel_id = v_pid
        AND li.code IN ('ONGOING', 'CLOSED_GUILTY')
    ) INTO v_has_active_disc;

    SELECT string_agg(
      concat_ws(' — ',
        rt.name_th,
        pl.name_th,
        cs.name_th,
        NULLIF(trim(dr.remark), '')
      ),
      '; ' ORDER BY dr.sort_order ASC, dr.effective_date DESC, dr.created_at DESC
    )
    INTO v_disc_summary
    FROM public.personnel_disciplinary_records dr
    JOIN public.lookup_items cs ON cs.id = dr.case_status_id
    LEFT JOIN public.lookup_items rt ON rt.id = dr.record_type_id
    LEFT JOIN public.lookup_items pl ON pl.id = dr.penalty_level_id
    WHERE dr.personnel_id = v_pid
      AND cs.code IN ('ONGOING', 'CLOSED_GUILTY');

    UPDATE public.personnel_career_records SET
      disciplinary_flag = v_has_active_disc,
      disciplinary_note = CASE
        WHEN v_has_active_disc THEN NULLIF(trim(COALESCE(v_disc_summary, '')), '')
        ELSE NULL
      END,
      updated_by = auth.uid()
    WHERE personnel_id = v_pid;
  END IF;

  RETURN v_pid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_save_personnel_bundle(jsonb) TO authenticated;

-- 7.4 fn_schema_health() — 33 Active Tables + 4 GAS Drive Folders (incl. logo_folder) + row_counts
CREATE OR REPLACE FUNCTION public.fn_schema_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected text[] := ARRAY[
    'lookup_categories', 'lookup_items', 'org_unit_levels', 'org_units',
    'position_types', 'positions', 'position_levels', 'position_allowed_levels',
    'personnel', 'personnel_assignments', 'personnel_career_records',
    'personnel_name_history', 'personnel_position_history', 'personnel_executive_duties',
    'personnel_salary_history', 'personnel_evaluations',
    'personnel_disciplinary_records', 'personnel_service_interruptions',
    'users', 'user_admin_scopes', 'api_scope_catalog',
    'webapps', 'webapp_roles', 'webapp_scopes',
    'webapp_allowed_origins', 'user_app_permissions', 'security_tokens',
    'credential_reset_requests', 'system_settings', 'import_jobs',
    'import_job_errors', 'audit_logs', 'login_attempts'
  ];
  v_missing text[];
  v_rls_off text[];
  v_views_count integer;
  v_funcs_count integer;
  v_status text := 'OK';
  v_gas_url text;
  v_img_dir text;
  v_sig_dir text;
  v_doc_dir text;
  v_logo_dir text;
BEGIN
  IF public.fn_current_user_role() <> 'SUPERADMIN' THEN
    RAISE EXCEPTION 'Only SUPERADMIN can run schema health diagnostics';
  END IF;

  SELECT COALESCE(array_agg(t), ARRAY[]::text[]) INTO v_missing
  FROM unnest(v_expected) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = t
  );

  SELECT COALESCE(array_agg(c.relname), ARRAY[]::text[]) INTO v_rls_off
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY(v_expected)
    AND c.relrowsecurity = false;

  SELECT count(*)::integer INTO v_views_count
  FROM information_schema.views
  WHERE table_schema = 'public' AND table_name LIKE 'v_%';

  SELECT count(*)::integer INTO v_funcs_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'fn_%';

  SELECT value INTO v_gas_url FROM public.system_settings WHERE key = 'google_drive_script_url';
  SELECT value INTO v_img_dir FROM public.system_settings WHERE key = 'google_drive_image_folder_id';
  SELECT value INTO v_sig_dir FROM public.system_settings WHERE key = 'google_drive_signature_folder_id';
  SELECT value INTO v_doc_dir FROM public.system_settings WHERE key = 'google_drive_document_folder_id';
  SELECT value INTO v_logo_dir FROM public.system_settings WHERE key = 'google_drive_logo_folder_id';

  IF array_length(v_missing, 1) > 0 OR array_length(v_rls_off, 1) > 0 THEN
    v_status := 'ERROR';
  ELSIF COALESCE(trim(v_gas_url), '') = ''
     OR COALESCE(trim(v_img_dir), '') = ''
     OR COALESCE(trim(v_sig_dir), '') = ''
     OR COALESCE(trim(v_doc_dir), '') = ''
     OR COALESCE(trim(v_logo_dir), '') = '' THEN
    v_status := 'WARNING';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'schema_name', 'public',
    'checked_at', now(),
    'tables_expected', array_length(v_expected, 1),
    'tables_found', array_length(v_expected, 1) - COALESCE(array_length(v_missing, 1), 0),
    'missing_tables', to_jsonb(v_missing),
    'rls_disabled_tables', to_jsonb(v_rls_off),
    'views_found', v_views_count,
    'functions_found', v_funcs_count,
    'gas_drive_configured', jsonb_build_object(
      'script_url', COALESCE(trim(v_gas_url), '') <> '',
      'image_folder', COALESCE(trim(v_img_dir), '') <> '',
      'signature_folder', COALESCE(trim(v_sig_dir), '') <> '',
      'document_folder', COALESCE(trim(v_doc_dir), '') <> '',
      'logo_folder', COALESCE(trim(v_logo_dir), '') <> ''
    ),
    'row_counts', jsonb_build_object(
      'personnel', (SELECT count(*)::integer FROM public.personnel),
      'users', (SELECT count(*)::integer FROM public.users),
      'webapps', (SELECT count(*)::integer FROM public.webapps),
      'org_units', (SELECT count(*)::integer FROM public.org_units),
      'positions', (SELECT count(*)::integer FROM public.positions),
      'lookup_items', (SELECT count(*)::integer FROM public.lookup_items)
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_schema_health() TO authenticated;

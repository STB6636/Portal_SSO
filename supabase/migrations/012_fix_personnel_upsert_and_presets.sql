-- =============================================================================
-- Migration 012: Fix Personnel Upsert Partial-Key Preservation, View Columns & Scope Preset Items
-- =============================================================================

-- 1. Update fn_save_personnel_bundle:
--    - Enforce non-blank first_name / last_name
--    - Preserve photo_path, signature_path, current_position_date, current_level_date,
--      disciplinary_flag, disciplinary_note when keys are omitted from JSONB payload (safe for Edit & UPSERT)
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
  v_f jsonb := COALESCE(p_payload->'fleet', '{}'::jsonb);
  v_c jsonb := COALESCE(p_payload->'career', '{}'::jsonb);
  v_decs jsonb := p_payload->'decorations';
  v_pid uuid := NULLIF(v_p->>'id', '')::uuid;
  v_cid text := regexp_replace(COALESCE(v_p->>'cid', ''), '[\s-]', '', 'g');
  v_first_name text := NULLIF(trim(COALESCE(v_p->>'first_name', '')), '');
  v_last_name text := NULLIF(trim(COALESCE(v_p->>'last_name', '')), '');
  v_office_id uuid := NULLIF(v_a->>'office_id', '')::uuid;
  v_dept_id uuid := NULLIF(v_a->>'department_id', '')::uuid;
  v_dec jsonb;
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

  IF v_pid IS NULL THEN
    INSERT INTO public.personnel (
      personnel_code, cid, prefix_id, noble_or_rank_title, first_name, last_name,
      gender_id, birth_date, phone_number, email, photo_path, signature_path, status_id,
      created_by, updated_by
    ) VALUES (
      NULLIF(trim(v_p->>'personnel_code'), ''),
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
      personnel_code = NULLIF(trim(v_p->>'personnel_code'), ''),
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

  INSERT INTO public.personnel_fleet_profiles (
    personnel_id, is_driver, driver_status_id, has_position_vehicle, updated_by
  ) VALUES (
    v_pid,
    COALESCE((v_f->>'is_driver')::boolean, false),
    NULLIF(v_f->>'driver_status_id', '')::uuid,
    COALESCE((v_f->>'has_position_vehicle')::boolean, false),
    auth.uid()
  )
  ON CONFLICT (personnel_id) DO UPDATE SET
    is_driver = EXCLUDED.is_driver,
    driver_status_id = EXCLUDED.driver_status_id,
    has_position_vehicle = EXCLUDED.has_position_vehicle,
    updated_by = auth.uid();

  INSERT INTO public.personnel_career_records (
    personnel_id, start_service_date, start_service_year_be, initial_position,
    initial_salary, current_salary, retro_salary_5y, disciplinary_flag, disciplinary_note, updated_by
  ) VALUES (
    v_pid,
    NULLIF(v_c->>'start_service_date', '')::date,
    NULLIF(v_c->>'start_service_year_be', '')::smallint,
    NULLIF(trim(v_c->>'initial_position'), ''),
    NULLIF(v_c->>'initial_salary', '')::numeric,
    NULLIF(v_c->>'current_salary', '')::numeric,
    NULLIF(v_c->>'retro_salary_5y', '')::numeric,
    COALESCE((v_c->>'disciplinary_flag')::boolean, false),
    NULLIF(trim(v_c->>'disciplinary_note'), ''),
    auth.uid()
  )
  ON CONFLICT (personnel_id) DO UPDATE SET
    start_service_date = EXCLUDED.start_service_date,
    start_service_year_be = EXCLUDED.start_service_year_be,
    initial_position = EXCLUDED.initial_position,
    initial_salary = EXCLUDED.initial_salary,
    current_salary = EXCLUDED.current_salary,
    retro_salary_5y = EXCLUDED.retro_salary_5y,
    disciplinary_flag = CASE
      WHEN v_c ? 'disciplinary_flag' THEN EXCLUDED.disciplinary_flag
      ELSE public.personnel_career_records.disciplinary_flag
    END,
    disciplinary_note = CASE
      WHEN v_c ? 'disciplinary_note' THEN EXCLUDED.disciplinary_note
      ELSE public.personnel_career_records.disciplinary_note
    END,
    updated_by = auth.uid();

  IF v_decs IS NOT NULL AND jsonb_typeof(v_decs) = 'array' THEN
    DELETE FROM public.personnel_decorations WHERE personnel_id = v_pid;
    FOR v_dec IN SELECT * FROM jsonb_array_elements(v_decs) LOOP
      IF NULLIF(v_dec->>'decoration_class_id', '') IS NOT NULL AND NULLIF(v_dec->>'received_year_be', '') IS NOT NULL THEN
        INSERT INTO public.personnel_decorations (
          personnel_id, decoration_class_id, received_year_be, gazette_ref, note, created_by
        ) VALUES (
          v_pid,
          (v_dec->>'decoration_class_id')::uuid,
          (v_dec->>'received_year_be')::smallint,
          NULLIF(trim(v_dec->>'gazette_ref'), ''),
          NULLIF(trim(v_dec->>'note'), ''),
          auth.uid()
        );
      END IF;
    END LOOP;
  END IF;

  RETURN v_pid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_save_personnel_bundle(jsonb) TO authenticated;

-- 2. Append current_position_date & current_level_date at the END of v_personnel_directory
--    (Preserves exact column positions 1..60 so all 5 dependent views remain untouched)
CREATE OR REPLACE VIEW public.v_personnel_directory
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.personnel_code,
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
  pt.name_th AS position_type_name,
  pa.position_id,
  pos.name_th AS position_name,
  pa.position_level_id,
  pl.name_th AS position_level_name,
  pa.position_number,
  pa.secondary_position,
  pa.acting_position,
  pa.bureau_id,
  ob.name_th AS bureau_name,
  pa.office_id,
  oo.name_th AS office_name,
  pa.department_id,
  od.name_th AS department_name,
  pa.division_id,
  ov.name_th AS division_name,
  pa.approval_tier_id,
  la.name_th AS approval_tier_name,
  COALESCE(pf.is_driver, false) AS is_driver,
  pf.driver_status_id,
  ld.name_th AS driver_status_name,
  COALESCE(pf.has_position_vehicle, false) AS has_position_vehicle,
  pc.start_service_date,
  pc.start_service_year_be,
  pc.initial_position,
  pc.initial_salary,
  pc.current_salary,
  pc.retro_salary_5y,
  COALESCE(pc.disciplinary_flag, false) AS disciplinary_flag,
  pc.disciplinary_note,
  (u.id IS NOT NULL) AS has_user_account,
  u.id AS user_id,
  u.role AS user_role,
  u.status AS user_status,
  pa.current_position_date,
  pa.current_level_date
FROM public.personnel p
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
LEFT JOIN public.personnel_fleet_profiles pf ON pf.personnel_id = p.id
LEFT JOIN public.lookup_items ld ON ld.id = pf.driver_status_id
LEFT JOIN public.personnel_career_records pc ON pc.personnel_id = p.id
LEFT JOIN public.users u ON u.personnel_id = p.id;

-- 3. Seed webapp_scope_preset_items idempotently (fixes empty presets in WebappConfigModal)
DO $$
DECLARE
  v_preset uuid;
BEGIN
  SELECT id INTO v_preset FROM public.webapp_scope_presets WHERE code = 'ROYAL_DEC';
  IF v_preset IS NOT NULL THEN
    INSERT INTO public.webapp_scope_preset_items (preset_id, scope_code) VALUES
      (v_preset, 'permission:read'),
      (v_preset, 'reference:read'),
      (v_preset, 'position:read'),
      (v_preset, 'personnel:read'),
      (v_preset, 'personnel:career'),
      (v_preset, 'personnel:sensitive')
    ON CONFLICT (preset_id, scope_code) DO NOTHING;
  END IF;

  SELECT id INTO v_preset FROM public.webapp_scope_presets WHERE code = 'VEHICLE_TAX';
  IF v_preset IS NOT NULL THEN
    INSERT INTO public.webapp_scope_preset_items (preset_id, scope_code) VALUES
      (v_preset, 'permission:read'),
      (v_preset, 'reference:read'),
      (v_preset, 'personnel:read'),
      (v_preset, 'personnel:signature')
    ON CONFLICT (preset_id, scope_code) DO NOTHING;
  END IF;

  SELECT id INTO v_preset FROM public.webapp_scope_presets WHERE code = 'CAR_REQUEST';
  IF v_preset IS NOT NULL THEN
    INSERT INTO public.webapp_scope_preset_items (preset_id, scope_code) VALUES
      (v_preset, 'permission:read'),
      (v_preset, 'reference:read'),
      (v_preset, 'position:read'),
      (v_preset, 'personnel:read'),
      (v_preset, 'personnel:signature')
    ON CONFLICT (preset_id, scope_code) DO NOTHING;
  END IF;
END $$;

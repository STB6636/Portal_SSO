-- =============================================================================
-- Migration 018: Position History Salary & Allowance + KP.7 v2.7.0 Compliance
-- Portal SSO v2.6.0 -> v2.7.0
-- Honors User Checkpoints:
--   - C2-B: Add ONLY `base_salary` and `position_allowance` to
--           `public.personnel_position_history` (no extra columns/seeds).
--   - C6-A: Keep `public.personnel_salary_history` intact, and perform a
--           one-time deterministic backfill into `personnel_position_history`
--           where `personnel_id` + `effective_date` match and `base_salary IS NULL`.
-- =============================================================================

-- 1. Add base_salary & position_allowance columns to public.personnel_position_history
ALTER TABLE public.personnel_position_history
  ADD COLUMN IF NOT EXISTS base_salary numeric(12,2),
  ADD COLUMN IF NOT EXISTS position_allowance numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.personnel_position_history.base_salary IS
  'อัตราเงินเดือน ณ วันที่มีผลของตำแหน่งนี้ (สำหรับแบบฟอร์ม ก.พ. ๗ ข้อ ๑๔)';
COMMENT ON COLUMN public.personnel_position_history.position_allowance IS
  'เงินประจำตำแหน่ง ณ วันที่มีผลของตำแหน่งนี้ (บาท/เดือน, ค่าเริ่มต้น 0)';

-- 2. Deterministic one-time backfill from personnel_salary_history (C6-A)
WITH latest_salary_per_date AS (
  SELECT DISTINCT ON (personnel_id, effective_date)
    personnel_id,
    effective_date,
    base_salary,
    position_allowance
  FROM public.personnel_salary_history
  ORDER BY personnel_id, effective_date, sort_order ASC, created_at DESC
)
UPDATE public.personnel_position_history ph
SET
  base_salary = sh.base_salary,
  position_allowance = COALESCE(sh.position_allowance, 0)
FROM latest_salary_per_date sh
WHERE ph.personnel_id = sh.personnel_id
  AND ph.effective_date = sh.effective_date
  AND ph.base_salary IS NULL;

-- 3. Recreate v_decoration_hr_source with base_salary & position_allowance inside position_history JSONB
DROP VIEW IF EXISTS public.v_decoration_hr_source;

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
        'base_salary', ph.base_salary,
        'position_allowance', ph.position_allowance,
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
        'document_ref', dr.document_ref,
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

-- 4. Upgrade fn_save_personnel_bundle(jsonb) to persist base_salary & position_allowance in Timeline 2
--    and fall back to latest position's salary/allowance in Guard 3 if salary_history is empty
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
  v_edus jsonb := p_payload->'educations';
  v_lics jsonb := p_payload->'licenses';
  v_trains jsonb := p_payload->'trainings';
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
  v_has_latest_pos boolean := false;
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
      father_full_name, mother_full_name, mother_maiden_name, spouse_full_name, spouse_maiden_name,
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
      NULLIF(trim(v_p->>'father_full_name'), ''),
      NULLIF(trim(v_p->>'mother_full_name'), ''),
      NULLIF(trim(v_p->>'mother_maiden_name'), ''),
      NULLIF(trim(v_p->>'spouse_full_name'), ''),
      NULLIF(trim(v_p->>'spouse_maiden_name'), ''),
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
      father_full_name = CASE WHEN v_p ? 'father_full_name' THEN NULLIF(trim(v_p->>'father_full_name'), '') ELSE father_full_name END,
      mother_full_name = CASE WHEN v_p ? 'mother_full_name' THEN NULLIF(trim(v_p->>'mother_full_name'), '') ELSE mother_full_name END,
      mother_maiden_name = CASE WHEN v_p ? 'mother_maiden_name' THEN NULLIF(trim(v_p->>'mother_maiden_name'), '') ELSE mother_maiden_name END,
      spouse_full_name = CASE WHEN v_p ? 'spouse_full_name' THEN NULLIF(trim(v_p->>'spouse_full_name'), '') ELSE spouse_full_name END,
      spouse_maiden_name = CASE WHEN v_p ? 'spouse_maiden_name' THEN NULLIF(trim(v_p->>'spouse_maiden_name'), '') ELSE spouse_maiden_name END,
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

  -- Timeline 2: Position History (with base_salary, position_allowance, sort_order & exclusive is_latest / is_initial)
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
          position_title_snapshot, org_unit_id, effective_date, end_date,
          base_salary, position_allowance, order_reference,
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
          NULLIF(v_item->>'base_salary', '')::numeric,
          COALESCE(NULLIF(v_item->>'position_allowance', '')::numeric, 0),
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

  -- Timeline 5: Disciplinary Records (with document_ref & sort_order)
  IF p_payload ? 'disciplinary_records' AND v_disc IS NOT NULL AND jsonb_typeof(v_disc) = 'array' THEN
    DELETE FROM public.personnel_disciplinary_records WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_disc) LOOP
      IF NULLIF(v_item->>'record_type_id', '') IS NOT NULL
         AND NULLIF(v_item->>'case_status_id', '') IS NOT NULL
         AND NULLIF(v_item->>'effective_date', '') IS NOT NULL THEN
        v_idx := v_idx + 1;
        INSERT INTO public.personnel_disciplinary_records (
          personnel_id, record_type_id, penalty_level_id, case_status_id, effective_date, resolved_date, document_ref, remark, sort_order
        ) VALUES (
          v_pid,
          (v_item->>'record_type_id')::uuid,
          NULLIF(v_item->>'penalty_level_id', '')::uuid,
          (v_item->>'case_status_id')::uuid,
          (v_item->>'effective_date')::date,
          NULLIF(v_item->>'resolved_date', '')::date,
          NULLIF(trim(v_item->>'document_ref'), ''),
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

  -- Timeline 7 (KP7 Item 10): Educations (key-safe)
  IF p_payload ? 'educations' AND v_edus IS NOT NULL AND jsonb_typeof(v_edus) = 'array' THEN
    DELETE FROM public.personnel_educations WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_edus) LOOP
      IF NULLIF(trim(COALESCE(v_item->>'institution_name', '')), '') IS NOT NULL
         AND NULLIF(trim(COALESCE(v_item->>'degree_title', '')), '') IS NOT NULL THEN
        v_idx := v_idx + 1;
        INSERT INTO public.personnel_educations (
          personnel_id, institution_name, start_period, end_period, degree_title, major_name, sort_order
        ) VALUES (
          v_pid,
          trim(v_item->>'institution_name'),
          NULLIF(trim(v_item->>'start_period'), ''),
          NULLIF(trim(v_item->>'end_period'), ''),
          trim(v_item->>'degree_title'),
          NULLIF(trim(v_item->>'major_name'), ''),
          COALESCE(NULLIF(v_item->>'sort_order', '')::integer, v_idx)
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 8 (KP7 Item 11): Professional Licenses (key-safe)
  IF p_payload ? 'licenses' AND v_lics IS NOT NULL AND jsonb_typeof(v_lics) = 'array' THEN
    DELETE FROM public.personnel_licenses WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_lics) LOOP
      IF NULLIF(trim(COALESCE(v_item->>'license_name', '')), '') IS NOT NULL THEN
        v_idx := v_idx + 1;
        INSERT INTO public.personnel_licenses (
          personnel_id, license_name, issuing_agency, license_number, effective_date, sort_order
        ) VALUES (
          v_pid,
          trim(v_item->>'license_name'),
          NULLIF(trim(v_item->>'issuing_agency'), ''),
          NULLIF(trim(v_item->>'license_number'), ''),
          NULLIF(v_item->>'effective_date', '')::date,
          COALESCE(NULLIF(v_item->>'sort_order', '')::integer, v_idx)
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 9 (KP7 Item 12): Trainings & Seminars (key-safe)
  IF p_payload ? 'trainings' AND v_trains IS NOT NULL AND jsonb_typeof(v_trains) = 'array' THEN
    DELETE FROM public.personnel_trainings WHERE personnel_id = v_pid;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_trains) LOOP
      IF NULLIF(trim(COALESCE(v_item->>'course_name', '')), '') IS NOT NULL THEN
        v_idx := v_idx + 1;
        INSERT INTO public.personnel_trainings (
          personnel_id, course_name, start_date, end_date, organizer_name, sort_order
        ) VALUES (
          v_pid,
          trim(v_item->>'course_name'),
          NULLIF(v_item->>'start_date', '')::date,
          NULLIF(v_item->>'end_date', '')::date,
          NULLIF(trim(v_item->>'organizer_name'), ''),
          COALESCE(NULLIF(v_item->>'sort_order', '')::integer, v_idx)
        );
      END IF;
    END LOOP;
  END IF;

  -- ===========================================================================
  -- AUTHORITATIVE HISTORY -> PARENT AUTO-SYNC
  -- ===========================================================================

  -- Guard 1A: Latest Position -> personnel_assignments
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
    v_has_latest_pos := true;
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

    -- Guard 1B: Initial Position -> personnel_career_records
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

  -- Guard 2: Executive Duties -> secondary_position & acting_position
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

  -- Guard 3: Salary History -> personnel_career_records (fallback to latest position salary if salary_history is empty)
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
  ELSIF v_has_latest_pos AND v_latest_pos.base_salary IS NOT NULL THEN
    UPDATE public.personnel_career_records SET
      current_salary = v_latest_pos.base_salary,
      position_allowance = COALESCE(v_latest_pos.position_allowance, 0),
      updated_by = auth.uid()
    WHERE personnel_id = v_pid;
  END IF;

  -- Guard 4: Disciplinary Records -> disciplinary_flag & disciplinary_note
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

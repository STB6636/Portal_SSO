-- =============================================================================
-- Migration 013: BMA HR Core & Royal Decoration Readiness (31 -> 37 Tables)
-- - Expands 4 existing tables with non-destructive ADD COLUMN IF NOT EXISTS
-- - Creates 6 Effective-Dated Timeline tables with Scoped RLS & updated_at trigger
-- - Appends new columns to v_personnel_directory (preserves positions 1..60)
-- - Creates read-only contract view v_decoration_hr_source (security_invoker)
-- - Upgrades fn_save_personnel_bundle (JSONB ? key-safe for all new fields/timelines)
-- - Upgrades fn_schema_health (37 expected tables)
-- - Seeds BMA standard master data idempotently (ON CONFLICT DO NOTHING)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Expand 4 existing tables (Non-destructive, Idempotent)
-- -----------------------------------------------------------------------------
ALTER TABLE public.personnel
  ADD COLUMN IF NOT EXISTS status_effective_date date,
  ADD COLUMN IF NOT EXISTS line_user_id text;

ALTER TABLE public.personnel_assignments
  ADD COLUMN IF NOT EXISTS legacy_c_level text,
  ADD COLUMN IF NOT EXISTS employee_group_id uuid REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS is_bma_permanent_secretary boolean NOT NULL DEFAULT false;

ALTER TABLE public.personnel_career_records
  ADD COLUMN IF NOT EXISTS re_appointment_date date,
  ADD COLUMN IF NOT EXISTS transfer_in_date date,
  ADD COLUMN IF NOT EXISTS prior_continuous_service_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS double_service_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position_allowance numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS academic_allowance numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_max_step boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_career_prior_days_nonneg') THEN
    ALTER TABLE public.personnel_career_records
      ADD CONSTRAINT chk_career_prior_days_nonneg CHECK (prior_continuous_service_days >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_career_double_days_nonneg') THEN
    ALTER TABLE public.personnel_career_records
      ADD CONSTRAINT chk_career_double_days_nonneg CHECK (double_service_days >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_career_pos_allowance_nonneg') THEN
    ALTER TABLE public.personnel_career_records
      ADD CONSTRAINT chk_career_pos_allowance_nonneg CHECK (position_allowance >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_career_acad_allowance_nonneg') THEN
    ALTER TABLE public.personnel_career_records
      ADD CONSTRAINT chk_career_acad_allowance_nonneg CHECK (academic_allowance >= 0);
  END IF;
END $$;

ALTER TABLE public.personnel_decorations
  ADD COLUMN IF NOT EXISTS award_date date,
  ADD COLUMN IF NOT EXISTS account_type_used text,
  ADD COLUMN IF NOT EXISTS nomination_basis text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS return_status text;

-- -----------------------------------------------------------------------------
-- 2. Create 6 Effective-Dated Timeline Tables (Tables 32-37)
-- -----------------------------------------------------------------------------

-- 32. personnel_name_history
CREATE TABLE IF NOT EXISTS public.personnel_name_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_id uuid NOT NULL REFERENCES public.personnel(id) ON DELETE CASCADE,
  old_prefix text,
  old_first_name text NOT NULL,
  old_last_name text NOT NULL,
  changed_date date NOT NULL,
  document_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_name_history_person_date
  ON public.personnel_name_history(personnel_id, changed_date DESC);

-- 33. personnel_position_history
CREATE TABLE IF NOT EXISTS public.personnel_position_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_id uuid NOT NULL REFERENCES public.personnel(id) ON DELETE CASCADE,
  position_number text,
  position_type_id uuid REFERENCES public.position_types(id) ON DELETE RESTRICT,
  position_id uuid REFERENCES public.positions(id) ON DELETE RESTRICT,
  position_level_id uuid REFERENCES public.position_levels(id) ON DELETE RESTRICT,
  position_title_snapshot text,
  legacy_c_level text,
  employee_group_id uuid REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  is_bma_permanent_secretary boolean NOT NULL DEFAULT false,
  org_unit_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  effective_date date NOT NULL,
  end_date date,
  order_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_history_person_date
  ON public.personnel_position_history(personnel_id, effective_date DESC);

-- 34. personnel_salary_history
CREATE TABLE IF NOT EXISTS public.personnel_salary_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_id uuid NOT NULL REFERENCES public.personnel(id) ON DELETE CASCADE,
  base_salary numeric(12, 2) NOT NULL CHECK (base_salary >= 0),
  position_allowance numeric(12, 2) NOT NULL DEFAULT 0 CHECK (position_allowance >= 0),
  academic_allowance numeric(12, 2) NOT NULL DEFAULT 0 CHECK (academic_allowance >= 0),
  is_max_step boolean NOT NULL DEFAULT false,
  effective_date date NOT NULL,
  order_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_history_person_date
  ON public.personnel_salary_history(personnel_id, effective_date DESC);

-- 35. personnel_evaluations
CREATE TABLE IF NOT EXISTS public.personnel_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_id uuid NOT NULL REFERENCES public.personnel(id) ON DELETE CASCADE,
  fiscal_year_be smallint NOT NULL CHECK (fiscal_year_be BETWEEN 2450 AND 2700),
  eval_round smallint NOT NULL CHECK (eval_round IN (1, 2)),
  score_percent numeric(5, 2) CHECK (score_percent IS NULL OR (score_percent >= 0 AND score_percent <= 100)),
  eval_grade_id uuid NOT NULL REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (personnel_id, fiscal_year_be, eval_round)
);
CREATE INDEX IF NOT EXISTS idx_evaluations_person_year
  ON public.personnel_evaluations(personnel_id, fiscal_year_be DESC, eval_round DESC);

-- 36. personnel_disciplinary_records
CREATE TABLE IF NOT EXISTS public.personnel_disciplinary_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_id uuid NOT NULL REFERENCES public.personnel(id) ON DELETE CASCADE,
  record_type_id uuid NOT NULL REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  penalty_level_id uuid REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  case_status_id uuid NOT NULL REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  effective_date date NOT NULL,
  resolved_date date,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discipline_person_status
  ON public.personnel_disciplinary_records(personnel_id, case_status_id);

DROP TRIGGER IF EXISTS trg_touch_personnel_disciplinary_records ON public.personnel_disciplinary_records;
CREATE TRIGGER trg_touch_personnel_disciplinary_records
  BEFORE UPDATE ON public.personnel_disciplinary_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

-- 37. personnel_service_interruptions
CREATE TABLE IF NOT EXISTS public.personnel_service_interruptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_id uuid NOT NULL REFERENCES public.personnel(id) ON DELETE CASCADE,
  interruption_type_id uuid NOT NULL REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date,
  deductible_days integer NOT NULL DEFAULT 0 CHECK (deductible_days >= 0),
  remark text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_interruptions_person_date
  ON public.personnel_service_interruptions(personnel_id, start_date DESC);

-- -----------------------------------------------------------------------------
-- 3. Enable Scoped RLS on all 6 new Timeline Tables
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'personnel_name_history',
    'personnel_position_history',
    'personnel_salary_history',
    'personnel_evaluations',
    'personnel_disciplinary_records',
    'personnel_service_interruptions'
  ]
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role;', v_tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS "scoped_select_%s" ON public.%I;', v_tbl, v_tbl);
    EXECUTE format(
      'CREATE POLICY "scoped_select_%s" ON public.%I FOR SELECT TO authenticated USING (public.fn_is_personnel_in_my_scope(personnel_id));',
      v_tbl, v_tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS "scoped_write_%s" ON public.%I;', v_tbl, v_tbl);
    EXECUTE format(
      'CREATE POLICY "scoped_write_%s" ON public.%I FOR ALL TO authenticated USING (public.fn_current_user_role() IN (''SUPERADMIN'',''ADMIN'') AND public.fn_is_personnel_in_my_scope(personnel_id)) WITH CHECK (public.fn_current_user_role() IN (''SUPERADMIN'',''ADMIN'') AND public.fn_is_personnel_in_my_scope(personnel_id));',
      v_tbl, v_tbl
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Upgrade v_personnel_directory (APPEND-ONLY after pa.current_level_date)
--    Preserves exact column positions 1..60 so all dependent views remain valid
-- -----------------------------------------------------------------------------
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
  pa.current_level_date,
  -- Appended columns (Migration 013)
  p.status_effective_date,
  p.line_user_id,
  pa.legacy_c_level,
  pa.employee_group_id,
  leg.name_th AS employee_group_name,
  COALESCE(pa.is_bma_permanent_secretary, false) AS is_bma_permanent_secretary,
  pc.re_appointment_date,
  pc.transfer_in_date,
  COALESCE(pc.prior_continuous_service_days, 0) AS prior_continuous_service_days,
  COALESCE(pc.double_service_days, 0) AS double_service_days,
  COALESCE(pc.position_allowance, 0)::numeric(12, 2) AS position_allowance,
  COALESCE(pc.academic_allowance, 0)::numeric(12, 2) AS academic_allowance,
  COALESCE(pc.is_max_step, false) AS is_max_step
FROM public.personnel p
LEFT JOIN public.lookup_items lp ON lp.id = p.prefix_id
LEFT JOIN public.lookup_items lg ON lg.id = p.gender_id
LEFT JOIN public.lookup_items ls ON ls.id = p.status_id
LEFT JOIN public.personnel_assignments pa ON pa.personnel_id = p.id
LEFT JOIN public.lookup_items le ON le.id = pa.employment_type_id
LEFT JOIN public.lookup_items leg ON leg.id = pa.employee_group_id
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

-- Keep v_personnel_royal_dec backward-compatible while enriching decoration JSONB entries
CREATE OR REPLACE VIEW public.v_personnel_royal_dec
WITH (security_invoker = true) AS
SELECT
  d.id,
  d.personnel_code,
  d.cid,
  d.full_name,
  d.birth_date,
  d.position_type_name,
  d.position_name,
  d.position_level_name,
  d.office_name,
  d.department_name,
  d.start_service_date,
  d.start_service_year_be,
  d.initial_position,
  d.initial_salary,
  d.current_salary,
  d.retro_salary_5y,
  d.disciplinary_flag,
  d.disciplinary_note,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', pd.id,
        'decoration_class_id', pd.decoration_class_id,
        'code', dc.code,
        'name_th', dc.name_th,
        'rank_order', dc.rank_order,
        'received_year_be', pd.received_year_be,
        'award_date', pd.award_date,
        'account_type_used', pd.account_type_used,
        'nomination_basis', pd.nomination_basis,
        'return_status', pd.return_status,
        'gazette_ref', pd.gazette_ref,
        'note', pd.note
      ) ORDER BY pd.received_year_be DESC, dc.rank_order DESC
    )
    FROM public.personnel_decorations pd
    JOIN public.decoration_classes dc ON dc.id = pd.decoration_class_id
    WHERE pd.personnel_id = d.id),
    '[]'::jsonb
  ) AS decorations
FROM public.v_personnel_directory d;

-- -----------------------------------------------------------------------------
-- 5. Read-Only Contract View for Decoration Sub-App (Section 4.2)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_decoration_hr_source
WITH (security_invoker = true) AS
SELECT
  d.id AS person_id,
  d.personnel_code,
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
  d.status_effective_date,
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
  pt.code AS position_type_code,
  d.position_type_name,
  d.position_id,
  d.position_name,
  d.position_level_id,
  pl.code AS position_level_code,
  d.position_level_name,
  d.position_number,
  d.legacy_c_level,
  d.employee_group_id,
  leg.code AS employee_group_code,
  d.employee_group_name,
  d.is_bma_permanent_secretary,
  d.current_position_date,
  d.current_level_date,
  d.email,
  d.phone_number,
  d.line_user_id,
  d.start_service_date,
  d.start_service_year_be,
  d.re_appointment_date,
  d.transfer_in_date,
  d.prior_continuous_service_days,
  d.double_service_days,
  d.initial_position,
  d.initial_salary,
  d.current_salary,
  d.retro_salary_5y,
  d.position_allowance,
  d.academic_allowance,
  d.is_max_step,
  d.disciplinary_flag,
  d.disciplinary_note,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', nh.id,
        'old_prefix', nh.old_prefix,
        'old_first_name', nh.old_first_name,
        'old_last_name', nh.old_last_name,
        'changed_date', nh.changed_date,
        'document_ref', nh.document_ref
      ) ORDER BY nh.changed_date DESC
    )
    FROM public.personnel_name_history nh
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
        'legacy_c_level', ph.legacy_c_level,
        'employee_group_id', ph.employee_group_id,
        'employee_group_code', pheg.code,
        'employee_group_name', pheg.name_th,
        'is_bma_permanent_secretary', ph.is_bma_permanent_secretary,
        'org_unit_id', ph.org_unit_id,
        'org_unit_name', phorg.name_th,
        'effective_date', ph.effective_date,
        'end_date', ph.end_date,
        'order_reference', ph.order_reference
      ) ORDER BY ph.effective_date DESC
    )
    FROM public.personnel_position_history ph
    LEFT JOIN public.position_types pht ON pht.id = ph.position_type_id
    LEFT JOIN public.positions php ON php.id = ph.position_id
    LEFT JOIN public.position_levels phl ON phl.id = ph.position_level_id
    LEFT JOIN public.lookup_items pheg ON pheg.id = ph.employee_group_id
    LEFT JOIN public.org_units phorg ON phorg.id = ph.org_unit_id
    WHERE ph.personnel_id = d.id),
    '[]'::jsonb
  ) AS position_history,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', sh.id,
        'base_salary', sh.base_salary,
        'position_allowance', sh.position_allowance,
        'academic_allowance', sh.academic_allowance,
        'is_max_step', sh.is_max_step,
        'effective_date', sh.effective_date,
        'order_reference', sh.order_reference
      ) ORDER BY sh.effective_date DESC
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
        'note', ev.note
      ) ORDER BY ev.fiscal_year_be DESC, ev.eval_round DESC
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
        'remark', dr.remark
      ) ORDER BY dr.effective_date DESC
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
        'remark', si.remark
      ) ORDER BY si.start_date DESC
    )
    FROM public.personnel_service_interruptions si
    LEFT JOIN public.lookup_items sit ON sit.id = si.interruption_type_id
    WHERE si.personnel_id = d.id),
    '[]'::jsonb
  ) AS service_interruptions,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'id', pd.id,
        'decoration_class_id', pd.decoration_class_id,
        'code', dc.code,
        'name_th', dc.name_th,
        'rank_order', dc.rank_order,
        'received_year_be', pd.received_year_be,
        'award_date', pd.award_date,
        'account_type_used', pd.account_type_used,
        'nomination_basis', pd.nomination_basis,
        'return_status', pd.return_status,
        'gazette_ref', pd.gazette_ref,
        'note', pd.note
      ) ORDER BY pd.received_year_be DESC, dc.rank_order DESC
    )
    FROM public.personnel_decorations pd
    JOIN public.decoration_classes dc ON dc.id = pd.decoration_class_id
    WHERE pd.personnel_id = d.id),
    '[]'::jsonb
  ) AS decorations
FROM public.v_personnel_directory d
LEFT JOIN public.lookup_items lg ON lg.id = d.gender_id
LEFT JOIN public.lookup_items le ON le.id = d.employment_type_id
LEFT JOIN public.lookup_items ls ON ls.id = d.status_id
LEFT JOIN public.lookup_items leg ON leg.id = d.employee_group_id
LEFT JOIN public.position_types pt ON pt.id = d.position_type_id
LEFT JOIN public.position_levels pl ON pl.id = d.position_level_id
LEFT JOIN public.org_units ob ON ob.id = d.bureau_id
LEFT JOIN public.org_units oo ON oo.id = d.office_id
LEFT JOIN public.org_units od ON od.id = d.department_id
LEFT JOIN public.org_units ov ON ov.id = d.division_id;

GRANT SELECT ON public.v_decoration_hr_source TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Upgrade fn_save_personnel_bundle (JSONB ? key-safe for all fields & timelines)
-- -----------------------------------------------------------------------------
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
  v_name_hist jsonb := p_payload->'name_history';
  v_pos_hist jsonb := p_payload->'position_history';
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
  v_item jsonb;
  v_has_active_disc boolean := false;
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
      status_effective_date, line_user_id,
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
      NULLIF(v_p->>'status_effective_date', '')::date,
      NULLIF(trim(v_p->>'line_user_id'), ''),
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
      status_effective_date = CASE WHEN v_p ? 'status_effective_date' THEN NULLIF(v_p->>'status_effective_date', '')::date ELSE status_effective_date END,
      line_user_id = CASE WHEN v_p ? 'line_user_id' THEN NULLIF(trim(v_p->>'line_user_id'), '') ELSE line_user_id END,
      updated_by = auth.uid()
    WHERE id = v_pid;
  END IF;

  INSERT INTO public.personnel_assignments (
    personnel_id, employment_type_id, position_type_id, position_id, position_level_id,
    position_number, secondary_position, acting_position,
    bureau_id, office_id, department_id, division_id,
    approval_tier_id, current_position_date, current_level_date,
    legacy_c_level, employee_group_id, is_bma_permanent_secretary, updated_by
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
    NULLIF(trim(v_a->>'legacy_c_level'), ''),
    NULLIF(v_a->>'employee_group_id', '')::uuid,
    COALESCE((v_a->>'is_bma_permanent_secretary')::boolean, false),
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
    legacy_c_level = CASE
      WHEN v_a ? 'legacy_c_level' THEN EXCLUDED.legacy_c_level
      ELSE public.personnel_assignments.legacy_c_level
    END,
    employee_group_id = CASE
      WHEN v_a ? 'employee_group_id' THEN EXCLUDED.employee_group_id
      ELSE public.personnel_assignments.employee_group_id
    END,
    is_bma_permanent_secretary = CASE
      WHEN v_a ? 'is_bma_permanent_secretary' THEN EXCLUDED.is_bma_permanent_secretary
      ELSE public.personnel_assignments.is_bma_permanent_secretary
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
    initial_salary, current_salary, retro_salary_5y, disciplinary_flag, disciplinary_note,
    re_appointment_date, transfer_in_date, prior_continuous_service_days, double_service_days,
    position_allowance, academic_allowance, is_max_step, updated_by
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
    NULLIF(v_c->>'re_appointment_date', '')::date,
    NULLIF(v_c->>'transfer_in_date', '')::date,
    COALESCE(NULLIF(v_c->>'prior_continuous_service_days', '')::integer, 0),
    COALESCE(NULLIF(v_c->>'double_service_days', '')::integer, 0),
    COALESCE(NULLIF(v_c->>'position_allowance', '')::numeric, 0),
    COALESCE(NULLIF(v_c->>'academic_allowance', '')::numeric, 0),
    COALESCE((v_c->>'is_max_step')::boolean, false),
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
    academic_allowance = CASE
      WHEN v_c ? 'academic_allowance' THEN EXCLUDED.academic_allowance
      ELSE public.personnel_career_records.academic_allowance
    END,
    is_max_step = CASE
      WHEN v_c ? 'is_max_step' THEN EXCLUDED.is_max_step
      ELSE public.personnel_career_records.is_max_step
    END,
    updated_by = auth.uid();

  -- Decorations (1:N — only replaced when key is explicitly provided)
  IF p_payload ? 'decorations' AND v_decs IS NOT NULL AND jsonb_typeof(v_decs) = 'array' THEN
    DELETE FROM public.personnel_decorations WHERE personnel_id = v_pid;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_decs) LOOP
      IF NULLIF(v_item->>'decoration_class_id', '') IS NOT NULL AND NULLIF(v_item->>'received_year_be', '') IS NOT NULL THEN
        INSERT INTO public.personnel_decorations (
          personnel_id, decoration_class_id, received_year_be,
          award_date, account_type_used, nomination_basis, return_status,
          gazette_ref, note, created_by
        ) VALUES (
          v_pid,
          (v_item->>'decoration_class_id')::uuid,
          (v_item->>'received_year_be')::smallint,
          NULLIF(v_item->>'award_date', '')::date,
          NULLIF(trim(v_item->>'account_type_used'), ''),
          COALESCE(NULLIF(trim(v_item->>'nomination_basis'), ''), 'normal'),
          NULLIF(trim(v_item->>'return_status'), ''),
          NULLIF(trim(v_item->>'gazette_ref'), ''),
          NULLIF(trim(v_item->>'note'), ''),
          auth.uid()
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 1: Name History
  IF p_payload ? 'name_history' AND v_name_hist IS NOT NULL AND jsonb_typeof(v_name_hist) = 'array' THEN
    DELETE FROM public.personnel_name_history WHERE personnel_id = v_pid;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_name_hist) LOOP
      IF NULLIF(trim(COALESCE(v_item->>'old_first_name', '')), '') IS NOT NULL
         AND NULLIF(trim(COALESCE(v_item->>'old_last_name', '')), '') IS NOT NULL
         AND NULLIF(v_item->>'changed_date', '') IS NOT NULL THEN
        INSERT INTO public.personnel_name_history (
          personnel_id, old_prefix, old_first_name, old_last_name, changed_date, document_ref
        ) VALUES (
          v_pid,
          NULLIF(trim(v_item->>'old_prefix'), ''),
          trim(v_item->>'old_first_name'),
          trim(v_item->>'old_last_name'),
          (v_item->>'changed_date')::date,
          NULLIF(trim(v_item->>'document_ref'), '')
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 2: Position History
  IF p_payload ? 'position_history' AND v_pos_hist IS NOT NULL AND jsonb_typeof(v_pos_hist) = 'array' THEN
    DELETE FROM public.personnel_position_history WHERE personnel_id = v_pid;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_pos_hist) LOOP
      IF NULLIF(v_item->>'effective_date', '') IS NOT NULL THEN
        INSERT INTO public.personnel_position_history (
          personnel_id, position_number, position_type_id, position_id, position_level_id,
          position_title_snapshot, legacy_c_level, employee_group_id, is_bma_permanent_secretary,
          org_unit_id, effective_date, end_date, order_reference
        ) VALUES (
          v_pid,
          NULLIF(trim(v_item->>'position_number'), ''),
          NULLIF(v_item->>'position_type_id', '')::uuid,
          NULLIF(v_item->>'position_id', '')::uuid,
          NULLIF(v_item->>'position_level_id', '')::uuid,
          NULLIF(trim(v_item->>'position_title_snapshot'), ''),
          NULLIF(trim(v_item->>'legacy_c_level'), ''),
          NULLIF(v_item->>'employee_group_id', '')::uuid,
          COALESCE((v_item->>'is_bma_permanent_secretary')::boolean, false),
          NULLIF(v_item->>'org_unit_id', '')::uuid,
          (v_item->>'effective_date')::date,
          NULLIF(v_item->>'end_date', '')::date,
          NULLIF(trim(v_item->>'order_reference'), '')
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 3: Salary History
  IF p_payload ? 'salary_history' AND v_sal_hist IS NOT NULL AND jsonb_typeof(v_sal_hist) = 'array' THEN
    DELETE FROM public.personnel_salary_history WHERE personnel_id = v_pid;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sal_hist) LOOP
      IF NULLIF(v_item->>'base_salary', '') IS NOT NULL AND NULLIF(v_item->>'effective_date', '') IS NOT NULL THEN
        INSERT INTO public.personnel_salary_history (
          personnel_id, base_salary, position_allowance, academic_allowance, is_max_step, effective_date, order_reference
        ) VALUES (
          v_pid,
          (v_item->>'base_salary')::numeric,
          COALESCE(NULLIF(v_item->>'position_allowance', '')::numeric, 0),
          COALESCE(NULLIF(v_item->>'academic_allowance', '')::numeric, 0),
          COALESCE((v_item->>'is_max_step')::boolean, false),
          (v_item->>'effective_date')::date,
          NULLIF(trim(v_item->>'order_reference'), '')
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 4: Evaluations
  IF p_payload ? 'evaluations' AND v_evals IS NOT NULL AND jsonb_typeof(v_evals) = 'array' THEN
    DELETE FROM public.personnel_evaluations WHERE personnel_id = v_pid;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_evals) LOOP
      IF NULLIF(v_item->>'fiscal_year_be', '') IS NOT NULL
         AND NULLIF(v_item->>'eval_round', '') IS NOT NULL
         AND NULLIF(v_item->>'eval_grade_id', '') IS NOT NULL THEN
        INSERT INTO public.personnel_evaluations (
          personnel_id, fiscal_year_be, eval_round, score_percent, eval_grade_id, note
        ) VALUES (
          v_pid,
          (v_item->>'fiscal_year_be')::smallint,
          (v_item->>'eval_round')::smallint,
          NULLIF(v_item->>'score_percent', '')::numeric,
          (v_item->>'eval_grade_id')::uuid,
          NULLIF(trim(v_item->>'note'), '')
        )
        ON CONFLICT (personnel_id, fiscal_year_be, eval_round) DO UPDATE SET
          score_percent = EXCLUDED.score_percent,
          eval_grade_id = EXCLUDED.eval_grade_id,
          note = EXCLUDED.note;
      END IF;
    END LOOP;
  END IF;

  -- Timeline 5: Disciplinary Records (also syncs disciplinary_flag when active/guilty cases exist)
  IF p_payload ? 'disciplinary_records' AND v_disc IS NOT NULL AND jsonb_typeof(v_disc) = 'array' THEN
    DELETE FROM public.personnel_disciplinary_records WHERE personnel_id = v_pid;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_disc) LOOP
      IF NULLIF(v_item->>'record_type_id', '') IS NOT NULL
         AND NULLIF(v_item->>'case_status_id', '') IS NOT NULL
         AND NULLIF(v_item->>'effective_date', '') IS NOT NULL THEN
        INSERT INTO public.personnel_disciplinary_records (
          personnel_id, record_type_id, penalty_level_id, case_status_id, effective_date, resolved_date, remark
        ) VALUES (
          v_pid,
          (v_item->>'record_type_id')::uuid,
          NULLIF(v_item->>'penalty_level_id', '')::uuid,
          (v_item->>'case_status_id')::uuid,
          (v_item->>'effective_date')::date,
          NULLIF(v_item->>'resolved_date', '')::date,
          NULLIF(trim(v_item->>'remark'), '')
        );
      END IF;
    END LOOP;

    SELECT EXISTS (
      SELECT 1
      FROM public.personnel_disciplinary_records dr
      JOIN public.lookup_items li ON li.id = dr.case_status_id
      WHERE dr.personnel_id = v_pid
        AND li.code IN ('ONGOING', 'CLOSED_GUILTY')
    ) INTO v_has_active_disc;

    IF v_has_active_disc THEN
      UPDATE public.personnel_career_records
      SET disciplinary_flag = true, updated_by = auth.uid()
      WHERE personnel_id = v_pid;
    END IF;
  END IF;

  -- Timeline 6: Service Interruptions
  IF p_payload ? 'service_interruptions' AND v_interr IS NOT NULL AND jsonb_typeof(v_interr) = 'array' THEN
    DELETE FROM public.personnel_service_interruptions WHERE personnel_id = v_pid;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_interr) LOOP
      IF NULLIF(v_item->>'interruption_type_id', '') IS NOT NULL
         AND NULLIF(v_item->>'start_date', '') IS NOT NULL THEN
        INSERT INTO public.personnel_service_interruptions (
          personnel_id, interruption_type_id, start_date, end_date, deductible_days, remark
        ) VALUES (
          v_pid,
          (v_item->>'interruption_type_id')::uuid,
          (v_item->>'start_date')::date,
          NULLIF(v_item->>'end_date', '')::date,
          COALESCE(NULLIF(v_item->>'deductible_days', '')::integer, 0),
          NULLIF(trim(v_item->>'remark'), '')
        );
      END IF;
    END LOOP;
  END IF;

  RETURN v_pid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_save_personnel_bundle(jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Upgrade fn_schema_health (37 Expected Tables in public)
-- -----------------------------------------------------------------------------
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
    'decoration_classes', 'personnel', 'personnel_assignments',
    'personnel_fleet_profiles', 'personnel_career_records', 'personnel_decorations',
    'personnel_name_history', 'personnel_position_history', 'personnel_salary_history',
    'personnel_evaluations', 'personnel_disciplinary_records', 'personnel_service_interruptions',
    'users', 'user_admin_scopes', 'api_scope_catalog', 'webapp_scope_presets',
    'webapp_scope_preset_items', 'webapps', 'webapp_roles', 'webapp_scopes',
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

  IF array_length(v_missing, 1) > 0 OR array_length(v_rls_off, 1) > 0 THEN
    v_status := 'ERROR';
  ELSIF COALESCE(trim(v_gas_url), '') = '' OR COALESCE(trim(v_img_dir), '') = '' OR COALESCE(trim(v_sig_dir), '') = '' OR COALESCE(trim(v_doc_dir), '') = '' THEN
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
      'document_folder', COALESCE(trim(v_doc_dir), '') <> ''
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_schema_health() TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Idempotent BMA Standard Master Data Seed
--    Uses ON CONFLICT DO NOTHING (no target column) to prevent 23505 on UNIQUE(name_th)
-- -----------------------------------------------------------------------------

-- 8.1 New Lookup Categories (6 categories)
INSERT INTO public.lookup_categories (code, name_th, description, is_system_locked, has_provision_flag, has_approver_flag, has_dispatch_flag, sort_order)
VALUES
  ('EMPLOYEE_GROUP', 'หมวดงานลูกจ้างประจำ', 'กลุ่มชั้นงานลูกจ้างประจำ กทม. (หมวดฝีมือขึ้นไปมีสิทธิขอเครื่องราชฯ)', true, false, false, false, 8),
  ('EVAL_GRADE', 'ระดับผลการประเมินการปฏิบัติราชการ', 'ระดับผลประเมินตามเกณฑ์ กทม. สำหรับตรวจสอบคุณสมบัติเครื่องราชฯ', true, false, false, false, 9),
  ('DISCIPLINARY_TYPE', 'ประเภทประวัติทางวินัยและคดี', 'สอบสวนวินัย คำสั่งลงโทษ คดีอาญา หรือ ป.ป.ช./ป.ป.ท.', true, false, false, false, 10),
  ('DISCIPLINARY_PENALTY', 'ระดับโทษทางวินัย', 'ภาคทัณฑ์ ตัดเงินเดือน ลดเงินเดือน ปลดออก ไล่ออก', true, false, false, false, 11),
  ('DISCIPLINARY_CASE_STATUS', 'สถานะคดี/เรื่องทางวินัย', 'ใช้ตรวจ Qualification Gate (อยู่ระหว่างดำเนินการ = Hold)', true, false, false, false, 12),
  ('SERVICE_INTERRUPTION_TYPE', 'เหตุการณ์กระทบการนับอายุราชการ', 'ลาศึกษาต่อ ลาไม่รับเงินเดือน สั่งพักราชการ หรือขาดราชการ', true, false, false, false, 13)
ON CONFLICT DO NOTHING;

-- 8.2 Lookup Items for existing & new categories
DO $$
DECLARE
  v_cat uuid;
BEGIN
  -- Expand EMPLOYMENT_TYPE
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'EMPLOYMENT_TYPE';
  IF v_cat IS NOT NULL THEN
    INSERT INTO public.lookup_items (category_id, code, name_th, sort_order, is_default) VALUES
      (v_cat, 'TEACHER', 'ข้าราชการครูและบุคลากรทางการศึกษากรุงเทพมหานคร', 4, false),
      (v_cat, 'POLITICAL_OFFICIAL', 'ข้าราชการการเมือง กทม. / ส.ก.', 5, false)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Expand PERSONNEL_STATUS
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'PERSONNEL_STATUS';
  IF v_cat IS NOT NULL THEN
    INSERT INTO public.lookup_items (category_id, code, name_th, color_hex, allows_account_provision, sort_order, is_default) VALUES
      (v_cat, 'SUSPENDED', 'สั่งพักราชการ', '#D97706', false, 6, false),
      (v_cat, 'DISMISSED', 'ปลดออก/ไล่ออก', '#991B1B', false, 7, false),
      (v_cat, 'DECEASED', 'เสียชีวิต', '#334155', false, 8, false)
    ON CONFLICT DO NOTHING;
  END IF;

  -- EMPLOYEE_GROUP
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'EMPLOYEE_GROUP';
  IF v_cat IS NOT NULL THEN
    INSERT INTO public.lookup_items (category_id, code, name_th, short_name, rank_order, sort_order) VALUES
      (v_cat, 'EMP_GENERAL', 'หมวดทั่วไป (บริการพื้นฐาน)', 'ทั่วไป', 10, 1),
      (v_cat, 'EMP_SEMI_SKILLED', 'หมวดกึ่งฝีมือ (สนับสนุน)', 'กึ่งฝีมือ', 20, 2),
      (v_cat, 'EMP_SKILLED', 'หมวดฝีมือ (กลุ่มงานช่าง)', 'ฝีมือ', 30, 3),
      (v_cat, 'EMP_SPECIAL_SKILLED', 'หมวดฝีมือพิเศษ (เทคนิคพิเศษ)', 'ฝีมือพิเศษ', 40, 4)
    ON CONFLICT DO NOTHING;
  END IF;

  -- EVAL_GRADE
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'EVAL_GRADE';
  IF v_cat IS NOT NULL THEN
    INSERT INTO public.lookup_items (category_id, code, name_th, color_hex, rank_order, sort_order) VALUES
      (v_cat, 'EXCELLENT', 'ดีเด่น', '#047857', 50, 1),
      (v_cat, 'VERY_GOOD', 'ดีมาก', '#0284C7', 40, 2),
      (v_cat, 'GOOD', 'ดี', '#16A34A', 30, 3),
      (v_cat, 'FAIR', 'พอใช้', '#D97706', 20, 4),
      (v_cat, 'NEEDS_IMPROVEMENT', 'ต้องปรับปรุง', '#DC2626', 10, 5)
    ON CONFLICT DO NOTHING;
  END IF;

  -- DISCIPLINARY_TYPE
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'DISCIPLINARY_TYPE';
  IF v_cat IS NOT NULL THEN
    INSERT INTO public.lookup_items (category_id, code, name_th, sort_order) VALUES
      (v_cat, 'INVESTIGATION_MINOR', 'สอบสวนวินัยไม่ร้ายแรง', 1),
      (v_cat, 'INVESTIGATION_SEVERE', 'สอบสวนวินัยร้ายแรง', 2),
      (v_cat, 'PENALTY', 'คำสั่งลงโทษทางวินัย', 3),
      (v_cat, 'CRIMINAL_CASE', 'คดีอาญา', 4),
      (v_cat, 'NACC_PACC', 'การชี้มูลของ ป.ป.ช. / ป.ป.ท.', 5)
    ON CONFLICT DO NOTHING;
  END IF;

  -- DISCIPLINARY_PENALTY
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'DISCIPLINARY_PENALTY';
  IF v_cat IS NOT NULL THEN
    INSERT INTO public.lookup_items (category_id, code, name_th, rank_order, sort_order) VALUES
      (v_cat, 'REPRIMAND', 'ภาคทัณฑ์', 10, 1),
      (v_cat, 'SALARY_CUT', 'ตัดเงินเดือน', 20, 2),
      (v_cat, 'SALARY_REDUCTION', 'ลดเงินเดือน', 30, 3),
      (v_cat, 'DISMISSAL', 'ปลดออก', 40, 4),
      (v_cat, 'EXPULSION', 'ไล่ออก', 50, 5)
    ON CONFLICT DO NOTHING;
  END IF;

  -- DISCIPLINARY_CASE_STATUS
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'DISCIPLINARY_CASE_STATUS';
  IF v_cat IS NOT NULL THEN
    INSERT INTO public.lookup_items (category_id, code, name_th, color_hex, sort_order) VALUES
      (v_cat, 'ONGOING', 'อยู่ระหว่างดำเนินการ (Hold)', '#D97706', 1),
      (v_cat, 'CLOSED_GUILTY', 'ยุติ - มีความผิด', '#DC2626', 2),
      (v_cat, 'CLOSED_CLEARED', 'ยุติ - ไม่มีความผิด / พ้นมลทิน', '#16A34A', 3)
    ON CONFLICT DO NOTHING;
  END IF;

  -- SERVICE_INTERRUPTION_TYPE
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'SERVICE_INTERRUPTION_TYPE';
  IF v_cat IS NOT NULL THEN
    INSERT INTO public.lookup_items (category_id, code, name_th, sort_order) VALUES
      (v_cat, 'STUDY_LEAVE_PAID', 'ลาศึกษาต่อโดยรับเงินเดือน', 1),
      (v_cat, 'STUDY_LEAVE_UNPAID', 'ลาศึกษาต่อโดยไม่รับเงินเดือน', 2),
      (v_cat, 'UNPAID_LEAVE', 'ลาโดยไม่รับเงินเดือน', 3),
      (v_cat, 'SUSPENSION', 'ถูกสั่งพักราชการ / ให้ออกจากราชการไว้ก่อน', 4),
      (v_cat, 'AWOL', 'ขาดราชการ', 5)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 8.3 Expand Position Types & Position Levels (avoiding UNIQUE(name_th) collisions)
INSERT INTO public.position_types (code, name_th, color_hex, sort_order) VALUES
  ('TEACHER', 'ข้าราชการครูและบุคลากรทางการศึกษา', '#0D9488', 6),
  ('POLITICAL', 'การเมือง / ส.ก.', '#9333EA', 7)
ON CONFLICT DO NOTHING;

INSERT INTO public.position_levels (code, name_th, rank_order, sort_order) VALUES
  ('O4', 'ทักษะพิเศษ', 35, 4),
  ('K5', 'ทรงคุณวุฒิ', 75, 9),
  ('TCH_ASST', 'ครูผู้ช่วย', 38, 12),
  ('TCH_K1', 'ครู (คศ.1)', 42, 13),
  ('TCH_K2', 'ครูชำนาญการ (คศ.2)', 52, 14),
  ('TCH_K3', 'ครูชำนาญการพิเศษ (คศ.3)', 62, 15),
  ('TCH_K4', 'ครูเชี่ยวชาญ (คศ.4)', 72, 16),
  ('TCH_K5', 'ครูเชี่ยวชาญพิเศษ (คศ.5)', 78, 17)
ON CONFLICT DO NOTHING;

-- 8.4 Standard 12 Royal Decoration Tiers + RJP (ON CONFLICT DO NOTHING)
DO $$
DECLARE
  v_crown uuid;
  v_elephant uuid;
  v_rjp uuid;
BEGIN
  SELECT li.id INTO v_crown
  FROM public.lookup_items li
  JOIN public.lookup_categories lc ON lc.id = li.category_id
  WHERE lc.code = 'DECORATION_FAMILY' AND li.code = 'CROWN_THAILAND';

  SELECT li.id INTO v_elephant
  FROM public.lookup_items li
  JOIN public.lookup_categories lc ON lc.id = li.category_id
  WHERE lc.code = 'DECORATION_FAMILY' AND li.code = 'WHITE_ELEPHANT';

  SELECT li.id INTO v_rjp
  FROM public.lookup_items li
  JOIN public.lookup_categories lc ON lc.id = li.category_id
  WHERE lc.code = 'DECORATION_FAMILY' AND li.code = 'CHAKRAPAT';

  IF v_crown IS NOT NULL AND v_elephant IS NOT NULL THEN
    INSERT INTO public.decoration_classes (family_id, code, name_th, rank_order, color_hex, sort_order) VALUES
      (v_crown,    'BM',   'เบญจมาภรณ์มงกุฎไทย (บ.ม.)',               1,  '#1D4ED8', 1),
      (v_elephant, 'BCH',  'เบญจมาภรณ์ช้างเผือก (บ.ช.)',              2,  '#DC2626', 2),
      (v_crown,    'JM',   'จัตุรถาภรณ์มงกุฎไทย (จ.ม.)',              3,  '#2563EB', 3),
      (v_elephant, 'JCH',  'จัตุรถาภรณ์ช้างเผือก (จ.ช.)',             4,  '#EF4444', 4),
      (v_crown,    'TM',   'ตริตาภรณ์มงกุฎไทย (ต.ม.)',                5,  '#0284C7', 5),
      (v_elephant, 'TCH',  'ตริตาภรณ์ช้างเผือก (ต.ช.)',               6,  '#B91C1C', 6),
      (v_crown,    'THM',  'ทวีติยาภรณ์มงกุฎไทย (ท.ม.)',              7,  '#0369A1', 7),
      (v_elephant, 'THCH', 'ทวีติยาภรณ์ช้างเผือก (ท.ช.)',             8,  '#991B1B', 8),
      (v_crown,    'PM',   'ประถมาภรณ์มงกุฎไทย (ป.ม.)',               9,  '#7C3AED', 9),
      (v_elephant, 'PCH',  'ประถมาภรณ์ช้างเผือก (ป.ช.)',              10, '#A21CAF', 10),
      (v_crown,    'MVM',  'มหาวชิรมงกุฎ (ม.ว.ม.)',                   11, '#B45309', 11),
      (v_elephant, 'MPCH', 'มหาปรมาภรณ์ช้างเผือก (ม.ป.ช.)',           12, '#92400E', 12)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_rjp IS NOT NULL THEN
    INSERT INTO public.decoration_classes (family_id, code, name_th, rank_order, color_hex, sort_order) VALUES
      (v_rjp, 'RJP', 'เหรียญจักรพรรดิมาลา (ร.จ.พ.)', 25, '#D97706', 13)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

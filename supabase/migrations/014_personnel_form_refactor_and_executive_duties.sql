-- =============================================================================
-- Migration 014: Personnel Form 3-Tab Refactor, 1:N Executive Duties,
--                Authoritative History Auto-Sync & Core HR Schema Cleanup
--                (Option A: 37 -> 35 Tables in public)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Create public.personnel_executive_duties (1:N Deputizing / Acting)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.personnel_executive_duties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_id uuid NOT NULL REFERENCES public.personnel(id) ON DELETE CASCADE,
  duty_type text NOT NULL CHECK (duty_type IN ('DEPUTIZING', 'ACTING')),
  position_type_id uuid REFERENCES public.position_types(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL REFERENCES public.positions(id) ON DELETE RESTRICT,
  position_level_id uuid REFERENCES public.position_levels(id) ON DELETE RESTRICT,
  bureau_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  office_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  division_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  effective_date date,
  end_date date,
  order_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_exec_duty_dates CHECK (
    end_date IS NULL OR effective_date IS NULL OR end_date >= effective_date
  )
);

CREATE INDEX IF NOT EXISTS idx_exec_duties_person_active
  ON public.personnel_executive_duties(personnel_id, duty_type, end_date);

DROP TRIGGER IF EXISTS trg_touch_personnel_executive_duties ON public.personnel_executive_duties;
CREATE TRIGGER trg_touch_personnel_executive_duties
  BEFORE UPDATE ON public.personnel_executive_duties
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personnel_executive_duties TO authenticated, service_role;
ALTER TABLE public.personnel_executive_duties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scoped_select_personnel_executive_duties" ON public.personnel_executive_duties;
CREATE POLICY "scoped_select_personnel_executive_duties"
  ON public.personnel_executive_duties
  FOR SELECT TO authenticated
  USING (public.fn_is_personnel_in_my_scope(personnel_id));

DROP POLICY IF EXISTS "scoped_write_personnel_executive_duties" ON public.personnel_executive_duties;
CREATE POLICY "scoped_write_personnel_executive_duties"
  ON public.personnel_executive_duties
  FOR ALL TO authenticated
  USING (
    public.fn_current_user_role() IN ('SUPERADMIN', 'ADMIN')
    AND public.fn_is_personnel_in_my_scope(personnel_id)
  )
  WITH CHECK (
    public.fn_current_user_role() IN ('SUPERADMIN', 'ADMIN')
    AND public.fn_is_personnel_in_my_scope(personnel_id)
  );

-- -----------------------------------------------------------------------------
-- Step 2: Drop ALL 7 Dependent Views in exact child -> parent order
--         (Required because PostgreSQL forbids dropping columns via CREATE OR REPLACE VIEW)
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_decoration_hr_source;
DROP VIEW IF EXISTS public.v_personnel_royal_dec;
DROP VIEW IF EXISTS public.v_personnel_approvers;
DROP VIEW IF EXISTS public.v_personnel_drivers;
DROP VIEW IF EXISTS public.v_user_app_access_matrix;
DROP VIEW IF EXISTS public.v_users_scoped;
DROP VIEW IF EXISTS public.v_personnel_directory;

-- -----------------------------------------------------------------------------
-- Step 3: Drop Deprecated Columns (Items 1 & 7) + Active Position History Guard
-- -----------------------------------------------------------------------------
ALTER TABLE public.personnel_assignments
  DROP COLUMN IF EXISTS legacy_c_level,
  DROP COLUMN IF EXISTS employee_group_id;

ALTER TABLE public.personnel_position_history
  DROP COLUMN IF EXISTS legacy_c_level,
  DROP COLUMN IF EXISTS employee_group_id;

ALTER TABLE public.personnel_career_records
  DROP CONSTRAINT IF EXISTS chk_career_acad_allowance_nonneg,
  DROP COLUMN IF EXISTS academic_allowance;

ALTER TABLE public.personnel_salary_history
  DROP COLUMN IF EXISTS academic_allowance;

-- Auto-close any legacy duplicate open-ended position history rows before adding partial unique index
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    WITH ranked AS (
      SELECT
        id,
        personnel_id,
        effective_date,
        LEAD(effective_date) OVER (
          PARTITION BY personnel_id
          ORDER BY effective_date ASC, created_at ASC, id ASC
        ) AS next_effective_date,
        ROW_NUMBER() OVER (
          PARTITION BY personnel_id
          ORDER BY effective_date DESC, created_at DESC, id DESC
        ) AS rn_desc
      FROM public.personnel_position_history
      WHERE end_date IS NULL
    )
    SELECT id, effective_date, next_effective_date
    FROM ranked
    WHERE rn_desc > 1
  LOOP
    UPDATE public.personnel_position_history
    SET end_date = GREATEST(
      v_rec.effective_date,
      COALESCE(v_rec.next_effective_date - INTERVAL '1 day', v_rec.effective_date)::date
    )
    WHERE id = v_rec.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_history_one_active_per_person
  ON public.personnel_position_history(personnel_id)
  WHERE end_date IS NULL;

-- -----------------------------------------------------------------------------
-- Step 4: Option A — Drop Sub-App Specific Tables (Items 8 & 9)
--         (Pre-flight verified: 0 personnel_decorations, 0 teacher_emp_refs)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.personnel_fleet_profiles CASCADE;
DROP TABLE IF EXISTS public.personnel_decorations CASCADE;
DROP TABLE IF EXISTS public.decoration_classes CASCADE;

-- -----------------------------------------------------------------------------
-- Step 5: FK-Safe Master Data Cleanup (Items 1, 7, 8, 9)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cat uuid;
BEGIN
  -- 5.1 Remove EMPLOYEE_GROUP lookup category & items (Item 1)
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'EMPLOYEE_GROUP';
  IF v_cat IS NOT NULL THEN
    DELETE FROM public.lookup_items WHERE category_id = v_cat;
    DELETE FROM public.lookup_categories WHERE id = v_cat;
  END IF;

  -- 5.2 Remove DRIVER_STATUS & DECORATION_FAMILY lookup categories & items (Option A, Items 8 & 9)
  FOR v_cat IN
    SELECT id FROM public.lookup_categories WHERE code IN ('DRIVER_STATUS', 'DECORATION_FAMILY')
  LOOP
    DELETE FROM public.lookup_items WHERE category_id = v_cat;
    DELETE FROM public.lookup_categories WHERE id = v_cat;
  END LOOP;

  -- 5.3 Clean EMPLOYMENT_TYPE: keep BMA civil servants, permanent & temporary employees only (Item 7)
  SELECT id INTO v_cat FROM public.lookup_categories WHERE code = 'EMPLOYMENT_TYPE';
  IF v_cat IS NOT NULL THEN
    UPDATE public.lookup_categories
    SET description = 'ข้าราชการกรุงเทพมหานครสามัญ / ลูกจ้างประจำ / ลูกจ้างชั่วคราว'
    WHERE id = v_cat;

    DELETE FROM public.lookup_items li
    WHERE li.category_id = v_cat
      AND li.code IN ('TEACHER', 'POLITICAL_OFFICIAL')
      AND NOT EXISTS (
        SELECT 1 FROM public.personnel_assignments pa WHERE pa.employment_type_id = li.id
      );

    UPDATE public.lookup_items
    SET is_active = false
    WHERE category_id = v_cat
      AND code IN ('TEACHER', 'POLITICAL_OFFICIAL');
  END IF;

  -- 5.4 Clean Teacher Position Levels (TCH_*) FK-safely (Item 7)
  DELETE FROM public.position_allowed_levels
  WHERE position_level_id IN (
    SELECT id FROM public.position_levels
    WHERE code IN ('TCH_ASST', 'TCH_K1', 'TCH_K2', 'TCH_K3', 'TCH_K4', 'TCH_K5')
  );

  DELETE FROM public.position_levels pl
  WHERE pl.code IN ('TCH_ASST', 'TCH_K1', 'TCH_K2', 'TCH_K3', 'TCH_K4', 'TCH_K5')
    AND NOT EXISTS (SELECT 1 FROM public.personnel_assignments pa WHERE pa.position_level_id = pl.id)
    AND NOT EXISTS (SELECT 1 FROM public.personnel_position_history ph WHERE ph.position_level_id = pl.id)
    AND NOT EXISTS (SELECT 1 FROM public.personnel_executive_duties ed WHERE ed.position_level_id = pl.id);

  UPDATE public.position_levels
  SET is_active = false
  WHERE code IN ('TCH_ASST', 'TCH_K1', 'TCH_K2', 'TCH_K3', 'TCH_K4', 'TCH_K5');

  -- 5.5 Clean Teacher & Political Position Types FK-safely (Item 7)
  DELETE FROM public.position_types pt
  WHERE pt.code IN ('TEACHER', 'POLITICAL')
    AND NOT EXISTS (SELECT 1 FROM public.positions pos WHERE pos.position_type_id = pt.id)
    AND NOT EXISTS (SELECT 1 FROM public.personnel_assignments pa WHERE pa.position_type_id = pt.id)
    AND NOT EXISTS (SELECT 1 FROM public.personnel_position_history ph WHERE ph.position_type_id = pt.id)
    AND NOT EXISTS (SELECT 1 FROM public.personnel_executive_duties ed WHERE ed.position_type_id = pt.id);

  UPDATE public.position_types
  SET is_active = false
  WHERE code IN ('TEACHER', 'POLITICAL');
END $$;

-- -----------------------------------------------------------------------------
-- Step 6: Recreate All 5 Surviving Views (security_invoker = true + GRANTs)
-- -----------------------------------------------------------------------------

-- 6.1 v_personnel_directory (Core HR + 1:N executive_duties JSONB)
CREATE VIEW public.v_personnel_directory
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
  p.status_effective_date,
  p.line_user_id,
  COALESCE(pa.is_bma_permanent_secretary, false) AS is_bma_permanent_secretary,
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
        'position_type_name', edpt.name_th,
        'position_id', ed.position_id,
        'position_name', edpos.name_th,
        'position_level_id', ed.position_level_id,
        'position_level_name', edpl.name_th,
        'bureau_id', ed.bureau_id,
        'bureau_name', edb.name_th,
        'office_id', ed.office_id,
        'office_name', edo.name_th,
        'department_id', ed.department_id,
        'department_name', edd.name_th,
        'division_id', ed.division_id,
        'division_name', edv.name_th,
        'effective_date', ed.effective_date,
        'end_date', ed.end_date,
        'order_reference', ed.order_reference
      ) ORDER BY (ed.end_date IS NOT NULL) ASC, ed.effective_date DESC NULLS LAST, ed.created_at DESC
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

-- 6.2 v_users_scoped (Restored verbatim for UsersPage & fn_dashboard_stats)
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
  d.office_id,
  d.office_name,
  d.department_id,
  d.department_name,
  d.division_id,
  d.division_name,
  d.position_name,
  d.position_level_name,
  s.scope_level_no,
  s.org_unit_id AS scope_org_unit_id,
  so.name_th AS scope_org_unit_name
FROM public.users u
LEFT JOIN public.v_personnel_directory d ON d.id = u.personnel_id
LEFT JOIN public.user_admin_scopes s ON s.user_id = u.id
LEFT JOIN public.org_units so ON so.id = s.org_unit_id;

GRANT SELECT ON public.v_users_scoped TO authenticated, service_role;

-- 6.3 v_user_app_access_matrix (Restored verbatim for AppAccessPage & portal-api)
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

-- 6.4 v_personnel_approvers (Enriched with secondary_position & executive_duties)
CREATE VIEW public.v_personnel_approvers
WITH (security_invoker = true) AS
SELECT
  d.id,
  d.personnel_code,
  d.full_name,
  d.position_name,
  d.position_level_name,
  d.secondary_position,
  d.acting_position,
  d.executive_duties,
  d.bureau_id,
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

-- 6.5 v_decoration_hr_source (Core HR & Timelines Read-Only Contract for Sub-Apps)
CREATE VIEW public.v_decoration_hr_source
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
  d.secondary_position,
  d.acting_position,
  d.executive_duties,
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
  ) AS service_interruptions
FROM public.v_personnel_directory d
LEFT JOIN public.lookup_items lg ON lg.id = d.gender_id
LEFT JOIN public.lookup_items le ON le.id = d.employment_type_id
LEFT JOIN public.lookup_items ls ON ls.id = d.status_id
LEFT JOIN public.position_types pt ON pt.id = d.position_type_id
LEFT JOIN public.position_levels pl ON pl.id = d.position_level_id
LEFT JOIN public.org_units ob ON ob.id = d.bureau_id
LEFT JOIN public.org_units oo ON oo.id = d.office_id
LEFT JOIN public.org_units od ON od.id = d.department_id
LEFT JOIN public.org_units ov ON ov.id = d.division_id;

GRANT SELECT ON public.v_decoration_hr_source TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Step 7: Upgrade fn_save_personnel_bundle
--         - Removes dropped columns & sub-app blocks (Option A)
--         - Persists 1:N personnel_executive_duties (enforcing EXECUTIVE type)
--         - Authoritative Auto-Sync for position/executive/salary/disciplinary histories
--         - Bulk Import UPSERT History-Protection Guard (re-syncs DB histories
--           whenever timeline keys are omitted so spreadsheet UPSERT never
--           overwrites history-locked parent fields)
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
  v_item jsonb;
  v_active_pos_count integer := 0;
  v_exec_pos_id uuid;
  v_exec_pt_id uuid;
  v_exec_pt_code text;
  v_exec_bureau_id uuid;
  v_exec_office_id uuid;
  -- Authoritative sync variables
  v_latest_pos RECORD;
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
    is_bma_permanent_secretary, updated_by
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
    is_bma_permanent_secretary = CASE
      WHEN v_a ? 'is_bma_permanent_secretary' THEN EXCLUDED.is_bma_permanent_secretary
      ELSE public.personnel_assignments.is_bma_permanent_secretary
    END,
    updated_by = auth.uid();

  INSERT INTO public.personnel_career_records (
    personnel_id, start_service_date, start_service_year_be, initial_position,
    initial_salary, current_salary, retro_salary_5y, disciplinary_flag, disciplinary_note,
    re_appointment_date, transfer_in_date, prior_continuous_service_days, double_service_days,
    position_allowance, is_max_step, updated_by
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
    is_max_step = CASE
      WHEN v_c ? 'is_max_step' THEN EXCLUDED.is_max_step
      ELSE public.personnel_career_records.is_max_step
    END,
    updated_by = auth.uid();

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

  -- Timeline 2: Position History (enforces at most 1 open-ended active row)
  IF p_payload ? 'position_history' AND v_pos_hist IS NOT NULL AND jsonb_typeof(v_pos_hist) = 'array' THEN
    v_active_pos_count := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_pos_hist) LOOP
      IF NULLIF(v_item->>'effective_date', '') IS NOT NULL AND NULLIF(v_item->>'end_date', '') IS NULL THEN
        v_active_pos_count := v_active_pos_count + 1;
      END IF;
    END LOOP;
    IF v_active_pos_count > 1 THEN
      RAISE EXCEPTION 'MULTIPLE_ACTIVE_POSITION_HISTORY: ประวัติการดำรงตำแหน่งสามารถเว้นว่างวันสิ้นสุด (ตำแหน่งปัจจุบัน) ได้เพียง 1 รายการเท่านั้น';
    END IF;

    DELETE FROM public.personnel_position_history WHERE personnel_id = v_pid;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_pos_hist) LOOP
      IF NULLIF(v_item->>'effective_date', '') IS NOT NULL THEN
        INSERT INTO public.personnel_position_history (
          personnel_id, position_number, position_type_id, position_id, position_level_id,
          position_title_snapshot, is_bma_permanent_secretary,
          org_unit_id, effective_date, end_date, order_reference
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
          COALESCE((v_item->>'is_bma_permanent_secretary')::boolean, false),
          NULLIF(v_item->>'org_unit_id', '')::uuid,
          (v_item->>'effective_date')::date,
          NULLIF(v_item->>'end_date', '')::date,
          NULLIF(trim(v_item->>'order_reference'), '')
        );
      END IF;
    END LOOP;
  END IF;

  -- Timeline 2B: Executive Duties (1:N Deputizing / Acting — EXECUTIVE position type only)
  IF p_payload ? 'executive_duties' AND v_exec_duties IS NOT NULL AND jsonb_typeof(v_exec_duties) = 'array' THEN
    DELETE FROM public.personnel_executive_duties WHERE personnel_id = v_pid;
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

        v_exec_office_id := NULLIF(v_item->>'office_id', '')::uuid;
        v_exec_bureau_id := COALESCE(
          NULLIF(v_item->>'bureau_id', '')::uuid,
          (SELECT parent_id FROM public.org_units WHERE id = v_exec_office_id)
        );

        INSERT INTO public.personnel_executive_duties (
          personnel_id, duty_type, position_type_id, position_id, position_level_id,
          bureau_id, office_id, department_id, division_id,
          effective_date, end_date, order_reference
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
          personnel_id, base_salary, position_allowance, is_max_step, effective_date, order_reference
        ) VALUES (
          v_pid,
          (v_item->>'base_salary')::numeric,
          COALESCE(NULLIF(v_item->>'position_allowance', '')::numeric, 0),
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

  -- Timeline 5: Disciplinary Records
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

  -- ===========================================================================
  -- AUTHORITATIVE HISTORY -> PARENT AUTO-SYNC & BULK IMPORT UPSERT GUARD
  -- Runs whenever DB has history rows for v_pid (both when payload supplied the
  -- timeline key AND when omitted e.g. by fn_import_personnel_batch UPSERT)
  -- ===========================================================================

  -- Guard 1: Position History -> personnel_assignments
  SELECT ph.*
  INTO v_latest_pos
  FROM public.personnel_position_history ph
  WHERE ph.personnel_id = v_pid
  ORDER BY
    (ph.end_date IS NOT NULL) ASC,
    ph.effective_date DESC,
    ph.end_date DESC NULLS FIRST,
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
        (ph.end_date IS NOT NULL) ASC,
        ph.effective_date DESC,
        ph.end_date DESC NULLS FIRST,
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
  END IF;

  -- Guard 2: Executive Duties -> secondary_position & acting_position summaries
  IF EXISTS (SELECT 1 FROM public.personnel_executive_duties WHERE personnel_id = v_pid) THEN
    SELECT string_agg(
      trim(
        concat(
          COALESCE(pos.name_th, ''),
          CASE WHEN pl.name_th IS NOT NULL THEN 'ระดับ' || pl.name_th ELSE '' END,
          CASE
            WHEN NULLIF(concat_ws(' / ', edo.name_th, edd.name_th, edv.name_th), '') IS NOT NULL
            THEN ' (' || concat_ws(' / ', edo.name_th, edd.name_th, edv.name_th) || ')'
            ELSE ''
          END
        )
      ),
      ', ' ORDER BY ed.effective_date DESC NULLS LAST, ed.created_at DESC
    )
    INTO v_deputizing_summary
    FROM public.personnel_executive_duties ed
    LEFT JOIN public.positions pos ON pos.id = ed.position_id
    LEFT JOIN public.position_levels pl ON pl.id = ed.position_level_id
    LEFT JOIN public.org_units edo ON edo.id = ed.office_id
    LEFT JOIN public.org_units edd ON edd.id = ed.department_id
    LEFT JOIN public.org_units edv ON edv.id = ed.division_id
    WHERE ed.personnel_id = v_pid
      AND ed.duty_type = 'DEPUTIZING'
      AND ed.end_date IS NULL;

    SELECT string_agg(
      trim(
        concat(
          COALESCE(pos.name_th, ''),
          CASE WHEN pl.name_th IS NOT NULL THEN 'ระดับ' || pl.name_th ELSE '' END,
          CASE
            WHEN NULLIF(concat_ws(' / ', edo.name_th, edd.name_th, edv.name_th), '') IS NOT NULL
            THEN ' (' || concat_ws(' / ', edo.name_th, edd.name_th, edv.name_th) || ')'
            ELSE ''
          END
        )
      ),
      ', ' ORDER BY ed.effective_date DESC NULLS LAST, ed.created_at DESC
    )
    INTO v_acting_summary
    FROM public.personnel_executive_duties ed
    LEFT JOIN public.positions pos ON pos.id = ed.position_id
    LEFT JOIN public.position_levels pl ON pl.id = ed.position_level_id
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

  -- Guard 3: Salary History -> personnel_career_records
  SELECT sh.*
  INTO v_latest_sal
  FROM public.personnel_salary_history sh
  WHERE sh.personnel_id = v_pid
  ORDER BY sh.effective_date DESC, sh.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.personnel_career_records SET
      current_salary = v_latest_sal.base_salary,
      position_allowance = COALESCE(v_latest_sal.position_allowance, 0),
      is_max_step = COALESCE(v_latest_sal.is_max_step, false),
      updated_by = auth.uid()
    WHERE personnel_id = v_pid;
  END IF;

  -- Guard 4: Disciplinary Records -> disciplinary_flag (true OR false) & disciplinary_note
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
      '; ' ORDER BY dr.effective_date DESC, dr.created_at DESC
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

-- -----------------------------------------------------------------------------
-- Step 8: Upgrade fn_dashboard_stats & fn_schema_health (35 Expected Tables)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_personnel', (SELECT count(*) FROM public.v_personnel_directory),
    'active_personnel', (SELECT count(*) FROM public.v_personnel_directory WHERE allows_account_provision = true),
    'total_users', (SELECT count(*) FROM public.v_users_scoped),
    'pending_reset_requests', (SELECT count(*) FROM public.credential_reset_requests WHERE status = 'PENDING'),
    'total_webapps', (SELECT count(*) FROM public.webapps WHERE status = 'ACTIVE'),
    'drivers_count', 0,
    'approvers_count', (SELECT count(*) FROM public.v_personnel_approvers),
    'executive_duties_count', (
      SELECT count(DISTINCT ed.personnel_id)
      FROM public.personnel_executive_duties ed
      JOIN public.v_personnel_directory d ON d.id = ed.personnel_id
      WHERE ed.end_date IS NULL
    ),
    'personnel_by_office', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('name', COALESCE(office_name, 'ไม่ระบุสังกัด'), 'count', cnt) ORDER BY cnt DESC)
       FROM (SELECT office_name, count(*)::integer AS cnt FROM public.v_personnel_directory GROUP BY office_name LIMIT 10) t1),
      '[]'::jsonb
    ),
    'personnel_by_position_type', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('name', COALESCE(pt_name, 'ไม่ระบุ'), 'color', COALESCE(pt_color, '#00744B'), 'count', cnt) ORDER BY cnt DESC)
       FROM (
         SELECT d.position_type_name AS pt_name, pt.color_hex AS pt_color, count(*)::integer AS cnt
         FROM public.v_personnel_directory d
         LEFT JOIN public.position_types pt ON pt.id = d.position_type_id
         GROUP BY d.position_type_name, pt.color_hex
       ) t2),
      '[]'::jsonb
    ),
    'recent_audits', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('id', id, 'action', action, 'entity_type', entity_type, 'cid_masked', cid_masked, 'created_at', created_at))
       FROM (SELECT id, action, entity_type, cid_masked, created_at FROM public.audit_logs ORDER BY created_at DESC LIMIT 8) t3),
      '[]'::jsonb
    )
  ) INTO v_res;

  RETURN v_res;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_dashboard_stats() TO authenticated;

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

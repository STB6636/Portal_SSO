-- =============================================================================
-- Migration 007: Relational Views (SECURITY INVOKER — Respects Scoped RLS)
-- =============================================================================

-- 1. v_personnel_directory
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
  u.status AS user_status
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

-- 2. v_users_scoped
CREATE OR REPLACE VIEW public.v_users_scoped
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

-- 3. v_user_app_access_matrix
CREATE OR REPLACE VIEW public.v_user_app_access_matrix
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

-- 4. v_webapps_with_roles
CREATE OR REPLACE VIEW public.v_webapps_with_roles
WITH (security_invoker = true) AS
SELECT
  w.id,
  w.app_code,
  w.name,
  w.description,
  w.url,
  w.icon,
  w.icon_url,
  w.color,
  w.status,
  w.auto_grant_on_provision,
  w.sort_order,
  w.api_key_prefix,
  w.created_at,
  w.updated_at,
  COALESCE(
    (SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.hierarchy_level DESC, r.sort_order)
     FROM public.webapp_roles r WHERE r.webapp_id = w.id),
    '[]'::jsonb
  ) AS roles,
  COALESCE(
    (SELECT array_agg(ws.scope_code ORDER BY ws.scope_code)
     FROM public.webapp_scopes ws WHERE ws.webapp_id = w.id),
    ARRAY[]::text[]
  ) AS scopes,
  COALESCE(
    (SELECT array_agg(ao.origin_url ORDER BY ao.origin_url)
     FROM public.webapp_allowed_origins ao WHERE ao.webapp_id = w.id),
    ARRAY[]::text[]
  ) AS allowed_origins,
  (SELECT count(*)::integer FROM public.user_app_permissions up
   WHERE up.webapp_id = w.id AND up.is_allowed = true
     AND (up.expires_at IS NULL OR up.expires_at > now())) AS authorized_count
FROM public.webapps w;

-- 5. v_personnel_drivers (CAR_REQUEST domain)
CREATE OR REPLACE VIEW public.v_personnel_drivers
WITH (security_invoker = true) AS
SELECT
  d.id,
  d.personnel_code,
  d.full_name,
  d.phone_number,
  d.office_id,
  d.office_name,
  d.department_id,
  d.department_name,
  d.driver_status_id,
  d.driver_status_name,
  COALESCE(ld.is_dispatchable, false) AS is_dispatchable,
  d.has_position_vehicle,
  d.signature_path
FROM public.v_personnel_directory d
LEFT JOIN public.lookup_items ld ON ld.id = d.driver_status_id
WHERE d.is_driver = true;

-- 6. v_personnel_approvers (CAR_REQUEST / General Approver API)
CREATE OR REPLACE VIEW public.v_personnel_approvers
WITH (security_invoker = true) AS
SELECT
  d.id,
  d.personnel_code,
  d.full_name,
  d.position_name,
  d.position_level_name,
  d.acting_position,
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

-- 7. v_personnel_royal_dec (ROYAL_DEC domain)
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

-- =============================================================================
-- Migration 008: Atomic Transactional RPCs (Portal SSO Core in public)
-- =============================================================================

-- 1. fn_get_public_settings
CREATE OR REPLACE FUNCTION public.fn_get_public_settings()
RETURNS TABLE (key text, value text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.key, s.value
  FROM public.system_settings s
  WHERE s.is_public = true
  ORDER BY s.key;
$$;
GRANT EXECUTE ON FUNCTION public.fn_get_public_settings() TO anon, authenticated;

-- 2. fn_is_initialized
CREATE OR REPLACE FUNCTION public.fn_is_initialized()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users LIMIT 1);
$$;
GRANT EXECUTE ON FUNCTION public.fn_is_initialized() TO anon, authenticated;

-- 3. fn_get_my_profile
CREATE OR REPLACE FUNCTION public.fn_get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

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
    'position_display', concat(COALESCE(pos.name_th, ''), COALESCE(pl.name_th, '')),
    'office_name', oo.name_th,
    'department_name', od.name_th,
    'admin_scope', CASE
      WHEN u.role = 'ADMIN' AND sc.user_id IS NOT NULL THEN jsonb_build_object(
        'scope_level_no', sc.scope_level_no,
        'org_unit_id', sc.org_unit_id,
        'org_unit_name', so.name_th,
        'parent_office_id', so.parent_id
      )
      ELSE NULL
    END
  ) INTO v_res
  FROM public.users u
  LEFT JOIN public.personnel p ON p.id = u.personnel_id
  LEFT JOIN public.lookup_items lp ON lp.id = p.prefix_id
  LEFT JOIN public.personnel_assignments pa ON pa.personnel_id = p.id
  LEFT JOIN public.positions pos ON pos.id = pa.position_id
  LEFT JOIN public.position_levels pl ON pl.id = pa.position_level_id
  LEFT JOIN public.org_units oo ON oo.id = pa.office_id
  LEFT JOIN public.org_units od ON od.id = pa.department_id
  LEFT JOIN public.user_admin_scopes sc ON sc.user_id = u.id
  LEFT JOIN public.org_units so ON so.id = sc.org_unit_id
  WHERE u.id = v_uid;

  RETURN v_res;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_get_my_profile() TO authenticated;

-- 4. fn_get_my_apps (SUPERADMIN automatically receives highest is_app_admin role)
CREATE OR REPLACE FUNCTION public.fn_get_my_apps()
RETURNS TABLE (
  webapp_id uuid,
  app_code text,
  name text,
  description text,
  url text,
  icon text,
  icon_url text,
  color text,
  status text,
  role_code text,
  role_name_th text,
  role_color text,
  hierarchy_level integer,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := public.fn_current_user_role();
BEGIN
  IF v_role = 'SUPERADMIN' THEN
    RETURN QUERY
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
      COALESCE(ar.role_code, 'APP_ADMIN'),
      COALESCE(ar.role_name_th, 'ผู้ดูแลระบบสูงสุด'),
      COALESCE(ar.color_hex, '#BE123C'),
      COALESCE(ar.hierarchy_level, 99),
      NULL::timestamptz
    FROM public.webapps w
    LEFT JOIN LATERAL (
      SELECT r.*
      FROM public.webapp_roles r
      WHERE r.webapp_id = w.id AND r.is_active = true
      ORDER BY r.is_app_admin DESC, r.hierarchy_level DESC
      LIMIT 1
    ) ar ON true
    WHERE w.status <> 'DISABLED'
    ORDER BY w.sort_order, w.name;
  ELSE
    RETURN QUERY
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
      wr.role_code,
      wr.role_name_th,
      wr.color_hex,
      wr.hierarchy_level,
      uap.expires_at
    FROM public.user_app_permissions uap
    JOIN public.webapps w ON w.id = uap.webapp_id
    JOIN public.webapp_roles wr ON wr.id = uap.webapp_role_id
    WHERE uap.user_id = auth.uid()
      AND uap.is_allowed = true
      AND (uap.expires_at IS NULL OR uap.expires_at > now())
      AND w.status <> 'DISABLED'
      AND wr.is_active = true
    ORDER BY w.sort_order, w.name;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_get_my_apps() TO authenticated;

-- 5. fn_dashboard_stats (Scoped by RLS via v_personnel_directory)
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
    'drivers_count', (SELECT count(*) FROM public.v_personnel_drivers),
    'approvers_count', (SELECT count(*) FROM public.v_personnel_approvers),
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

-- 6. fn_save_personnel_bundle (Atomic 5-table upsert with scope enforcement)
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
      trim(v_p->>'first_name'),
      trim(v_p->>'last_name'),
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
      first_name = trim(v_p->>'first_name'),
      last_name = trim(v_p->>'last_name'),
      gender_id = NULLIF(v_p->>'gender_id', '')::uuid,
      birth_date = NULLIF(v_p->>'birth_date', '')::date,
      phone_number = NULLIF(trim(v_p->>'phone_number'), ''),
      email = NULLIF(lower(trim(v_p->>'email')), ''),
      photo_path = NULLIF(trim(v_p->>'photo_path'), ''),
      signature_path = NULLIF(trim(v_p->>'signature_path'), ''),
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
    current_position_date = EXCLUDED.current_position_date,
    current_level_date = EXCLUDED.current_level_date,
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
    disciplinary_flag = EXCLUDED.disciplinary_flag,
    disciplinary_note = EXCLUDED.disciplinary_note,
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

-- 7. fn_check_existing_cids_with_snapshot (Used by Staging Grid for UpsertDiffModal)
CREATE OR REPLACE FUNCTION public.fn_check_existing_cids_with_snapshot(p_cids text[])
RETURNS TABLE (
  personnel_id uuid,
  cid text,
  personnel_code text,
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
    p.personnel_code,
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

-- 8. fn_import_personnel_batch (Atomic per-row savepoint re-validating CID & Admin Scope)
CREATE OR REPLACE FUNCTION public.fn_import_personnel_batch(
  p_job_id uuid,
  p_rows_jsonb jsonb,
  p_mode text DEFAULT 'UPSERT'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_cid text;
  v_existing_id uuid;
  v_office_id uuid;
  v_dept_id uuid;
  v_saved_id uuid;
  v_sheet_row integer;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_saved_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF public.fn_current_user_role() NOT IN ('SUPERADMIN', 'ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows_jsonb) LOOP
    v_sheet_row := COALESCE((v_row->>'sheet_row_no')::integer, 0);
    v_cid := regexp_replace(COALESCE(v_row->'personnel'->>'cid', ''), '[\s-]', '', 'g');
    v_office_id := NULLIF(v_row->'assignment'->>'office_id', '')::uuid;
    v_dept_id := NULLIF(v_row->'assignment'->>'department_id', '')::uuid;

    BEGIN
      IF NOT public.fn_valid_cid(v_cid) THEN
        RAISE EXCEPTION 'CID_MOD11_FAILED';
      END IF;

      IF NOT public.fn_is_org_in_my_scope(v_office_id, v_dept_id) THEN
        RAISE EXCEPTION 'OUT_OF_ADMIN_SCOPE';
      END IF;

      SELECT id INTO v_existing_id FROM public.personnel WHERE cid = v_cid;

      IF v_existing_id IS NOT NULL AND p_mode = 'INSERT_ONLY' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF v_existing_id IS NOT NULL THEN
        v_row := jsonb_set(v_row, '{personnel,id}', to_jsonb(v_existing_id::text));
        v_saved_id := public.fn_save_personnel_bundle(v_row);
        v_updated := v_updated + 1;
      ELSE
        v_saved_id := public.fn_save_personnel_bundle(v_row);
        v_inserted := v_inserted + 1;
      END IF;

      v_saved_ids := array_append(v_saved_ids, v_saved_id);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      IF p_job_id IS NOT NULL THEN
        INSERT INTO public.import_job_errors (job_id, sheet_row_no, cid_masked, column_key, error_code, error_message)
        VALUES (p_job_id, v_sheet_row, public.fn_mask_cid(v_cid), 'row', SQLSTATE, SQLERRM);
      END IF;
    END;
  END LOOP;

  IF p_job_id IS NOT NULL THEN
    UPDATE public.import_jobs SET
      inserted = inserted + v_inserted,
      updated = updated + v_updated,
      skipped = skipped + v_skipped,
      failed = failed + v_failed
    WHERE id = p_job_id;
  END IF;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'failed', v_failed,
    'saved_personnel_ids', to_jsonb(v_saved_ids)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_import_personnel_batch(uuid, jsonb, text) TO authenticated;

-- 9. fn_save_webapp_with_roles (SUPERADMIN only)
CREATE OR REPLACE FUNCTION public.fn_save_webapp_with_roles(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wid uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_r jsonb;
  v_scope text;
  v_origin text;
  v_keep_role_ids uuid[] := ARRAY[]::uuid[];
  v_rid uuid;
BEGIN
  IF public.fn_current_user_role() <> 'SUPERADMIN' THEN
    RAISE EXCEPTION 'Only SUPERADMIN can configure webapps';
  END IF;

  IF v_wid IS NULL THEN
    INSERT INTO public.webapps (
      app_code, name, description, url, icon, icon_url, color, status,
      auto_grant_on_provision, sort_order, created_by
    ) VALUES (
      upper(trim(p_payload->>'app_code')),
      trim(p_payload->>'name'),
      NULLIF(trim(p_payload->>'description'), ''),
      trim(p_payload->>'url'),
      COALESCE(NULLIF(trim(p_payload->>'icon'), ''), 'fa-window-maximize'),
      NULLIF(trim(p_payload->>'icon_url'), ''),
      COALESCE(NULLIF(trim(p_payload->>'color'), ''), '#00744B'),
      COALESCE(NULLIF(trim(p_payload->>'status'), ''), 'ACTIVE'),
      COALESCE((p_payload->>'auto_grant_on_provision')::boolean, false),
      COALESCE((p_payload->>'sort_order')::integer, 0),
      auth.uid()
    ) RETURNING id INTO v_wid;
  ELSE
    UPDATE public.webapps SET
      app_code = upper(trim(p_payload->>'app_code')),
      name = trim(p_payload->>'name'),
      description = NULLIF(trim(p_payload->>'description'), ''),
      url = trim(p_payload->>'url'),
      icon = COALESCE(NULLIF(trim(p_payload->>'icon'), ''), 'fa-window-maximize'),
      icon_url = NULLIF(trim(p_payload->>'icon_url'), ''),
      color = COALESCE(NULLIF(trim(p_payload->>'color'), ''), '#00744B'),
      status = COALESCE(NULLIF(trim(p_payload->>'status'), ''), 'ACTIVE'),
      auto_grant_on_provision = COALESCE((p_payload->>'auto_grant_on_provision')::boolean, false),
      sort_order = COALESCE((p_payload->>'sort_order')::integer, 0)
    WHERE id = v_wid;
  END IF;

  -- Upsert webapp_roles
  IF p_payload ? 'roles' AND jsonb_typeof(p_payload->'roles') = 'array' THEN
    FOR v_r IN SELECT * FROM jsonb_array_elements(p_payload->'roles') LOOP
      v_rid := NULLIF(v_r->>'id', '')::uuid;
      IF v_rid IS NULL THEN
        INSERT INTO public.webapp_roles (
          webapp_id, role_code, role_name_th, description, hierarchy_level, color_hex,
          is_default_on_grant, is_app_admin, allow_scoped_admin_grant, sort_order, is_active
        ) VALUES (
          v_wid,
          upper(trim(v_r->>'role_code')),
          trim(v_r->>'role_name_th'),
          NULLIF(trim(v_r->>'description'), ''),
          COALESCE((v_r->>'hierarchy_level')::integer, 1),
          COALESCE(NULLIF(trim(v_r->>'color_hex'), ''), '#00744B'),
          COALESCE((v_r->>'is_default_on_grant')::boolean, false),
          COALESCE((v_r->>'is_app_admin')::boolean, false),
          COALESCE((v_r->>'allow_scoped_admin_grant')::boolean, true),
          COALESCE((v_r->>'sort_order')::integer, 0),
          COALESCE((v_r->>'is_active')::boolean, true)
        )
        ON CONFLICT (webapp_id, role_code) DO UPDATE SET
          role_name_th = EXCLUDED.role_name_th,
          description = EXCLUDED.description,
          hierarchy_level = EXCLUDED.hierarchy_level,
          color_hex = EXCLUDED.color_hex,
          is_default_on_grant = EXCLUDED.is_default_on_grant,
          is_app_admin = EXCLUDED.is_app_admin,
          allow_scoped_admin_grant = EXCLUDED.allow_scoped_admin_grant,
          sort_order = EXCLUDED.sort_order,
          is_active = EXCLUDED.is_active
        RETURNING id INTO v_rid;
      ELSE
        UPDATE public.webapp_roles SET
          role_code = upper(trim(v_r->>'role_code')),
          role_name_th = trim(v_r->>'role_name_th'),
          description = NULLIF(trim(v_r->>'description'), ''),
          hierarchy_level = COALESCE((v_r->>'hierarchy_level')::integer, 1),
          color_hex = COALESCE(NULLIF(trim(v_r->>'color_hex'), ''), '#00744B'),
          is_default_on_grant = COALESCE((v_r->>'is_default_on_grant')::boolean, false),
          is_app_admin = COALESCE((v_r->>'is_app_admin')::boolean, false),
          allow_scoped_admin_grant = COALESCE((v_r->>'allow_scoped_admin_grant')::boolean, true),
          sort_order = COALESCE((v_r->>'sort_order')::integer, 0),
          is_active = COALESCE((v_r->>'is_active')::boolean, true)
        WHERE id = v_rid AND webapp_id = v_wid;
      END IF;
      v_keep_role_ids := array_append(v_keep_role_ids, v_rid);
    END LOOP;

    DELETE FROM public.webapp_roles
    WHERE webapp_id = v_wid
      AND NOT (id = ANY(v_keep_role_ids))
      AND NOT EXISTS (SELECT 1 FROM public.user_app_permissions up WHERE up.webapp_role_id = webapp_roles.id);
  END IF;

  -- Sync scopes
  IF p_payload ? 'scopes' AND jsonb_typeof(p_payload->'scopes') = 'array' THEN
    DELETE FROM public.webapp_scopes WHERE webapp_id = v_wid;
    FOR v_scope IN SELECT jsonb_array_elements_text(p_payload->'scopes') LOOP
      INSERT INTO public.webapp_scopes (webapp_id, scope_code) VALUES (v_wid, v_scope) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- Sync allowed origins
  IF p_payload ? 'allowed_origins' AND jsonb_typeof(p_payload->'allowed_origins') = 'array' THEN
    DELETE FROM public.webapp_allowed_origins WHERE webapp_id = v_wid;
    FOR v_origin IN SELECT jsonb_array_elements_text(p_payload->'allowed_origins') LOOP
      IF trim(v_origin) <> '' THEN
        INSERT INTO public.webapp_allowed_origins (webapp_id, origin_url) VALUES (v_wid, trim(v_origin)) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_wid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_save_webapp_with_roles(jsonb) TO authenticated;

-- 10. fn_bulk_grant_webapp_access (Respects Scoped Admin & allow_scoped_admin_grant)
CREATE OR REPLACE FUNCTION public.fn_bulk_grant_webapp_access(
  p_webapp_id uuid,
  p_webapp_role_id uuid,
  p_user_ids uuid[],
  p_is_allowed boolean DEFAULT true,
  p_expires_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role text := public.fn_current_user_role();
  v_allow_admin boolean;
  v_uid uuid;
  v_target_role text;
  v_target_pid uuid;
  v_count integer := 0;
BEGIN
  IF v_actor_role NOT IN ('SUPERADMIN', 'ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT allow_scoped_admin_grant INTO v_allow_admin
  FROM public.webapp_roles
  WHERE id = p_webapp_role_id AND webapp_id = p_webapp_id;

  IF v_allow_admin IS NULL THEN
    RAISE EXCEPTION 'Invalid webapp_role_id for webapp';
  END IF;

  IF v_actor_role = 'ADMIN' AND NOT v_allow_admin THEN
    RAISE EXCEPTION 'This webapp role can only be granted by SUPERADMIN';
  END IF;

  FOREACH v_uid IN ARRAY p_user_ids LOOP
    SELECT role, personnel_id INTO v_target_role, v_target_pid FROM public.users WHERE id = v_uid;
    IF v_target_role IS NULL THEN CONTINUE; END IF;

    IF v_actor_role = 'ADMIN' THEN
      IF v_target_role <> 'USER' OR NOT public.fn_is_personnel_in_my_scope(v_target_pid) THEN
        CONTINUE;
      END IF;
    END IF;

    INSERT INTO public.user_app_permissions (user_id, webapp_id, webapp_role_id, is_allowed, expires_at, note, granted_by)
    VALUES (v_uid, p_webapp_id, p_webapp_role_id, p_is_allowed, p_expires_at, p_note, auth.uid())
    ON CONFLICT (user_id, webapp_id) DO UPDATE SET
      webapp_role_id = EXCLUDED.webapp_role_id,
      is_allowed = EXCLUDED.is_allowed,
      expires_at = EXCLUDED.expires_at,
      note = EXCLUDED.note,
      granted_by = auth.uid();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_bulk_grant_webapp_access(uuid, uuid, uuid[], boolean, timestamptz, text) TO authenticated;

-- 11. fn_assign_user_role_and_scope (SUPERADMIN only)
CREATE OR REPLACE FUNCTION public.fn_assign_user_role_and_scope(
  p_user_id uuid,
  p_role text,
  p_scope_level_no smallint DEFAULT NULL,
  p_org_unit_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.fn_current_user_role() <> 'SUPERADMIN' THEN
    RAISE EXCEPTION 'Only SUPERADMIN can assign roles and admin scopes';
  END IF;

  IF p_role NOT IN ('SUPERADMIN', 'ADMIN', 'USER') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  IF p_role = 'ADMIN' AND (p_scope_level_no NOT IN (2, 3) OR p_org_unit_id IS NULL) THEN
    RAISE EXCEPTION 'ADMIN role requires scope_level_no (2=สำนักงาน/กอง or 3=ส่วน/ฝ่าย) and org_unit_id';
  END IF;

  UPDATE public.users SET role = p_role WHERE id = p_user_id;

  IF p_role = 'ADMIN' THEN
    INSERT INTO public.user_admin_scopes (user_id, scope_level_no, org_unit_id, assigned_by)
    VALUES (p_user_id, p_scope_level_no, p_org_unit_id, auth.uid())
    ON CONFLICT (user_id) DO UPDATE SET
      scope_level_no = EXCLUDED.scope_level_no,
      org_unit_id = EXCLUDED.org_unit_id,
      assigned_by = auth.uid();
  ELSE
    DELETE FROM public.user_admin_scopes WHERE user_id = p_user_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_assign_user_role_and_scope(uuid, text, smallint, uuid) TO authenticated;

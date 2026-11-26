-- =============================================================================
-- Migration 006: Scoped RLS Functions & Policies across ALL 31 Tables (public)
-- Enforces 3 Core Roles + 2-Tier Admin Scope (Lv2 office_id / Lv3 department_id)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid() AND status = 'ACTIVE' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_my_admin_scope()
RETURNS TABLE (scope_level_no smallint, org_unit_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.scope_level_no, s.org_unit_id
  FROM public.user_admin_scopes s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.user_id = auth.uid() AND u.role = 'ADMIN' AND u.status = 'ACTIVE'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_is_org_in_my_scope(p_office_id uuid, p_department_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_scope_level smallint;
  v_scope_org uuid;
BEGIN
  v_role := public.fn_current_user_role();
  IF v_role = 'SUPERADMIN' THEN
    RETURN true;
  END IF;

  IF v_role = 'ADMIN' THEN
    SELECT scope_level_no, org_unit_id INTO v_scope_level, v_scope_org
    FROM public.fn_my_admin_scope() LIMIT 1;

    IF v_scope_level = 2 THEN
      RETURN p_office_id IS NOT NULL AND p_office_id = v_scope_org;
    ELSIF v_scope_level = 3 THEN
      RETURN p_department_id IS NOT NULL AND p_department_id = v_scope_org;
    END IF;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_is_personnel_in_my_scope(p_personnel_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_my_pid uuid;
  v_office_id uuid;
  v_dept_id uuid;
BEGIN
  IF p_personnel_id IS NULL THEN
    RETURN false;
  END IF;

  v_role := public.fn_current_user_role();
  IF v_role = 'SUPERADMIN' THEN
    RETURN true;
  END IF;

  SELECT personnel_id INTO v_my_pid FROM public.users WHERE id = auth.uid();
  IF v_my_pid IS NOT NULL AND v_my_pid = p_personnel_id THEN
    RETURN true;
  END IF;

  IF v_role = 'ADMIN' THEN
    SELECT office_id, department_id INTO v_office_id, v_dept_id
    FROM public.personnel_assignments
    WHERE personnel_id = p_personnel_id;

    RETURN public.fn_is_org_in_my_scope(v_office_id, v_dept_id);
  END IF;

  RETURN false;
END;
$$;

-- Enable RLS explicitly on all 31 tables
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'lookup_categories', 'lookup_items', 'org_unit_levels', 'org_units',
    'position_types', 'positions', 'position_levels', 'position_allowed_levels',
    'decoration_classes', 'personnel', 'personnel_assignments',
    'personnel_fleet_profiles', 'personnel_career_records', 'personnel_decorations',
    'users', 'user_admin_scopes', 'api_scope_catalog', 'webapp_scope_presets',
    'webapp_scope_preset_items', 'webapps', 'webapp_roles', 'webapp_scopes',
    'webapp_allowed_origins', 'user_app_permissions', 'security_tokens',
    'credential_reset_requests', 'system_settings', 'import_jobs',
    'import_job_errors', 'audit_logs', 'login_attempts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_tbl);
  END LOOP;
END $$;

-- Group A (Master Lookups & Hierarchies): Authenticated Read, SUPERADMIN Write
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'lookup_categories', 'lookup_items', 'org_unit_levels', 'org_units',
    'position_types', 'positions', 'position_levels', 'position_allowed_levels',
    'decoration_classes', 'api_scope_catalog', 'webapp_scope_presets',
    'webapp_scope_preset_items'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth_read_%s" ON public.%I;', v_tbl, v_tbl);
    EXECUTE format('CREATE POLICY "auth_read_%s" ON public.%I FOR SELECT TO authenticated USING (true);', v_tbl, v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS "sa_write_%s" ON public.%I;', v_tbl, v_tbl);
    EXECUTE format('CREATE POLICY "sa_write_%s" ON public.%I FOR ALL TO authenticated USING (public.fn_current_user_role() = ''SUPERADMIN'') WITH CHECK (public.fn_current_user_role() = ''SUPERADMIN'');', v_tbl, v_tbl);
  END LOOP;
END $$;

-- Group B: Personnel Domain (Scoped RLS)
DROP POLICY IF EXISTS "scoped_select_personnel" ON public.personnel;
CREATE POLICY "scoped_select_personnel" ON public.personnel
  FOR SELECT TO authenticated
  USING (public.fn_is_personnel_in_my_scope(id));

DROP POLICY IF EXISTS "scoped_insert_personnel" ON public.personnel;
CREATE POLICY "scoped_insert_personnel" ON public.personnel
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_current_user_role() IN ('SUPERADMIN', 'ADMIN'));

DROP POLICY IF EXISTS "scoped_update_personnel" ON public.personnel;
CREATE POLICY "scoped_update_personnel" ON public.personnel
  FOR UPDATE TO authenticated
  USING (public.fn_is_personnel_in_my_scope(id))
  WITH CHECK (public.fn_is_personnel_in_my_scope(id));

DROP POLICY IF EXISTS "scoped_delete_personnel" ON public.personnel;
CREATE POLICY "scoped_delete_personnel" ON public.personnel
  FOR DELETE TO authenticated
  USING (public.fn_current_user_role() = 'SUPERADMIN' OR (public.fn_current_user_role() = 'ADMIN' AND public.fn_is_personnel_in_my_scope(id)));

-- personnel_assignments
DROP POLICY IF EXISTS "scoped_all_personnel_assignments" ON public.personnel_assignments;
CREATE POLICY "scoped_all_personnel_assignments" ON public.personnel_assignments
  FOR ALL TO authenticated
  USING (
    public.fn_current_user_role() = 'SUPERADMIN'
    OR personnel_id = (SELECT personnel_id FROM public.users WHERE id = auth.uid())
    OR public.fn_is_org_in_my_scope(office_id, department_id)
  )
  WITH CHECK (
    public.fn_current_user_role() = 'SUPERADMIN'
    OR public.fn_is_org_in_my_scope(office_id, department_id)
  );

-- personnel_fleet_profiles, personnel_career_records, personnel_decorations
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['personnel_fleet_profiles', 'personnel_career_records', 'personnel_decorations']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "scoped_select_%s" ON public.%I;', v_tbl, v_tbl);
    EXECUTE format('CREATE POLICY "scoped_select_%s" ON public.%I FOR SELECT TO authenticated USING (public.fn_is_personnel_in_my_scope(personnel_id));', v_tbl, v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS "scoped_write_%s" ON public.%I;', v_tbl, v_tbl);
    EXECUTE format('CREATE POLICY "scoped_write_%s" ON public.%I FOR ALL TO authenticated USING (public.fn_current_user_role() IN (''SUPERADMIN'',''ADMIN'') AND public.fn_is_personnel_in_my_scope(personnel_id)) WITH CHECK (public.fn_current_user_role() IN (''SUPERADMIN'',''ADMIN'') AND public.fn_is_personnel_in_my_scope(personnel_id));', v_tbl, v_tbl);
  END LOOP;
END $$;

-- users & user_admin_scopes
DROP POLICY IF EXISTS "scoped_select_users" ON public.users;
CREATE POLICY "scoped_select_users" ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.fn_current_user_role() = 'SUPERADMIN'
    OR (public.fn_current_user_role() = 'ADMIN' AND public.fn_is_personnel_in_my_scope(personnel_id))
  );

DROP POLICY IF EXISTS "scoped_update_users" ON public.users;
CREATE POLICY "scoped_update_users" ON public.users
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR public.fn_current_user_role() = 'SUPERADMIN'
    OR (public.fn_current_user_role() = 'ADMIN' AND role = 'USER' AND public.fn_is_personnel_in_my_scope(personnel_id))
  );

DROP POLICY IF EXISTS "select_admin_scopes" ON public.user_admin_scopes;
CREATE POLICY "select_admin_scopes" ON public.user_admin_scopes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.fn_current_user_role() = 'SUPERADMIN');

DROP POLICY IF EXISTS "sa_write_admin_scopes" ON public.user_admin_scopes;
CREATE POLICY "sa_write_admin_scopes" ON public.user_admin_scopes
  FOR ALL TO authenticated
  USING (public.fn_current_user_role() = 'SUPERADMIN')
  WITH CHECK (public.fn_current_user_role() = 'SUPERADMIN');

-- webapps, webapp_roles, webapp_scopes, webapp_allowed_origins
DROP POLICY IF EXISTS "auth_read_webapps" ON public.webapps;
CREATE POLICY "auth_read_webapps" ON public.webapps FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sa_write_webapps" ON public.webapps;
CREATE POLICY "sa_write_webapps" ON public.webapps FOR ALL TO authenticated
  USING (public.fn_current_user_role() = 'SUPERADMIN')
  WITH CHECK (public.fn_current_user_role() = 'SUPERADMIN');

DROP POLICY IF EXISTS "auth_read_webapp_roles" ON public.webapp_roles;
CREATE POLICY "auth_read_webapp_roles" ON public.webapp_roles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sa_write_webapp_roles" ON public.webapp_roles;
CREATE POLICY "sa_write_webapp_roles" ON public.webapp_roles FOR ALL TO authenticated
  USING (public.fn_current_user_role() = 'SUPERADMIN')
  WITH CHECK (public.fn_current_user_role() = 'SUPERADMIN');

DROP POLICY IF EXISTS "sa_all_webapp_scopes" ON public.webapp_scopes;
CREATE POLICY "sa_all_webapp_scopes" ON public.webapp_scopes FOR ALL TO authenticated
  USING (public.fn_current_user_role() = 'SUPERADMIN')
  WITH CHECK (public.fn_current_user_role() = 'SUPERADMIN');

DROP POLICY IF EXISTS "sa_all_webapp_allowed_origins" ON public.webapp_allowed_origins;
CREATE POLICY "sa_all_webapp_allowed_origins" ON public.webapp_allowed_origins FOR ALL TO authenticated
  USING (public.fn_current_user_role() = 'SUPERADMIN')
  WITH CHECK (public.fn_current_user_role() = 'SUPERADMIN');

-- user_app_permissions (respects Admin scope & allow_scoped_admin_grant)
DROP POLICY IF EXISTS "scoped_select_user_app_permissions" ON public.user_app_permissions;
CREATE POLICY "scoped_select_user_app_permissions" ON public.user_app_permissions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.fn_current_user_role() = 'SUPERADMIN'
    OR (
      public.fn_current_user_role() = 'ADMIN'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = user_app_permissions.user_id
          AND public.fn_is_personnel_in_my_scope(u.personnel_id)
      )
    )
  );

DROP POLICY IF EXISTS "scoped_write_user_app_permissions" ON public.user_app_permissions;
CREATE POLICY "scoped_write_user_app_permissions" ON public.user_app_permissions
  FOR ALL TO authenticated
  USING (
    public.fn_current_user_role() = 'SUPERADMIN'
    OR (
      public.fn_current_user_role() = 'ADMIN'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = user_app_permissions.user_id
          AND u.role = 'USER'
          AND public.fn_is_personnel_in_my_scope(u.personnel_id)
      )
      AND EXISTS (
        SELECT 1 FROM public.webapp_roles wr
        WHERE wr.id = user_app_permissions.webapp_role_id
          AND wr.allow_scoped_admin_grant = true
      )
    )
  )
  WITH CHECK (
    public.fn_current_user_role() = 'SUPERADMIN'
    OR (
      public.fn_current_user_role() = 'ADMIN'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = user_app_permissions.user_id
          AND u.role = 'USER'
          AND public.fn_is_personnel_in_my_scope(u.personnel_id)
      )
      AND EXISTS (
        SELECT 1 FROM public.webapp_roles wr
        WHERE wr.id = user_app_permissions.webapp_role_id
          AND wr.allow_scoped_admin_grant = true
      )
    )
  );

-- credential_reset_requests
DROP POLICY IF EXISTS "scoped_select_reset_requests" ON public.credential_reset_requests;
CREATE POLICY "scoped_select_reset_requests" ON public.credential_reset_requests
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.fn_current_user_role() = 'SUPERADMIN'
    OR (public.fn_current_user_role() = 'ADMIN' AND public.fn_is_personnel_in_my_scope(personnel_id))
  );

DROP POLICY IF EXISTS "scoped_update_reset_requests" ON public.credential_reset_requests;
CREATE POLICY "scoped_update_reset_requests" ON public.credential_reset_requests
  FOR UPDATE TO authenticated
  USING (
    public.fn_current_user_role() = 'SUPERADMIN'
    OR (public.fn_current_user_role() = 'ADMIN' AND public.fn_is_personnel_in_my_scope(personnel_id))
  );

-- system_settings
DROP POLICY IF EXISTS "read_public_system_settings" ON public.system_settings;
CREATE POLICY "read_public_system_settings" ON public.system_settings
  FOR SELECT TO anon, authenticated
  USING (is_public = true OR public.fn_current_user_role() = 'SUPERADMIN');

DROP POLICY IF EXISTS "sa_write_system_settings" ON public.system_settings;
CREATE POLICY "sa_write_system_settings" ON public.system_settings
  FOR ALL TO authenticated
  USING (public.fn_current_user_role() = 'SUPERADMIN')
  WITH CHECK (public.fn_current_user_role() = 'SUPERADMIN');

-- import_jobs & import_job_errors
DROP POLICY IF EXISTS "scoped_all_import_jobs" ON public.import_jobs;
CREATE POLICY "scoped_all_import_jobs" ON public.import_jobs
  FOR ALL TO authenticated
  USING (public.fn_current_user_role() = 'SUPERADMIN' OR created_by = auth.uid())
  WITH CHECK (public.fn_current_user_role() IN ('SUPERADMIN', 'ADMIN'));

DROP POLICY IF EXISTS "scoped_all_import_job_errors" ON public.import_job_errors;
CREATE POLICY "scoped_all_import_job_errors" ON public.import_job_errors
  FOR ALL TO authenticated
  USING (
    public.fn_current_user_role() = 'SUPERADMIN'
    OR EXISTS (SELECT 1 FROM public.import_jobs j WHERE j.id = import_job_errors.job_id AND j.created_by = auth.uid())
  )
  WITH CHECK (public.fn_current_user_role() IN ('SUPERADMIN', 'ADMIN'));

-- audit_logs
DROP POLICY IF EXISTS "scoped_select_audit_logs" ON public.audit_logs;
CREATE POLICY "scoped_select_audit_logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.fn_current_user_role() = 'SUPERADMIN'
    OR actor_user_id = auth.uid()
    OR (public.fn_current_user_role() = 'ADMIN' AND public.fn_is_org_in_my_scope(office_id, department_id))
  );

-- security_tokens & login_attempts: Edge Functions (service_role) only; deny direct client access
DROP POLICY IF EXISTS "deny_client_security_tokens" ON public.security_tokens;
CREATE POLICY "deny_client_security_tokens" ON public.security_tokens
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "sa_read_login_attempts" ON public.login_attempts;
CREATE POLICY "sa_read_login_attempts" ON public.login_attempts
  FOR SELECT TO authenticated USING (public.fn_current_user_role() = 'SUPERADMIN');

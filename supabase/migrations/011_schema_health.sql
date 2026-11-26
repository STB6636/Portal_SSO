-- =============================================================================
-- Migration 011: Schema Health & Self-Repair Diagnostics (31 Tables in public)
-- =============================================================================

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

CREATE OR REPLACE FUNCTION public.fn_schema_repair()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tbl text;
  v_fixed integer := 0;
BEGIN
  IF public.fn_current_user_role() <> 'SUPERADMIN' THEN
    RAISE EXCEPTION 'Only SUPERADMIN can run schema repair';
  END IF;

  FOR v_tbl IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_tbl);
    v_fixed := v_fixed + 1;
  END LOOP;

  PERFORM public.fn_cleanup_expired_security_records();

  RETURN jsonb_build_object(
    'repaired_rls_tables', v_fixed,
    'health', public.fn_schema_health()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_schema_repair() TO authenticated;

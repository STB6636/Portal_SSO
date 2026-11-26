-- =============================================================================
-- Migration 005: Domain Constraints, Mod 11 CID Validator & Integrity Triggers
-- =============================================================================

-- Thai 13-digit CID Mod 11 validation
CREATE OR REPLACE FUNCTION public.fn_valid_cid(p_cid text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text;
  v_sum integer := 0;
  v_i integer;
  v_check integer;
BEGIN
  IF p_cid IS NULL THEN
    RETURN false;
  END IF;
  v_clean := regexp_replace(trim(p_cid), '[\s-]', '', 'g');
  IF v_clean !~ '^\d{13}$' THEN
    RETURN false;
  END IF;
  FOR v_i IN 1..12 LOOP
    v_sum := v_sum + (substr(v_clean, v_i, 1)::integer * (14 - v_i));
  END LOOP;
  v_check := (11 - (v_sum % 11)) % 10;
  RETURN v_check = substr(v_clean, 13, 1)::integer;
END;
$$;

-- PDPA CID Masking helper (1-xxxx-xxxxx-12-3)
CREATE OR REPLACE FUNCTION public.fn_mask_cid(p_cid text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text;
BEGIN
  v_clean := regexp_replace(COALESCE(p_cid, ''), '\D', '', 'g');
  IF length(v_clean) <> 13 THEN
    RETURN 'x-xxxx-xxxxx-xx-x';
  END IF;
  RETURN substr(v_clean, 1, 1) || '-xxxx-xxxxx-' || substr(v_clean, 11, 2) || '-' || substr(v_clean, 13, 1);
END;
$$;

-- Add CID check constraint on personnel
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_personnel_valid_cid'
  ) THEN
    ALTER TABLE public.personnel
      ADD CONSTRAINT chk_personnel_valid_cid CHECK (public.fn_valid_cid(cid));
  END IF;
END $$;

-- Generic updated_at touch trigger
CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Validate 4-level org_units parent hierarchy (1 -> 2 -> 3 -> 4)
CREATE OR REPLACE FUNCTION public.fn_org_parent_level_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_level_no smallint;
  v_parent_level_no smallint;
BEGIN
  SELECT level_no INTO v_level_no FROM public.org_unit_levels WHERE id = NEW.level_id;
  IF v_level_no IS NULL THEN
    RAISE EXCEPTION 'Invalid org_unit level_id';
  END IF;

  IF v_level_no = 1 THEN
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Level 1 org unit (สำนัก) must not have parent_id';
    END IF;
  ELSE
    IF NEW.parent_id IS NULL THEN
      RAISE EXCEPTION 'Level % org unit requires a parent_id', v_level_no;
    END IF;
    SELECT l.level_no INTO v_parent_level_no
    FROM public.org_units p
    JOIN public.org_unit_levels l ON l.id = p.level_id
    WHERE p.id = NEW.parent_id;

    IF v_parent_level_no IS NULL OR v_parent_level_no <> (v_level_no - 1) THEN
      RAISE EXCEPTION 'Parent org unit must be level % for child level %', (v_level_no - 1), v_level_no;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_parent_level_check ON public.org_units;
CREATE TRIGGER trg_org_parent_level_check
  BEFORE INSERT OR UPDATE ON public.org_units
  FOR EACH ROW EXECUTE FUNCTION public.fn_org_parent_level_check();

-- Validate user_admin_scopes (only ADMIN, org_unit matches scope_level_no 2 or 3)
CREATE OR REPLACE FUNCTION public.fn_validate_admin_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_role text;
  v_unit_level smallint;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = NEW.user_id;
  IF v_role IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'user_admin_scopes can only be assigned to role ADMIN';
  END IF;

  SELECT l.level_no INTO v_unit_level
  FROM public.org_units u
  JOIN public.org_unit_levels l ON l.id = u.level_id
  WHERE u.id = NEW.org_unit_id;

  IF v_unit_level IS DISTINCT FROM NEW.scope_level_no THEN
    RAISE EXCEPTION 'org_unit_id level (%) does not match scope_level_no (%)', v_unit_level, NEW.scope_level_no;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_admin_scope ON public.user_admin_scopes;
CREATE TRIGGER trg_validate_admin_scope
  BEFORE INSERT OR UPDATE ON public.user_admin_scopes
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_admin_scope();

-- Validate user_app_permissions (webapp_role_id must belong to webapp_id)
CREATE OR REPLACE FUNCTION public.fn_validate_user_app_permission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_webapp_id uuid;
BEGIN
  SELECT webapp_id INTO v_role_webapp_id
  FROM public.webapp_roles
  WHERE id = NEW.webapp_role_id;

  IF v_role_webapp_id IS DISTINCT FROM NEW.webapp_id THEN
    RAISE EXCEPTION 'webapp_role_id does not belong to the specified webapp_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_user_app_permission ON public.user_app_permissions;
CREATE TRIGGER trg_validate_user_app_permission
  BEFORE INSERT OR UPDATE ON public.user_app_permissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_user_app_permission();

-- Prevent privilege escalation on users by non-SUPERADMIN
CREATE OR REPLACE FUNCTION public.fn_users_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    -- Allow service_role / postgres migrations
    RETURN NEW;
  END IF;

  SELECT role INTO v_actor_role FROM public.users WHERE id = auth.uid();

  IF v_actor_role IS DISTINCT FROM 'SUPERADMIN' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only SUPERADMIN can modify user role';
    END IF;
    IF OLD.role IN ('SUPERADMIN', 'ADMIN') AND NEW.id <> auth.uid() THEN
      RAISE EXCEPTION 'Insufficient privileges to modify SUPERADMIN/ADMIN account';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_guard ON public.users;
CREATE TRIGGER trg_users_guard
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_users_guard();

-- Audit trigger for key security tables
CREATE OR REPLACE FUNCTION public.fn_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_id text;
  v_cid_masked text := NULL;
BEGIN
  v_entity_id := COALESCE(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END,
    NULL
  );

  IF TG_TABLE_NAME = 'personnel' THEN
    v_cid_masked := public.fn_mask_cid(CASE WHEN TG_OP = 'DELETE' THEN OLD.cid ELSE NEW.cid END);
  END IF;

  INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, cid_masked, detail)
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_entity_id,
    v_cid_masked,
    jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_personnel ON public.personnel;
CREATE TRIGGER trg_audit_personnel
  AFTER INSERT OR UPDATE OR DELETE ON public.personnel
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_event();

DROP TRIGGER IF EXISTS trg_audit_webapps ON public.webapps;
CREATE TRIGGER trg_audit_webapps
  AFTER INSERT OR UPDATE OR DELETE ON public.webapps
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_event();

DROP TRIGGER IF EXISTS trg_audit_user_app_permissions ON public.user_app_permissions;
CREATE TRIGGER trg_audit_user_app_permissions
  AFTER INSERT OR UPDATE OR DELETE ON public.user_app_permissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_event();

-- Attach updated_at triggers
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'lookup_categories', 'lookup_items', 'org_unit_levels', 'org_units',
    'position_types', 'positions', 'position_levels', 'decoration_classes',
    'personnel', 'personnel_assignments', 'personnel_fleet_profiles',
    'personnel_career_records', 'personnel_decorations', 'users',
    'user_admin_scopes', 'webapps', 'webapp_roles', 'user_app_permissions',
    'system_settings'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%s ON public.%I;', v_tbl, v_tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_%s BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();',
      v_tbl, v_tbl
    );
  END LOOP;
END $$;

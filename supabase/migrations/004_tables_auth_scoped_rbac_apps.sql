-- =============================================================================
-- Migration 004: Group C & D — Scoped RBAC, Sub-Webapps, Import & Security (Tables 15–31)
-- =============================================================================

-- 15. users (3 Core Roles ONLY: SUPERADMIN, ADMIN, USER)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  personnel_id uuid UNIQUE REFERENCES public.personnel(id) ON DELETE SET NULL,
  username text NOT NULL UNIQUE,
  email text UNIQUE,
  auth_email text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'USER' CHECK (role IN ('SUPERADMIN', 'ADMIN', 'USER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING')),
  username_changed boolean NOT NULL DEFAULT false,
  must_change_credential boolean NOT NULL DEFAULT true,
  credential_changed_at timestamptz,
  account_source text NOT NULL DEFAULT 'PROVISIONED',
  approved_by uuid,
  approved_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON public.users(role, status);

-- 16. user_admin_scopes (2-Tier Mandatory Admin Scope: 2=สำนักงาน/กอง, 3=ส่วน/ฝ่าย)
CREATE TABLE IF NOT EXISTS public.user_admin_scopes (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  scope_level_no smallint NOT NULL CHECK (scope_level_no IN (2, 3)),
  org_unit_id uuid NOT NULL REFERENCES public.org_units(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_scopes_org ON public.user_admin_scopes(org_unit_id, scope_level_no);

-- 17. api_scope_catalog
CREATE TABLE IF NOT EXISTS public.api_scope_catalog (
  code text PRIMARY KEY,
  name_th text NOT NULL,
  description text,
  is_sensitive boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

-- 18. webapp_scope_presets
CREATE TABLE IF NOT EXISTS public.webapp_scope_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_th text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

-- 19. webapp_scope_preset_items
CREATE TABLE IF NOT EXISTS public.webapp_scope_preset_items (
  preset_id uuid NOT NULL REFERENCES public.webapp_scope_presets(id) ON DELETE CASCADE,
  scope_code text NOT NULL REFERENCES public.api_scope_catalog(code) ON DELETE CASCADE,
  PRIMARY KEY (preset_id, scope_code)
);

-- 20. webapps
CREATE TABLE IF NOT EXISTS public.webapps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  url text NOT NULL,
  icon text DEFAULT 'fa-window-maximize',
  icon_url text,
  color text DEFAULT '#00744B',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MAINTENANCE', 'DISABLED')),
  auto_grant_on_provision boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  api_key_prefix text,
  api_key_hash text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 21. webapp_roles (1:N unequal per-app roles)
CREATE TABLE IF NOT EXISTS public.webapp_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webapp_id uuid NOT NULL REFERENCES public.webapps(id) ON DELETE CASCADE,
  role_code text NOT NULL,
  role_name_th text NOT NULL,
  description text,
  hierarchy_level integer NOT NULL DEFAULT 1,
  color_hex text DEFAULT '#00744B',
  is_default_on_grant boolean NOT NULL DEFAULT false,
  is_app_admin boolean NOT NULL DEFAULT false,
  allow_scoped_admin_grant boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (webapp_id, role_code)
);
CREATE INDEX IF NOT EXISTS idx_webapp_roles_app ON public.webapp_roles(webapp_id, hierarchy_level DESC);

-- 22. webapp_scopes (M:N)
CREATE TABLE IF NOT EXISTS public.webapp_scopes (
  webapp_id uuid NOT NULL REFERENCES public.webapps(id) ON DELETE CASCADE,
  scope_code text NOT NULL REFERENCES public.api_scope_catalog(code) ON DELETE CASCADE,
  PRIMARY KEY (webapp_id, scope_code)
);

-- 23. webapp_allowed_origins (1:N)
CREATE TABLE IF NOT EXISTS public.webapp_allowed_origins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webapp_id uuid NOT NULL REFERENCES public.webapps(id) ON DELETE CASCADE,
  origin_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (webapp_id, origin_url)
);

-- 24. user_app_permissions (M:N)
CREATE TABLE IF NOT EXISTS public.user_app_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  webapp_id uuid NOT NULL REFERENCES public.webapps(id) ON DELETE CASCADE,
  webapp_role_id uuid NOT NULL REFERENCES public.webapp_roles(id) ON DELETE RESTRICT,
  is_allowed boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  note text,
  granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, webapp_id)
);
CREATE INDEX IF NOT EXISTS idx_user_app_perm_app ON public.user_app_permissions(webapp_id, is_allowed);

-- 25. security_tokens (SHA-256 hash only, 5-min TTL one-time SSO handshake & register tickets)
CREATE TABLE IF NOT EXISTS public.security_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_type text NOT NULL CHECK (token_type IN ('SSO_HANDSHAKE', 'REGISTER_TICKET')),
  token_hash text NOT NULL UNIQUE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  webapp_id uuid REFERENCES public.webapps(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_tokens_exp ON public.security_tokens(expires_at);

-- 26. credential_reset_requests
CREATE TABLE IF NOT EXISTS public.credential_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  personnel_id uuid REFERENCES public.personnel(id) ON DELETE SET NULL,
  reason text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  handled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reset_req_status ON public.credential_reset_requests(status, created_at DESC);

-- 27. system_settings
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value text,
  value_type text NOT NULL DEFAULT 'string',
  group_name text NOT NULL DEFAULT 'general',
  label_th text NOT NULL,
  description text,
  is_public boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 28. import_jobs
CREATE TABLE IF NOT EXISTS public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  source_format text NOT NULL CHECK (source_format IN ('XLSX', 'CSV', 'CLIPBOARD')),
  mode text NOT NULL CHECK (mode IN ('INSERT_ONLY', 'UPSERT')),
  total_rows integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  accounts_created integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_created ON public.import_jobs(created_at DESC);

-- 29. import_job_errors (1:N)
CREATE TABLE IF NOT EXISTS public.import_job_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  sheet_row_no integer NOT NULL,
  cid_masked text,
  column_key text,
  error_code text NOT NULL,
  error_message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_errors_job ON public.import_job_errors(job_id, sheet_row_no);

-- 30. audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  cid_masked text,
  office_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_scope ON public.audit_logs(office_id, department_id);

-- 31. login_attempts
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  ip_address text,
  succeeded boolean NOT NULL DEFAULT false,
  failure_reason text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON public.login_attempts(identifier, attempted_at DESC);

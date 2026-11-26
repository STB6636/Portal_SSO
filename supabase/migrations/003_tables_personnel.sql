-- =============================================================================
-- Migration 003: Group B — Relational Personnel Domain Hub (Tables 10–14)
-- Domain Exclusions Enforced:
--   * VEHICLE_TAX: No internal phone extension, no vehicle-officer flag.
--   * CAR_REQUEST: No driver code, no driver license number/type/expiry.
-- File URLs (photo_path, signature_path) store Google Drive URLs returned by GAS.
-- =============================================================================

-- 10. personnel
CREATE TABLE IF NOT EXISTS public.personnel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_code text UNIQUE,
  cid text NOT NULL UNIQUE,
  prefix_id uuid REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  noble_or_rank_title text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  gender_id uuid REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  birth_date date,
  phone_number text,
  email text UNIQUE,
  photo_path text,
  signature_path text,
  status_id uuid REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS idx_personnel_name ON public.personnel(first_name, last_name);
CREATE INDEX IF NOT EXISTS idx_personnel_status ON public.personnel(status_id);

-- 11. personnel_assignments (1:1)
CREATE TABLE IF NOT EXISTS public.personnel_assignments (
  personnel_id uuid PRIMARY KEY REFERENCES public.personnel(id) ON DELETE CASCADE,
  employment_type_id uuid REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  position_type_id uuid REFERENCES public.position_types(id) ON DELETE RESTRICT,
  position_id uuid REFERENCES public.positions(id) ON DELETE RESTRICT,
  position_level_id uuid REFERENCES public.position_levels(id) ON DELETE RESTRICT,
  position_number text,
  secondary_position text,
  acting_position text,
  bureau_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  office_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  division_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  approval_tier_id uuid REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  current_position_date date,
  current_level_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS idx_assignments_office ON public.personnel_assignments(office_id);
CREATE INDEX IF NOT EXISTS idx_assignments_department ON public.personnel_assignments(department_id);
CREATE INDEX IF NOT EXISTS idx_assignments_division ON public.personnel_assignments(division_id);
CREATE INDEX IF NOT EXISTS idx_assignments_approval_tier ON public.personnel_assignments(approval_tier_id);

-- 12. personnel_fleet_profiles (1:0..1 — CAR_REQUEST domain)
CREATE TABLE IF NOT EXISTS public.personnel_fleet_profiles (
  personnel_id uuid PRIMARY KEY REFERENCES public.personnel(id) ON DELETE CASCADE,
  is_driver boolean NOT NULL DEFAULT false,
  driver_status_id uuid REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  has_position_vehicle boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS idx_fleet_is_driver ON public.personnel_fleet_profiles(is_driver) WHERE is_driver = true;

-- 13. personnel_career_records (1:0..1 — ROYAL_DEC domain)
CREATE TABLE IF NOT EXISTS public.personnel_career_records (
  personnel_id uuid PRIMARY KEY REFERENCES public.personnel(id) ON DELETE CASCADE,
  start_service_date date,
  start_service_year_be smallint CHECK (start_service_year_be IS NULL OR start_service_year_be BETWEEN 2450 AND 2700),
  initial_position text,
  initial_salary numeric(12, 2) CHECK (initial_salary IS NULL OR initial_salary >= 0),
  current_salary numeric(12, 2) CHECK (current_salary IS NULL OR current_salary >= 0),
  retro_salary_5y numeric(12, 2) CHECK (retro_salary_5y IS NULL OR retro_salary_5y >= 0),
  disciplinary_flag boolean NOT NULL DEFAULT false,
  disciplinary_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- 14. personnel_decorations (1:N — ROYAL_DEC domain)
CREATE TABLE IF NOT EXISTS public.personnel_decorations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_id uuid NOT NULL REFERENCES public.personnel(id) ON DELETE CASCADE,
  decoration_class_id uuid NOT NULL REFERENCES public.decoration_classes(id) ON DELETE RESTRICT,
  received_year_be smallint NOT NULL CHECK (received_year_be BETWEEN 2450 AND 2700),
  gazette_ref text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_personnel_decorations_pid ON public.personnel_decorations(personnel_id, received_year_be DESC);

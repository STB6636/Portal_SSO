-- =============================================================================
-- Migration 002: Group A — Dynamic Master Data & Hierarchies (Tables 1–9)
-- Zero-Hardcode Policy: No business-option CHECK (... IN (...)) constraints.
-- =============================================================================

-- 1. lookup_categories
CREATE TABLE IF NOT EXISTS public.lookup_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_th text NOT NULL UNIQUE,
  description text,
  is_system_locked boolean NOT NULL DEFAULT false,
  has_provision_flag boolean NOT NULL DEFAULT false,
  has_approver_flag boolean NOT NULL DEFAULT false,
  has_dispatch_flag boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. lookup_items
CREATE TABLE IF NOT EXISTS public.lookup_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.lookup_categories(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_th text NOT NULL,
  short_name text,
  color_hex text,
  icon_name text,
  rank_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  allows_account_provision boolean NOT NULL DEFAULT true,
  is_approver boolean NOT NULL DEFAULT false,
  is_dispatchable boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, code),
  UNIQUE (category_id, name_th)
);
CREATE INDEX IF NOT EXISTS idx_lookup_items_category ON public.lookup_items(category_id, sort_order);

-- 3. org_unit_levels (Levels 1-4: สำนัก > สำนักงาน/กอง > ส่วน/ฝ่าย > กลุ่มงาน)
CREATE TABLE IF NOT EXISTS public.org_unit_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_no smallint NOT NULL UNIQUE CHECK (level_no BETWEEN 1 AND 4),
  code text NOT NULL UNIQUE,
  name_th text NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. org_units (Self-referencing 4-level hierarchy tree)
CREATE TABLE IF NOT EXISTS public.org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id uuid NOT NULL REFERENCES public.org_unit_levels(id) ON DELETE RESTRICT,
  parent_id uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,
  code text,
  name_th text NOT NULL,
  short_name text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_units_parent_name
  ON public.org_units (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(trim(name_th)));
CREATE INDEX IF NOT EXISTS idx_org_units_parent ON public.org_units(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_org_units_level ON public.org_units(level_id);

-- 5. position_types
CREATE TABLE IF NOT EXISTS public.position_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_th text NOT NULL UNIQUE,
  color_hex text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. positions
CREATE TABLE IF NOT EXISTS public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_type_id uuid NOT NULL REFERENCES public.position_types(id) ON DELETE RESTRICT,
  name_th text NOT NULL,
  requires_level boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (position_type_id, name_th)
);
CREATE INDEX IF NOT EXISTS idx_positions_type ON public.positions(position_type_id, sort_order);

-- 7. position_levels
CREATE TABLE IF NOT EXISTS public.position_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_th text NOT NULL UNIQUE,
  rank_order integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8. position_allowed_levels (M:N)
CREATE TABLE IF NOT EXISTS public.position_allowed_levels (
  position_id uuid NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  position_level_id uuid NOT NULL REFERENCES public.position_levels(id) ON DELETE CASCADE,
  PRIMARY KEY (position_id, position_level_id)
);

-- 9. decoration_classes
CREATE TABLE IF NOT EXISTS public.decoration_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.lookup_items(id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  name_th text NOT NULL UNIQUE,
  rank_order integer NOT NULL DEFAULT 0,
  color_hex text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decoration_classes_family ON public.decoration_classes(family_id, rank_order);

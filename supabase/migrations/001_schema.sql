-- =============================================================================
-- Migration 001: Extensions & Schema Permissions (Portal SSO Core in public)
-- Decision Q3: Portal SSO Core uses schema `public`. Future sub-webapps
-- (ROYAL_DEC, VEHICLE_TAX, CAR_REQUEST, etc.) will create dedicated schemas
-- inside this same Supabase project without provisioning new projects.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

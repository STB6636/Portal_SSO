-- =============================================================================
-- Migration 009: Scheduled Maintenance (pg_cron ONLY)
-- Decision (Comment 1 & Q4): NO Supabase Storage Buckets created.
-- All images, signatures, and documents are stored on Google Drive (3 folders)
-- via Google Apps Script Web App (.../exec) and only URLs are saved in Supabase.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_cleanup_expired_security_records()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.security_tokens
  WHERE expires_at < now() - interval '1 day'
     OR (used_at IS NOT NULL AND used_at < now() - interval '1 day');

  DELETE FROM public.login_attempts
  WHERE attempted_at < now() - interval '30 days';
END;
$$;

-- Schedule hourly cleanup when pg_cron extension is enabled in Supabase
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('portal_sso_cleanup_security')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal_sso_cleanup_security');

    PERFORM cron.schedule(
      'portal_sso_cleanup_security',
      '15 * * * *',
      'SELECT public.fn_cleanup_expired_security_records();'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END $$;

import { supabase } from '@/lib/supabaseClient';
import type { AuditLogRow, ImportJobRow } from '@/types/database.types';

export const auditService = {
  async listAuditLogs(limit = 200): Promise<AuditLogRow[]> {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as AuditLogRow[];
  },

  async listImportJobs(limit = 50): Promise<ImportJobRow[]> {
    const { data, error } = await supabase
      .from('import_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as ImportJobRow[];
  },
};

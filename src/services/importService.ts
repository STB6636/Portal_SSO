import { supabase } from '@/lib/supabaseClient';
import { userService } from './userService';
import type { ImportCommitMode, ImportSourceFormat } from '@/types/database.types';
import type { ExistingPersonnelSnapshot, ImportBatchCommitResult, StagingRow } from '@/types/import.types';

export const importService = {
  async checkExistingCids(cids: string[]): Promise<Map<string, ExistingPersonnelSnapshot>> {
    const clean = Array.from(new Set(cids.filter((c) => /^\d{13}$/.test(c))));
    const result = new Map<string, ExistingPersonnelSnapshot>();
    if (clean.length === 0) return result;

    for (let i = 0; i < clean.length; i += 400) {
      const slice = clean.slice(i, i + 400);
      const { data, error } = await supabase.rpc('fn_check_existing_cids_with_snapshot', { p_cids: slice });
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as ExistingPersonnelSnapshot[]) {
        result.set(row.cid, row);
      }
    }
    return result;
  },

  async commitStagingRows(params: {
    fileName: string;
    sourceFormat: ImportSourceFormat;
    mode: ImportCommitMode;
    rows: StagingRow[];
    chunkSize?: number;
    autoProvisionAccounts: boolean;
    onProgress?: (percent: number, label: string) => void;
  }): Promise<ImportBatchCommitResult> {
    const { fileName, sourceFormat, mode, rows, chunkSize = 200, autoProvisionAccounts, onProgress } = params;

    const { data: authData } = await supabase.auth.getUser();
    const { data: job, error: jobErr } = await supabase
      .from('import_jobs')
      .insert({
        file_name: fileName,
        source_format: sourceFormat,
        mode,
        total_rows: rows.length,
        status: 'RUNNING',
        created_by: authData.user?.id ?? null,
      })
      .select('id')
      .single();

    if (jobErr || !job) throw new Error(jobErr?.message || 'ไม่สามารถสร้างงานนำเข้าได้');
    const jobId = job.id as string;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let accountsCreated = 0;
    const savedPersonnelIds: string[] = [];

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const payload = chunk.map((r) => ({
        sheet_row_no: r.sheetRowNo,
        personnel: {
          cid: r.resolved.cid,
          prefix_id: r.resolved.prefix_id || null,
          noble_or_rank_title: r.resolved.noble_or_rank_title || null,
          first_name: r.resolved.first_name,
          last_name: r.resolved.last_name,
          gender_id: r.resolved.gender_id || null,
          birth_date: r.resolved.birth_date || null,
          phone_number: r.resolved.phone_number || null,
          email: r.resolved.email || null,
          status_id: r.resolved.status_id || null,
        },
        assignment: {
          employment_type_id: r.resolved.employment_type_id || null,
          position_type_id: r.resolved.position_type_id || null,
          position_id: r.resolved.position_id || null,
          position_level_id: r.resolved.position_level_id || null,
          position_number: r.resolved.position_number || null,
          secondary_position: r.resolved.secondary_position || null,
          acting_position: r.resolved.acting_position || null,
          bureau_id: r.resolved.bureau_id || null,
          office_id: r.resolved.office_id || null,
          department_id: r.resolved.department_id || null,
          division_id: r.resolved.division_id || null,
          approval_tier_id: r.resolved.approval_tier_id || null,
        },
        career: {
          start_service_date: r.resolved.start_service_date || null,
          start_service_year_be:
            typeof r.resolved.start_service_date === 'string' && r.resolved.start_service_date.length >= 4
              ? Number(r.resolved.start_service_date.slice(0, 4)) + 543
              : r.resolved.start_service_year_be || null,
          initial_position: r.resolved.initial_position || null,
          initial_salary: r.resolved.initial_salary ?? null,
          current_salary: r.resolved.current_salary ?? null,
        },
      }));

      const { data: res, error } = await supabase.rpc('fn_import_personnel_batch', {
        p_job_id: jobId,
        p_rows_jsonb: payload,
        p_mode: mode,
      });
      if (error) throw new Error(error.message);

      inserted += Number(res?.inserted ?? 0);
      updated += Number(res?.updated ?? 0);
      skipped += Number(res?.skipped ?? 0);
      failed += Number(res?.failed ?? 0);
      if (Array.isArray(res?.saved_personnel_ids)) {
        savedPersonnelIds.push(...(res.saved_personnel_ids as string[]));
      }

      const pct = Math.min(80, Math.round(((i + chunk.length) / Math.max(1, rows.length)) * 80));
      onProgress?.(pct, `บันทึกข้อมูลบุคลากรแล้ว ${Math.min(i + chunk.length, rows.length)} / ${rows.length} แถว`);
    }

    // Auto-Provision accounts in chunks of 25
    if (autoProvisionAccounts && savedPersonnelIds.length > 0) {
      for (let i = 0; i < savedPersonnelIds.length; i += 25) {
        const slice = savedPersonnelIds.slice(i, i + 25);
        const provRes = await userService.provisionAccounts(slice).catch(() => ({ created: 0 }));
        accountsCreated += Number(provRes.created ?? 0);
        const pct = 80 + Math.round(((i + slice.length) / savedPersonnelIds.length) * 20);
        onProgress?.(pct, `สร้างบัญชีผู้ใช้อัตโนมัติแล้ว ${accountsCreated} บัญชี`);
      }
    }

    const finalStatus = failed === 0 ? 'COMPLETED' : inserted + updated > 0 ? 'PARTIAL' : 'FAILED';
    await supabase
      .from('import_jobs')
      .update({ accounts_created: accountsCreated, status: finalStatus, finished_at: new Date().toISOString() })
      .eq('id', jobId);

    const { data: errRows } = await supabase
      .from('import_job_errors')
      .select('sheet_row_no, cid_masked, column_key, error_code, error_message')
      .eq('job_id', jobId);

    onProgress?.(100, 'ดำเนินการนำเข้าเสร็จสมบูรณ์');

    return {
      jobId,
      sourceFormat,
      mode,
      totalRows: rows.length,
      inserted,
      updated,
      skipped,
      failed,
      accountsCreated,
      errors: ((errRows ?? []) as Array<{
        sheet_row_no: number;
        cid_masked: string | null;
        column_key: string | null;
        error_code: string;
        error_message: string;
      }>).map((e) => ({
        sheetRowNo: e.sheet_row_no,
        cidMasked: e.cid_masked || '',
        columnKey: e.column_key || '',
        errorCode: e.error_code,
        errorMessage: e.error_message,
      })),
    };
  },
};

import { supabase } from '@/lib/supabaseClient';
import type { DashboardStatsResponse } from '@/types/api.types';
import type {
  PersonnelBundlePayload,
  PersonnelDirectoryItem,
  PersonnelTimelinesBundle,
} from '@/types/domain.types';
import type {
  PersonnelDisciplinaryRecordRow,
  PersonnelEducationRow,
  PersonnelEvaluationRow,
  PersonnelExecutiveDutyRow,
  PersonnelLicenseRow,
  PersonnelNameHistoryRow,
  PersonnelPositionHistoryRow,
  PersonnelSalaryHistoryRow,
  PersonnelServiceInterruptionRow,
  PersonnelTrainingRow,
} from '@/types/database.types';

export const personnelService = {
  async listDirectory(): Promise<PersonnelDirectoryItem[]> {
    const { data, error } = await supabase
      .from('v_personnel_directory')
      .select('*')
      .order('office_name', { ascending: true })
      .order('first_name', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PersonnelDirectoryItem[];
  },

  async getPersonnelById(personnelId: string): Promise<PersonnelDirectoryItem | null> {
    const { data, error } = await supabase
      .from('v_personnel_directory')
      .select('*')
      .eq('id', personnelId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as PersonnelDirectoryItem | null;
  },

  async getPersonnelTimelines(personnelId: string): Promise<PersonnelTimelinesBundle> {
    const [
      nameRes,
      posRes,
      execRes,
      salRes,
      evalRes,
      discRes,
      interRes,
      eduRes,
      licRes,
      trainRes,
    ] = await Promise.all([
      supabase
        .from('personnel_name_history')
        .select('*')
        .eq('personnel_id', personnelId)
        .order('sort_order', { ascending: true })
        .order('changed_date', { ascending: false }),
      supabase
        .from('personnel_position_history')
        .select('*')
        .eq('personnel_id', personnelId)
        .order('sort_order', { ascending: true })
        .order('effective_date', { ascending: false }),
      supabase
        .from('personnel_executive_duties')
        .select('*')
        .eq('personnel_id', personnelId)
        .order('sort_order', { ascending: true })
        .order('effective_date', { ascending: false }),
      supabase
        .from('personnel_salary_history')
        .select('*')
        .eq('personnel_id', personnelId)
        .order('sort_order', { ascending: true })
        .order('effective_date', { ascending: false }),
      supabase
        .from('personnel_evaluations')
        .select('*')
        .eq('personnel_id', personnelId)
        .order('sort_order', { ascending: true })
        .order('fiscal_year_be', { ascending: false })
        .order('eval_round', { ascending: false }),
      supabase
        .from('personnel_disciplinary_records')
        .select('*')
        .eq('personnel_id', personnelId)
        .order('sort_order', { ascending: true })
        .order('effective_date', { ascending: false }),
      supabase
        .from('personnel_service_interruptions')
        .select('*')
        .eq('personnel_id', personnelId)
        .order('sort_order', { ascending: true })
        .order('start_date', { ascending: false }),
      supabase
        .from('personnel_educations')
        .select('*')
        .eq('personnel_id', personnelId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false }),
      supabase
        .from('personnel_licenses')
        .select('*')
        .eq('personnel_id', personnelId)
        .order('sort_order', { ascending: true })
        .order('effective_date', { ascending: false }),
      supabase
        .from('personnel_trainings')
        .select('*')
        .eq('personnel_id', personnelId)
        .order('sort_order', { ascending: true })
        .order('start_date', { ascending: false }),
    ]);

    const results = [
      { table: 'personnel_name_history', res: nameRes },
      { table: 'personnel_position_history', res: posRes },
      { table: 'personnel_executive_duties', res: execRes },
      { table: 'personnel_salary_history', res: salRes },
      { table: 'personnel_evaluations', res: evalRes },
      { table: 'personnel_disciplinary_records', res: discRes },
      { table: 'personnel_service_interruptions', res: interRes },
      { table: 'personnel_educations', res: eduRes },
      { table: 'personnel_licenses', res: licRes },
      { table: 'personnel_trainings', res: trainRes },
    ];
    const failed = results.find((entry) => entry.res.error);
    if (failed?.res.error) {
      throw new Error(`โหลดข้อมูลประวัติ (${failed.table}) ไม่สำเร็จ: ${failed.res.error.message}`);
    }

    return {
      nameHistory: (nameRes.data ?? []) as PersonnelNameHistoryRow[],
      positionHistory: (posRes.data ?? []) as PersonnelPositionHistoryRow[],
      executiveDuties: (execRes.data ?? []) as PersonnelExecutiveDutyRow[],
      salaryHistory: (salRes.data ?? []) as PersonnelSalaryHistoryRow[],
      evaluations: (evalRes.data ?? []) as PersonnelEvaluationRow[],
      disciplinaryRecords: (discRes.data ?? []) as PersonnelDisciplinaryRecordRow[],
      serviceInterruptions: (interRes.data ?? []) as PersonnelServiceInterruptionRow[],
      educations: (eduRes.data ?? []) as PersonnelEducationRow[],
      licenses: (licRes.data ?? []) as PersonnelLicenseRow[],
      trainings: (trainRes.data ?? []) as PersonnelTrainingRow[],
    };
  },

  async saveBundle(payload: PersonnelBundlePayload): Promise<string> {
    const { data, error } = await supabase.rpc('fn_save_personnel_bundle', { p_payload: payload });
    if (error) throw new Error(error.message);
    return String(data);
  },

  async deletePersonnel(id: string) {
    const { error } = await supabase.from('personnel').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async updateOwnMedia(personnelId: string, fields: { photo_path?: string | null; signature_path?: string | null; phone_number?: string; email?: string }) {
    const { error } = await supabase.from('personnel').update(fields).eq('id', personnelId);
    if (error) throw new Error(error.message);
  },

  async getDashboardStats(): Promise<DashboardStatsResponse> {
    const { data, error } = await supabase.rpc('fn_dashboard_stats');
    if (error) throw new Error(error.message);
    return data as DashboardStatsResponse;
  },
};

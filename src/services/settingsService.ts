import { supabase, SUPABASE_URL } from '@/lib/supabaseClient';
import { formatDatabaseError } from '@/lib/pgErrorHelpers';
import type { ApiScopeCatalogRow, SystemSettingRow } from '@/types/database.types';
import type { SchemaHealthReport } from '@/types/api.types';

const SETTING_META_FALLBACK: Record<
  string,
  { value_type: string; group_name: string; label_th: string; is_public: boolean }
> = {
  organization_name: { value_type: 'string', group_name: 'branding', label_th: 'ชื่อองค์กรหลัก', is_public: true },
  bureau_name: { value_type: 'string', group_name: 'branding', label_th: 'ชื่อหน่วยงาน', is_public: true },
  system_title: { value_type: 'string', group_name: 'branding', label_th: 'ชื่อระบบ', is_public: true },
  logo_url: { value_type: 'url', group_name: 'branding', label_th: 'ลิงก์โลโก้หน่วยงาน', is_public: true },
  footer_description: { value_type: 'string', group_name: 'branding', label_th: 'คำอธิบายท้ายหน้า', is_public: true },
  allow_self_register: { value_type: 'boolean', group_name: 'security', label_th: 'เปิดให้ลงทะเบียนด้วยตนเอง', is_public: true },
  max_login_attempts: { value_type: 'number', group_name: 'security', label_th: 'จำนวนครั้งล็อกอินผิดสูงสุด', is_public: false },
  login_lock_minutes: { value_type: 'number', group_name: 'security', label_th: 'ระยะเวลาล็อกบัญชีชั่วคราว', is_public: false },
  Import_Max_Rows: { value_type: 'number', group_name: 'import', label_th: 'จำนวนแถวสูงสุดต่อการนำเข้า', is_public: true },
  Import_Chunk_Size: { value_type: 'number', group_name: 'import', label_th: 'จำนวนแถวต่อชุดการบันทึก', is_public: true },
  google_drive_script_url: { value_type: 'url', group_name: 'google_drive', label_th: 'ลิงก์เว็บแอป Google Apps Script', is_public: true },
  google_drive_image_folder_id: { value_type: 'string', group_name: 'google_drive', label_th: 'โฟลเดอร์ไฟล์รูปภาพ', is_public: true },
  google_drive_signature_folder_id: { value_type: 'string', group_name: 'google_drive', label_th: 'โฟลเดอร์ไฟล์ลายเซ็น', is_public: true },
  google_drive_document_folder_id: { value_type: 'string', group_name: 'google_drive', label_th: 'โฟลเดอร์ไฟล์เอกสาร', is_public: true },
  google_drive_logo_folder_id: { value_type: 'string', group_name: 'google_drive', label_th: 'โฟลเดอร์รูปโลโก้ระบบ', is_public: true },
  announcement_enabled: { value_type: 'boolean', group_name: 'announcement', label_th: 'เปิดแสดงประกาศระบบ', is_public: true },
  announcement_mode: { value_type: 'string', group_name: 'announcement', label_th: 'รูปแบบประกาศ', is_public: true },
  announcement_title: { value_type: 'string', group_name: 'announcement', label_th: 'หัวข้อประกาศ', is_public: true },
  announcement_body: { value_type: 'text', group_name: 'announcement', label_th: 'เนื้อหาประกาศ', is_public: true },
  announcement_image_url: { value_type: 'url', group_name: 'announcement', label_th: 'ลิงก์รูปภาพประกาศ', is_public: true },
  announcement_start_date: { value_type: 'date', group_name: 'announcement', label_th: 'วันที่เริ่มแสดงประกาศ', is_public: true },
  announcement_end_date: { value_type: 'date', group_name: 'announcement', label_th: 'วันที่สิ้นสุดแสดงประกาศ', is_public: true },
  announcement_updated_at: { value_type: 'string', group_name: 'announcement', label_th: 'เวลาอัปเดตประกาศล่าสุด', is_public: true },
};

export const settingsService = {
  async listAll(): Promise<SystemSettingRow[]> {
    const { data, error } = await supabase.from('system_settings').select('*').order('group_name').order('key');
    if (error) throw new Error(formatDatabaseError(error));
    return (data ?? []) as SystemSettingRow[];
  },

  async updateMany(entries: Array<{ key: string; value: string }>) {
    if (entries.length === 0) return;
    const { data: existingRows } = await supabase
      .from('system_settings')
      .select('key, value_type, group_name, label_th, description, is_public');
    const existingMap = new Map(
      ((existingRows ?? []) as Array<Pick<SystemSettingRow, 'key' | 'value_type' | 'group_name' | 'label_th' | 'description' | 'is_public'>>).map(
        (r) => [r.key, r]
      )
    );

    const payload = entries.map((item) => {
      const ex = existingMap.get(item.key);
      const fb = SETTING_META_FALLBACK[item.key] || {
        value_type: 'string',
        group_name: 'general',
        label_th: item.key,
        is_public: false,
      };
      return {
        key: item.key,
        value: item.value,
        value_type: ex?.value_type ?? fb.value_type,
        group_name: ex?.group_name ?? fb.group_name,
        label_th: ex?.label_th ?? fb.label_th,
        description: ex?.description ?? null,
        is_public: ex?.is_public ?? fb.is_public,
      };
    });

    const { error } = await supabase.from('system_settings').upsert(payload, { onConflict: 'key' });
    if (error) throw new Error(formatDatabaseError(error));
  },

  async listApiCatalog(): Promise<{
    scopes: ApiScopeCatalogRow[];
  }> {
    const { data, error } = await supabase.from('api_scope_catalog').select('*').order('sort_order').order('code');
    if (error) throw new Error(formatDatabaseError(error));
    return {
      scopes: (data ?? []) as ApiScopeCatalogRow[],
    };
  },

  async saveApiScope(payload: ApiScopeCatalogRow) {
    const clean = {
      code: payload.code.trim().toLowerCase(),
      name_th: payload.name_th.trim(),
      description: payload.description?.trim() || null,
      is_sensitive: Boolean(payload.is_sensitive),
      sort_order: Number(payload.sort_order ?? 0),
      is_active: payload.is_active !== false,
    };
    const { error } = await supabase.from('api_scope_catalog').upsert(clean, { onConflict: 'code' });
    if (error) throw new Error(formatDatabaseError(error));
  },

  async deleteApiScope(code: string) {
    const { error } = await supabase.from('api_scope_catalog').delete().eq('code', code);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async checkSchemaHealth(): Promise<SchemaHealthReport> {
    const { data, error } = await supabase.rpc('fn_schema_health');
    if (error) throw new Error(formatDatabaseError(error));
    return data as SchemaHealthReport;
  },

  async repairSchema() {
    const { data, error } = await supabase.rpc('fn_schema_repair');
    if (error) throw new Error(formatDatabaseError(error));
    return data;
  },

  async pingPortalApiHealth(): Promise<{ ok: boolean; version?: string; latencyMs: number; message: string }> {
    const t0 = performance.now();
    try {
      const base = String(SUPABASE_URL || '').replace(/\/+$/, '');
      if (!base) {
        return { ok: false, latencyMs: 0, message: 'ยังไม่ได้ตั้งค่า SUPABASE_URL' };
      }
      const res = await fetch(`${base}/functions/v1/portal-api/health`, { method: 'GET' });
      const latencyMs = Math.round(performance.now() - t0);
      if (!res.ok) {
        return { ok: false, latencyMs, message: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { success?: boolean; version?: string };
      return {
        ok: Boolean(data?.success),
        version: data?.version,
        latencyMs,
        message: 'พร้อมใช้งานปกติ',
      };
    } catch {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        message: 'ไม่สามารถเชื่อมต่อ Central API ได้',
      };
    }
  },
};

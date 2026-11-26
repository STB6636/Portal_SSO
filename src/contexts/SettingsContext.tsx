import React, { createContext, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { QUERY_KEYS } from '@/lib/queryClient';
import type { PublicSystemSettings } from '@/types/domain.types';

export const DEFAULT_PUBLIC_SETTINGS: PublicSystemSettings = {
  organization_name: 'กรุงเทพมหานคร',
  bureau_name: 'สำนักเทศกิจ',
  system_title: 'Portal SSO — ศูนย์กลางข้อมูลบุคลากรและยืนยันตัวตน',
  logo_url: '',
  footer_description: 'ระบบยืนยันตัวตนกลางและทะเบียนประวัติบุคลากรอิเล็กทรอนิกส์ (STB-APP)',
  allow_self_register: false,
  import_max_rows: 2000,
  import_chunk_size: 200,
  google_drive_script_url: '',
  google_drive_image_folder_id: '',
  google_drive_signature_folder_id: '',
  google_drive_document_folder_id: '',
  google_drive_logo_folder_id: '',
  announcement_enabled: false,
  announcement_mode: 'text',
  announcement_title: '',
  announcement_body: '',
  announcement_image_url: '',
  announcement_start_date: '',
  announcement_end_date: '',
  announcement_updated_at: '',
};

interface SettingsContextValue {
  settings: PublicSystemSettings;
  isLoading: boolean;
  refreshSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function parseSettingsMap(rows: Array<{ key: string; value: string | null }>): PublicSystemSettings {
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.key, String(row.value ?? '').trim());
  }
  const bool = (k: string, fallback: boolean) => {
    const v = map.get(k);
    if (!v) return fallback;
    return v === 'true' || v === '1';
  };
  const num = (k: string, fallback: number) => {
    const n = Number(map.get(k));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    organization_name: map.get('organization_name') || DEFAULT_PUBLIC_SETTINGS.organization_name,
    bureau_name: map.get('bureau_name') || DEFAULT_PUBLIC_SETTINGS.bureau_name,
    system_title: map.get('system_title') || DEFAULT_PUBLIC_SETTINGS.system_title,
    logo_url: map.get('logo_url') || '',
    footer_description: map.get('footer_description') || DEFAULT_PUBLIC_SETTINGS.footer_description,
    allow_self_register: bool('allow_self_register', false),
    import_max_rows: num('Import_Max_Rows', 2000),
    import_chunk_size: num('Import_Chunk_Size', 200),
    google_drive_script_url: map.get('google_drive_script_url') || '',
    google_drive_image_folder_id: map.get('google_drive_image_folder_id') || '',
    google_drive_signature_folder_id: map.get('google_drive_signature_folder_id') || '',
    google_drive_document_folder_id: map.get('google_drive_document_folder_id') || '',
    google_drive_logo_folder_id: map.get('google_drive_logo_folder_id') || '',
    announcement_enabled: bool('announcement_enabled', false),
    announcement_mode: map.get('announcement_mode') === 'image' ? 'image' : 'text',
    announcement_title: map.get('announcement_title') || '',
    announcement_body: map.get('announcement_body') || '',
    announcement_image_url: map.get('announcement_image_url') || '',
    announcement_start_date: map.get('announcement_start_date') || '',
    announcement_end_date: map.get('announcement_end_date') || '',
    announcement_updated_at: map.get('announcement_updated_at') || '',
  };
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEYS.publicSettings,
    queryFn: async (): Promise<PublicSystemSettings> => {
      if (!isSupabaseConfigured) return DEFAULT_PUBLIC_SETTINGS;
      const { data: rpcData, error } = await supabase.rpc('fn_get_public_settings');
      if (error || !Array.isArray(rpcData)) {
        return DEFAULT_PUBLIC_SETTINGS;
      }
      return parseSettingsMap(rpcData as Array<{ key: string; value: string | null }>);
    },
    placeholderData: DEFAULT_PUBLIC_SETTINGS,
  });

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings: data ?? DEFAULT_PUBLIC_SETTINGS,
      isLoading,
      refreshSettings: async () => {
        await qc.invalidateQueries({ queryKey: QUERY_KEYS.publicSettings });
      },
    }),
    [data, isLoading, qc]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

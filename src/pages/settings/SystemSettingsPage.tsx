import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { SettingsGeneralTab } from '@/components/settings/SettingsGeneralTab';
import { SettingsGoogleDriveTab } from '@/components/settings/SettingsGoogleDriveTab';
import { SettingsLookupsTab } from '@/components/settings/SettingsLookupsTab';
import { SettingsOrgUnitsTab } from '@/components/settings/SettingsOrgUnitsTab';
import { SettingsPositionsTab } from '@/components/settings/SettingsPositionsTab';
import { SettingsAnnouncementTab } from '@/components/settings/SettingsAnnouncementTab';
import { settingsService } from '@/services/settingsService';
import { useSettings } from '@/contexts/SettingsContext';
import { QUERY_KEYS } from '@/lib/queryClient';
import { useUiStore } from '@/stores/useUiStore';

export type SystemSettingsTabKey =
  | 'general'
  | 'gdrive'
  | 'lookups'
  | 'org-units'
  | 'positions'
  | 'announcement';

const SETTINGS_TABS: Array<{ key: SystemSettingsTabKey; label: string; icon: string }> = [
  { key: 'general', label: '1. ข้อมูลหน่วยงาน & ระบบ', icon: 'fa-building-columns' },
  { key: 'gdrive', label: '2. Google Drive', icon: 'fa-brands fa-google-drive' },
  { key: 'lookups', label: '3. จัดการตัวเลือก Dropdown', icon: 'fa-list-check' },
  { key: 'org-units', label: '4. โครงสร้างหน่วยงาน 4 ระดับ', icon: 'fa-sitemap' },
  { key: 'positions', label: '5. ตำแหน่ง & สายงาน', icon: 'fa-briefcase' },
  { key: 'announcement', label: '6. ประกาศระบบ', icon: 'fa-bullhorn' },
];

const GENERAL_KEYS = [
  'organization_name',
  'bureau_name',
  'system_title',
  'logo_url',
  'footer_description',
  'allow_self_register',
  'max_login_attempts',
  'login_lock_minutes',
];

const DRIVE_KEYS = [
  'google_drive_script_url',
  'google_drive_image_folder_id',
  'google_drive_signature_folder_id',
  'google_drive_document_folder_id',
  'google_drive_logo_folder_id',
];

const ANNOUNCEMENT_KEYS = [
  'announcement_enabled',
  'announcement_mode',
  'announcement_title',
  'announcement_body',
  'announcement_image_url',
  'announcement_start_date',
  'announcement_end_date',
];

export default function SystemSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { refreshSettings } = useSettings();
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);

  const rawTab = (searchParams.get('tab') || 'general') as SystemSettingsTabKey;
  const activeTab: SystemSettingsTabKey = SETTINGS_TABS.some((t) => t.key === rawTab)
    ? rawTab
    : 'general';

  const { data: rows = [] } = useQuery({
    queryKey: QUERY_KEYS.systemSettings,
    queryFn: () => settingsService.listAll(),
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const hydratedRef = useRef(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);

  // Guard against background React Query refetch wiping unsaved user edits
  useEffect(() => {
    if (rows.length === 0) return;
    if (hydratedRef.current && dirtyRef.current) return;
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value ?? '';
    setForm(map);
    hydratedRef.current = true;
  }, [rows]);

  const setVal = (key: string, value: string) => {
    dirtyRef.current = true;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const switchTab = (tab: SystemSettingsTabKey) => {
    setSearchParams({ tab }, { replace: true });
  };

  const saveScopedKeys = async (
    keys: string[],
    extraEntries: Array<{ key: string; value: string }> = []
  ): Promise<boolean> => {
    setSaving(true);
    try {
      const entries = [
        ...keys.map((key) => ({ key, value: form[key] ?? '' })),
        ...extraEntries,
      ];
      await settingsService.updateMany(entries);
      dirtyRef.current = false;
      await qc.invalidateQueries({ queryKey: QUERY_KEYS.systemSettings });
      await refreshSettings();
      showToast('บันทึกการตั้งค่าระบบเรียบร้อยแล้ว', 'success');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout
      title="พารามิเตอร์ตั้งค่าระบบ & โครงสร้างหลัก"
      subtitle="ศูนย์รวมการตั้งค่าหน่วยงาน, Google Drive, ตัวเลือก Dropdown, หน่วยงาน 4 ระดับ, ตำแหน่ง และประกาศระบบ"
      activePage="settings-system"
    >
      <div className="space-y-5">
        {/* Sub-Navigation Bar (#settingsTabNav — Checkin-Vite-React-main Pattern) */}
        <div
          id="settingsTabNav"
          className="bma-card p-2 flex flex-wrap items-center gap-1.5"
          role="tablist"
        >
          {SETTINGS_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const iconClass = tab.icon.startsWith('fa-brands') ? tab.icon : `fa-solid ${tab.icon}`;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => switchTab(tab.key)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-gradient-to-r from-[#00744B] to-[#00A368] text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <i className={iconClass} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === 'general' && (
          <SettingsGeneralTab
            form={form}
            setVal={setVal}
            saving={saving}
            onSave={() => saveScopedKeys(GENERAL_KEYS)}
            onGoToDriveTab={() => switchTab('gdrive')}
          />
        )}

        {activeTab === 'gdrive' && (
          <SettingsGoogleDriveTab
            form={form}
            setVal={setVal}
            saving={saving}
            onSave={() => void saveScopedKeys(DRIVE_KEYS)}
          />
        )}

        {activeTab === 'lookups' && <SettingsLookupsTab />}
        {activeTab === 'org-units' && <SettingsOrgUnitsTab />}
        {activeTab === 'positions' && <SettingsPositionsTab />}

        {activeTab === 'announcement' && (
          <SettingsAnnouncementTab
            form={form}
            setVal={setVal}
            saving={saving}
            onSaveAnnouncement={() =>
              saveScopedKeys(ANNOUNCEMENT_KEYS, [
                { key: 'announcement_updated_at', value: new Date().toISOString() },
              ])
            }
            onGoToDriveTab={() => switchTab('gdrive')}
          />
        )}
      </div>
    </AdminLayout>
  );
}

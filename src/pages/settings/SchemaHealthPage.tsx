import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useSettings } from '@/contexts/SettingsContext';
import { settingsService } from '@/services/settingsService';
import { fetchDriveStorageQuota, formatBytes } from '@/services/driveStorageService';
import { QUERY_KEYS } from '@/lib/queryClient';
import { formatThaiDateTime } from '@/lib/thaiDate';
import { useUiStore } from '@/stores/useUiStore';

const ROW_COUNT_LABELS: Array<{
  key: 'personnel' | 'users' | 'webapps' | 'org_units' | 'positions' | 'lookup_items';
  label: string;
  icon: string;
}> = [
  { key: 'personnel', label: 'ทะเบียนบุคลากร', icon: 'fa-users' },
  { key: 'users', label: 'บัญชีผู้ใช้งาน SSO', icon: 'fa-user-shield' },
  { key: 'webapps', label: 'เว็บแอปย่อย', icon: 'fa-window-restore' },
  { key: 'org_units', label: 'หน่วยงาน 4 ระดับ', icon: 'fa-sitemap' },
  { key: 'positions', label: 'ตำแหน่งในสายงาน', icon: 'fa-briefcase' },
  { key: 'lookup_items', label: 'ตัวเลือก Dropdown', icon: 'fa-list-check' },
];

const FOLDER_META: Array<{
  key: 'image' | 'signature' | 'document' | 'logo';
  cfgKey: 'image_folder' | 'signature_folder' | 'document_folder' | 'logo_folder';
  label: string;
  icon: string;
}> = [
  { key: 'image', cfgKey: 'image_folder', label: '1. โฟลเดอร์รูปภาพ', icon: 'fa-image text-emerald-600' },
  { key: 'signature', cfgKey: 'signature_folder', label: '2. โฟลเดอร์ลายเซ็น', icon: 'fa-signature text-sky-600' },
  { key: 'document', cfgKey: 'document_folder', label: '3. โฟลเดอร์เอกสาร', icon: 'fa-file-pdf text-rose-600' },
  { key: 'logo', cfgKey: 'logo_folder', label: '4. โฟลเดอร์โลโก้ระบบ', icon: 'fa-shield-halved text-amber-600' },
];

export default function SchemaHealthPage() {
  const qc = useQueryClient();
  const { settings } = useSettings();
  const showToast = useUiStore((s) => s.showToast);

  const {
    data: health,
    isLoading,
    isFetching: fetchingHealth,
    refetch: refetchHealth,
  } = useQuery({
    queryKey: QUERY_KEYS.schemaHealth,
    queryFn: () => settingsService.checkSchemaHealth(),
  });

  const {
    data: apiPing,
    isFetching: pingingApi,
    refetch: refetchApiPing,
  } = useQuery({
    queryKey: ['portalApiHealth'],
    queryFn: () => settingsService.pingPortalApiHealth(),
    staleTime: 60_000,
  });

  const {
    data: driveQuota,
    isFetching: fetchingDrive,
    refetch: refetchDrive,
  } = useQuery({
    queryKey: [
      'driveStorageQuota',
      settings.google_drive_script_url,
      settings.google_drive_image_folder_id,
      settings.google_drive_signature_folder_id,
      settings.google_drive_document_folder_id,
      settings.google_drive_logo_folder_id,
    ],
    queryFn: () => fetchDriveStorageQuota(settings),
    enabled: Boolean(settings.google_drive_script_url),
    staleTime: 120_000,
  });

  const handleRefreshAll = () => {
    void refetchHealth();
    void refetchApiPing();
    if (settings.google_drive_script_url) {
      void refetchDrive();
    }
  };

  const handleRepair = async () => {
    try {
      await settingsService.repairSchema();
      await qc.invalidateQueries({ queryKey: QUERY_KEYS.schemaHealth });
      showToast('ดำเนินการตรวจสอบและซ่อมแซม RLS/Token เรียบร้อยแล้ว', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถซ่อมแซมได้', 'error');
    }
  };

  const quotaPct = driveQuota?.usedPercent ?? 0;
  const quotaBarColor =
    quotaPct >= 90 ? 'bg-rose-500' : quotaPct >= 75 ? 'bg-amber-500' : 'bg-emerald-600';

  return (
    <AdminLayout
      title="ตรวจสอบสุขภาพฐานข้อมูลและพื้นที่จัดเก็บ"
      subtitle={`ตรวจสอบครบ ${health?.tables_expected ?? 36} ตาราง 3NF ใน Schema public, สถานะ portal-api และพื้นที่จัดเก็บ Google Drive 4 โฟลเดอร์`}
      activePage="settings-schema"
    >
      <div className="space-y-5">
        {/* Card 1: Database & Portal API Overview */}
        <div className="bma-card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-base text-slate-800 dark:text-white">
                สถานะระบบฐานข้อมูล:{' '}
                <span
                  className={
                    health?.status === 'OK'
                      ? 'text-emerald-600'
                      : health?.status === 'WARNING'
                        ? 'text-amber-600'
                        : 'text-rose-600'
                  }
                >
                  {isLoading ? 'กำลังตรวจ...' : health?.status || 'UNKNOWN'}
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Schema หลัก: {health?.schema_name || 'public'}
                {health?.checked_at ? ` · ตรวจล่าสุด: ${formatThaiDateTime(health.checked_at)}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={fetchingHealth || pingingApi || fetchingDrive}
                className="bma-btn-outline text-xs"
              >
                <i
                  className={`fa-solid fa-rotate mr-1.5 ${
                    fetchingHealth || pingingApi || fetchingDrive ? 'fa-spin' : ''
                  }`}
                />
                ตรวจสอบใหม่ทั้งหมด
              </button>
              <button type="button" onClick={handleRepair} className="bma-btn-primary text-xs">
                <i className="fa-solid fa-wrench mr-1.5" />
                ซ่อมแซม RLS & เก็บกวาด Token
              </button>
            </div>
          </div>

          {health && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-500">ตารางเชิงสัมพันธ์ 3NF</p>
                <p className="text-2xl font-black text-[#00744B] dark:text-emerald-400">
                  {health.tables_found} / {health.tables_expected}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {health.missing_tables.length === 0 ? 'ครบทุกตารางตามสเปก' : `ขาด ${health.missing_tables.length} ตาราง`}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-500">ตารางที่ยังปิด RLS</p>
                <p
                  className={`text-2xl font-black ${
                    health.rls_disabled_tables.length === 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {health.rls_disabled_tables.length}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {health.rls_disabled_tables.length === 0 ? 'เปิดป้องกันครบ 100%' : 'ควรสั่งซ่อมแซม RLS'}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-500">Views & RPC Functions</p>
                <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                  {health.views_found} Views · {health.functions_found} Fn
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">ใน Schema public</p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-500">Central REST API (portal-api)</p>
                <p
                  className={`text-lg font-black mt-0.5 ${
                    apiPing?.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                  }`}
                >
                  {pingingApi
                    ? 'กำลังเชื่อมต่อ...'
                    : apiPing?.ok
                      ? `ออนไลน์ (${apiPing.latencyMs} ms)`
                      : 'ไม่ตอบสนอง'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {apiPing?.version ? `เวอร์ชัน ${apiPing.version}` : apiPing?.message || 'ตรวจสอบ /health'}
                </p>
              </div>
            </div>
          )}

          {health && (health.missing_tables.length > 0 || health.rls_disabled_tables.length > 0) && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-1">
              {health.missing_tables.length > 0 && (
                <p>
                  <strong>ตารางที่ยังไม่พบ:</strong> {health.missing_tables.join(', ')}
                </p>
              )}
              {health.rls_disabled_tables.length > 0 && (
                <p>
                  <strong>ตารางที่ปิด RLS:</strong> {health.rls_disabled_tables.join(', ')}
                </p>
              )}
            </div>
          )}

          {/* Row Counts Strip */}
          {health?.row_counts && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              <h3 className="text-xs font-extrabold text-slate-600 dark:text-slate-300">
                สรุปจำนวนข้อมูลในตารางหลัก
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {ROW_COUNT_LABELS.map((item) => (
                  <div
                    key={item.key}
                    className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700 text-center"
                  >
                    <i className={`fa-solid ${item.icon} text-emerald-600 dark:text-emerald-400 text-xs mb-1`} />
                    <div className="text-lg font-black text-slate-800 dark:text-white font-mono">
                      {Number(health.row_counts?.[item.key] ?? 0).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Google Drive Storage Quota & 4 Folders */}
        <div className="bma-card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                <i className="fa-brands fa-google-drive text-base" />
              </span>
              <div>
                <h2 className="font-extrabold text-base text-slate-800 dark:text-white">
                  พื้นที่จัดเก็บ Google Drive และสถานะ 4 โฟลเดอร์
                </h2>
                <p className="text-xs text-slate-500">
                  ดึงข้อมูลโควตาพื้นที่และจำนวนไฟล์จริงผ่าน Google Apps Script Bridge
                  {driveQuota?.version ? ` (${driveQuota.version})` : ''}
                </p>
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                health?.gas_drive_configured.script_url
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
              }`}
            >
              {health?.gas_drive_configured.script_url ? 'เชื่อมต่อ Web App แล้ว' : 'ยังไม่ตั้งค่า Web App URL'}
            </span>
          </div>

          {/* Drive Quota Progress Bar */}
          {!settings.google_drive_script_url ? (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-4 text-xs text-amber-900 dark:text-amber-200">
              <i className="fa-solid fa-circle-info mr-1.5" />
              ยังไม่ได้ตั้งค่า Google Apps Script Web App URL — กรุณาไปที่เมนู{' '}
              <strong>ตั้งค่าระบบ → 2. Google Drive</strong> เพื่อเชื่อมต่อพื้นที่จัดเก็บ
            </div>
          ) : fetchingDrive ? (
            <div className="py-6 text-center text-xs text-slate-400">
              <i className="fa-solid fa-spinner fa-spin mr-1.5" />
              กำลังตรวจสอบโควตาพื้นที่และนับไฟล์ใน Google Drive...
            </div>
          ) : driveQuota?.success ? (
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-200">
                  พื้นที่ใช้งานรวมบนบัญชี Google Drive
                </span>
                <span className="font-mono font-extrabold text-slate-800 dark:text-white">
                  {formatBytes(driveQuota.totalUsedBytes)} /{' '}
                  {driveQuota.isUnlimited ? 'ไม่จำกัด' : formatBytes(driveQuota.totalLimitBytes)}
                  {!driveQuota.isUnlimited ? ` (${driveQuota.usedPercent}%)` : ''}
                </span>
              </div>
              {!driveQuota.isUnlimited && driveQuota.totalLimitBytes > 0 && (
                <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${quotaBarColor}`}
                    style={{ width: `${Math.min(100, Math.max(2, quotaPct))}%` }}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  พื้นที่คงเหลือ:{' '}
                  <strong className="text-emerald-700 dark:text-emerald-300">
                    {driveQuota.isUnlimited ? 'ไม่จำกัด' : formatBytes(driveQuota.availableBytes)}
                  </strong>
                </span>
                {driveQuota.checkedAt && <span>อัปเดตเมื่อ: {formatThaiDateTime(driveQuota.checkedAt)}</span>}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 text-xs text-amber-900 dark:text-amber-200">
              <i className="fa-solid fa-triangle-exclamation mr-1.5" />
              ไม่สามารถอ่านโควตา Google Drive ได้ ({driveQuota?.message || 'กรุณาตรวจสอบว่าได้ Deploy gas/DriveStorageBridge.gs เวอร์ชัน 2.7.0 แล้ว'})
            </div>
          )}

          {/* 4 Folders Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 text-left">
                  <th className="py-2.5 px-3">โฟลเดอร์</th>
                  <th className="py-2.5 px-3">สถานะการตั้งค่า</th>
                  <th className="py-2.5 px-3">ชื่อโฟลเดอร์บน Drive</th>
                  <th className="py-2.5 px-3 text-right">จำนวนไฟล์</th>
                  <th className="py-2.5 px-3 text-right">ขนาดรวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {FOLDER_META.map((fm) => {
                  const configured = Boolean(health?.gas_drive_configured?.[fm.cfgKey]);
                  const stat = driveQuota?.folders?.find((item) => item.key === fm.key);
                  return (
                    <tr key={fm.key}>
                      <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-white">
                        <i className={`fa-solid ${fm.icon} mr-2`} />
                        {fm.label}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            configured
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                              : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้งค่า'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                        {stat?.accessible
                          ? stat.folderName || '-'
                          : stat?.error
                            ? <span className="text-rose-500">{stat.error}</span>
                            : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {stat?.accessible ? (
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <span>
                              {stat.fileCount.toLocaleString()} ไฟล์
                              {stat.truncated && <span className="text-amber-600 ml-0.5">+</span>}
                            </span>
                            {(stat.subFolderCount ?? 0) > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                                {stat.subFolderCount} โฟลเดอร์ย่อย
                              </span>
                            )}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">
                        {stat?.accessible ? formatBytes(stat.sizeBytes) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

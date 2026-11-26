import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { DriveImage } from '@/components/common/DriveImage';
import { useSettings } from '@/contexts/SettingsContext';
import { deleteFromGoogleDrive } from '@/services/driveStorageService';
import { webappService } from '@/services/webappService';
import { WebappConfigModal } from '@/components/admin/WebappConfigModal';
import { useUiStore } from '@/stores/useUiStore';
import { confirmAction } from '@/lib/swalHelpers';
import { QUERY_KEYS } from '@/lib/queryClient';
import type { WebappWithRoles } from '@/types/domain.types';

export default function WebappsPage() {
  const qc = useQueryClient();
  const { settings } = useSettings();
  const showToast = useUiStore((s) => s.showToast);

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<WebappWithRoles | null>(null);

  const { data: webapps = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.webapps,
    queryFn: () => webappService.listAll(),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return webapps;
    return webapps.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.app_code.toLowerCase().includes(q) ||
        (w.description || '').toLowerCase().includes(q)
    );
  }, [webapps, search]);

  const invalidateWebappQueries = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: QUERY_KEYS.webapps }),
      qc.invalidateQueries({ queryKey: QUERY_KEYS.myApps }),
      qc.invalidateQueries({ queryKey: QUERY_KEYS.dashboardStats }),
    ]);
  };

  const handleDelete = async (app: WebappWithRoles) => {
    const ok = await confirmAction(
      `ลบเว็บแอป "${app.name}"`,
      'การลบจะยกเลิกสิทธิ์เข้าถึงและระดับสิทธิ์ทั้งหมดของเว็บแอปนี้ ยืนยันหรือไม่?',
      'ยืนยันลบ',
      'warning'
    );
    if (!ok) return;
    try {
      await webappService.deleteWebapp(app.id);
      if (app.icon_url) {
        void deleteFromGoogleDrive({ fileUrlOrId: app.icon_url, category: 'image', settings });
      }
      showToast('ลบเว็บแอปย่อยเรียบร้อย', 'success');
      await invalidateWebappQueries();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถลบเว็บแอปได้', 'error');
    }
  };

  return (
    <AdminLayout
      title="จัดการระบบเว็บแอปย่อย"
      subtitle="ลงทะเบียนเว็บแอปย่อย นิยามระดับสิทธิ์รายแอป ตั้งค่า API Key และ Allowed Origins"
      activePage="webapps"
    >
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-emerald-600 text-white flex items-center justify-center shadow">
              <i className="fa-solid fa-window-restore text-base" />
            </span>
            จัดการระบบเว็บแอปย่อย (Sub-Webapps Registry)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            ลงทะเบียนเว็บแอปย่อย นิยามระดับสิทธิ์รายแอปไม่จำกัดขั้น ตั้งค่า API Key, Scopes และ Allowed Origins (เฉพาะ SUPERADMIN)
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingApp(null);
            setModalOpen(true);
          }}
          className="bma-btn-primary"
        >
          <i className="fa-solid fa-plus mr-1.5" />
          ลงทะเบียนเว็บแอปใหม่
        </button>
      </div>

      {/* Search */}
      <div className="bma-card p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <i className="fa-solid fa-magnifying-glass text-xs text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            className="bma-input pl-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อเว็บแอป หรือ App Code..."
          />
        </div>
        <div className="text-xs text-slate-500">
          พบทั้งหมด <strong className="text-slate-800 dark:text-slate-100">{filtered.length}</strong> ระบบ
        </div>
      </div>

      {/* Grid of Registered Sub-Webapps */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bma-card h-52 animate-pulse bg-slate-100 dark:bg-slate-800/40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bma-card p-12 text-center text-slate-500">
          <i className="fa-solid fa-cubes text-3xl text-slate-300 mb-3 block" />
          ยังไม่มีเว็บแอปย่อยที่ตรงกับการค้นหา
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((app) => (
            <div
              key={app.id}
              className="bma-card p-5 flex flex-col justify-between gap-4 hover:shadow-lg transition"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-11 h-11 rounded-2xl text-white flex items-center justify-center text-lg shadow shrink-0 overflow-hidden"
                      style={{ backgroundColor: app.color || '#00744B' }}
                    >
                      {app.icon_url ? (
                        <DriveImage
                          src={app.icon_url}
                          alt={app.name}
                          category="image"
                          className="w-full h-full object-cover"
                          fallback={<i className={`fa-solid ${app.icon || 'fa-window-maximize'}`} />}
                        />
                      ) : (
                        <i className={`fa-solid ${app.icon || 'fa-window-maximize'}`} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 dark:text-white truncate">{app.name}</h3>
                      <span className="text-[11px] font-mono text-slate-500">{app.app_code}</span>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                      app.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                        : app.status === 'MAINTENANCE'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {app.status}
                  </span>
                </div>

                {app.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{app.description}</p>
                )}

                <div className="flex flex-wrap gap-1">
                  {(app.roles || []).map((r) => (
                    <span
                      key={r.id}
                      className="px-2 py-0.5 rounded-md text-[10px] font-bold text-white"
                      style={{ backgroundColor: r.color_hex || '#00744B' }}
                    >
                      {r.role_name_th}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-center text-[11px]">
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 py-1.5">
                    <div className="text-slate-400">ผู้มีสิทธิ์</div>
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      {app.authorized_count ?? 0}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 py-1.5">
                    <div className="text-slate-400">API Scopes</div>
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      {(app.scopes || []).length}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 py-1.5">
                    <div className="text-slate-400">Auto-Grant</div>
                    <div className="font-bold text-emerald-600 dark:text-emerald-400">
                      {app.auto_grant_on_provision ? 'เปิด' : 'ปิด'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <a
                  href={app.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-slate-400 hover:text-[#00744B] truncate max-w-[180px]"
                >
                  <i className="fa-solid fa-arrow-up-right-from-square mr-1" />
                  {app.url}
                </a>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingApp(app);
                      setModalOpen(true);
                    }}
                    className="bma-btn-outline text-xs py-1 px-2.5"
                  >
                    <i className="fa-solid fa-sliders mr-1" />
                    ตั้งค่า
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(app)}
                    className="px-2.5 py-1 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                    title="ลบเว็บแอป"
                  >
                    <i className="fa-solid fa-trash-can" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <WebappConfigModal
        open={modalOpen}
        webapp={editingApp}
        onClose={() => setModalOpen(false)}
        onSaved={() => void invalidateWebappQueries()}
      />
    </div>
    </AdminLayout>
  );
}

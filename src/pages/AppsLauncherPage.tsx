import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { ScopeBadge } from '@/components/common/ScopeBadge';
import { DriveImage } from '@/components/common/DriveImage';
import { sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import { ssoService } from '@/services/ssoService';
import { QUERY_KEYS } from '@/lib/queryClient';
import { formatThaiDate } from '@/lib/thaiDate';
import { useUiStore } from '@/stores/useUiStore';

type AppStatusFilter = 'ALL' | 'ACTIVE' | 'MAINTENANCE';

export default function AppsLauncherPage() {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AppStatusFilter>('ALL');
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  const { data: apps = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.myApps,
    queryFn: () => ssoService.getMyApps(),
  });

  const filteredApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter((app) => {
      if (statusFilter === 'ACTIVE' && app.status !== 'ACTIVE') return false;
      if (statusFilter === 'MAINTENANCE' && app.status !== 'MAINTENANCE') return false;
      if (q) {
        const hay = `${app.name} ${app.app_code} ${app.description || ''} ${app.role_name_th}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [apps, search, statusFilter]);

  const counts = useMemo(
    () => ({
      ALL: apps.length,
      ACTIVE: apps.filter((a) => a.status === 'ACTIVE').length,
      MAINTENANCE: apps.filter((a) => a.status === 'MAINTENANCE').length,
    }),
    [apps]
  );

  const handleLaunch = async (webappId: string, name: string) => {
    setLaunchingId(webappId);
    try {
      const { redirect_url } = await ssoService.generateSsoLaunchUrl(webappId);
      window.open(redirect_url, '_blank', 'noopener,noreferrer');
      showToast(`เปิดระบบ "${name}" ผ่าน SSO สำเร็จ`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถสร้างลิงก์ SSO ได้', 'error');
    } finally {
      setLaunchingId(null);
    }
  };

  return (
    <AdminLayout
      title="แอปของฉัน (SSO Launcher)"
      subtitle="เข้าใช้งานเว็บแอปย่อยทั้งหมดที่บัญชีของคุณได้รับอนุญาตภายในระบบผู้ดูแล"
      activePage="apps"
    >
      <div className="space-y-5">
        {/* Summary & MainApp Switch Bar */}
        <div className="bma-card p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
              <i className="fa-solid fa-grip text-[#00744B] dark:text-emerald-400" />
              <span>ระบบงานที่พร้อมใช้งาน ({apps.length} ระบบ)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              กดที่ปุ่มเปิดใช้งานเพื่อออก One-Time SSO Token (อายุ 5 นาที) และเข้าสู่เว็บแอปย่อยอัตโนมัติ
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <ScopeBadge />
            <button
              type="button"
              onClick={() => navigate('/main-app')}
              className="bma-btn-primary text-xs"
            >
              <i className="fa-solid fa-tv" />
              <span>เปิดโหมด MainApp (เต็มจอ)</span>
            </button>
          </div>
        </div>

        {/* Search & Status Filter Strip */}
        <div className="bma-card p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <i className="fa-solid fa-magnifying-glass text-xs text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อเว็บแอป, รหัสแอป หรือระดับสิทธิ์..."
              className="bma-input pl-8 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'ALL', label: 'ทั้งหมด' },
                { id: 'ACTIVE', label: 'พร้อมใช้งาน' },
                { id: 'MAINTENANCE', label: 'ปิดปรับปรุง' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  statusFilter === tab.id
                    ? 'bg-[#00744B] text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label} ({counts[tab.id]})
              </button>
            ))}
          </div>
        </div>

        {/* App Cards Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-2xl bg-white dark:bg-slate-800 bma-skeleton-shimmer" />
            ))}
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="bma-card p-10 text-center text-slate-500 dark:text-slate-400">
            <i className="fa-solid fa-box-open text-4xl mb-3 opacity-40" />
            <p className="font-bold text-sm">
              {search.trim() || statusFilter !== 'ALL'
                ? 'ไม่พบเว็บแอปย่อยที่ตรงกับเงื่อนไขการค้นหา'
                : 'ยังไม่มีเว็บแอปย่อยที่ได้รับอนุญาต'}
            </p>
            <p className="text-xs mt-1">
              {search.trim() || statusFilter !== 'ALL'
                ? 'ลองล้างคำค้นหาหรือเลือกตัวกรอง "ทั้งหมด"'
                : 'กรุณาติดต่อผู้ดูแลระบบประจำสังกัดเพื่อขอเปิดสิทธิ์เข้าใช้งาน'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredApps.map((app) => {
              const iconImg = sanitizeImageUrl(app.icon_url);
              const accent = app.color || '#00744B';
              return (
                <div
                  key={app.webapp_id}
                  className="bma-card p-5 flex flex-col justify-between gap-4 hover:-translate-y-0.5 hover:shadow-lg transition"
                >
                  <div className="flex items-start gap-3.5">
                    <div
                      className="w-12 h-12 rounded-2xl text-white flex items-center justify-center text-xl shadow-md shrink-0 overflow-hidden"
                      style={{ backgroundColor: iconImg ? 'transparent' : accent }}
                    >
                      {iconImg ? (
                        <DriveImage
                          src={iconImg}
                          alt={app.name}
                          category="image"
                          className="w-full h-full object-cover border border-slate-200 dark:border-slate-700 rounded-2xl"
                          fallback={
                            <span
                              className="w-full h-full flex items-center justify-center text-white"
                              style={{ backgroundColor: accent }}
                            >
                              <i className={`fa-solid ${app.icon || 'fa-window-maximize'}`} />
                            </span>
                          }
                        />
                      ) : (
                        <i className={`fa-solid ${app.icon || 'fa-window-maximize'}`} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-mono font-bold text-slate-400">{app.app_code}</span>
                      <h3 className="font-extrabold text-base text-slate-800 dark:text-white leading-snug truncate">
                        {app.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                        {app.description || 'ระบบงานย่อยภายใต้โครงการ Portal SSO'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold text-white"
                        style={{ backgroundColor: app.role_color || accent }}
                      >
                        <i className="fa-solid fa-user-tag text-[10px]" />
                        {app.role_name_th}
                      </span>
                      {app.expires_at && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          <i className="fa-regular fa-clock text-[9px]" />
                          ถึง {formatThaiDate(app.expires_at, 'short')}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={launchingId === app.webapp_id || app.status === 'MAINTENANCE'}
                      onClick={() => void handleLaunch(app.webapp_id, app.name)}
                      className="px-4 py-2 rounded-xl bg-[#00744B] hover:bg-[#005B2E] text-white text-xs font-bold transition disabled:opacity-50 shrink-0"
                    >
                      {app.status === 'MAINTENANCE' ? (
                        'ปิดปรับปรุง'
                      ) : launchingId === app.webapp_id ? (
                        <>
                          <i className="fa-solid fa-spinner fa-spin mr-1.5" />
                          กำลังเชื่อมต่อ...
                        </>
                      ) : (
                        <>
                          เปิดใช้งาน <i className="fa-solid fa-arrow-up-right-from-square ml-1" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

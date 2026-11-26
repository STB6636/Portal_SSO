import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/contexts/ThemeContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import { useSystemUpdateCheck } from '@/hooks/useSystemUpdateCheck';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUiStore } from '@/stores/useUiStore';
import { ssoService } from '@/services/ssoService';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { confirmAction } from '@/lib/swalHelpers';
import { cleanDisplaySegment } from '@/lib/positionFormatter';
import { formatThaiDate } from '@/lib/thaiDate';
import { QUERY_KEYS } from '@/lib/queryClient';
import { DriveImage } from '@/components/common/DriveImage';
import { RoleBadge } from '@/components/common/RoleBadge';
import { MyProfileModal } from '@/components/profile/MyProfileModal';
import { SystemUpdateModal, sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import type { MyAppLaunchCard } from '@/types/domain.types';

type SmartTvTile =
  | {
      kind: 'admin';
      id: '__ADMIN_PORTAL__';
      code: 'ADMIN_PORTAL';
      name: string;
      description: string;
      icon: string;
      iconUrl?: string;
      accent: string;
      roleLabel: string;
      roleColor: string;
      status: 'ACTIVE';
      pendingCount: number;
    }
  | {
      kind: 'webapp';
      id: string;
      code: string;
      name: string;
      description: string;
      icon: string;
      iconUrl?: string;
      accent: string;
      roleLabel: string;
      roleColor: string;
      status: MyAppLaunchCard['status'];
      expiresAt?: string | null;
      raw: MyAppLaunchCard;
    };

function formatBangkokClock(now: Date): { timeStr: string; dateStr: string } {
  try {
    const timeStr = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    const dateStr = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
    return { timeStr, dateStr };
  } catch {
    return { timeStr: '', dateStr: '' };
  }
}

export default function AppsLauncherPage() {
  const navigate = useNavigate();
  const { user, isSuperAdmin, isAdminOrAbove, scopeLabel } = useScopedPermissions();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const { settings } = useSettings();
  const { isDark, toggleTheme } = useTheme();
  const showToast = useUiStore((s) => s.showToast);

  const [search, setSearch] = useState('');
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [myProfileOpen, setMyProfileOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Preserve System Announcements & Release Notes popup outside AdminShell (C4-A)
  const { versionInfo, showUpdateModal, openUpdateModal, dismissModal } = useSystemUpdateCheck(settings);

  useEffect(() => {
    document.title = `แอปของฉัน — ${settings.bureau_name || 'Portal SSO'}`;
  }, [settings.bureau_name]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const { data: apps = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.myApps,
    queryFn: () => ssoService.getMyApps(),
  });

  const { data: pendingResetRows = [] } = useQuery({
    queryKey: QUERY_KEYS.resetRequests('PENDING'),
    enabled: Boolean(user && isAdminOrAbove && isSupabaseConfigured),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credential_reset_requests')
        .select('id')
        .eq('status', 'PENDING')
        .limit(99);
      if (error) return [];
      return data ?? [];
    },
  });

  const pendingResetCount = pendingResetRows.length;

  // Build unified Smart TV Tile list:
  // Built-in "ระบบผู้ดูแล" tile rendered STRICTLY for SUPERADMIN / ADMIN (ZERO DOM for USER!)
  const tiles = useMemo<SmartTvTile[]>(() => {
    const q = search.trim().toLowerCase();
    const list: SmartTvTile[] = [];

    if (isAdminOrAbove) {
      const adminTile: SmartTvTile = {
        kind: 'admin',
        id: '__ADMIN_PORTAL__',
        code: 'ADMIN_PORTAL',
        name: 'ระบบผู้ดูแล',
        description: isSuperAdmin
          ? 'ศูนย์บริหารจัดการทะเบียนประวัติบุคลากร บัญชีผู้ใช้ เว็บแอปย่อย แค็ตตาล็อก API และการตั้งค่าระบบกลางทั้งหมด'
          : `ศูนย์บริหารจัดการทะเบียนประวัติบุคลากร บัญชีผู้ใช้ คำขอรีเซ็ตรหัส และสิทธิ์เข้าถึงเว็บแอปย่อย (${scopeLabel})`,
        icon: 'fa-screwdriver-wrench',
        accent: '#00744B',
        roleLabel: isSuperAdmin ? 'SUPERADMIN' : 'ADMIN',
        roleColor: isSuperAdmin ? '#BE123C' : '#B45309',
        status: 'ACTIVE',
        pendingCount: pendingResetCount,
      };
      if (
        !q ||
        `${adminTile.name} ${adminTile.description} admin dashboard ผู้ดูแลระบบ จัดการ`
          .toLowerCase()
          .includes(q)
      ) {
        list.push(adminTile);
      }
    }

    for (const app of apps) {
      if (
        q &&
        !`${app.name} ${app.app_code} ${app.description || ''} ${app.role_name_th}`
          .toLowerCase()
          .includes(q)
      ) {
        continue;
      }
      list.push({
        kind: 'webapp',
        id: app.webapp_id,
        code: app.app_code,
        name: app.name,
        description: app.description || 'ระบบงานย่อยภายใต้โครงการ Portal SSO',
        icon: app.icon || 'fa-window-maximize',
        iconUrl: sanitizeImageUrl(app.icon_url),
        accent: app.color || '#00744B',
        roleLabel: app.role_name_th,
        roleColor: app.role_color || app.color || '#00744B',
        status: app.status,
        expiresAt: app.expires_at,
        raw: app,
      });
    }

    return list;
  }, [apps, isAdminOrAbove, isSuperAdmin, pendingResetCount, scopeLabel, search]);

  useEffect(() => {
    if (focusedIndex >= tiles.length) {
      setFocusedIndex(0);
    }
  }, [focusedIndex, tiles.length]);

  const handleActivateTile = async (tile: SmartTvTile) => {
    if (tile.kind === 'admin') {
      navigate('/dashboard');
      return;
    }
    if (tile.status === 'MAINTENANCE') {
      showToast(`ระบบ "${tile.name}" อยู่ระหว่างปิดปรับปรุงชั่วคราว`, 'warning');
      return;
    }
    setLaunchingId(tile.id);
    try {
      const { redirect_url } = await ssoService.generateSsoLaunchUrl(tile.id);
      window.open(redirect_url, '_blank', 'noopener,noreferrer');
      showToast(`เปิดระบบ "${tile.name}" ผ่าน SSO สำเร็จ`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถสร้างลิงก์ SSO ได้', 'error');
    } finally {
      setLaunchingId(null);
    }
  };

  // Smart TV D-Pad Keyboard Navigation (ArrowLeft / ArrowRight / ArrowUp / ArrowDown / Enter / '/')
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (myProfileOpen || showUpdateModal) return;
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement)?.blur();
        }
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (tiles.length === 0) return;

      const cols = window.innerWidth >= 1280 ? 4 : window.innerWidth >= 768 ? 3 : window.innerWidth >= 640 ? 2 : 1;
      let nextIdx = focusedIndex;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextIdx = (focusedIndex + 1) % tiles.length;
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nextIdx = (focusedIndex - 1 + tiles.length) % tiles.length;
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        nextIdx = Math.min(tiles.length - 1, focusedIndex + cols);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        nextIdx = Math.max(0, focusedIndex - cols);
      } else if (e.key === 'Enter' && document.activeElement?.tagName.toLowerCase() !== 'button') {
        e.preventDefault();
        const currentTile = tiles[focusedIndex];
        if (currentTile) void handleActivateTile(currentTile);
        return;
      } else {
        return;
      }

      setFocusedIndex(nextIdx);
      tileRefs.current[nextIdx]?.focus({ preventScroll: false });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tiles, focusedIndex, myProfileOpen, showUpdateModal]);

  const handleLogout = async () => {
    const ok = await confirmAction(
      'ออกจากระบบ',
      'คุณต้องการออกจากระบบ Portal SSO ใช่หรือไม่?',
      'ออกจากระบบ',
      'warning'
    );
    if (!ok) return;
    await supabase.auth.signOut().catch(() => {});
    clearAuth();
    showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    navigate('/login', { replace: true });
  };

  const { timeStr, dateStr } = formatBangkokClock(now);
  const logoUrl = sanitizeImageUrl(settings.logo_url);
  const avatarUrl = sanitizeImageUrl(user?.photo_path);
  const initials = (user?.full_name || user?.username || 'U').trim().slice(0, 2);
  const spotlightTile = tiles[focusedIndex] ?? tiles[0] ?? null;

  return (
    <div className="smarttv-desktop-canvas min-h-screen flex flex-col relative overflow-x-hidden">
      {/* Ambient Emerald/Gold Radial Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden z-0"
      >
        <div
          className="absolute -top-32 -left-24 w-[480px] h-[480px] rounded-full blur-3xl opacity-25 dark:opacity-20"
          style={{ background: 'radial-gradient(circle, #00A368 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-1/3 -right-24 w-[440px] h-[440px] rounded-full blur-3xl opacity-20 dark:opacity-15"
          style={{ background: 'radial-gradient(circle, #F6DE51 0%, transparent 72%)' }}
        />
      </div>

      {/* Floating Glass HUD Top Bar */}
      <header className="smarttv-hud-bar sticky top-0 z-30 border-b">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Left: Organization Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#00351B] to-[#00744B] p-1.5 border border-emerald-400/35 shadow-md flex items-center justify-center shrink-0 overflow-hidden">
              {logoUrl ? (
                <DriveImage
                  src={logoUrl}
                  alt={settings.bureau_name || 'Logo'}
                  category="logo"
                  className="w-full h-full object-contain"
                  fallback={<i className="fa-solid fa-shield-halved text-[#F6DE51] text-lg" />}
                />
              ) : (
                <i className="fa-solid fa-shield-halved text-[#F6DE51] text-lg" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[#00744B] dark:text-emerald-400 truncate">
                {settings.organization_name}
              </p>
              <h1 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate leading-tight">
                {settings.bureau_name}
              </h1>
            </div>
          </div>

          {/* Center: Quick Search */}
          <div className="order-3 lg:order-2 w-full lg:w-auto lg:flex-1 lg:max-w-md">
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass text-xs text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาแอปพลิเคชัน... (กด / เพื่อค้นหาด่วน)"
                className="w-full pl-9 pr-9 py-2 rounded-full bg-white/85 dark:bg-slate-900/75 border border-slate-200/90 dark:border-slate-700/80 text-xs sm:text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00744B]/40 focus:border-[#00744B] transition"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="ล้างคำค้นหา"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <i className="fa-solid fa-xmark text-xs" />
                </button>
              )}
            </div>
          </div>

          {/* Right: Live Clock + HUD Controls + Profile Avatar */}
          <div className="order-2 lg:order-3 flex items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Live Thai Clock */}
            {timeStr && (
              <div className="hidden xl:flex flex-col items-end pr-2 border-r border-slate-300/60 dark:border-slate-700/80">
                <span className="font-mono font-black text-sm text-slate-800 dark:text-white leading-none">
                  {timeStr} น.
                </span>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                  {dateStr}
                </span>
              </div>
            )}

            {/* Announcement / Version Info Button */}
            <button
              type="button"
              onClick={openUpdateModal}
              title="ดูประกาศระบบและบันทึกอัปเดตเวอร์ชัน"
              className="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-slate-700 text-[#00744B] dark:text-emerald-300 flex items-center justify-center transition relative"
            >
              <i className="fa-solid fa-bullhorn text-xs" />
              {settings.announcement_enabled && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white dark:ring-slate-900" />
              )}
            </button>

            {/* Admin-Only Pending Reset Requests Quick Link */}
            {isAdminOrAbove && (
              <button
                type="button"
                onClick={() => navigate('/admin/reset-requests')}
                title="คำขอรีเซ็ตรหัสเข้าใช้รออนุมัติ"
                className="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 hover:bg-amber-50 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-300 flex items-center justify-center transition relative"
              >
                <i className="fa-solid fa-bell text-xs" />
                {pendingResetCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center shadow">
                    {pendingResetCount > 99 ? '99+' : pendingResetCount}
                  </span>
                )}
              </button>
            )}

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              title={isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดถนอมสายตา'}
              className="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-amber-300 flex items-center justify-center transition"
            >
              <i className={`fa-solid ${isDark ? 'fa-sun' : 'fa-moon'} text-xs`} />
            </button>

            {/* User Profile Pill -> Opens MyProfileModal */}
            <button
              type="button"
              onClick={() => setMyProfileOpen(true)}
              aria-label="เปิดโปรไฟล์ของฉัน"
              className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white/85 dark:bg-slate-800/85 hover:border-[#00744B]/50 transition"
            >
              {avatarUrl ? (
                <DriveImage
                  src={avatarUrl}
                  alt={user?.full_name || ''}
                  category="image"
                  className="w-7 h-7 rounded-full object-cover border border-emerald-500/40 shrink-0"
                  fallback={
                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white font-extrabold text-[11px] flex items-center justify-center shrink-0">
                      {initials}
                    </span>
                  }
                />
              ) : (
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white font-extrabold text-[11px] flex items-center justify-center shrink-0">
                  {initials}
                </span>
              )}
              <span className="hidden sm:block max-w-[140px] truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                {user?.full_name || user?.username || 'ผู้ใช้งาน'}
              </span>
            </button>

            {/* Logout Button */}
            <button
              type="button"
              onClick={() => void handleLogout()}
              title="ออกจากระบบ"
              className="w-9 h-9 rounded-full border border-rose-200 dark:border-rose-900/60 bg-rose-50/90 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center transition"
            >
              <i className="fa-solid fa-right-from-bracket text-xs" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Smart TV Desktop Stage */}
      <main className="relative z-10 flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-7">
        {/* Hero Spotlight Banner */}
        <section className="smarttv-spotlight-banner rounded-3xl overflow-hidden relative shadow-xl border border-emerald-700/30">
          <div className="relative z-10 p-6 sm:p-8 lg:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold bg-white/15 text-[#F6DE51] border border-white/20 backdrop-blur-sm">
                  <i className="fa-solid fa-tv text-[10px]" />
                  Portal SSO Launcher
                </span>
                <RoleBadge role={user?.role} />
                {spotlightTile && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/25 text-emerald-100">
                    {spotlightTile.code}
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs sm:text-sm text-emerald-100/90 font-semibold">
                  ยินดีต้อนรับ, {user?.full_name || user?.username}
                  {cleanDisplaySegment(user?.position_display)
                    ? ` · ${cleanDisplaySegment(user?.position_display)}`
                    : ''}
                </p>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight leading-tight">
                  {spotlightTile ? spotlightTile.name : 'ศูนย์รวมแอปพลิเคชันของฉัน'}
                </h2>
              </div>

              <p className="text-xs sm:text-sm text-emerald-50/90 leading-relaxed line-clamp-2">
                {spotlightTile
                  ? spotlightTile.description
                  : 'เข้าใช้งานระบบเว็บแอปย่อยทั้งหมดที่ได้รับอนุญาตด้วยการยืนยันตัวตนครั้งเดียว (Single Sign-On)'}
              </p>

              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                {spotlightTile && (
                  <button
                    type="button"
                    disabled={
                      launchingId === spotlightTile.id || spotlightTile.status === 'MAINTENANCE'
                    }
                    onClick={() => void handleActivateTile(spotlightTile)}
                    className="px-6 py-2.5 rounded-2xl bg-[#F6DE51] hover:bg-amber-300 text-slate-950 font-black text-xs sm:text-sm shadow-lg transition inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    {spotlightTile.status === 'MAINTENANCE' ? (
                      <>
                        <i className="fa-solid fa-wrench" />
                        <span>ปิดปรับปรุงชั่วคราว</span>
                      </>
                    ) : launchingId === spotlightTile.id ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" />
                        <span>กำลังเชื่อมต่อ SSO...</span>
                      </>
                    ) : spotlightTile.kind === 'admin' ? (
                      <>
                        <i className="fa-solid fa-gauge-high" />
                        <span>เข้าสู่ระบบผู้ดูแล</span>
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-play" />
                        <span>เปิดใช้งานทันที</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setMyProfileOpen(true)}
                  className="px-4 py-2.5 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs sm:text-sm font-bold backdrop-blur-sm transition inline-flex items-center gap-2"
                >
                  <i className="fa-solid fa-id-card" />
                  <span>โปรไฟล์ & พิมพ์ ก.พ. ๗</span>
                </button>
              </div>
            </div>

            {/* Right Spotlight Poster Emblem */}
            {spotlightTile && (
              <div className="hidden lg:flex items-center justify-center shrink-0">
                <div
                  className="w-40 h-40 rounded-3xl shadow-2xl border-2 border-white/25 flex items-center justify-center overflow-hidden backdrop-blur-md"
                  style={{
                    background: `linear-gradient(135deg, ${spotlightTile.accent}EE, ${spotlightTile.accent}99)`,
                  }}
                >
                  {spotlightTile.iconUrl ? (
                    <DriveImage
                      src={spotlightTile.iconUrl}
                      alt={spotlightTile.name}
                      category="image"
                      className="w-full h-full object-cover"
                      fallback={
                        <i className={`fa-solid ${spotlightTile.icon} text-6xl text-white drop-shadow`} />
                      }
                    />
                  ) : (
                    <i className={`fa-solid ${spotlightTile.icon} text-6xl text-white drop-shadow`} />
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Smart TV Poster Tile Grid */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm sm:text-base font-black text-slate-800 dark:text-white flex items-center gap-2">
              <span className="w-1.5 h-5 rounded-full bg-[#00744B] inline-block" />
              <span>แอปพลิเคชันที่พร้อมใช้งาน ({tiles.length})</span>
            </h3>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <i className="fa-regular fa-keyboard" />
              <span>ใช้ปุ่มลูกศร ← ↑ ↓ → และ Enter เพื่อเลือกแอปแบบ Smart TV</span>
            </span>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="aspect-[16/10] rounded-3xl bg-white/80 dark:bg-slate-800/80 bma-skeleton-shimmer"
                />
              ))}
            </div>
          ) : tiles.length === 0 ? (
            <div className="bma-card p-12 text-center text-slate-500 dark:text-slate-400 space-y-2">
              <i className="fa-solid fa-box-open text-4xl opacity-40 block" />
              <p className="font-extrabold text-sm">
                {search.trim()
                  ? `ไม่พบแอปพลิเคชันที่ตรงกับ "${search.trim()}"`
                  : 'ยังไม่มีเว็บแอปย่อยที่ได้รับอนุญาต'}
              </p>
              <p className="text-xs">
                {search.trim()
                  ? 'ลองล้างคำค้นหาเพื่อดูระบบงานทั้งหมดที่พร้อมใช้งาน'
                  : 'กรุณาติดต่อผู้ดูแลระบบประจำสังกัดเพื่อขอเปิดสิทธิ์เข้าใช้งาน'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
              {tiles.map((tile, idx) => {
                const isFocused = idx === focusedIndex;
                const isLaunching = launchingId === tile.id;
                const isMaint = tile.status === 'MAINTENANCE';
                return (
                  <button
                    key={tile.id}
                    ref={(el) => {
                      tileRefs.current[idx] = el;
                    }}
                    type="button"
                    onMouseEnter={() => setFocusedIndex(idx)}
                    onFocus={() => setFocusedIndex(idx)}
                    onClick={() => void handleActivateTile(tile)}
                    disabled={isLaunching}
                    className={`smarttv-app-tile group text-left rounded-3xl overflow-hidden flex flex-col justify-between aspect-[16/10] p-5 relative transition-all duration-200 focus:outline-none ${
                      isFocused ? 'smarttv-tile-focused' : ''
                    } ${isMaint ? 'opacity-75' : ''}`}
                    style={
                      {
                        '--tile-accent': tile.accent,
                      } as React.CSSProperties
                    }
                  >
                    {/* Top Row: Poster Icon + Status/Role Pill */}
                    <div className="flex items-start justify-between gap-3 relative z-10">
                      <div
                        className="w-14 h-14 rounded-2xl text-white flex items-center justify-center text-2xl shadow-lg shrink-0 overflow-hidden border border-white/25 group-hover:scale-105 transition-transform"
                        style={{
                          background: `linear-gradient(135deg, ${tile.accent}, #00351B)`,
                        }}
                      >
                        {tile.iconUrl ? (
                          <DriveImage
                            src={tile.iconUrl}
                            alt={tile.name}
                            category="image"
                            className="w-full h-full object-cover"
                            fallback={<i className={`fa-solid ${tile.icon}`} />}
                          />
                        ) : (
                          <i className={`fa-solid ${tile.icon}`} />
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-1 min-w-0">
                        <span
                          className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold text-white shadow-xs truncate max-w-[140px]"
                          style={{ backgroundColor: tile.roleColor }}
                        >
                          {tile.roleLabel}
                        </span>
                        {tile.kind === 'admin' && tile.pendingCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-600 text-white">
                            รออนุมัติ {tile.pendingCount}
                          </span>
                        )}
                        {isMaint && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500 text-slate-950">
                            ปิดปรับปรุง
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Bottom Row: Title, Description & Action Footer */}
                    <div className="space-y-1.5 relative z-10 mt-auto pt-3">
                      <h4 className="font-black text-base text-slate-900 dark:text-white leading-snug truncate group-hover:text-[#00744B] dark:group-hover:text-emerald-300 transition">
                        {tile.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                        {tile.description}
                      </p>

                      <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-200/70 dark:border-slate-700/60 text-[11px]">
                        <span className="font-mono font-bold text-slate-400 truncate">
                          {tile.kind === 'webapp' && tile.expiresAt
                            ? `ถึง ${formatThaiDate(tile.expiresAt, 'short')}`
                            : tile.code}
                        </span>
                        <span className="font-extrabold text-[#00744B] dark:text-emerald-400 inline-flex items-center gap-1 shrink-0">
                          {isLaunching ? (
                            <>
                              <i className="fa-solid fa-spinner fa-spin" />
                              กำลังเปิด...
                            </>
                          ) : tile.kind === 'admin' ? (
                            <>
                              เข้าจัดการ <i className="fa-solid fa-arrow-right text-[10px]" />
                            </>
                          ) : (
                            <>
                              เปิดใช้งาน <i className="fa-solid fa-arrow-up-right-from-square text-[10px]" />
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Subtle Footer */}
      <footer className="relative z-10 py-3.5 px-4 text-center text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-200/70 dark:border-slate-800/80">
        {settings.footer_description} · {versionInfo.appVersion}
      </footer>

      {/* My Profile Popup Modal */}
      <MyProfileModal open={myProfileOpen} onClose={() => setMyProfileOpen(false)} />

      {/* System Announcement & Release Notes Modal (preserved outside AdminShell!) */}
      <SystemUpdateModal
        open={showUpdateModal}
        onClose={dismissModal}
        settings={settings}
        versionInfo={versionInfo}
      />
    </div>
  );
}

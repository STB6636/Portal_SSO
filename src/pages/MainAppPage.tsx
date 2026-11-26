import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { confirmLogout } from '@/lib/swalHelpers';
import { formatThaiDate } from '@/lib/thaiDate';
import { QUERY_KEYS } from '@/lib/queryClient';
import { DriveImage } from '@/components/common/DriveImage';
import { MyProfileModal } from '@/components/profile/MyProfileModal';
import { SystemUpdateModal, sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import type { MyAppLaunchCard } from '@/types/domain.types';

type MainAppTile =
  | {
      kind: 'admin';
      id: '__ADMIN_DASHBOARD__';
      code: 'ADMIN_DASHBOARD';
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

interface RippleState {
  tileId: string;
  x: number;
  y: number;
  key: number;
}

function formatBangkokTime(now: Date): string {
  try {
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    return '';
  }
}

export default function MainAppPage() {
  const navigate = useNavigate();
  const { user, isSuperAdmin, isAdminOrAbove, scopeLabel } = useScopedPermissions();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const { settings } = useSettings();
  const { isDark, toggleTheme } = useTheme();
  const showToast = useUiStore((s) => s.showToast);

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'coverflow' | 'grid'>('coverflow');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [myProfileOpen, setMyProfileOpen] = useState(false);
  const [ripple, setRipple] = useState<RippleState | null>(null);
  const [now, setNow] = useState(() => new Date());

  const railRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Preserve System Announcements & Release Notes popup outside AdminShell
  const { versionInfo, showUpdateModal, openUpdateModal, dismissModal } = useSystemUpdateCheck(settings);

  useEffect(() => {
    document.title = `MainApp — ${settings.bureau_name || 'Portal SSO'}`;
  }, [settings.bureau_name]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
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

  // Built-in "แดชบอร์ดผู้ดูแลระบบ" card strictly for ADMIN / SUPERADMIN (ZERO DOM for USER)
  const tiles = useMemo<MainAppTile[]>(() => {
    const q = search.trim().toLowerCase();
    const list: MainAppTile[] = [];

    if (isAdminOrAbove) {
      const adminTile: MainAppTile = {
        kind: 'admin',
        id: '__ADMIN_DASHBOARD__',
        code: 'ADMIN_DASHBOARD',
        name: 'แดชบอร์ดผู้ดูแลระบบ',
        description: isSuperAdmin
          ? 'ศูนย์บริหารจัดการทะเบียนบุคลากร บัญชีผู้ใช้ เว็บแอปย่อย แค็ตตาล็อก API และการตั้งค่าระบบกลางทั้งหมด'
          : `ศูนย์บริหารจัดการทะเบียนบุคลากร บัญชีผู้ใช้ คำขอรีเซ็ตรหัส และสิทธิ์เข้าถึงเว็บแอปย่อย (${scopeLabel})`,
        icon: 'fa-chart-line',
        accent: '#10B981',
        roleLabel: isSuperAdmin ? 'SUPERADMIN' : 'ADMIN',
        roleColor: isSuperAdmin ? '#BE123C' : '#D97706',
        status: 'ACTIVE',
        pendingCount: pendingResetCount,
      };
      if (
        !q ||
        `${adminTile.name} ${adminTile.description} admin dashboard ผู้ดูแลระบบ แดชบอร์ด จัดการ`
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
        description: app.description || 'เว็บแอปพลิเคชันในระบบ Portal SSO',
        icon: app.icon || 'fa-window-maximize',
        iconUrl: sanitizeImageUrl(app.icon_url),
        accent: app.color || '#10B981',
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

  const scrollTileIntoCenter = (idx: number) => {
    if (viewMode !== 'coverflow') return;
    const node = tileRefs.current[idx];
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  const stepFocus = (delta: number) => {
    if (tiles.length === 0) return;
    const nextIdx = (focusedIndex + delta + tiles.length) % tiles.length;
    setFocusedIndex(nextIdx);
    scrollTileIntoCenter(nextIdx);
  };

  const handleActivateTile = async (
    tile: MainAppTile,
    clickEvent?: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (clickEvent) {
      const rect = clickEvent.currentTarget.getBoundingClientRect();
      setRipple({
        tileId: tile.id,
        x: clickEvent.clientX - rect.left,
        y: clickEvent.clientY - rect.top,
        key: Date.now(),
      });
    }

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

  // Smart TV D-Pad Keyboard Navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (myProfileOpen || showUpdateModal) return;
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        if (e.key === 'Escape') (document.activeElement as HTMLElement)?.blur();
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (tiles.length === 0) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextIdx = (focusedIndex + 1) % tiles.length;
        setFocusedIndex(nextIdx);
        scrollTileIntoCenter(nextIdx);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const nextIdx = (focusedIndex - 1 + tiles.length) % tiles.length;
        setFocusedIndex(nextIdx);
        scrollTileIntoCenter(nextIdx);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocusedIndex(0);
        scrollTileIntoCenter(0);
      } else if (e.key === 'Enter' && activeTag !== 'button') {
        e.preventDefault();
        const currentTile = tiles[focusedIndex];
        if (currentTile) void handleActivateTile(currentTile);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tiles, focusedIndex, viewMode, myProfileOpen, showUpdateModal]);

  const handleCardPointerMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty('--rx', `${(-py * 10).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(px * 10).toFixed(2)}deg`);
  };

  const handleCardPointerLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  const handleLogout = async () => {
    const ok = await confirmLogout({
      fullName: user?.full_name,
      username: user?.username,
      role: user?.role,
      bureauName: settings.bureau_name,
    });
    if (!ok) return;
    await supabase.auth.signOut().catch(() => {});
    clearAuth();
    showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    navigate('/login', { replace: true });
  };

  const timeStr = formatBangkokTime(now);
  const logoUrl = sanitizeImageUrl(settings.logo_url);
  const avatarUrl = sanitizeImageUrl(user?.photo_path);
  const initials = (user?.full_name || user?.username || 'U').trim().slice(0, 2);
  const greetingName = (user?.full_name || user?.username || 'ผู้ใช้งาน').trim();
  const activeTile = tiles[focusedIndex] ?? tiles[0] ?? null;

  return (
    <div className="mainapp-stage-canvas min-h-screen flex flex-col relative overflow-x-hidden select-none">
      {/* Ambient Bokeh + Vertical Digital Pulse Matrix */}
      <div aria-hidden="true" className="mainapp-bokeh-layer pointer-events-none fixed inset-0 z-0" />

      {/* Top Glass HUD Header (Reference Image 3) */}
      <header className="mainapp-top-hud sticky top-0 z-30">
        <div className="max-w-[1480px] mx-auto px-4 sm:px-7 py-3 flex items-center justify-between gap-3">
          {/* Left: Glowing BMA / Organization Emblem + Portal Title */}
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-full bg-white/10 p-1.5 border-2 border-emerald-300/60 shadow-[0_0_22px_rgba(16,185,129,0.55)] flex items-center justify-center shrink-0 overflow-hidden">
              {logoUrl ? (
                <DriveImage
                  src={logoUrl}
                  alt={settings.organization_name || 'Logo'}
                  category="logo"
                  className="w-full h-full object-contain rounded-full"
                  fallback={<i className="fa-solid fa-shield-halved text-[#F6DE51] text-xl" />}
                />
              ) : (
                <i className="fa-solid fa-shield-halved text-[#F6DE51] text-xl" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-black text-white tracking-tight truncate leading-tight">
                {settings.organization_name || 'กรุงเทพมหานคร (BMA)'}
              </h1>
              <p className="text-[11px] sm:text-xs font-bold tracking-wider uppercase text-emerald-200/85 truncate">
                {settings.bureau_name || 'WEB-APP PORTAL'}
              </p>
            </div>
          </div>

          {/* Right: Greeting + Avatar + Crisp Digital Clock + Glowing Search Button */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <button
              type="button"
              onClick={() => setMyProfileOpen(true)}
              aria-label="เปิดโปรไฟล์ของฉัน"
              className="flex items-center gap-2.5 px-2 py-1 rounded-full hover:bg-white/10 transition text-right"
            >
              <div className="hidden md:block min-w-0">
                <p className="text-sm font-extrabold text-white leading-tight truncate max-w-[200px]">
                  สวัสดี, {greetingName}
                </p>
                <p className="text-[11px] font-mono text-emerald-200/80 truncate">
                  ({user?.username || user?.role || 'USER'})
                </p>
              </div>
              {avatarUrl ? (
                <DriveImage
                  src={avatarUrl}
                  alt={greetingName}
                  category="image"
                  className="w-10 h-10 rounded-full object-cover border-2 border-emerald-300/75 shadow-md shrink-0 bg-white"
                  fallback={
                    <span className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-white font-extrabold text-xs flex items-center justify-center border-2 border-emerald-300/75 shrink-0">
                      {initials}
                    </span>
                  }
                />
              ) : (
                <span className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-white font-extrabold text-xs flex items-center justify-center border-2 border-emerald-300/75 shrink-0">
                  {initials}
                </span>
              )}
            </button>

            {timeStr && (
              <div className="hidden sm:flex items-baseline gap-1 font-mono font-black text-2xl lg:text-3xl text-white tracking-tight drop-shadow">
                <span>{timeStr}</span>
                <span className="text-base lg:text-lg font-extrabold text-emerald-200">น.</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => searchInputRef.current?.focus()}
              aria-label="ค้นหาแอปพลิเคชัน"
              title="ค้นหาแอปพลิเคชัน (กด /)"
              className="mainapp-search-btn-glow w-11 h-11 rounded-2xl text-white flex items-center justify-center transition"
            >
              <i className="fa-solid fa-magnifying-glass text-base" />
            </button>
          </div>
        </div>
      </header>

      {/* Center Stage: Smart TV Cover-Flow Showcase / Grid Mode */}
      <main className="relative z-10 flex-1 flex flex-col justify-center max-w-[1480px] w-full mx-auto px-4 sm:px-7 py-6 pb-28">
        {isLoading ? (
          <div className="flex items-center justify-center gap-6 py-10 overflow-hidden">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-48 h-48 sm:w-56 sm:h-56 rounded-[28px] bg-white/10 border border-white/15 animate-pulse shrink-0"
              />
            ))}
          </div>
        ) : tiles.length === 0 ? (
          <div className="max-w-md mx-auto rounded-3xl bg-white/10 backdrop-blur-xl border border-emerald-300/25 p-10 text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-300/35 mx-auto flex items-center justify-center text-emerald-200 text-2xl">
              <i className="fa-solid fa-box-open" />
            </div>
            <h2 className="font-extrabold text-base text-white">
              {search.trim()
                ? `ไม่พบแอปพลิเคชันที่ตรงกับ "${search.trim()}"`
                : 'ยังไม่มีเว็บแอปย่อยที่ได้รับอนุญาต'}
            </h2>
            <p className="text-xs text-emerald-100/80">
              {search.trim()
                ? 'ลองล้างคำค้นหาเพื่อดูแอปพลิเคชันทั้งหมดที่พร้อมใช้งาน'
                : 'กรุณาติดต่อผู้ดูแลระบบประจำสังกัดเพื่อขอเปิดสิทธิ์เข้าใช้งาน'}
            </p>
            {search.trim() && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs transition"
              >
                ล้างคำค้นหา
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Cover-Flow Rail OR Grid Mode */}
            <div
              ref={railRef}
              className={
                viewMode === 'coverflow'
                  ? 'mainapp-rail flex items-center justify-start sm:justify-safe-center gap-5 sm:gap-7 overflow-x-auto snap-x snap-mandatory py-10 px-6 sm:px-10'
                  : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5 sm:gap-6 py-4'
              }
              style={
                viewMode === 'coverflow' && tiles.length <= 5
                  ? { justifyContent: 'center' }
                  : undefined
              }
            >
              {tiles.map((tile, idx) => {
                const isFocused = idx === focusedIndex;
                const isLaunching = launchingId === tile.id;
                const isMaint = tile.status === 'MAINTENANCE';
                const offset = idx - focusedIndex;
                const cfRot = viewMode === 'coverflow' ? (offset < 0 ? '4deg' : offset > 0 ? '-4deg' : '0deg') : '0deg';

                return (
                  <button
                    key={tile.id}
                    ref={(el) => {
                      tileRefs.current[idx] = el;
                    }}
                    type="button"
                    data-tile-id={tile.id}
                    onMouseEnter={() => setFocusedIndex(idx)}
                    onFocus={() => setFocusedIndex(idx)}
                    onMouseMove={handleCardPointerMove}
                    onMouseLeave={handleCardPointerLeave}
                    onClick={(e) => void handleActivateTile(tile, e)}
                    disabled={isLaunching}
                    style={{ '--cf-rot': cfRot } as React.CSSProperties}
                    className={`mainapp-card snap-center flex flex-col items-center justify-between text-center p-5 sm:p-6 focus:outline-none ${
                      viewMode === 'coverflow'
                        ? 'w-[200px] h-[215px] sm:w-[228px] sm:h-[242px] shrink-0'
                        : 'aspect-square w-full'
                    } ${isFocused ? 'is-focused' : viewMode === 'coverflow' ? 'is-receded' : ''} ${
                      isMaint ? 'opacity-70' : ''
                    }`}
                  >
                    {/* Click Ripple */}
                    {ripple && ripple.tileId === tile.id && (
                      <span
                        key={ripple.key}
                        className="mainapp-click-ripple"
                        style={{ left: ripple.x, top: ripple.y }}
                      />
                    )}

                    {/* Top Right Status / Pending Pill */}
                    <div className="w-full flex items-center justify-end min-h-[20px]">
                      {tile.kind === 'admin' && tile.pendingCount > 0 ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white shadow">
                          รออนุมัติ {tile.pendingCount}
                        </span>
                      ) : isMaint ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-slate-950">
                          ปิดปรับปรุง
                        </span>
                      ) : null}
                    </div>

                    {/* Center 3D Glowing Emblem / Uploaded App Icon */}
                    <div
                      className="w-20 h-20 sm:w-24 sm:h-24 rounded-[22px] flex items-center justify-center shadow-[0_14px_30px_rgba(0,0,0,0.45)] border border-white/30 overflow-hidden shrink-0"
                      style={{
                        background: tile.iconUrl
                          ? 'rgba(255,255,255,0.12)'
                          : `linear-gradient(145deg, ${tile.accent}, #022C1D)`,
                      }}
                    >
                      {isLaunching ? (
                        <i className="fa-solid fa-spinner fa-spin text-3xl text-emerald-200" />
                      ) : tile.iconUrl ? (
                        <DriveImage
                          src={tile.iconUrl}
                          alt={tile.name}
                          category="image"
                          className="w-full h-full object-cover"
                          fallback={<i className={`fa-solid ${tile.icon} text-4xl text-white drop-shadow`} />}
                        />
                      ) : (
                        <i className={`fa-solid ${tile.icon} text-4xl sm:text-[42px] text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]`} />
                      )}
                    </div>

                    {/* Bottom Centered Bold Thai App Name */}
                    <div className="w-full pt-2 space-y-0.5">
                      <h2 className="font-extrabold text-sm sm:text-[15px] text-white leading-snug line-clamp-2 drop-shadow-sm">
                        {tile.name}
                      </h2>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Active Caption Strip below cards */}
            {activeTile && (
              <div className="max-w-2xl mx-auto px-5 py-3.5 rounded-2xl bg-black/25 backdrop-blur-md border border-emerald-300/20 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <span className="font-black text-sm text-white truncate">{activeTile.name}</span>
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold text-white"
                      style={{ backgroundColor: activeTile.roleColor }}
                    >
                      {activeTile.roleLabel}
                    </span>
                    {activeTile.kind === 'webapp' && activeTile.expiresAt && (
                      <span className="text-[10px] font-bold text-amber-200">
                        <i className="fa-regular fa-clock mr-1" />
                        ถึง {formatThaiDate(activeTile.expiresAt, 'short')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-emerald-100/80 line-clamp-1">{activeTile.description}</p>
                </div>

                <button
                  type="button"
                  disabled={launchingId === activeTile.id || activeTile.status === 'MAINTENANCE'}
                  onClick={() => void handleActivateTile(activeTile)}
                  className="px-5 py-2 rounded-full bg-[#F6DE51] hover:bg-amber-300 text-slate-950 font-black text-xs shadow-lg transition inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  {activeTile.kind === 'admin' ? (
                    <>
                      <i className="fa-solid fa-gauge-high" />
                      <span>เข้าสู่ระบบผู้ดูแล</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-play" />
                      <span>เปิดใช้งาน</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom Floating Glass Pill Dock (Reference Image 3) */}
      <nav
        aria-label="แถบควบคุม MainApp"
        className="fixed bottom-4 inset-x-0 z-30 flex justify-center px-3 pointer-events-none"
      >
        <div className="mainapp-bottom-dock pointer-events-auto rounded-full px-3 sm:px-5 py-2 flex items-center gap-2 sm:gap-3.5 max-w-full overflow-x-auto">
          {/* Left: TV Navigation Controls (Prev / Home / Next) */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => stepFocus(-1)}
              title="ก่อนหน้า (←)"
              aria-label="แอปก่อนหน้า"
              className="w-8 h-8 rounded-full hover:bg-white/15 text-emerald-100 flex items-center justify-center transition"
            >
              <i className="fa-solid fa-caret-left text-base" />
            </button>
            <button
              type="button"
              onClick={() => {
                setFocusedIndex(0);
                scrollTileIntoCenter(0);
              }}
              title="กลับการ์ดแรก (Home)"
              aria-label="กลับการ์ดแรก"
              className="w-8 h-8 rounded-full hover:bg-white/15 text-emerald-200 flex items-center justify-center transition"
            >
              <i className="fa-solid fa-circle text-[9px]" />
            </button>
            <button
              type="button"
              onClick={() => stepFocus(1)}
              title="ถัดไป (→)"
              aria-label="แอปถัดไป"
              className="w-8 h-8 rounded-full hover:bg-white/15 text-emerald-100 flex items-center justify-center transition"
            >
              <i className="fa-solid fa-caret-right text-base" />
            </button>
          </div>

          {/* Center: Glowing Pill Search Box */}
          <div className="mainapp-dock-search rounded-full px-3.5 py-1.5 flex items-center gap-2 w-40 sm:w-56 md:w-64 shrink-0">
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหา (Search)..."
              className="bg-transparent text-xs text-white placeholder:text-emerald-200/70 focus:outline-none w-full"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="ล้างคำค้นหา"
                className="text-emerald-200 hover:text-white"
              >
                <i className="fa-solid fa-xmark text-xs" />
              </button>
            ) : (
              <i className="fa-solid fa-magnifying-glass text-xs text-emerald-300" />
            )}
          </div>

          {/* Mode Toggle + Profile/KP7 Shortcut */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode((m) => (m === 'coverflow' ? 'grid' : 'coverflow'))}
              title={viewMode === 'coverflow' ? 'สลับเป็นมุมมองตาราง (Grid)' : 'สลับเป็นมุมมอง Cover-Flow'}
              aria-label="สลับมุมมองแอป"
              className={`w-9 h-9 rounded-xl border flex items-center justify-center transition ${
                viewMode === 'grid'
                  ? 'bg-emerald-500/35 border-emerald-300/70 text-white'
                  : 'bg-white/10 border-white/15 text-emerald-100 hover:bg-white/20'
              }`}
            >
              <i className={`fa-solid ${viewMode === 'coverflow' ? 'fa-table-cells-large' : 'fa-film'} text-xs`} />
            </button>

            <button
              type="button"
              onClick={() => setMyProfileOpen(true)}
              title="โปรไฟล์ของฉัน & พิมพ์ ก.พ. ๗"
              aria-label="โปรไฟล์ของฉันและพิมพ์ ก.พ. ๗"
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-[#F6DE51] flex items-center justify-center transition"
            >
              <i className="fa-solid fa-id-card text-xs" />
            </button>
          </div>

          {/* Right: Dock Clock + Theme + Announcements + Admin Bell + Branded Logout */}
          <div className="flex items-center gap-1.5 pl-1 border-l border-emerald-300/20 shrink-0">
            {timeStr && (
              <span className="hidden md:inline font-mono font-bold text-xs text-emerald-100 px-1.5">
                {timeStr}
              </span>
            )}

            <button
              type="button"
              onClick={toggleTheme}
              title={isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดถนอมสายตา'}
              aria-label="สลับธีมสี"
              className="w-8 h-8 rounded-full hover:bg-white/15 text-amber-200 flex items-center justify-center transition"
            >
              <i className={`fa-solid ${isDark ? 'fa-sun' : 'fa-moon'} text-xs`} />
            </button>

            <button
              type="button"
              onClick={openUpdateModal}
              title="ประกาศระบบและบันทึกอัปเดต"
              aria-label="ประกาศระบบ"
              className="w-8 h-8 rounded-full hover:bg-white/15 text-emerald-200 flex items-center justify-center transition relative"
            >
              <i className="fa-solid fa-bullhorn text-xs" />
              {settings.announcement_enabled && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400" />
              )}
            </button>

            {isAdminOrAbove && (
              <button
                type="button"
                onClick={() => navigate('/admin/reset-requests')}
                title="คำขอรีเซ็ตรหัสเข้าใช้รออนุมัติ"
                aria-label="แจ้งเตือนคำขอรีเซ็ตรหัส"
                className="w-8 h-8 rounded-full hover:bg-white/15 text-amber-300 flex items-center justify-center transition relative"
              >
                <i className="fa-solid fa-bell text-xs" />
                {pendingResetCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                    {pendingResetCount > 9 ? '9+' : pendingResetCount}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleLogout()}
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
              className="w-8 h-8 rounded-full bg-rose-500/20 hover:bg-rose-500/40 border border-rose-300/35 text-rose-200 flex items-center justify-center transition"
            >
              <i className="fa-solid fa-right-from-bracket text-xs" />
            </button>
          </div>
        </div>
      </nav>

      {/* Modals preserved outside AdminShell */}
      <MyProfileModal open={myProfileOpen} onClose={() => setMyProfileOpen(false)} />
      <SystemUpdateModal
        open={showUpdateModal}
        onClose={dismissModal}
        settings={settings}
        versionInfo={versionInfo}
      />
    </div>
  );
}

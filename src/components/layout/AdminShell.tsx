import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  Suspense,
} from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/contexts/ThemeContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import { useSystemUpdateCheck } from '@/hooks/useSystemUpdateCheck';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUiStore } from '@/stores/useUiStore';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { confirmAction } from '@/lib/swalHelpers';
import { formatThaiDateTime, getCurrentYearBeBangkok } from '@/lib/thaiDate';
import { cleanDisplaySegment } from '@/lib/positionFormatter';
import { QUERY_KEYS } from '@/lib/queryClient';
import { AdminMainSkeleton } from './AdminMainSkeleton';
import { SystemUpdateModal, sanitizeImageUrl } from './SystemUpdateModal';
import { DriveImage } from '@/components/common/DriveImage';
import { RoleBadge } from '@/components/common/RoleBadge';
import { MyProfileModal } from '@/components/profile/MyProfileModal';

export interface ShellHeaderMeta {
  path: string;
  title: string;
  subtitle?: string;
  activePage?: string;
}

export interface AdminShellContextValue {
  setHeaderMeta: (meta: ShellHeaderMeta) => void;
}

export const AdminLayoutContext = createContext<AdminShellContextValue | null>(null);

interface NavItemDef {
  id: string;
  to: string;
  label: string;
  shortLabel: string;
  icon: string;
  iconBg: string;
  group: string;
  badge?: number;
  show: boolean;
  keywords: string;
}

export const ROUTE_META_MAP: Record<string, { activePage: string; title: string; subtitle: string }> = {
  '/dashboard': { activePage: 'dashboard', title: 'แดชบอร์ดภาพรวมระบบ', subtitle: 'สถิติบุคลากร บัญชีผู้ใช้ และความเคลื่อนไหวในขอบเขตสังกัด' },
  '/apps': { activePage: 'apps', title: 'แอปของฉัน (SSO Launcher)', subtitle: 'เข้าใช้งานระบบเว็บแอปย่อยที่ได้รับอนุญาตด้วยการยืนยันตัวตนครั้งเดียว' },
  '/admin/personnel': { activePage: 'personnel', title: 'ข้อมูลบุคลากร', subtitle: 'ทะเบียนประวัติบุคลากรกลาง (กรองอัตโนมัติตามขอบเขตสังกัด) พร้อมนำเข้า/ส่งออก Excel' },
  '/admin/personnel/import': { activePage: 'personnel', title: 'นำเข้าบุคลากร (CSV / Excel)', subtitle: 'ตารางพักข้อมูลเสมือน Google Sheets ตรวจสายแม่-ลูกพร้อมไฮไลท์สีแดงทันที' },
  '/admin/users': { activePage: 'users', title: 'บัญชีผู้ใช้งาน', subtitle: 'จัดการบัญชี 3 สิทธิ์หลัก สร้างบัญชีอัตโนมัติ และกำหนดขอบเขตสำนักงาน/กอง หรือส่วน/ฝ่าย' },
  '/admin/reset-requests': { activePage: 'reset-requests', title: 'คำขอรีเซ็ตรหัสเข้าใช้', subtitle: 'พิจารณาอนุมัติคำขอรีเซ็ตรหัสเริ่มต้น (CID 6 หลักท้าย) ในขอบเขตสังกัด' },
  '/admin/app-access': { activePage: 'app-access', title: 'กำหนดสิทธิ์เข้าถึงเว็บแอปย่อย', subtitle: 'เปิด-ปิดสิทธิ์และเลือกระดับสิทธิ์เฉพาะของแต่ละเว็บแอปย่อย' },
  '/admin/webapps': { activePage: 'webapps', title: 'จัดการระบบเว็บแอปย่อย', subtitle: 'ลงทะเบียนเว็บแอปย่อย นิยามระดับสิทธิ์รายแอป ตั้งค่า API Key และ Allowed Origins' },
  '/settings/api-catalog': { activePage: 'settings-api-catalog', title: 'แค็ตตาล็อก API & คู่มือการเชื่อมต่อ', subtitle: 'จัดการ API Scopes และแนวทางการเชื่อมต่อเว็บแอปย่อย' },
  '/settings/system': { activePage: 'settings-system', title: 'พารามิเตอร์ตั้งค่าระบบ & โครงสร้างหลัก', subtitle: 'ตั้งค่าหน่วยงาน, Google Drive, ตัวเลือก Dropdown, หน่วยงาน 4 ระดับ, ตำแหน่ง และประกาศระบบ' },
  '/settings/schema': { activePage: 'settings-schema', title: 'ตรวจสอบสุขภาพฐานข้อมูลและพื้นที่จัดเก็บ', subtitle: 'ตรวจสอบตาราง 3NF ใน Schema public, สถานะ portal-api และพื้นที่จัดเก็บ Google Drive 4 โฟลเดอร์' },
  '/settings/audit': { activePage: 'settings-audit', title: 'ประวัติการใช้งาน (Audit Log)', subtitle: 'บันทึกการเปลี่ยนแปลงข้อมูล การนำเข้า และการอนุญาตสิทธิ์ในขอบเขตสังกัด' },
  '/profile': { activePage: 'profile', title: 'โปรไฟล์ของฉัน', subtitle: 'จัดการข้อมูลส่วนตัว รหัสเข้าใช้ รูปโปรไฟล์ และลายเซ็นพื้นใส' },
};

export function AdminShell({ children }: { children?: React.ReactNode }) {
  const { user, isSuperAdmin, isAdminOrAbove, scopeLabel } = useScopedPermissions();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const showToast = useUiStore((s) => s.showToast);
  const { settings } = useSettings();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [myProfileOpen, setMyProfileOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement | null>(null);
  const quickRef = useRef<HTMLDivElement | null>(null);
  const avatarRef = useRef<HTMLDivElement | null>(null);

  const [headerOverride, setHeaderOverride] = useState<ShellHeaderMeta>({
    path: '',
    title: '',
    subtitle: '',
    activePage: '',
  });

  const { versionInfo, showUpdateModal, openUpdateModal, dismissModal } = useSystemUpdateCheck(settings);

  const { data: pendingResetRows = [] } = useQuery({
    queryKey: QUERY_KEYS.resetRequests('PENDING'),
    enabled: Boolean(user && isAdminOrAbove && isSupabaseConfigured),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credential_reset_requests')
        .select('id, reason, created_at, user_id')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) return [];
      return data ?? [];
    },
  });

  const routeDefault = ROUTE_META_MAP[location.pathname] || {
    activePage: 'apps',
    title: 'Portal SSO',
    subtitle: '',
  };

  const isOverrideMatch = headerOverride.path === location.pathname;
  const title = isOverrideMatch && headerOverride.title ? headerOverride.title : routeDefault.title;
  const subtitle = isOverrideMatch && headerOverride.subtitle !== undefined ? headerOverride.subtitle : routeDefault.subtitle;
  const activePage = isOverrideMatch && headerOverride.activePage ? headerOverride.activePage : routeDefault.activePage;

  useEffect(() => {
    document.title = `${title} — ${settings.bureau_name || 'Portal SSO'}`;
  }, [title, settings.bureau_name]);

  useEffect(() => {
    setAvatarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (bellOpen && bellRef.current && !bellRef.current.contains(target)) setBellOpen(false);
      if (quickOpen && quickRef.current && !quickRef.current.contains(target)) setQuickOpen(false);
      if (avatarOpen && avatarRef.current && !avatarRef.current.contains(target)) setAvatarOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAvatarOpen(false);
        setBellOpen(false);
        setQuickOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [bellOpen, quickOpen, avatarOpen]);

  const setHeaderMeta = useCallback((meta: ShellHeaderMeta) => {
    setHeaderOverride((prev) =>
      prev.path === meta.path && prev.title === meta.title && prev.subtitle === meta.subtitle && prev.activePage === meta.activePage
        ? prev
        : meta
    );
  }, []);

  const shellContextValue = useMemo(() => ({ setHeaderMeta }), [setHeaderMeta]);

  const pendingResetCount = pendingResetRows.length;

  const navItems = useMemo<NavItemDef[]>(
    () =>
      [
        // กลุ่ม 1: หลัก
        { id: 'dashboard', group: 'หลัก', to: '/dashboard', label: 'แดชบอร์ด', shortLabel: 'แดชบอร์ด', icon: 'fa-chart-line', iconBg: 'bg-emerald-500/15 text-emerald-400', show: isAdminOrAbove, keywords: 'dashboard ภาพรวม สรุป' },
        { id: 'apps', group: 'หลัก', to: '/apps', label: 'แอปของฉัน', shortLabel: 'แอปของฉัน', icon: 'fa-grip', iconBg: 'bg-teal-500/15 text-teal-400', show: true, keywords: 'apps launcher sso เว็บแอป' },
        // กลุ่ม 2: บุคลากรและบัญชี (นำเข้าบุคลากรอยู่เป็นปุ่มภายในหน้าข้อมูลบุคลากร)
        { id: 'personnel', group: 'บุคลากรและบัญชี', to: '/admin/personnel', label: 'ข้อมูลบุคลากร', shortLabel: 'บุคลากร', icon: 'fa-id-card', iconBg: 'bg-emerald-500/15 text-emerald-300', show: isAdminOrAbove, keywords: 'personnel บุคลากร ข้าราชการ นำเข้า csv excel' },
        { id: 'users', group: 'บุคลากรและบัญชี', to: '/admin/users', label: 'บัญชีผู้ใช้งาน', shortLabel: 'บัญชีผู้ใช้', icon: 'fa-users-gear', iconBg: 'bg-purple-500/15 text-purple-400', show: isAdminOrAbove, keywords: 'users บัญชีผู้ใช้ admin scope rbac' },
        { id: 'reset-requests', group: 'บุคลากรและบัญชี', to: '/admin/reset-requests', label: 'คำขอรีเซ็ตรหัสเข้าใช้', shortLabel: 'รีเซ็ตรหัส', icon: 'fa-key', iconBg: 'bg-amber-500/15 text-amber-400', badge: pendingResetCount, show: isAdminOrAbove, keywords: 'reset password ลืมรหัส รีเซ็ต' },
        // กลุ่ม 3: ระบบเว็บแอปย่อย
        { id: 'app-access', group: 'ระบบเว็บแอปย่อย', to: '/admin/app-access', label: 'กำหนดสิทธิ์เข้าถึงเว็บแอปย่อย', shortLabel: 'สิทธิ์แอป', icon: 'fa-shield-halved', iconBg: 'bg-sky-500/15 text-sky-400', show: isAdminOrAbove, keywords: 'app access permission อนุญาตแอป' },
        { id: 'webapps', group: 'ระบบเว็บแอปย่อย', to: '/admin/webapps', label: 'จัดการระบบเว็บแอปย่อย', shortLabel: 'เว็บแอปย่อย', icon: 'fa-window-restore', iconBg: 'bg-indigo-500/15 text-indigo-400', show: isSuperAdmin, keywords: 'webapps เพิ่มแอป roles api key' },
        // กลุ่ม 4: ตั้งค่าระบบเทคนิค (รวมตั้งค่าตัวเลือก & โครงสร้างเป็น 6 แท็บย่อยในหน้าตั้งค่าระบบ)
        { id: 'settings-system', group: 'ตั้งค่าระบบเทคนิค', to: '/settings/system', label: 'พารามิเตอร์ตั้งค่าระบบ', shortLabel: 'ตั้งค่าระบบ', icon: 'fa-gears', iconBg: 'bg-rose-500/15 text-rose-400', show: isSuperAdmin, keywords: 'system settings google drive gas ประกาศ dropdown lookups org units หน่วยงาน positions ตำแหน่ง' },
        { id: 'settings-api-catalog', group: 'ตั้งค่าระบบเทคนิค', to: '/settings/api-catalog', label: 'แค็ตตาล็อก API & คู่มือเชื่อมต่อ', shortLabel: 'API Scopes', icon: 'fa-plug', iconBg: 'bg-violet-500/15 text-violet-400', show: isSuperAdmin, keywords: 'api scope guide แค็ตตาล็อก คู่มือ' },
        { id: 'settings-schema', group: 'ตั้งค่าระบบเทคนิค', to: '/settings/schema', label: 'ตรวจสอบสุขภาพฐานข้อมูล', shortLabel: 'สุขภาพ DB', icon: 'fa-database', iconBg: 'bg-blue-500/15 text-blue-400', show: isSuperAdmin, keywords: 'schema health repair ฐานข้อมูล' },
        { id: 'settings-audit', group: 'ตั้งค่าระบบเทคนิค', to: '/settings/audit', label: 'ประวัติการใช้งาน (Audit Log)', shortLabel: 'Audit Log', icon: 'fa-clock-rotate-left', iconBg: 'bg-slate-500/20 text-slate-300', show: isAdminOrAbove, keywords: 'audit log import history ประวัติ' },
      ].filter((item) => item.show),
    [isSuperAdmin, isAdminOrAbove, pendingResetCount]
  );

  const groupedNav = useMemo(() => {
    const groups: Array<{ group: string; items: NavItemDef[] }> = [];
    for (const item of navItems) {
      let bucket = groups.find((g) => g.group === item.group);
      if (!bucket) {
        bucket = { group: item.group, items: [] };
        groups.push(bucket);
      }
      bucket.items.push(item);
    }
    return groups;
  }, [navItems]);

  const quickNavResults = useMemo(() => {
    const shortcuts: NavItemDef[] = [
      ...navItems,
      {
        id: 'quick-profile',
        group: 'ทางลัด',
        to: '/profile',
        label: 'โปรไฟล์ของฉัน',
        shortLabel: 'โปรไฟล์',
        icon: 'fa-circle-user',
        iconBg: 'bg-emerald-500/15 text-emerald-400',
        show: true,
        keywords: 'profile โปรไฟล์ ลายเซ็น เปลี่ยนรหัส รูปโปรไฟล์ บัญชีของฉัน',
      },
      ...(isAdminOrAbove
        ? [
            {
              id: 'quick-import',
              group: 'ทางลัด',
              to: '/admin/personnel/import',
              label: 'นำเข้าบุคลากร (CSV / Excel)',
              shortLabel: 'นำเข้าชีต',
              icon: 'fa-file-excel',
              iconBg: 'bg-green-500/15 text-green-400',
              show: true,
              keywords: 'import csv excel นำเข้า บุคลากร',
            },
          ]
        : []),
      ...(isSuperAdmin
        ? [
            { id: 'quick-lookups', group: 'ทางลัด', to: '/settings/system?tab=lookups', label: 'ตั้งค่า: ตัวเลือก Dropdown', shortLabel: 'Dropdown', icon: 'fa-list-check', iconBg: 'bg-cyan-500/15 text-cyan-400', show: true, keywords: 'lookups dropdown ตัวเลือก flags' },
            { id: 'quick-org', group: 'ทางลัด', to: '/settings/system?tab=org-units', label: 'ตั้งค่า: โครงสร้างหน่วยงาน 4 ระดับ', shortLabel: 'หน่วยงาน', icon: 'fa-sitemap', iconBg: 'bg-emerald-500/15 text-emerald-400', show: true, keywords: 'org units สำนัก กอง ฝ่าย กลุ่มงาน' },
            { id: 'quick-pos', group: 'ทางลัด', to: '/settings/system?tab=positions', label: 'ตั้งค่า: ตำแหน่งและสายงาน', shortLabel: 'ตำแหน่ง', icon: 'fa-briefcase', iconBg: 'bg-teal-500/15 text-teal-400', show: true, keywords: 'positions สายงาน ตำแหน่ง ระดับ' },
            { id: 'quick-gdrive', group: 'ทางลัด', to: '/settings/system?tab=gdrive', label: 'ตั้งค่า: Google Drive', shortLabel: 'Drive', icon: 'fa-cloud-arrow-up', iconBg: 'bg-emerald-500/15 text-emerald-400', show: true, keywords: 'google drive gas ลิงก์โฟลเดอร์' },
            { id: 'quick-announce', group: 'ทางลัด', to: '/settings/system?tab=announcement', label: 'ตั้งค่า: ประกาศระบบ', shortLabel: 'ประกาศ', icon: 'fa-bullhorn', iconBg: 'bg-amber-500/15 text-amber-400', show: true, keywords: 'announcement ประกาศ' },
          ]
        : []),
    ];
    const q = quickQuery.trim().toLowerCase();
    if (!q) return navItems;
    return shortcuts.filter((t) => `${t.label} ${t.keywords}`.toLowerCase().includes(q));
  }, [navItems, quickQuery, isAdminOrAbove, isSuperAdmin]);

  const handleLogout = async () => {
    const ok = await confirmAction('ออกจากระบบ', 'คุณต้องการออกจากระบบ Portal SSO ใช่หรือไม่?', 'ออกจากระบบ', 'warning');
    if (!ok) return;
    await supabase.auth.signOut().catch(() => {});
    clearAuth();
    showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    navigate('/login', { replace: true });
  };

  const yearBuddhist = getCurrentYearBeBangkok();
  const logoUrl = sanitizeImageUrl(settings.logo_url);
  const initials = (user?.full_name || user?.username || 'U').trim().slice(0, 2);

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-[#111827] dark:bg-[#0B132B] text-slate-100 border-r border-slate-800/80">
      <div className="px-4 py-4 border-b border-slate-800 flex items-center gap-3">
        {logoUrl ? (
          <DriveImage
            src={logoUrl}
            alt="Logo"
            category="logo"
            className="w-10 h-10 rounded-xl object-contain bg-white/10 p-1 border border-white/15 shrink-0"
            fallback={
              <div className="w-10 h-10 rounded-xl bg-emerald-600/25 border border-emerald-400/30 flex items-center justify-center shrink-0">
                <i className="fa-solid fa-shield-halved text-emerald-300 text-lg" />
              </div>
            }
          />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-emerald-600/25 border border-emerald-400/30 flex items-center justify-center shrink-0">
            <i className="fa-solid fa-shield-halved text-emerald-300 text-lg" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-emerald-400 truncate">{settings.organization_name}</p>
          <p className="font-extrabold text-sm text-white truncate">{settings.bureau_name}</p>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="ปิดเมนู"
          className="lg:hidden w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>

      {/* Capsule Profile Card (คลิกเปิดหน้าต่างโปรไฟล์ของฉันได้ทันที) */}
      <div className="px-3.5 py-3 border-b border-slate-800/80">
        <button
          type="button"
          onClick={() => {
            setMobileMenuOpen(false);
            setMyProfileOpen(true);
          }}
          className="w-full text-left p-2.5 rounded-2xl bg-slate-800/70 hover:bg-slate-800 border border-slate-700/70 hover:border-emerald-500/40 flex items-center gap-3 transition"
          title="เปิดโปรไฟล์ของฉัน"
        >
          {sanitizeImageUrl(user?.photo_path) ? (
            <DriveImage
              src={sanitizeImageUrl(user?.photo_path)}
              alt={user?.full_name || ''}
              category="image"
              className="w-10 h-10 rounded-full object-cover border border-white/20 shrink-0"
              fallback={
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-white font-extrabold text-xs flex items-center justify-center shrink-0 shadow-md border border-white/20">
                  {initials}
                </div>
              }
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-white font-extrabold text-xs flex items-center justify-center shrink-0 shadow-md border border-white/20">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-bold text-xs text-white truncate">{user?.full_name || user?.username || 'ผู้ใช้งาน'}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  isSuperAdmin
                    ? 'bg-rose-400/20 text-rose-300 border border-rose-400/30'
                    : isAdminOrAbove
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                      : 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30'
                }`}
              >
                {user?.role || 'USER'}
              </span>
              <span className="text-[10px] text-slate-400 truncate" title={scopeLabel}>
                {scopeLabel}
              </span>
            </div>
          </div>
        </button>
      </div>

      {/* 6-Group Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-3">
        {groupedNav.map((grp) => (
          <div key={grp.group} className="space-y-1">
            <p className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {grp.group}
            </p>
            {grp.items.map((item) => (
              <NavLink
                key={item.id}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition ${
                    isActive || activePage === item.id
                      ? 'bg-gradient-to-r from-[#00744B] to-[#00A368] text-white shadow-md shadow-emerald-950/60'
                      : 'text-slate-300 hover:bg-white/6 hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0 ${
                        isActive || activePage === item.id ? 'bg-white/20 text-white' : item.iconBg
                      }`}
                    >
                      <i className={`fa-solid ${item.icon}`} />
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {(item.badge ?? 0) > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center">
                        {(item.badge ?? 0) > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Sidebar Footer */}
      <div className="p-3 border-t border-slate-800">
        <button
          type="button"
          onClick={openUpdateModal}
          className="w-full px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-slate-300 flex items-center justify-between transition"
        >
          <span>
            <i className="fa-solid fa-code-branch text-emerald-400 mr-1.5" />
            {versionInfo.appVersion}
          </span>
          <span className="font-mono opacity-75">{versionInfo.buildId ? versionInfo.buildId.slice(-8) : 'SSO'}</span>
        </button>
      </div>
    </div>
  );

  const mobileBottomItems = navItems.slice(0, 5);

  return (
    <div className="min-h-screen flex bg-[#E7ECE9] dark:bg-[#0B132B] text-slate-800 dark:text-slate-100">
      <aside className="hidden lg:block w-72 shrink-0 sticky top-0 h-screen shadow-xl z-30">
        {renderSidebarContent()}
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[9980] lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-72 max-w-[85vw] h-full shadow-2xl z-10">{renderSidebarContent()}</div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col min-h-screen pb-16 lg:pb-0">
        <header className="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="เปิดเมนู"
            >
              <i className="fa-solid fa-bars-staggered" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <button
                  type="button"
                  onClick={() => navigate(isAdminOrAbove ? '/dashboard' : '/apps')}
                  className="hover:text-emerald-600 transition"
                  title="หน้าหลัก"
                >
                  <i className="fa-solid fa-house" />
                </button>
                <span>/</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-bold truncate">{title}</span>
              </div>
              <h1 className="text-base sm:text-lg font-extrabold text-slate-800 dark:text-white truncate leading-tight">
                {title}
              </h1>
              {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:block">{subtitle}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Quick Nav Search */}
            <div className="relative hidden md:block" ref={quickRef}>
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
              <input
                type="text"
                value={quickQuery}
                onFocus={() => setQuickOpen(true)}
                onChange={(e) => {
                  setQuickQuery(e.target.value);
                  setQuickOpen(true);
                }}
                placeholder="ค้นหาเมนู / ไปยังหน้า..."
                className="w-52 lg:w-60 pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600 outline-none"
              />
              {quickOpen && (
                <div className="absolute right-0 mt-1.5 w-64 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden z-50">
                  <div className="px-3 py-2 text-[10px] font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    ทางลัดไปยังหน้าต่างๆ
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1.5 space-y-0.5">
                    {quickNavResults.length === 0 ? (
                      <p className="text-center text-xs text-slate-400 py-3">ไม่พบเมนูที่ค้นหา</p>
                    ) : (
                      quickNavResults.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setQuickOpen(false);
                            setQuickQuery('');
                            if (item.id === 'quick-profile') {
                              setMyProfileOpen(true);
                            } else if (location.pathname !== item.to) {
                              navigate(item.to);
                            }
                          }}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-emerald-50 dark:hover:bg-slate-800 flex items-center gap-2.5 text-xs font-semibold transition"
                        >
                          <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] ${item.iconBg}`}>
                            <i className={`fa-solid ${item.icon}`} />
                          </span>
                          <span className="truncate">{item.label}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Notification Bell (Reset Requests in Scope) */}
            {isAdminOrAbove && (
              <div className="relative" ref={bellRef}>
                <button
                  type="button"
                  onClick={() => setBellOpen((v) => !v)}
                  className="relative w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-200 transition"
                  aria-label="แจ้งเตือนคำขอรีเซ็ตรหัสเข้าใช้"
                >
                  <i className="fa-solid fa-bell" />
                  {pendingResetCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shadow-xs">
                      {pendingResetCount > 99 ? '99+' : pendingResetCount}
                    </span>
                  )}
                </button>

                {bellOpen && (
                  <div className="absolute right-0 mt-2 w-80 max-w-[92vw] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-800 dark:text-white">
                        <i className="fa-solid fa-key text-amber-500 mr-1.5" />
                        คำขอรีเซ็ตรหัสเข้าใช้
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
                        {pendingResetCount} รายการ
                      </span>
                    </div>
                    <div className="p-3 space-y-2 max-h-[60dvh] overflow-y-auto">
                      {pendingResetCount === 0 ? (
                        <p className="text-center text-xs text-slate-400 py-5">ไม่มีคำขอรออนุมัติในขอบเขตสังกัด</p>
                      ) : (
                        <>
                          {pendingResetRows.slice(0, 4).map((r: { id: string; reason: string | null; created_at: string }) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                setBellOpen(false);
                                navigate('/admin/reset-requests');
                              }}
                              className="w-full text-left p-2.5 rounded-xl border border-amber-200/70 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/30 hover:bg-amber-50 transition text-xs"
                            >
                              <p className="font-bold text-slate-800 dark:text-slate-100 truncate">
                                คำขอรีเซ็ตรหัสเริ่มต้น
                              </p>
                              <p className="text-[11px] text-slate-500 truncate mt-0.5">{r.reason || 'ผู้ใช้ขอรีเซ็ตรหัสผ่าน'}</p>
                              <p className="text-[10px] font-mono text-amber-700 dark:text-amber-300 mt-1">
                                <i className="fa-regular fa-clock mr-1" />
                                {formatThaiDateTime(r.created_at)}
                              </p>
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setBellOpen(false);
                              navigate('/admin/reset-requests');
                            }}
                            className="w-full py-2 rounded-xl text-xs font-bold text-[#00744B] dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 transition"
                          >
                            ดูคำขอทั้งหมด →
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Theme Toggle Pill */}
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-amber-300 transition"
            >
              <i className={`fa-solid ${isDark ? 'fa-sun' : 'fa-moon'}`} />
              <span className="hidden sm:inline">{isDark ? 'โหมดสว่าง' : 'โหมดถนอมสายตา'}</span>
            </button>

            {/* Topbar Avatar Dropdown Menu */}
            <div className="relative" ref={avatarRef}>
              <button
                type="button"
                onClick={() => setAvatarOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={avatarOpen}
                aria-label="เมนูบัญชีผู้ใช้"
                className="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                {sanitizeImageUrl(user?.photo_path) ? (
                  <DriveImage
                    src={sanitizeImageUrl(user?.photo_path)}
                    alt={user?.full_name || ''}
                    category="image"
                    className="w-7 h-7 rounded-full object-cover border border-emerald-500/40 shrink-0"
                    fallback={
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white font-extrabold text-[11px] flex items-center justify-center shrink-0">
                        {initials}
                      </div>
                    }
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white font-extrabold text-[11px] flex items-center justify-center shrink-0">
                    {initials}
                  </div>
                )}
                <span className="hidden xl:block max-w-[140px] truncate text-xs font-bold text-slate-700 dark:text-slate-100">
                  {user?.full_name || user?.username || 'ผู้ใช้งาน'}
                </span>
                <i
                  className={`fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform ${
                    avatarOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {avatarOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-64 max-w-[90vw] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden z-50"
                >
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
                    {sanitizeImageUrl(user?.photo_path) ? (
                      <DriveImage
                        src={sanitizeImageUrl(user?.photo_path)}
                        alt={user?.full_name || ''}
                        category="image"
                        className="w-10 h-10 rounded-full object-cover border border-emerald-500/40 shrink-0"
                        fallback={
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white font-extrabold text-xs flex items-center justify-center shrink-0">
                            {initials}
                          </div>
                        }
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white font-extrabold text-xs flex items-center justify-center shrink-0">
                        {initials}
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="font-bold text-xs text-slate-800 dark:text-white truncate">
                        {user?.full_name || user?.username || 'ผู้ใช้งาน'}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {cleanDisplaySegment(user?.position_display) || scopeLabel}
                      </p>
                      <div className="pt-0.5">
                        <RoleBadge role={user?.role} />
                      </div>
                    </div>
                  </div>

                  <div className="p-1.5 space-y-0.5">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAvatarOpen(false);
                        setMyProfileOpen(true);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-emerald-50 dark:hover:bg-slate-800 flex items-center gap-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 transition"
                    >
                      <i className="fa-solid fa-circle-user text-[#00744B] dark:text-emerald-400 w-4 text-center" />
                      <span>โปรไฟล์ของฉัน</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAvatarOpen(false);
                        void handleLogout();
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2.5 text-xs font-bold text-rose-600 dark:text-rose-400 transition"
                    >
                      <i className="fa-solid fa-right-from-bracket w-4 text-center" />
                      <span>ออกจากระบบ</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <AdminLayoutContext.Provider value={shellContextValue}>
          <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto">
            <Suspense fallback={<AdminMainSkeleton />}>{children || <Outlet />}</Suspense>
          </main>
        </AdminLayoutContext.Provider>

        <footer className="bma-footer-bar text-center px-4 py-3 text-xs border-t border-slate-200/70 dark:border-slate-800 mt-auto">
          <p className="font-semibold text-slate-600 dark:text-slate-300">
            <span className="text-[#00744B] dark:text-[#00C08A] font-bold">{settings.bureau_name}</span>{' '}
            {settings.organization_name} © พ.ศ. {yearBuddhist}
          </p>
          {settings.footer_description && <p className="text-[11px] text-slate-400 mt-0.5">{settings.footer_description}</p>}
        </footer>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-1 py-1.5 flex items-center justify-around shadow-2xl">
        {mobileBottomItems.map((item) => (
          <NavLink
            key={item.id}
            to={item.to}
            onClick={() => setMobileMenuOpen(false)}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center px-1 py-1 text-[10px] font-bold transition min-w-0 flex-1 ${
                isActive || activePage === item.id
                  ? 'text-[#00744B] dark:text-[#00C08A]'
                  : 'text-slate-500 dark:text-slate-400'
              }`
            }
          >
            <i className={`fa-solid ${item.icon} text-sm mb-0.5`} />
            <span className="truncate max-w-full">{item.shortLabel}</span>
            {(item.badge ?? 0) > 0 && (
              <span className="absolute top-0 right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                {(item.badge ?? 0) > 9 ? '9+' : item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <SystemUpdateModal open={showUpdateModal} onClose={dismissModal} settings={settings} versionInfo={versionInfo} />
      <MyProfileModal open={myProfileOpen} onClose={() => setMyProfileOpen(false)} />
    </div>
  );
}

import { useNavigate } from 'react-router-dom';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';

export function MobileShortcutGrid() {
  const navigate = useNavigate();
  const { isSuperAdmin, isAdminOrAbove } = useScopedPermissions();

  const shortcuts = [
    { to: '/main-app', label: 'MainApp', icon: 'fa-tv', bg: 'from-[#00351B] to-[#00744B]', show: true },
    { to: '/dashboard', label: 'แดชบอร์ด', icon: 'fa-chart-line', bg: 'from-emerald-500 to-teal-600', show: isAdminOrAbove },
    { to: '/apps', label: 'แอปของฉัน', icon: 'fa-grip', bg: 'from-teal-600 to-emerald-700', show: isAdminOrAbove },
    { to: '/admin/personnel', label: 'บุคลากร', icon: 'fa-id-card', bg: 'from-teal-500 to-emerald-600', show: isAdminOrAbove },
    { to: '/admin/users', label: 'บัญชีผู้ใช้', icon: 'fa-users-gear', bg: 'from-purple-600 to-fuchsia-600', show: isAdminOrAbove },
    { to: '/admin/reset-requests', label: 'รีเซ็ตรหัส', icon: 'fa-key', bg: 'from-amber-500 to-orange-600', show: isAdminOrAbove },
    { to: '/admin/app-access', label: 'สิทธิ์แอป', icon: 'fa-shield-halved', bg: 'from-sky-500 to-blue-600', show: isAdminOrAbove },
    { to: '/settings/system', label: 'ตั้งค่าระบบ', icon: 'fa-gears', bg: 'from-rose-500 to-pink-600', show: isSuperAdmin },
  ].filter((s) => s.show);

  return (
    <div className="lg:hidden grid grid-cols-4 gap-2.5 mb-4">
      {shortcuts.map((item) => (
        <button
          key={item.to}
          type="button"
          onClick={() => navigate(item.to)}
          className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs active:scale-95 transition"
        >
          <span className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.bg} text-white flex items-center justify-center shadow-sm mb-1.5`}>
            <i className={`fa-solid ${item.icon} text-sm`} />
          </span>
          <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate max-w-full">
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}

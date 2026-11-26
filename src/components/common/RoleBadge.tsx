import type { CoreRole } from '@/types/database.types';

export function RoleBadge({ role }: { role: CoreRole | null | undefined }) {
  if (!role) return <span className="text-xs text-slate-400">-</span>;
  const cls =
    role === 'SUPERADMIN'
      ? 'role-pastel-superadmin'
      : role === 'ADMIN'
        ? 'role-pastel-admin'
        : 'role-pastel-user';
  const icon =
    role === 'SUPERADMIN' ? 'fa-crown' : role === 'ADMIN' ? 'fa-user-shield' : 'fa-user';

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>
      <i className={`fa-solid ${icon} text-[10px]`} />
      <span>{role}</span>
    </span>
  );
}

import { useScopedPermissions } from '@/hooks/useScopedPermissions';

export function ScopeBadge({ compact = false }: { compact?: boolean }) {
  const { isSuperAdmin, isOfficeAdmin, isDepartmentAdmin, scopeLabel } = useScopedPermissions();

  const style = isSuperAdmin
    ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/60'
    : isOfficeAdmin
      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
      : isDepartmentAdmin
        ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800/60'
        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60';

  const icon = isSuperAdmin
    ? 'fa-globe'
    : isOfficeAdmin
      ? 'fa-building'
      : isDepartmentAdmin
        ? 'fa-sitemap'
        : 'fa-user-check';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-bold ${
        compact ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'
      } ${style}`}
    >
      <i className={`fa-solid ${icon}`} />
      <span className="truncate max-w-[260px]">{scopeLabel}</span>
    </span>
  );
}

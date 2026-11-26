export function AdminMainSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200/80 dark:border-slate-700/60 mt-4 mb-6 p-6">
        <div className="rounded-2xl p-5 bg-slate-200 dark:bg-slate-700 bma-skeleton-shimmer h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-slate-300 dark:bg-slate-600" />
            <div className="space-y-2">
              <div className="w-48 h-4 rounded-md bg-slate-300 dark:bg-slate-600" />
              <div className="w-72 h-3 rounded-md bg-slate-300 dark:bg-slate-600 hidden sm:block" />
            </div>
          </div>
          <div className="hidden sm:flex gap-2">
            <div className="w-28 h-9 rounded-xl bg-slate-300 dark:bg-slate-600" />
            <div className="w-28 h-9 rounded-xl bg-slate-300 dark:bg-slate-600" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-10 rounded-xl bg-slate-100 dark:bg-slate-700/50 bma-skeleton-shimmer" />
          <div className="h-10 rounded-xl bg-slate-100 dark:bg-slate-700/50 bma-skeleton-shimmer" />
          <div className="h-10 rounded-xl bg-slate-100 dark:bg-slate-700/50 bma-skeleton-shimmer" />
        </div>
        <div className="mt-6 space-y-3">
          <div className="h-12 rounded-xl bg-slate-100 dark:bg-slate-700/60 bma-skeleton-shimmer" />
          <div className="h-14 rounded-xl bg-slate-50 dark:bg-slate-800/60 bma-skeleton-shimmer" />
          <div className="h-14 rounded-xl bg-slate-50 dark:bg-slate-800/60 bma-skeleton-shimmer" />
          <div className="h-14 rounded-xl bg-slate-50 dark:bg-slate-800/60 bma-skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}

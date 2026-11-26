export interface TagChipOption {
  id: string;
  label: string;
  count?: number;
  colorHex?: string | null;
  icon?: string;
}

export function StatusTagChips({
  options,
  activeIds,
  onChange,
  allId = 'ALL',
}: {
  options: TagChipOption[];
  activeIds: string[];
  onChange: (ids: string[]) => void;
  allId?: string;
}) {
  const handleToggle = (id: string) => {
    if (id === allId) {
      onChange([]);
      return;
    }
    if (activeIds.includes(id)) {
      onChange(activeIds.filter((x) => x !== id));
    } else {
      onChange([...activeIds, id]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((opt) => {
        const isAll = opt.id === allId;
        const isActive = isAll ? activeIds.length === 0 : activeIds.includes(opt.id);
        const activeBg = opt.colorHex || '#00744B';
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => handleToggle(opt.id)}
            style={
              isActive
                ? { backgroundColor: activeBg, borderColor: activeBg }
                : opt.colorHex && !isAll
                  ? { borderColor: `${opt.colorHex}55` }
                  : undefined
            }
            className={`status-tag-chip ${isActive ? 'active' : ''}`}
          >
            {isAll ? (
              <i className={`fa-solid ${opt.icon || 'fa-layer-group'} text-xs`} />
            ) : (
              <i
                className={`fa-solid ${isActive ? 'fa-square-check' : 'fa-regular fa-square'} text-xs`}
                style={!isActive && opt.colorHex ? { color: opt.colorHex } : undefined}
              />
            )}
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                  isActive
                    ? 'bg-white/25 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

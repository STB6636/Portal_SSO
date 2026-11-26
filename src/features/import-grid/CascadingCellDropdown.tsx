import { useEffect, useMemo, useRef, useState } from 'react';
import type { CellValidationResult } from '@/types/import.types';

interface CascadingCellDropdownProps {
  initialValue: string;
  options: string[];
  validation?: CellValidationResult;
  parentLabel?: string;
  onCommit: (value: string) => void;
  onAutoFillParent?: (parentName: string) => void;
  onCancel: () => void;
}

export function CascadingCellDropdown({
  initialValue,
  options,
  validation,
  parentLabel,
  onCommit,
  onAutoFillParent,
  onCancel,
}: CascadingCellDropdownProps) {
  const [query, setQuery] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCommit(query);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [onCommit, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 60);
    return options.filter((opt) => opt.toLowerCase().includes(q)).slice(0, 60);
  }, [options, query]);

  return (
    <div ref={containerRef} className="relative w-full z-40">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(query);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="w-full bg-white dark:bg-slate-900 border-2 border-[#00744B] rounded px-1.5 py-0.5 text-xs outline-none text-slate-900 dark:text-slate-100"
        placeholder="พิมพ์เพื่อค้นหาหรือเลือก..."
      />

      <div className="absolute left-0 top-full mt-1 w-64 max-h-64 overflow-y-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl z-50 text-xs">
        {validation?.autoFillParentName && onAutoFillParent && (
          <div className="p-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onAutoFillParent(validation.autoFillParentName!);
              }}
              className="w-full text-left px-2 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold flex items-center gap-1.5 transition"
            >
              <i className="fa-solid fa-wand-magic-sparkles" />
              <span>
                เติม{parentLabel || 'แม่'} "{validation.autoFillParentName}" ให้อัตโนมัติ
              </span>
            </button>
          </div>
        )}

        {validation?.suggestions && validation.suggestions.length > 0 && (
          <div className="p-1.5 border-b border-slate-100 dark:border-slate-800 bg-emerald-50/60 dark:bg-emerald-950/30">
            <div className="px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
              ค่าใกล้เคียงที่แนะนำ (คลิกเพื่อแทนที่)
            </div>
            {validation.suggestions.map((sug) => (
              <button
                key={sug}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onCommit(sug);
                }}
                className="w-full text-left px-2 py-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-900 dark:text-emerald-100 font-medium flex items-center gap-1.5"
              >
                <i className="fa-solid fa-check text-[10px] text-emerald-600" />
                <span className="truncate">{sug}</span>
              </button>
            ))}
          </div>
        )}

        <div className="p-1">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onCommit('');
            }}
            className="w-full text-left px-2 py-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 italic"
          >
            (ล้างค่าให้ว่าง)
          </button>
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-slate-400 text-center">ไม่พบรายการที่ตรงกัน</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onCommit(opt);
                }}
                className={`w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 truncate ${
                  opt === initialValue
                    ? 'bg-emerald-50 dark:bg-emerald-900/40 font-semibold text-emerald-800 dark:text-emerald-200'
                    : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                {opt}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

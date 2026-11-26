import { useEffect, useRef, useState } from 'react';
import { toArabicDigits, validateCid } from '@/lib/cidValidator';

interface CidInlineEditorProps {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function CidInlineEditor({ initialValue, onCommit, onCancel }: CidInlineEditorProps) {
  const [val, setVal] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const check = validateCid(val);
  const digitsOnly = toArabicDigits(val).value.replace(/\D/g, '');

  return (
    <div className="relative w-full">
      <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border-2 border-[#00744B] rounded px-1.5 py-0.5 shadow-lg">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          maxLength={17}
          value={val}
          onChange={(e) => {
            const { value: arabic } = toArabicDigits(e.target.value);
            const clean = arabic.replace(/[^\d]/g, '').slice(0, 13);
            setVal(clean);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              onCommit(val);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={() => onCommit(val)}
          className="w-full bg-transparent text-xs font-mono outline-none text-slate-900 dark:text-slate-100"
          placeholder="เลข 13 หลัก"
        />
        <span
          className={`text-[10px] font-mono shrink-0 px-1 rounded ${
            check.valid
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
          }`}
        >
          {digitsOnly.length}/13
        </span>
      </div>
      {!check.valid && check.message && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg bg-rose-700 text-white text-[11px] px-2.5 py-1.5 shadow-xl">
          <i className="fa-solid fa-triangle-exclamation mr-1" />
          {check.message}
        </div>
      )}
    </div>
  );
}

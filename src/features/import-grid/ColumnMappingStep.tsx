import { useMemo } from 'react';
import { IMPORT_COLUMNS } from './importColumnsConfig';
import type { CsvEncodingMode } from './CsvSmartReader';
import type { ColumnMappingEntry, ImportColumnKey } from '@/types/import.types';

interface ColumnMappingStepProps {
  fileName: string;
  sourceFormat: 'XLSX' | 'CSV' | 'CLIPBOARD';
  detectedEncoding: string;
  encodingOverride: CsvEncodingMode;
  onChangeEncoding: (mode: CsvEncodingMode) => void;
  rawRows: string[][];
  mappings: ColumnMappingEntry[];
  onChangeMapping: (sourceIndex: number, targetKey: ImportColumnKey | null) => void;
  onBack: () => void;
  onNext: () => void;
  isPreparing?: boolean;
}

const REQUIRED_KEYS: ImportColumnKey[] = ['cid', 'first_name', 'last_name'];

export function ColumnMappingStep({
  fileName,
  sourceFormat,
  detectedEncoding,
  encodingOverride,
  onChangeEncoding,
  rawRows,
  mappings,
  onChangeMapping,
  onBack,
  onNext,
  isPreparing = false,
}: ColumnMappingStepProps) {
  const mappedTargets = useMemo(() => {
    const set = new Set<ImportColumnKey>();
    for (const m of mappings) {
      if (m.targetKey) set.add(m.targetKey);
    }
    return set;
  }, [mappings]);

  const missingRequired = REQUIRED_KEYS.filter((k) => !mappedTargets.has(k));
  const sampleRows = rawRows.slice(0, 3);

  return (
    <div className="space-y-4">
      {/* Header bar & CSV Encoding Switcher */}
      <div className="bma-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
            <i className="fa-solid fa-table-columns" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-800 dark:text-slate-100 truncate">
              จับคู่คอลัมน์ข้อมูล ({fileName})
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              พบ {mappings.length} คอลัมน์ · {rawRows.length.toLocaleString()} แถวข้อมูล · จับคู่แล้ว{' '}
              <strong className="text-emerald-700 dark:text-emerald-300">{mappedTargets.size}</strong> / {IMPORT_COLUMNS.length} คอลัมน์มาตรฐาน
            </div>
          </div>
        </div>

        {sourceFormat === 'CSV' && (
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/70 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              <i className="fa-solid fa-language mr-1 text-emerald-600" />
              Encoding ({detectedEncoding}):
            </span>
            <select
              className="text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1"
              value={encodingOverride}
              onChange={(e) => onChangeEncoding(e.target.value as CsvEncodingMode)}
            >
              <option value="auto">อัตโนมัติ (แนะนำ)</option>
              <option value="utf-8">UTF-8</option>
              <option value="windows-874">Windows-874 / TIS-620 (ภาษาไทย Excel)</option>
            </select>
          </div>
        )}
      </div>

      {missingRequired.length > 0 && (
        <div className="rounded-xl border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200 flex items-center gap-2.5">
          <i className="fa-solid fa-circle-exclamation text-rose-600 shrink-0" />
          <span>
            กรุณาจับคู่คอลัมน์บังคับให้ครบก่อนไปขั้นถัดไป:{' '}
            <strong>
              {missingRequired
                .map((k) => IMPORT_COLUMNS.find((c) => c.key === k)?.labelTh || k)
                .join(', ')}
            </strong>
          </span>
        </div>
      )}

      {/* Column Mapping Table */}
      <div className="bma-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3 w-12">#</th>
                <th className="px-4 py-3 min-w-[180px]">ชื่อหัวตารางจากไฟล์ต้นทาง</th>
                <th className="px-4 py-3 min-w-[260px]">จับคู่เข้ากับฟิลด์ระบบ ({IMPORT_COLUMNS.length} คอลัมน์มาตรฐาน)</th>
                <th className="px-4 py-3 min-w-[260px]">ตัวอย่างข้อมูล 3 แถวแรก</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {mappings.map((entry) => {
                const samples = sampleRows
                  .map((r) => r[entry.sourceIndex] || '')
                  .filter(Boolean)
                  .slice(0, 3);
                return (
                  <tr key={entry.sourceIndex} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">
                      {entry.sourceIndex + 1}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-100">
                      {entry.sourceHeader}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        className={`bma-input text-xs py-1.5 ${
                          entry.targetKey
                            ? 'border-emerald-400 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/20 font-semibold'
                            : 'text-slate-400'
                        }`}
                        value={entry.targetKey || ''}
                        onChange={(e) =>
                          onChangeMapping(
                            entry.sourceIndex,
                            (e.target.value || null) as ImportColumnKey | null
                          )
                        }
                      >
                        <option value="">— ไม่นำเข้าคอลัมน์นี้ (ข้าม) —</option>
                        {IMPORT_COLUMNS.map((col) => {
                          const takenElsewhere =
                            mappedTargets.has(col.key) && entry.targetKey !== col.key;
                          return (
                            <option key={col.key} value={col.key}>
                              [{col.excelCol}] {col.labelTh}
                              {col.required ? ' *' : ''}
                              {takenElsewhere ? ' (จับคู่ไว้ที่ช่องอื่นแล้ว)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                      {samples.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {samples.map((s, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 max-w-[180px] truncate"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="italic text-slate-400">(ว่าง)</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <button type="button" onClick={onBack} className="bma-btn-outline">
          <i className="fa-solid fa-arrow-left mr-1.5" />
          ย้อนกลับไปเลือกไฟล์ใหม่
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={missingRequired.length > 0 || isPreparing || rawRows.length === 0}
          className="bma-btn-primary"
        >
          {isPreparing ? (
            <>
              <i className="fa-solid fa-spinner fa-spin mr-1.5" />
              กำลังตรวจสอบเลขบัตรและข้อมูลอ้างอิง...
            </>
          ) : (
            <>
              ตรวจสอบความถูกต้องในตาราง (Step 3)
              <i className="fa-solid fa-arrow-right ml-1.5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

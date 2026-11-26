import { useEffect, useState } from 'react';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { IMPORT_COLUMNS } from './importColumnsConfig';
import type { ImportColumnKey, StagingRow } from '@/types/import.types';

interface MobileImportRowDrawerProps {
  row: StagingRow | null;
  onClose: () => void;
  onSaveRow: (rowId: string, patch: Partial<Record<ImportColumnKey, string>>) => void;
}

export function MobileImportRowDrawer({ row, onClose, onSaveRow }: MobileImportRowDrawerProps) {
  const [draft, setDraft] = useState<Partial<Record<ImportColumnKey, string>>>({});

  useEffect(() => {
    if (row) {
      setDraft({ ...row.cells });
    }
  }, [row]);

  if (!row) return null;

  const errorKeys = IMPORT_COLUMNS.filter((c) => row.validations[c.key]?.status === 'ERROR');
  const otherKeys = IMPORT_COLUMNS.filter((c) => row.validations[c.key]?.status !== 'ERROR');

  return (
    <ResponsiveModal
      open={Boolean(row)}
      onClose={onClose}
      title={`แก้ไขข้อมูลแถวที่ ${row.sheetRowNo}`}
      subtitle={`${row.cells.first_name || ''} ${row.cells.last_name || ''} · พบจุดแดง ${row.errorCount} ช่อง`}
      icon="fa-pen-to-square"
      maxWidthClass="max-w-lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="bma-btn-outline">
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => {
              onSaveRow(row.rowId, draft);
              onClose();
            }}
            className="bma-btn-primary"
          >
            <i className="fa-solid fa-check mr-1.5" />
            บันทึกการแก้ไขแถวนี้
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {errorKeys.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase text-rose-600 dark:text-rose-400">
              <i className="fa-solid fa-circle-exclamation mr-1" />
              ฟิลด์ที่ต้องแก้ไข ({errorKeys.length})
            </div>
            {errorKeys.map((col) => {
              const v = row.validations[col.key];
              return (
                <div
                  key={col.key}
                  className="p-3 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/30 space-y-1.5"
                >
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-100">
                    [{col.excelCol}] {col.labelTh}
                  </label>
                  <input
                    type="text"
                    className="bma-input text-sm"
                    value={draft[col.key] ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [col.key]: e.target.value }))}
                  />
                  {v?.message && <p className="text-xs text-rose-600 dark:text-rose-400">{v.message}</p>}
                  {v?.suggestions && v.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {v.suggestions.map((sug) => (
                        <button
                          key={sug}
                          type="button"
                          onClick={() => setDraft((prev) => ({ ...prev, [col.key]: sug }))}
                          className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 text-xs font-semibold"
                        >
                          ใช้ "{sug}"
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <details className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
          <summary className="cursor-pointer text-xs font-bold text-slate-600 dark:text-slate-300">
            ดูและแก้ไขฟิลด์อื่นๆ ทั้งหมด ({otherKeys.length} ช่อง)
          </summary>
          <div className="mt-3 space-y-2.5">
            {otherKeys.map((col) => (
              <div key={col.key}>
                <label className="block text-xs text-slate-500 mb-1">
                  [{col.excelCol}] {col.labelTh}
                </label>
                <input
                  type="text"
                  className="bma-input text-xs py-1.5"
                  value={draft[col.key] ?? ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [col.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </details>
      </div>
    </ResponsiveModal>
  );
}

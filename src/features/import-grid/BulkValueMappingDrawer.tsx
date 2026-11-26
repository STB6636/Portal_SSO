import { useMemo, useState } from 'react';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { IMPORT_COLUMN_MAP } from './importColumnsConfig';
import type { RelationalHierarchyIndex } from './RelationalHierarchyIndex';
import type { ImportColumnKey, StagingRow } from '@/types/import.types';

interface BulkValueMappingDrawerProps {
  open: boolean;
  onClose: () => void;
  rows: StagingRow[];
  index: RelationalHierarchyIndex;
  onBulkReplace: (colKey: ImportColumnKey, fromValue: string, toValue: string) => number;
}

interface GroupedErrorItem {
  colKey: ImportColumnKey;
  colLabel: string;
  rawValue: string;
  count: number;
  suggestions: string[];
  options: string[];
}

export function BulkValueMappingDrawer({
  open,
  onClose,
  rows,
  index,
  onBulkReplace,
}: BulkValueMappingDrawerProps) {
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({});

  const grouped = useMemo<GroupedErrorItem[]>(() => {
    const map = new Map<string, GroupedErrorItem>();
    for (const row of rows) {
      for (const [k, v] of Object.entries(row.validations)) {
        const colKey = k as ImportColumnKey;
        if (v?.status !== 'ERROR') continue;
        if (
          v.code !== 'LOOKUP_NOT_FOUND' &&
          v.code !== 'POSITION_MISMATCH_TYPE' &&
          v.code !== 'LEVEL_NOT_ALLOWED_FOR_POSITION' &&
          v.code !== 'ORG_PARENT_MISMATCH' &&
          v.code !== 'INVALID_BOOLEAN'
        ) {
          continue;
        }
        const rawValue = row.cells[colKey].trim();
        if (!rawValue) continue;
        const mapKey = `${colKey}::${rawValue}`;
        const existing = map.get(mapKey);
        if (existing) {
          existing.count += 1;
        } else {
          const def = IMPORT_COLUMN_MAP[colKey];
          let options: string[] = [];
          if (def.kind === 'lookup' && def.lookupCategoryCode) {
            options = index.getLookupOptions(def.lookupCategoryCode);
          } else if (def.kind === 'position_type') {
            options = index.getPositionTypeOptions();
          } else if (def.kind === 'position') {
            options = index.getPositionOptionsForType(null);
          } else if (def.kind === 'position_level') {
            options = index.getAllowedLevelOptions(null);
          } else if (def.kind === 'bureau') {
            options = index.getBureauOptions();
          } else if (def.kind === 'office') {
            options = index.getOfficeOptions(null);
          } else if (def.kind === 'department') {
            options = index.getDepartmentOptions(null);
          } else if (def.kind === 'division') {
            options = index.getDivisionOptions(null);
          } else if (def.kind === 'boolean') {
            options = ['ใช่', 'ไม่ใช่'];
          }

          map.set(mapKey, {
            colKey,
            colLabel: def.labelTh,
            rawValue,
            count: 1,
            suggestions: v.suggestions || [],
            options,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [rows, index]);

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      title="แก้ไขคำผิดยกคอลัมน์ (Bulk Value Mapping)"
      subtitle="จับกลุ่มคำที่ไม่ตรงกับฐานข้อมูล แล้วคลิกแทนที่ทีเดียวทั้งคอลัมน์"
      icon="fa-wand-magic-sparkles"
      maxWidthClass="max-w-3xl"
      footer={
        <button type="button" onClick={onClose} className="bma-btn-primary">
          ปิดหน้าต่าง
        </button>
      }
    >
      {grouped.length === 0 ? (
        <div className="py-10 text-center text-slate-500 dark:text-slate-400">
          <i className="fa-solid fa-circle-check text-3xl text-emerald-500 mb-2 block" />
          ไม่พบค่าพิมพ์ผิดหรือค่าที่ไม่ตรงกับ Master Data ในขณะนี้
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((item) => {
            const idKey = `${item.colKey}::${item.rawValue}`;
            const chosen = selectedTargets[idKey] ?? item.suggestions[0] ?? '';
            return (
              <div
                key={idKey}
                className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-slate-50/70 dark:bg-slate-800/50 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                      {item.colLabel}
                    </span>
                    <span className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                      "{item.rawValue}"
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300">
                    พบ {item.count} แถว
                  </span>
                </div>

                {item.suggestions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-slate-500">แนะนำ:</span>
                    {item.suggestions.map((sug) => (
                      <button
                        key={sug}
                        type="button"
                        onClick={() => onBulkReplace(item.colKey, item.rawValue, sug)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/50 dark:hover:bg-emerald-900 text-emerald-800 dark:text-emerald-200 font-semibold transition"
                      >
                        <i className="fa-solid fa-bolt mr-1 text-[10px]" />
                        แทนที่ทั้งหมดด้วย "{sug}"
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="bma-input text-xs py-1.5 flex-1 min-w-[200px]"
                    value={chosen}
                    onChange={(e) =>
                      setSelectedTargets((prev) => ({ ...prev, [idKey]: e.target.value }))
                    }
                  >
                    <option value="">— เลือกค่ามาตรฐานจากฐานข้อมูล —</option>
                    {item.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!chosen}
                    onClick={() => onBulkReplace(item.colKey, item.rawValue, chosen)}
                    className="bma-btn-primary text-xs py-1.5 px-3"
                  >
                    แทนที่ {item.count} แถว
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ResponsiveModal>
  );
}

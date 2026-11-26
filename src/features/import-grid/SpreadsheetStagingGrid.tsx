import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IMPORT_COLUMNS, IMPORT_COLUMN_MAP } from './importColumnsConfig';
import { CidInlineEditor } from './CidInlineEditor';
import { CascadingCellDropdown } from './CascadingCellDropdown';
import { MobileImportRowDrawer } from './MobileImportRowDrawer';
import type { RelationalHierarchyIndex } from './RelationalHierarchyIndex';
import type { ActiveCellCoord } from '@/stores/useImportSheetStore';
import type { ImportColumnKey, StagingRow } from '@/types/import.types';

interface SpreadsheetStagingGridProps {
  rows: StagingRow[];
  index: RelationalHierarchyIndex;
  activeCell: ActiveCellCoord | null;
  showErrorsOnly: boolean;
  searchQuery: string;
  canUndo: boolean;
  canRedo: boolean;
  onSetActiveCell: (coord: ActiveCellCoord | null) => void;
  onSetShowErrorsOnly: (v: boolean) => void;
  onSetSearchQuery: (q: string) => void;
  onUpdateCell: (rowId: string, colKey: ImportColumnKey, value: string) => void;
  onUpdateRowBatch: (rowId: string, patch: Partial<Record<ImportColumnKey, string>>) => void;
  onFillDown: (rowId: string, colKey: ImportColumnKey, count: number) => void;
  onDeleteRow: (rowId: string) => void;
  onToggleRowSelection: (rowId: string) => void;
  onToggleAllSelection: (selected: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onApplyAllAutoFixes: () => void;
  onOpenBulkMapper: () => void;
  onExportRedRows: () => void;
}

const ROW_HEIGHT = 40;

const PARENT_COL_MAP: Partial<Record<ImportColumnKey, { parentKey: ImportColumnKey; parentLabel: string }>> = {
  position_id: { parentKey: 'position_type_id', parentLabel: 'ประเภทตำแหน่ง' },
  office_id: { parentKey: 'bureau_id', parentLabel: 'สำนัก' },
  department_id: { parentKey: 'office_id', parentLabel: 'สำนักงาน/กอง' },
  division_id: { parentKey: 'department_id', parentLabel: 'ส่วน/ฝ่าย' },
};

const STATUS_BADGE: Record<StagingRow['rowStatus'], { label: string; cls: string }> = {
  NEW: {
    label: 'เพิ่มใหม่',
    cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  },
  UPDATE: {
    label: 'อัปเดตเดิม',
    cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
  },
  WARNING: {
    label: 'แก้ไขอัตโนมัติ',
    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  },
  ERROR: {
    label: 'ต้องแก้ไข',
    cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
  },
};

export function SpreadsheetStagingGrid({
  rows,
  index,
  activeCell,
  showErrorsOnly,
  searchQuery,
  canUndo,
  canRedo,
  onSetActiveCell,
  onSetShowErrorsOnly,
  onSetSearchQuery,
  onUpdateCell,
  onUpdateRowBatch,
  onFillDown,
  onDeleteRow,
  onToggleRowSelection,
  onToggleAllSelection,
  onUndo,
  onRedo,
  onApplyAllAutoFixes,
  onOpenBulkMapper,
  onExportRedRows,
}: SpreadsheetStagingGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [editingCell, setEditingCell] = useState<ActiveCellCoord | null>(null);
  const [plainDraft, setPlainDraft] = useState('');
  const [mobileEditRow, setMobileEditRow] = useState<StagingRow | null>(null);

  const stats = useMemo(() => {
    let validNew = 0;
    let validUpdate = 0;
    let warnings = 0;
    let errors = 0;
    for (const r of rows) {
      if (r.rowStatus === 'ERROR') errors += 1;
      else if (r.rowStatus === 'UPDATE') validUpdate += 1;
      else if (r.rowStatus === 'WARNING') warnings += 1;
      else validNew += 1;
    }
    return { validNew, validUpdate, warnings, errors, total: rows.length };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (showErrorsOnly && r.errorCount === 0) return false;
      if (!q) return true;
      return (
        r.cells.cid.toLowerCase().includes(q) ||
        r.cells.first_name.toLowerCase().includes(q) ||
        r.cells.last_name.toLowerCase().includes(q) ||
        r.cells.office_id.toLowerCase().includes(q) ||
        r.cells.department_id.toLowerCase().includes(q) ||
        r.cells.position_id.toLowerCase().includes(q)
      );
    });
  }, [rows, showErrorsOnly, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const allSelected = rows.length > 0 && rows.every((r) => r.selected);

  const getDropdownOptions = useCallback(
    (row: StagingRow, colKey: ImportColumnKey): string[] | null => {
      const def = IMPORT_COLUMN_MAP[colKey];
      if (def.kind === 'lookup' && def.lookupCategoryCode) {
        return index.getLookupOptions(def.lookupCategoryCode);
      }
      if (def.kind === 'position_type') return index.getPositionTypeOptions();
      if (def.kind === 'position') {
        const ptId = typeof row.resolved.position_type_id === 'string' ? row.resolved.position_type_id : null;
        return index.getPositionOptionsForType(ptId);
      }
      if (def.kind === 'position_level') {
        const pId = typeof row.resolved.position_id === 'string' ? row.resolved.position_id : null;
        return index.getAllowedLevelOptions(pId);
      }
      if (def.kind === 'bureau') return index.getBureauOptions();
      if (def.kind === 'office') {
        const bId = typeof row.resolved.bureau_id === 'string' ? row.resolved.bureau_id : null;
        return index.getOfficeOptions(bId);
      }
      if (def.kind === 'department') {
        const oId = typeof row.resolved.office_id === 'string' ? row.resolved.office_id : null;
        return index.getDepartmentOptions(oId);
      }
      if (def.kind === 'division') {
        const dId = typeof row.resolved.department_id === 'string' ? row.resolved.department_id : null;
        return index.getDivisionOptions(dId);
      }
      if (def.kind === 'boolean') return ['ใช่', 'ไม่ใช่'];
      return null;
    },
    [index]
  );

  const jumpToNextError = useCallback(() => {
    const errorCoords: Array<{ rowIndex: number; rowId: string; colKey: ImportColumnKey }> = [];
    filteredRows.forEach((row, rIdx) => {
      for (const col of IMPORT_COLUMNS) {
        if (row.validations[col.key]?.status === 'ERROR') {
          errorCoords.push({ rowIndex: rIdx, rowId: row.rowId, colKey: col.key });
        }
      }
    });
    if (errorCoords.length === 0) return;

    let nextIdx = 0;
    if (activeCell) {
      const curPos = errorCoords.findIndex(
        (c) => c.rowId === activeCell.rowId && c.colKey === activeCell.colKey
      );
      if (curPos >= 0) {
        nextIdx = (curPos + 1) % errorCoords.length;
      }
    }
    const target = errorCoords[nextIdx];
    onSetActiveCell({ rowId: target.rowId, colKey: target.colKey });
    rowVirtualizer.scrollToIndex(target.rowIndex, { align: 'center' });
  }, [filteredRows, activeCell, onSetActiveCell, rowVirtualizer]);

  // Global keyboard navigation when grid cell is focused (not editing)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!editingCell) {
          e.preventDefault();
          onUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        if (!editingCell) {
          e.preventDefault();
          onRedo();
        }
        return;
      }
      if (!activeCell || editingCell) return;

      const rIdx = filteredRows.findIndex((r) => r.rowId === activeCell.rowId);
      const cIdx = IMPORT_COLUMNS.findIndex((c) => c.key === activeCell.colKey);
      if (rIdx < 0 || cIdx < 0) return;

      if (e.key === 'ArrowDown' && rIdx < filteredRows.length - 1) {
        e.preventDefault();
        onSetActiveCell({ rowId: filteredRows[rIdx + 1].rowId, colKey: activeCell.colKey });
      } else if (e.key === 'ArrowUp' && rIdx > 0) {
        e.preventDefault();
        onSetActiveCell({ rowId: filteredRows[rIdx - 1].rowId, colKey: activeCell.colKey });
      } else if ((e.key === 'ArrowRight' || e.key === 'Tab') && cIdx < IMPORT_COLUMNS.length - 1) {
        e.preventDefault();
        onSetActiveCell({ rowId: activeCell.rowId, colKey: IMPORT_COLUMNS[cIdx + 1].key });
      } else if (e.key === 'ArrowLeft' && cIdx > 0) {
        e.preventDefault();
        onSetActiveCell({ rowId: activeCell.rowId, colKey: IMPORT_COLUMNS[cIdx - 1].key });
      } else if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        setEditingCell(activeCell);
        setPlainDraft(filteredRows[rIdx].cells[activeCell.colKey]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCell, editingCell, filteredRows, onSetActiveCell, onUndo, onRedo]);

  const activeRowObj = useMemo(
    () => (activeCell ? rows.find((r) => r.rowId === activeCell.rowId) ?? null : null),
    [activeCell, rows]
  );
  const activeValidation = activeCell && activeRowObj ? activeRowObj.validations[activeCell.colKey] : undefined;

  const commitCellWithCascade = (row: StagingRow, colKey: ImportColumnKey, value: string) => {
    setEditingCell(null);
    if (row.cells[colKey] === value) return;
    // Clear dependent children if parent org or position type changed
    if (colKey === 'bureau_id') {
      onUpdateRowBatch(row.rowId, { bureau_id: value, office_id: '', department_id: '', division_id: '' });
    } else if (colKey === 'office_id') {
      onUpdateRowBatch(row.rowId, { office_id: value, department_id: '', division_id: '' });
    } else if (colKey === 'department_id') {
      onUpdateRowBatch(row.rowId, { department_id: value, division_id: '' });
    } else if (colKey === 'position_type_id') {
      onUpdateRowBatch(row.rowId, { position_type_id: value, position_id: '', position_level_id: '' });
    } else {
      onUpdateCell(row.rowId, colKey, value);
    }
  };

  const totalTableWidth = useMemo(
    () => 42 + 54 + 98 + IMPORT_COLUMNS.reduce((acc, c) => acc + c.width, 0) + 46,
    []
  );

  return (
    <div className="space-y-3">
      {/* Status KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <div className="bma-card px-3.5 py-2.5">
          <div className="text-[11px] text-slate-500">ทั้งหมด</div>
          <div className="text-lg font-extrabold text-slate-800 dark:text-slate-100">
            {stats.total.toLocaleString()}
          </div>
        </div>
        <div className="bma-card px-3.5 py-2.5 border-l-4 border-l-emerald-500">
          <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">พร้อมเพิ่มใหม่</div>
          <div className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300">
            {stats.validNew.toLocaleString()}
          </div>
        </div>
        <div className="bma-card px-3.5 py-2.5 border-l-4 border-l-blue-500">
          <div className="text-[11px] text-blue-700 dark:text-blue-300 font-semibold">พร้อมอัปเดตเดิม</div>
          <div className="text-lg font-extrabold text-blue-700 dark:text-blue-300">
            {stats.validUpdate.toLocaleString()}
          </div>
        </div>
        <div className="bma-card px-3.5 py-2.5 border-l-4 border-l-amber-500">
          <div className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold">เตือน/แก้ไขอัตโนมัติ</div>
          <div className="text-lg font-extrabold text-amber-700 dark:text-amber-300">
            {stats.warnings.toLocaleString()}
          </div>
        </div>
        <div className="bma-card px-3.5 py-2.5 border-l-4 border-l-rose-500 col-span-2 sm:col-span-1">
          <div className="text-[11px] text-rose-700 dark:text-rose-300 font-semibold">พบจุดแดง (ต้องแก้ไข)</div>
          <div className="text-lg font-extrabold text-rose-600 dark:text-rose-400">
            {stats.errors.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Spreadsheet Toolbar */}
      <div className="bma-card p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="ย้อนกลับ (Ctrl+Z)"
            className="bma-btn-outline text-xs py-1.5 px-2.5 disabled:opacity-40"
          >
            <i className="fa-solid fa-rotate-left" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="ทำซ้ำ (Ctrl+Y)"
            className="bma-btn-outline text-xs py-1.5 px-2.5 disabled:opacity-40"
          >
            <i className="fa-solid fa-rotate-right" />
          </button>

          <button
            type="button"
            onClick={jumpToNextError}
            disabled={stats.errors === 0}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-40 transition"
          >
            <i className="fa-solid fa-crosshairs mr-1.5" />
            กระโดดไปจุดแดงถัดไป
          </button>

          <button
            type="button"
            onClick={() => onSetShowErrorsOnly(!showErrorsOnly)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
              showErrorsOnly
                ? 'bg-rose-100 border-rose-400 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200'
                : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <i className="fa-solid fa-filter mr-1.5" />
            เฉพาะแถวสีแดง ({stats.errors})
          </button>

          <button
            type="button"
            onClick={onOpenBulkMapper}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white transition"
          >
            <i className="fa-solid fa-wand-magic-sparkles mr-1.5" />
            แก้คำผิดยกคอลัมน์
          </button>

          {stats.warnings > 0 && (
            <button
              type="button"
              onClick={onApplyAllAutoFixes}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition"
            >
              <i className="fa-solid fa-broom mr-1.5" />
              ยืนยันแก้ไขอัตโนมัติทั้งหมด
            </button>
          )}

          {stats.errors > 0 && (
            <button
              type="button"
              onClick={onExportRedRows}
              className="bma-btn-outline text-xs py-1.5 px-2.5"
            >
              <i className="fa-solid fa-file-excel text-rose-600 mr-1.5" />
              ส่งออกเฉพาะแถวสีแดง
            </button>
          )}
        </div>

        <div className="relative w-full sm:w-60">
          <i className="fa-solid fa-magnifying-glass text-xs text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSetSearchQuery(e.target.value)}
            placeholder="ค้นหาชื่อ, เลขบัตร, สังกัด..."
            className="bma-input text-xs py-1.5 pl-8"
          />
        </div>
      </div>

      {/* Formula / Inspector Bar for Active Cell */}
      {activeCell && activeRowObj && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/80 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded bg-[#00744B] text-white font-mono font-bold">
              {IMPORT_COLUMN_MAP[activeCell.colKey].excelCol}
              {activeRowObj.sheetRowNo}
            </span>
            <span className="font-bold text-slate-700 dark:text-slate-200">
              {IMPORT_COLUMN_MAP[activeCell.colKey].labelTh}:
            </span>
            <span className="font-mono text-slate-600 dark:text-slate-300 truncate max-w-[260px]">
              {activeRowObj.cells[activeCell.colKey] || '(ว่าง)'}
            </span>

            {activeValidation?.status === 'ERROR' && (
              <span className="text-rose-600 dark:text-rose-400 font-semibold">
                <i className="fa-solid fa-circle-exclamation mr-1" />
                {activeValidation.message}
              </span>
            )}
            {activeValidation?.status === 'WARNING' && (
              <span className="text-amber-700 dark:text-amber-300 font-semibold">
                <i className="fa-solid fa-triangle-exclamation mr-1" />
                {activeValidation.message}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {activeValidation?.autoFillParentName && PARENT_COL_MAP[activeCell.colKey] && (
              <button
                type="button"
                onClick={() => {
                  const pInfo = PARENT_COL_MAP[activeCell.colKey]!;
                  onUpdateCell(activeRowObj.rowId, pInfo.parentKey, activeValidation.autoFillParentName!);
                }}
                className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold"
              >
                <i className="fa-solid fa-wand-magic-sparkles mr-1" />
                เติม{PARENT_COL_MAP[activeCell.colKey]!.parentLabel} "{activeValidation.autoFillParentName}"
              </button>
            )}
            {activeValidation?.suggestions && activeValidation.suggestions.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  commitCellWithCascade(
                    activeRowObj,
                    activeCell.colKey,
                    activeValidation.suggestions![0]
                  )
                }
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                ใช้ "{activeValidation.suggestions[0]}"
              </button>
            )}
            <button
              type="button"
              title="คัดลอกค่าเซลล์นี้ลงไปอีก 5 แถวถัดไป (Fill Handle)"
              onClick={() => onFillDown(activeRowObj.rowId, activeCell.colKey, 5)}
              className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            >
              <i className="fa-solid fa-arrow-down-short-wide mr-1" />
              Fill Down 5 แถว
            </button>
          </div>
        </div>
      )}

      {/* Mobile Card List Fallback (< 640px) */}
      <div className="sm:hidden space-y-2">
        {filteredRows.slice(0, 60).map((row) => (
          <div
            key={row.rowId}
            className={`bma-card p-3 border-l-4 ${
              row.errorCount > 0 ? 'border-l-rose-500' : 'border-l-emerald-500'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                #{row.sheetRowNo} {row.cells.first_name} {row.cells.last_name}
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE[row.rowStatus].cls}`}>
                {STATUS_BADGE[row.rowStatus].label}
              </span>
            </div>
            <div className="text-xs text-slate-500 font-mono mt-1">CID: {row.cells.cid || '-'}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {row.cells.position_id || '-'} · {row.cells.office_id || '-'}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-rose-600 font-semibold">
                {row.errorCount > 0 ? `พบจุดแดง ${row.errorCount} ช่อง` : 'ผ่านการตรวจสอบ'}
              </span>
              <button
                type="button"
                onClick={() => setMobileEditRow(row)}
                className="bma-btn-primary text-xs py-1 px-2.5"
              >
                <i className="fa-solid fa-pen mr-1" />
                แก้ไขแถวนี้
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop 60fps Virtualized Spreadsheet Grid (>= 640px) */}
      <div className="hidden sm:block bma-card overflow-hidden">
        <div
          ref={scrollRef}
          className="overflow-auto relative"
          style={{ height: '540px' }}
        >
          <div style={{ width: `${totalTableWidth}px`, position: 'relative' }}>
            {/* Sticky Header Row */}
            <div className="sticky top-0 z-20 flex bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 select-none">
              <div className="w-[42px] shrink-0 flex items-center justify-center border-r border-slate-200 dark:border-slate-700 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleAllSelection(e.target.checked)}
                />
              </div>
              <div className="w-[54px] shrink-0 flex items-center justify-center border-r border-slate-200 dark:border-slate-700 py-2">
                แถว
              </div>
              <div className="w-[98px] shrink-0 flex items-center justify-center border-r border-slate-200 dark:border-slate-700 py-2">
                สถานะ
              </div>
              {IMPORT_COLUMNS.map((col) => (
                <div
                  key={col.key}
                  style={{ width: `${col.width}px` }}
                  className="shrink-0 px-2 py-2 border-r border-slate-200 dark:border-slate-700 truncate"
                  title={`[${col.excelCol}] ${col.labelTh} (${col.group})`}
                >
                  <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 mr-1">
                    {col.excelCol}
                  </span>
                  {col.labelTh}
                  {col.required && <span className="text-rose-500 ml-0.5">*</span>}
                </div>
              ))}
              <div className="w-[46px] shrink-0 flex items-center justify-center py-2">ลบ</div>
            </div>

            {/* Virtualized Body */}
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const row = filteredRows[vRow.index];
                if (!row) return null;
                return (
                  <div
                    key={row.rowId}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${ROW_HEIGHT}px`,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                    className={`flex items-center border-b border-slate-200 dark:border-slate-800 text-xs ${
                      row.errorCount > 0
                        ? 'bg-rose-50/30 dark:bg-rose-950/10'
                        : vRow.index % 2 === 1
                          ? 'bg-slate-50/50 dark:bg-slate-900/40'
                          : 'bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="w-[42px] h-full shrink-0 flex items-center justify-center border-r border-slate-200 dark:border-slate-800">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={() => onToggleRowSelection(row.rowId)}
                      />
                    </div>
                    <div className="w-[54px] h-full shrink-0 flex items-center justify-center border-r border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-400">
                      {row.sheetRowNo}
                    </div>
                    <div className="w-[98px] h-full shrink-0 flex items-center justify-center border-r border-slate-200 dark:border-slate-800 px-1">
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold truncate ${STATUS_BADGE[row.rowStatus].cls}`}
                      >
                        {STATUS_BADGE[row.rowStatus].label}
                      </span>
                    </div>

                    {IMPORT_COLUMNS.map((col) => {
                      const val = row.cells[col.key];
                      const cellV = row.validations[col.key];
                      const isActive =
                        activeCell?.rowId === row.rowId && activeCell?.colKey === col.key;
                      const isEditing =
                        editingCell?.rowId === row.rowId && editingCell?.colKey === col.key;

                      const cellBg =
                        cellV?.status === 'ERROR'
                          ? 'bg-rose-100/80 dark:bg-rose-950/60 text-rose-900 dark:text-rose-100'
                          : cellV?.status === 'WARNING'
                            ? 'bg-amber-100/70 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100'
                            : '';

                      const dropdownOptions = isEditing ? getDropdownOptions(row, col.key) : null;

                      return (
                        <div
                          key={col.key}
                          style={{ width: `${col.width}px` }}
                          onClick={() => onSetActiveCell({ rowId: row.rowId, colKey: col.key })}
                          onDoubleClick={() => {
                            onSetActiveCell({ rowId: row.rowId, colKey: col.key });
                            setEditingCell({ rowId: row.rowId, colKey: col.key });
                            setPlainDraft(val);
                          }}
                          title={cellV?.message || val}
                          className={`h-full shrink-0 px-2 flex items-center border-r border-slate-200 dark:border-slate-800 relative cursor-cell ${cellBg} ${
                            isActive ? 'ring-2 ring-inset ring-[#00744B] z-10' : ''
                          }`}
                        >
                          {isEditing ? (
                            col.key === 'cid' ? (
                              <CidInlineEditor
                                initialValue={val}
                                onCommit={(next) => commitCellWithCascade(row, 'cid', next)}
                                onCancel={() => setEditingCell(null)}
                              />
                            ) : dropdownOptions ? (
                              <CascadingCellDropdown
                                initialValue={val}
                                options={dropdownOptions}
                                validation={cellV}
                                parentLabel={PARENT_COL_MAP[col.key]?.parentLabel}
                                onCommit={(next) => commitCellWithCascade(row, col.key, next)}
                                onAutoFillParent={(parentName) => {
                                  const pInfo = PARENT_COL_MAP[col.key];
                                  if (pInfo) {
                                    onUpdateCell(row.rowId, pInfo.parentKey, parentName);
                                  }
                                  setEditingCell(null);
                                }}
                                onCancel={() => setEditingCell(null)}
                              />
                            ) : (
                              <input
                                autoFocus
                                type="text"
                                value={plainDraft}
                                onChange={(e) => setPlainDraft(e.target.value)}
                                onBlur={() => commitCellWithCascade(row, col.key, plainDraft)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === 'Tab') {
                                    e.preventDefault();
                                    commitCellWithCascade(row, col.key, plainDraft);
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setEditingCell(null);
                                  }
                                }}
                                className="w-full bg-white dark:bg-slate-900 border-2 border-[#00744B] rounded px-1.5 py-0.5 text-xs outline-none text-slate-900 dark:text-slate-100"
                              />
                            )
                          ) : (
                            <div className="w-full flex items-center justify-between gap-1 truncate">
                              <span
                                className={`truncate ${
                                  col.key === 'cid' ? 'font-mono' : ''
                                } ${!val && cellV?.normalizedValue ? 'italic opacity-75' : ''}`}
                              >
                                {val || cellV?.normalizedValue || ''}
                              </span>
                              {cellV?.status === 'ERROR' && (
                                <i className="fa-solid fa-circle-exclamation text-rose-600 dark:text-rose-400 text-[10px] shrink-0" />
                              )}
                              {cellV?.status === 'WARNING' && (
                                <i className="fa-solid fa-sparkles text-amber-600 dark:text-amber-400 text-[10px] shrink-0" />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div className="w-[46px] h-full shrink-0 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => onDeleteRow(row.rowId)}
                        title="ลบแถวนี้"
                        className="text-slate-400 hover:text-rose-600 transition"
                      >
                        <i className="fa-solid fa-trash-can text-xs" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <MobileImportRowDrawer
        row={mobileEditRow}
        onClose={() => setMobileEditRow(null)}
        onSaveRow={(rowId, patch) => onUpdateRowBatch(rowId, patch)}
      />
    </div>
  );
}

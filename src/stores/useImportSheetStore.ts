import { create } from 'zustand';
import {
  buildStagingRowsFromMapping,
  validateAllStagingRows,
  type ValidationContext,
} from '@/features/import-grid/StagingValidationEngine';
import type { CsvEncodingMode } from '@/features/import-grid/CsvSmartReader';
import type { ImportCommitMode, ImportSourceFormat } from '@/types/database.types';
import type {
  ColumnMappingEntry,
  ExistingPersonnelSnapshot,
  ImportBatchCommitResult,
  ImportColumnKey,
  StagingRow,
} from '@/types/import.types';

const MAX_HISTORY_STEPS = 50;

export interface ActiveCellCoord {
  rowId: string;
  colKey: ImportColumnKey;
}

/**
 * PDPA RAM-ONLY Import Staging Store:
 * Strictly in-memory Zustand store — NEVER persists sensitive CID / Personnel
 * rows to localStorage, sessionStorage, or IndexedDB.
 */
interface ImportSheetState {
  step: 1 | 2 | 3 | 4;
  fileName: string;
  sourceFormat: ImportSourceFormat;
  detectedEncoding: 'utf-8-bom' | 'utf-8' | 'windows-874' | 'xlsx' | 'clipboard';
  encodingOverride: CsvEncodingMode;
  rawBuffer: ArrayBuffer | null;
  rawHeaders: string[];
  rawRows: string[][];
  columnMappings: ColumnMappingEntry[];

  rows: StagingRow[];
  existingCidMap: Map<string, ExistingPersonnelSnapshot>;
  past: StagingRow[][];
  future: StagingRow[][];

  mode: ImportCommitMode;
  autoProvision: boolean;
  skipRedRows: boolean;
  showErrorsOnly: boolean;
  searchQuery: string;
  activeCell: ActiveCellCoord | null;
  commitResult: ImportBatchCommitResult | null;

  // Actions
  setStep: (step: 1 | 2 | 3 | 4) => void;
  setParsedTable: (params: {
    fileName: string;
    sourceFormat: ImportSourceFormat;
    detectedEncoding: ImportSheetState['detectedEncoding'];
    headers: string[];
    rows: string[][];
    mappings: ColumnMappingEntry[];
    rawBuffer?: ArrayBuffer | null;
    encodingOverride?: CsvEncodingMode;
  }) => void;
  updateColumnMapping: (sourceIndex: number, targetKey: ImportColumnKey | null) => void;
  buildAndValidateStaging: (ctx: Omit<ValidationContext, 'mode' | 'existingCidMap'>, existingMap?: Map<string, ExistingPersonnelSnapshot>) => void;
  setExistingCidMap: (map: Map<string, ExistingPersonnelSnapshot>, ctx: Omit<ValidationContext, 'mode' | 'existingCidMap'>) => void;
  revalidateAll: (ctx: Omit<ValidationContext, 'mode' | 'existingCidMap'>) => void;

  setCellValue: (
    rowId: string,
    colKey: ImportColumnKey,
    value: string,
    ctx: Omit<ValidationContext, 'mode' | 'existingCidMap'>
  ) => void;
  setRowCellsBatch: (
    rowId: string,
    patch: Partial<Record<ImportColumnKey, string>>,
    ctx: Omit<ValidationContext, 'mode' | 'existingCidMap'>
  ) => void;
  bulkReplaceColumnValue: (
    colKey: ImportColumnKey,
    fromValue: string,
    toValue: string,
    ctx: Omit<ValidationContext, 'mode' | 'existingCidMap'>
  ) => number;
  fillDownColumn: (
    fromRowId: string,
    colKey: ImportColumnKey,
    count: number,
    ctx: Omit<ValidationContext, 'mode' | 'existingCidMap'>
  ) => void;
  applyAllAutoFixes: (ctx: Omit<ValidationContext, 'mode' | 'existingCidMap'>) => number;
  deleteRow: (rowId: string, ctx: Omit<ValidationContext, 'mode' | 'existingCidMap'>) => void;
  toggleRowSelection: (rowId: string) => void;
  toggleAllSelection: (selected: boolean) => void;

  undo: () => void;
  redo: () => void;

  setMode: (mode: ImportCommitMode, ctx?: Omit<ValidationContext, 'mode' | 'existingCidMap'>) => void;
  setAutoProvision: (v: boolean) => void;
  setSkipRedRows: (v: boolean) => void;
  setShowErrorsOnly: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  setActiveCell: (coord: ActiveCellCoord | null) => void;
  setCommitResult: (res: ImportBatchCommitResult | null) => void;
  resetAll: () => void;
}

function pushHistory(past: StagingRow[][], snapshot: StagingRow[]): StagingRow[][] {
  const next = [...past, snapshot];
  return next.length > MAX_HISTORY_STEPS ? next.slice(next.length - MAX_HISTORY_STEPS) : next;
}

export const useImportSheetStore = create<ImportSheetState>((set, get) => ({
  step: 1,
  fileName: '',
  sourceFormat: 'XLSX',
  detectedEncoding: 'xlsx',
  encodingOverride: 'auto',
  rawBuffer: null,
  rawHeaders: [],
  rawRows: [],
  columnMappings: [],

  rows: [],
  existingCidMap: new Map(),
  past: [],
  future: [],

  mode: 'UPSERT',
  autoProvision: true,
  skipRedRows: false,
  showErrorsOnly: false,
  searchQuery: '',
  activeCell: null,
  commitResult: null,

  setStep: (step) => set({ step }),

  setParsedTable: ({
    fileName,
    sourceFormat,
    detectedEncoding,
    headers,
    rows,
    mappings,
    rawBuffer = null,
    encodingOverride = 'auto',
  }) =>
    set({
      fileName,
      sourceFormat,
      detectedEncoding,
      encodingOverride,
      rawBuffer,
      rawHeaders: headers,
      rawRows: rows,
      columnMappings: mappings,
      rows: [],
      past: [],
      future: [],
      commitResult: null,
      step: 2,
    }),

  updateColumnMapping: (sourceIndex, targetKey) =>
    set((state) => ({
      columnMappings: state.columnMappings.map((entry) => {
        if (entry.sourceIndex === sourceIndex) {
          return { ...entry, targetKey };
        }
        // Prevent duplicate target assignment
        if (targetKey && entry.targetKey === targetKey) {
          return { ...entry, targetKey: null };
        }
        return entry;
      }),
    })),

  buildAndValidateStaging: (ctx, existingMap) => {
    const state = get();
    const cidMap = existingMap ?? state.existingCidMap;
    const rawStaging = buildStagingRowsFromMapping(state.rawRows, state.columnMappings);
    const validated = validateAllStagingRows(rawStaging, {
      ...ctx,
      mode: state.mode,
      existingCidMap: cidMap,
    });
    set({
      existingCidMap: cidMap,
      rows: validated,
      past: [],
      future: [],
      step: 3,
      activeCell: validated[0] ? { rowId: validated[0].rowId, colKey: 'cid' } : null,
    });
  },

  setExistingCidMap: (map, ctx) => {
    const state = get();
    const validated = validateAllStagingRows(state.rows, {
      ...ctx,
      mode: state.mode,
      existingCidMap: map,
    });
    set({ existingCidMap: map, rows: validated });
  },

  revalidateAll: (ctx) => {
    const state = get();
    const validated = validateAllStagingRows(state.rows, {
      ...ctx,
      mode: state.mode,
      existingCidMap: state.existingCidMap,
    });
    set({ rows: validated });
  },

  setCellValue: (rowId, colKey, value, ctx) => {
    const state = get();
    const prevSnapshot = state.rows;
    const updated = state.rows.map((row) =>
      row.rowId === rowId ? { ...row, cells: { ...row.cells, [colKey]: value } } : row
    );
    const validated = validateAllStagingRows(updated, {
      ...ctx,
      mode: state.mode,
      existingCidMap: state.existingCidMap,
    });
    set({
      rows: validated,
      past: pushHistory(state.past, prevSnapshot),
      future: [],
    });
  },

  setRowCellsBatch: (rowId, patch, ctx) => {
    const state = get();
    const prevSnapshot = state.rows;
    const updated = state.rows.map((row) =>
      row.rowId === rowId ? { ...row, cells: { ...row.cells, ...patch } } : row
    );
    const validated = validateAllStagingRows(updated, {
      ...ctx,
      mode: state.mode,
      existingCidMap: state.existingCidMap,
    });
    set({
      rows: validated,
      past: pushHistory(state.past, prevSnapshot),
      future: [],
    });
  },

  bulkReplaceColumnValue: (colKey, fromValue, toValue, ctx) => {
    const state = get();
    const prevSnapshot = state.rows;
    let count = 0;
    const targetFrom = fromValue.trim();
    const updated = state.rows.map((row) => {
      if (row.cells[colKey].trim() === targetFrom) {
        count += 1;
        return { ...row, cells: { ...row.cells, [colKey]: toValue } };
      }
      return row;
    });
    if (count === 0) return 0;
    const validated = validateAllStagingRows(updated, {
      ...ctx,
      mode: state.mode,
      existingCidMap: state.existingCidMap,
    });
    set({
      rows: validated,
      past: pushHistory(state.past, prevSnapshot),
      future: [],
    });
    return count;
  },

  fillDownColumn: (fromRowId, colKey, count, ctx) => {
    const state = get();
    const startIdx = state.rows.findIndex((r) => r.rowId === fromRowId);
    if (startIdx < 0 || count <= 0) return;
    const sourceValue = state.rows[startIdx].cells[colKey];
    const prevSnapshot = state.rows;
    const updated = state.rows.map((row, idx) => {
      if (idx > startIdx && idx <= startIdx + count) {
        return { ...row, cells: { ...row.cells, [colKey]: sourceValue } };
      }
      return row;
    });
    const validated = validateAllStagingRows(updated, {
      ...ctx,
      mode: state.mode,
      existingCidMap: state.existingCidMap,
    });
    set({
      rows: validated,
      past: pushHistory(state.past, prevSnapshot),
      future: [],
    });
  },

  applyAllAutoFixes: (ctx) => {
    const state = get();
    const prevSnapshot = state.rows;
    let fixed = 0;
    const updated = state.rows.map((row) => {
      let changed = false;
      const nextCells = { ...row.cells };
      for (const [key, res] of Object.entries(row.validations)) {
        const colKey = key as ImportColumnKey;
        if (res?.status === 'WARNING' && res.normalizedValue && nextCells[colKey] !== res.normalizedValue) {
          nextCells[colKey] = res.normalizedValue;
          changed = true;
          fixed += 1;
        }
      }
      return changed ? { ...row, cells: nextCells } : row;
    });
    if (fixed === 0) return 0;
    const validated = validateAllStagingRows(updated, {
      ...ctx,
      mode: state.mode,
      existingCidMap: state.existingCidMap,
    });
    set({
      rows: validated,
      past: pushHistory(state.past, prevSnapshot),
      future: [],
    });
    return fixed;
  },

  deleteRow: (rowId, ctx) => {
    const state = get();
    const prevSnapshot = state.rows;
    const remaining = state.rows.filter((r) => r.rowId !== rowId);
    const validated = validateAllStagingRows(remaining, {
      ...ctx,
      mode: state.mode,
      existingCidMap: state.existingCidMap,
    });
    set({
      rows: validated,
      past: pushHistory(state.past, prevSnapshot),
      future: [],
    });
  },

  toggleRowSelection: (rowId) =>
    set((state) => ({
      rows: state.rows.map((r) => (r.rowId === rowId ? { ...r, selected: !r.selected } : r)),
    })),

  toggleAllSelection: (selected) =>
    set((state) => ({
      rows: state.rows.map((r) => ({ ...r, selected })),
    })),

  undo: () =>
    set((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        rows: previous,
        past: state.past.slice(0, -1),
        future: [state.rows, ...state.future].slice(0, MAX_HISTORY_STEPS),
      };
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        rows: next,
        past: pushHistory(state.past, state.rows),
        future: state.future.slice(1),
      };
    }),

  setMode: (mode, ctx) => {
    set({ mode });
    if (ctx) {
      const state = get();
      const validated = validateAllStagingRows(state.rows, {
        ...ctx,
        mode,
        existingCidMap: state.existingCidMap,
      });
      set({ rows: validated });
    }
  },

  setAutoProvision: (autoProvision) => set({ autoProvision }),
  setSkipRedRows: (skipRedRows) => set({ skipRedRows }),
  setShowErrorsOnly: (showErrorsOnly) => set({ showErrorsOnly }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveCell: (activeCell) => set({ activeCell }),
  setCommitResult: (commitResult) => set({ commitResult }),

  resetAll: () =>
    set({
      step: 1,
      fileName: '',
      sourceFormat: 'XLSX',
      detectedEncoding: 'xlsx',
      encodingOverride: 'auto',
      rawBuffer: null,
      rawHeaders: [],
      rawRows: [],
      columnMappings: [],
      rows: [],
      existingCidMap: new Map(),
      past: [],
      future: [],
      skipRedRows: false,
      showErrorsOnly: false,
      searchQuery: '',
      activeCell: null,
      commitResult: null,
    }),
}));

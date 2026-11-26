import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImportSheetStore } from '@/stores/useImportSheetStore';
import { RelationalHierarchyIndex } from '@/features/import-grid/RelationalHierarchyIndex';
import type { MasterDataBundle } from '@/types/domain.types';

function makeValidCid(idx: number): string {
  const base = String(110070001000 + idx).padStart(12, '0');
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(base[i]) * (13 - i);
  const check = (11 - (sum % 11)) % 10;
  return `${base}${check}`;
}

const mockMaster: MasterDataBundle = {
  categories: [],
  items: [],
  itemsByCategoryCode: {
    PREFIX: [
      {
        id: 'p1',
        category_id: 'c1',
        code: 'MR',
        name_th: 'นาย',
        short_name: 'น.',
        color_hex: null,
        rank_order: 1,
        is_default: false,
        allows_account_provision: true,
        is_approver: false,
        sort_order: 1,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ],
  },
  orgUnitLevels: [],
  orgUnits: [],
  positionTypes: [
    { id: 'pt1', code: 'PRO', name_th: 'วิชาการ', color_hex: null, sort_order: 1, is_active: true, created_at: '', updated_at: '' },
  ],
  positions: [
    { id: 'pos1', position_type_id: 'pt1', name_th: 'เจ้าพนักงานเทศกิจ', requires_level: false, sort_order: 1, is_active: true, created_at: '', updated_at: '' },
  ],
  positionLevels: [],
  positionAllowedLevels: [],
};

describe('useImportSheetStore (PDPA RAM-Only + Undo/Redo + Bulk Replace)', () => {
  const index = new RelationalHierarchyIndex(mockMaster);
  const ctx = { index, isSuperAdmin: true, adminScope: null };

  beforeEach(() => {
    useImportSheetStore.getState().resetAll();
  });

  it('NEVER writes staged personnel rows or CIDs to localStorage or sessionStorage (PDPA RAM-Only)', () => {
    const lsSpy = vi.spyOn(Storage.prototype, 'setItem');
    const store = useImportSheetStore.getState();

    store.setParsedTable({
      fileName: 'test.csv',
      sourceFormat: 'CSV',
      detectedEncoding: 'utf-8',
      headers: ['cid', 'first_name', 'last_name', 'prefix_id', 'phone_number', 'birth_date'],
      rows: [[makeValidCid(1), 'สมชาย', 'ใจดี', 'น.', '812345678', '15/05/1987']],
      mappings: [
        { sourceHeader: 'cid', sourceIndex: 0, targetKey: 'cid' },
        { sourceHeader: 'first_name', sourceIndex: 1, targetKey: 'first_name' },
        { sourceHeader: 'last_name', sourceIndex: 2, targetKey: 'last_name' },
        { sourceHeader: 'prefix_id', sourceIndex: 3, targetKey: 'prefix_id' },
        { sourceHeader: 'phone_number', sourceIndex: 4, targetKey: 'phone_number' },
        { sourceHeader: 'birth_date', sourceIndex: 5, targetKey: 'birth_date' },
      ],
    });
    useImportSheetStore.getState().buildAndValidateStaging(ctx);

    expect(useImportSheetStore.getState().rows).toHaveLength(1);
    expect(lsSpy).not.toHaveBeenCalled();
    lsSpy.mockRestore();
  });

  it('supports bulkReplaceColumnValue, applyAllAutoFixes, and 50-step Undo/Redo stack', () => {
    const store = useImportSheetStore.getState();
    store.setParsedTable({
      fileName: 'bulk.xlsx',
      sourceFormat: 'XLSX',
      detectedEncoding: 'xlsx',
      headers: ['cid', 'first_name', 'last_name', 'position_type_id', 'position_id', 'phone_number'],
      rows: [
        [makeValidCid(2), 'ก', 'ข', 'วิชาการ', 'จนท.เทศกิจ', '812345678'],
        [makeValidCid(3), 'ค', 'ง', 'วิชาการ', 'จนท.เทศกิจ', '891112222'],
      ],
      mappings: [
        { sourceHeader: 'cid', sourceIndex: 0, targetKey: 'cid' },
        { sourceHeader: 'first_name', sourceIndex: 1, targetKey: 'first_name' },
        { sourceHeader: 'last_name', sourceIndex: 2, targetKey: 'last_name' },
        { sourceHeader: 'position_type_id', sourceIndex: 3, targetKey: 'position_type_id' },
        { sourceHeader: 'position_id', sourceIndex: 4, targetKey: 'position_id' },
        { sourceHeader: 'phone_number', sourceIndex: 5, targetKey: 'phone_number' },
      ],
    });
    useImportSheetStore.getState().buildAndValidateStaging(ctx);

    // Initially 2 red rows due to typo "จนท.เทศกิจ"
    expect(useImportSheetStore.getState().rows.every((r) => r.errorCount > 0)).toBe(true);

    // Bulk replace typo across entire column
    const replaced = useImportSheetStore
      .getState()
      .bulkReplaceColumnValue('position_id', 'จนท.เทศกิจ', 'เจ้าพนักงานเทศกิจ', ctx);
    expect(replaced).toBe(2);
    expect(useImportSheetStore.getState().rows.every((r) => r.errorCount === 0)).toBe(true);

    // Apply yellow auto-fixes (phone leading zero)
    const autoFixed = useImportSheetStore.getState().applyAllAutoFixes(ctx);
    expect(autoFixed).toBe(2);
    expect(useImportSheetStore.getState().rows[0].cells.phone_number).toBe('0812345678');

    // Undo restores before auto-fix, Redo re-applies it
    useImportSheetStore.getState().undo();
    expect(useImportSheetStore.getState().rows[0].cells.phone_number).toBe('812345678');
    useImportSheetStore.getState().redo();
    expect(useImportSheetStore.getState().rows[0].cells.phone_number).toBe('0812345678');

    // Stress-test history cap at 50 steps
    const firstRowId = useImportSheetStore.getState().rows[0].rowId;
    for (let i = 0; i < 60; i += 1) {
      useImportSheetStore.getState().setCellValue(firstRowId, 'first_name', `ชื่อ${i}`, ctx);
    }
    expect(useImportSheetStore.getState().past.length).toBeLessThanOrEqual(50);
  });
});

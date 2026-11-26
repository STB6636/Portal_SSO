import { describe, expect, it } from 'vitest';
import { RelationalHierarchyIndex } from '@/features/import-grid/RelationalHierarchyIndex';
import { validateAllStagingRows } from '@/features/import-grid/StagingValidationEngine';
import { createEmptyCells } from '@/features/import-grid/importColumnsConfig';
import type { MasterDataBundle } from '@/types/domain.types';
import type { StagingRow } from '@/types/import.types';

function makeValidCid(idx: number): string {
  const base = String(110070000000 + idx).padStart(12, '0');
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(base[i]) * (13 - i);
  const check = (11 - (sum % 11)) % 10;
  return `${base}${check}`;
}

function buildMockMaster(): MasterDataBundle {
  const now = '2026-01-01T00:00:00Z';
  return {
    categories: [],
    items: [],
    itemsByCategoryCode: {
      PREFIX: [
        {
          id: 'pref-mr',
          category_id: 'cat-prefix',
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
          created_at: now,
          updated_at: now,
        },
      ],
      PERSONNEL_STATUS: [
        {
          id: 'st-active',
          category_id: 'cat-status',
          code: 'ACTIVE',
          name_th: 'ปฏิบัติงานปกติ',
          short_name: null,
          color_hex: '#00744B',
          rank_order: 1,
          is_default: true,
          allows_account_provision: true,
          is_approver: false,
          sort_order: 1,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      ],
    },
    orgUnitLevels: [
      { id: 'lv1', level_no: 1, code: 'BUREAU', name_th: 'สำนัก', updated_at: now },
      { id: 'lv2', level_no: 2, code: 'OFFICE', name_th: 'สำนักงาน/กอง', updated_at: now },
      { id: 'lv3', level_no: 3, code: 'DEPARTMENT', name_th: 'ส่วน/ฝ่าย', updated_at: now },
      { id: 'lv4', level_no: 4, code: 'DIVISION', name_th: 'กลุ่มงาน', updated_at: now },
    ],
    orgUnits: [
      { id: 'b-1', level_id: 'lv1', level_no: 1, parent_id: null, code: 'STB', name_th: 'สำนักเทศกิจ', short_name: 'สนท.', sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'o-sec', level_id: 'lv2', level_no: 2, parent_id: 'b-1', code: 'SEC', name_th: 'สำนักงานเลขานุการ', short_name: null, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'o-law', level_id: 'lv2', level_no: 2, parent_id: 'b-1', code: 'LAW', name_th: 'สำนักงานตรวจและบังคับการ', short_name: null, sort_order: 2, is_active: true, created_at: now, updated_at: now },
      // Duplicate department name "ฝ่ายบริหารงานทั่วไป" under TWO DIFFERENT offices!
      { id: 'd-sec-gen', level_id: 'lv3', level_no: 3, parent_id: 'o-sec', code: null, name_th: 'ฝ่ายบริหารงานทั่วไป', short_name: null, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'd-law-gen', level_id: 'lv3', level_no: 3, parent_id: 'o-law', code: null, name_th: 'ฝ่ายบริหารงานทั่วไป', short_name: null, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      // Unique department name under o-law for 1-click parent auto-fill test
      { id: 'd-law-patrol', level_id: 'lv3', level_no: 3, parent_id: 'o-law', code: null, name_th: 'ส่วนตรวจการ', short_name: null, sort_order: 2, is_active: true, created_at: now, updated_at: now },
    ],
    positionTypes: [
      { id: 'pt-pro', code: 'PRO', name_th: 'วิชาการ', color_hex: '#00744B', sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'pt-emp', code: 'EMP', name_th: 'ลูกจ้างประจำ', color_hex: '#64748B', sort_order: 2, is_active: true, created_at: now, updated_at: now },
    ],
    positions: [
      { id: 'pos-com', position_type_id: 'pt-pro', name_th: 'นักวิชาการคอมพิวเตอร์', requires_level: true, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'pos-drv', position_type_id: 'pt-emp', name_th: 'พนักงานขับรถยนต์', requires_level: false, sort_order: 2, is_active: true, created_at: now, updated_at: now },
    ],
    positionLevels: [
      { id: 'pl-op', code: 'K1', name_th: 'ปฏิบัติการ', rank_order: 1, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'pl-sr', code: 'K2', name_th: 'ชำนาญการ', rank_order: 2, sort_order: 2, is_active: true, created_at: now, updated_at: now },
      { id: 'pl-exec', code: 'M2', name_th: 'อำนวยการสูง', rank_order: 10, sort_order: 10, is_active: true, created_at: now, updated_at: now },
    ],
    positionAllowedLevels: [
      { position_id: 'pos-com', position_level_id: 'pl-op' },
      { position_id: 'pos-com', position_level_id: 'pl-sr' },
    ],
  };
}

function makeRow(idx: number, overrides: Partial<Record<keyof StagingRow['cells'], string>>): StagingRow {
  return {
    rowId: `r-${idx}`,
    sheetRowNo: idx + 2,
    selected: true,
    cells: {
      ...createEmptyCells(),
      cid: makeValidCid(idx),
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      ...overrides,
    },
    resolved: {},
    validations: {},
    rowStatus: 'NEW',
    errorCount: 0,
    warningCount: 0,
  };
}

describe('RelationalHierarchyIndex & StagingValidationEngine', () => {
  const master = buildMockMaster();
  const index = new RelationalHierarchyIndex(master);

  it('resolves duplicate department names across offices via Composite Key (parent_office_id, normalized_name)', () => {
    const rows = [
      makeRow(1, { office_id: 'สำนักงานเลขานุการ', department_id: 'ฝ่ายบริหารงานทั่วไป' }),
      makeRow(2, { office_id: 'สำนักงานตรวจและบังคับการ', department_id: 'ฝ่ายบริหารงานทั่วไป' }),
    ];
    const validated = validateAllStagingRows(rows, {
      index,
      mode: 'UPSERT',
      existingCidMap: new Map(),
      isSuperAdmin: true,
      adminScope: null,
    });

    expect(validated[0].errorCount).toBe(0);
    expect(validated[1].errorCount).toBe(0);
    expect(validated[0].resolved.bureau_id).toBe('b-1'); // auto-filled single bureau
    expect(validated[0].resolved.department_id).toBe('d-sec-gen');
    expect(validated[1].resolved.department_id).toBe('d-law-gen');
  });

  it('provides 1-click parent auto-fill when child department has a unique parent, and blocks when ambiguous', () => {
    const rows = [
      makeRow(10, { office_id: '', department_id: 'ส่วนตรวจการ' }), // unique under สำนักงานตรวจและบังคับการ
      makeRow(11, { office_id: '', department_id: 'ฝ่ายบริหารงานทั่วไป' }), // ambiguous across 2 offices
    ];
    const validated = validateAllStagingRows(rows, {
      index,
      mode: 'UPSERT',
      existingCidMap: new Map(),
      isSuperAdmin: true,
      adminScope: null,
    });

    expect(validated[0].validations.department_id?.code).toBe('PARENT_REQUIRED');
    expect(validated[0].validations.department_id?.autoFillParentName).toBe('สำนักงานตรวจและบังคับการ');

    expect(validated[1].validations.department_id?.code).toBe('PARENT_REQUIRED');
    expect(validated[1].validations.department_id?.autoFillParentName).toBeUndefined();
  });

  it('enforces 3-level position cascade and requires_level flag', () => {
    const rows = [
      makeRow(20, { position_type_id: 'วิชาการ', position_id: 'นักวิชาการคอมพิวเตอร์', position_level_id: '' }), // missing level
      makeRow(21, { position_type_id: 'วิชาการ', position_id: 'นักวิชาการคอมพิวเตอร์', position_level_id: 'อำนวยการสูง' }), // disallowed level
      makeRow(22, { position_type_id: 'ลูกจ้างประจำ', position_id: 'พนักงานขับรถยนต์', position_level_id: 'ปฏิบัติการ' }), // level not allowed when requires_level=false
      makeRow(23, { position_type_id: 'วิชาการ', position_id: 'นักวิชาการคอมพิวเตอร์', position_level_id: 'ชำนาญการ' }), // valid
    ];
    const validated = validateAllStagingRows(rows, {
      index,
      mode: 'UPSERT',
      existingCidMap: new Map(),
      isSuperAdmin: true,
      adminScope: null,
    });

    expect(validated[0].validations.position_level_id?.code).toBe('LEVEL_REQUIRED');
    expect(validated[1].validations.position_level_id?.code).toBe('LEVEL_NOT_ALLOWED_FOR_POSITION');
    expect(validated[2].validations.position_level_id?.code).toBe('LEVEL_NOT_ALLOWED_WHEN_NOT_REQUIRED');
    expect(validated[3].errorCount).toBe(0);
    expect(validated[3].resolved.position_level_id).toBe('pl-sr');
  });

  it('blocks rows outside assigned Lv2 Office Admin scope (OUT_OF_ADMIN_SCOPE)', () => {
    const rows = [
      makeRow(30, { office_id: 'สำนักงานเลขานุการ', department_id: 'ฝ่ายบริหารงานทั่วไป' }),
      makeRow(31, { office_id: 'สำนักงานตรวจและบังคับการ', department_id: 'ส่วนตรวจการ' }),
    ];
    const validated = validateAllStagingRows(rows, {
      index,
      mode: 'UPSERT',
      existingCidMap: new Map(),
      isSuperAdmin: false,
      adminScope: {
        scope_level_no: 2,
        org_unit_id: 'o-sec',
        org_unit_name: 'สำนักงานเลขานุการ',
      },
    });

    expect(validated[0].errorCount).toBe(0);
    expect(validated[1].validations.office_id?.code).toBe('OUT_OF_ADMIN_SCOPE');
  });

  it('validates 2,000 staging rows in-memory rapidly (< 250ms budget)', () => {
    const bulkRows: StagingRow[] = [];
    for (let i = 1; i <= 2000; i += 1) {
      bulkRows.push(
        makeRow(i, {
          prefix_id: 'นาย',
          position_type_id: 'วิชาการ',
          position_id: 'นักวิชาการคอมพิวเตอร์',
          position_level_id: 'ชำนาญการ',
          bureau_id: 'สำนักเทศกิจ',
          office_id: i % 2 === 0 ? 'สำนักงานเลขานุการ' : 'สำนักงานตรวจและบังคับการ',
          department_id: 'ฝ่ายบริหารงานทั่วไป',
        })
      );
    }

    const t0 = performance.now();
    const validated = validateAllStagingRows(bulkRows, {
      index,
      mode: 'UPSERT',
      existingCidMap: new Map(),
      isSuperAdmin: true,
      adminScope: null,
    });
    const elapsedMs = performance.now() - t0;

    expect(validated).toHaveLength(2000);
    expect(validated.every((r) => r.errorCount === 0)).toBe(true);
    expect(elapsedMs).toBeLessThan(250);
  });

  it('preserves System Settings sort_order for allowed levels and auto-derives start_service_year_be from start_service_date', () => {
    const unsortedMaster = buildMockMaster();
    // Reverse allowed level junction order intentionally -> index MUST still return sorted by sort_order
    unsortedMaster.positionAllowedLevels = [
      { position_id: 'pos-com', position_level_id: 'pl-sr' },
      { position_id: 'pos-com', position_level_id: 'pl-op' },
    ];
    const sortedIndex = new RelationalHierarchyIndex(unsortedMaster);
    expect(sortedIndex.getAllowedLevelOptions('pos-com')).toEqual(['ปฏิบัติการ', 'ชำนาญการ']);

    const rows = [
      makeRow(99, { start_service_date: '01/10/2558', start_service_year_be: '2560' }), // mismatched year -> auto-derived 2558
    ];
    const validated = validateAllStagingRows(rows, {
      index: sortedIndex,
      mode: 'UPSERT',
      existingCidMap: new Map(),
      isSuperAdmin: true,
      adminScope: null,
    });
    expect(validated[0].errorCount).toBe(0);
    expect(validated[0].resolved.start_service_year_be).toBe(2558);
    expect(validated[0].validations.start_service_year_be?.code).toBe('AUTO_FIXED_SERVICE_YEAR');
  });
});

import { describe, expect, it } from 'vitest';
import { formatDatabaseError } from '@/lib/pgErrorHelpers';
import { validateCid } from '@/lib/cidValidator';
import { buildLiveExampleRow } from '@/features/import-grid/DynamicExcelTemplateBuilder';
import { RelationalHierarchyIndex } from '@/features/import-grid/RelationalHierarchyIndex';
import { validateAllStagingRows } from '@/features/import-grid/StagingValidationEngine';
import { IMPORT_COLUMNS, createEmptyCells } from '@/features/import-grid/importColumnsConfig';
import type { MasterDataBundle } from '@/types/domain.types';
import type { StagingRow } from '@/types/import.types';

describe('pgErrorHelpers & Zero-Hardcode Template Self-Import', () => {
  it('translates Postgres SQLSTATE & RPC errors to actionable Thai messages', () => {
    expect(formatDatabaseError({ code: '23505', message: 'duplicate key value violates unique constraint "personnel_cid_key"' })).toContain('เลขประจำตัวประชาชน');
    expect(formatDatabaseError({ code: '23503', message: 'update or delete violates foreign key constraint still referenced' })).toContain('ไม่สามารถลบรายการนี้ได้');
    expect(formatDatabaseError({ code: '23514', message: 'check constraint received_year_be' })).toContain('2450');
    expect(formatDatabaseError({ code: '22P02', message: 'invalid input syntax for type uuid' })).toContain('UUID');
    expect(formatDatabaseError(new Error('OUT_OF_ADMIN_SCOPE: Target org unit is outside'))).toContain('นอกขอบเขต');
    expect(formatDatabaseError(new Error('REQUIRED_NAME: missing'))).toContain('ชื่อจริงและนามสกุล');
    expect(formatDatabaseError(new Error('MULTIPLE_ACTIVE_POSITION_HISTORY: dup'))).toContain('เว้นว่างวันสิ้นสุด');
    expect(formatDatabaseError(new Error('EXECUTIVE_DUTY_NOT_EXECUTIVE_TYPE: bad'))).toContain('ประเภทบริหาร');
    expect(formatDatabaseError({ code: '23505', message: 'duplicate key value violates unique constraint "ux_pos_history_one_latest"' })).toContain('ตำแหน่งล่าสุด');
    expect(formatDatabaseError({ code: '23505', message: 'duplicate key value violates unique constraint "ux_pos_history_one_initial"' })).toContain('ตำแหน่งแรกบรรจุ');
  });

  it('strips leading Excel text-escape apostrophe from CID', () => {
    // 1100701234565 -> compute valid check digit
    const base = '110070123456';
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += Number(base[i]) * (13 - i);
    const validCid = `${base}${(11 - (sum % 11)) % 10}`;

    const res = validateCid(`'${validCid}`);
    expect(res.valid).toBe(true);
    expect(res.normalized).toBe(validCid);
  });

  it('builds a live example row from MasterDataBundle that passes StagingValidationEngine with 0 errors', () => {
    const now = '2026-01-01T00:00:00Z';
    const master: MasterDataBundle = {
      categories: [],
      items: [],
      itemsByCategoryCode: {
        PREFIX: [{ id: 'p1', category_id: 'c1', code: 'MR', name_th: 'นาย', short_name: 'นาย', color_hex: null, rank_order: 0, is_default: true, allows_account_provision: true, is_approver: false, sort_order: 1, is_active: true, created_at: now, updated_at: now }],
        GENDER: [{ id: 'g1', category_id: 'c2', code: 'MALE', name_th: 'ชาย', short_name: 'ช', color_hex: null, rank_order: 0, is_default: false, allows_account_provision: true, is_approver: false, sort_order: 1, is_active: true, created_at: now, updated_at: now }],
        EMPLOYMENT_TYPE: [{ id: 'e1', category_id: 'c3', code: 'CS', name_th: 'ข้าราชการกรุงเทพมหานครสามัญ', short_name: null, color_hex: null, rank_order: 0, is_default: true, allows_account_provision: true, is_approver: false, sort_order: 1, is_active: true, created_at: now, updated_at: now }],
        APPROVAL_TIER: [{ id: 'a1', category_id: 'c4', code: 'NONE', name_th: 'ไม่มีอำนาจลงนาม', short_name: null, color_hex: null, rank_order: 0, is_default: true, allows_account_provision: true, is_approver: false, sort_order: 1, is_active: true, created_at: now, updated_at: now }],
        PERSONNEL_STATUS: [{ id: 's1', category_id: 'c5', code: 'ACTIVE', name_th: 'ปฏิบัติราชการ', short_name: null, color_hex: '#00744B', rank_order: 0, is_default: true, allows_account_provision: true, is_approver: false, sort_order: 1, is_active: true, created_at: now, updated_at: now }],
      },
      orgUnitLevels: [
        { id: 'l1', level_no: 1, code: 'BUREAU', name_th: 'สำนัก', updated_at: now },
        { id: 'l2', level_no: 2, code: 'OFFICE', name_th: 'สำนักงาน/กอง', updated_at: now },
        { id: 'l3', level_no: 3, code: 'DEPARTMENT', name_th: 'ส่วน/ฝ่าย', updated_at: now },
        { id: 'l4', level_no: 4, code: 'DIVISION', name_th: 'กลุ่มงาน', updated_at: now },
      ],
      orgUnits: [
        { id: 'b1', level_id: 'l1', level_no: 1, parent_id: null, code: 'STB', name_th: 'สำนักเทศกิจ', short_name: null, sort_order: 1, is_active: true, created_at: now, updated_at: now },
        { id: 'o1', level_id: 'l2', level_no: 2, parent_id: 'b1', code: 'SEC', name_th: 'สำนักงานเลขานุการ', short_name: null, sort_order: 1, is_active: true, created_at: now, updated_at: now },
        { id: 'd1', level_id: 'l3', level_no: 3, parent_id: 'o1', code: null, name_th: 'ฝ่ายบริหารงานทั่วไป', short_name: null, sort_order: 1, is_active: true, created_at: now, updated_at: now },
        { id: 'v1', level_id: 'l4', level_no: 4, parent_id: 'd1', code: null, name_th: 'งานสารบรรณ', short_name: null, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      ],
      positionTypes: [{ id: 'pt1', code: 'ACADEMIC', name_th: 'ประเภทวิชาการ', color_hex: '#00744B', sort_order: 1, is_active: true, created_at: now, updated_at: now }],
      positions: [{ id: 'pos1', position_type_id: 'pt1', name_th: 'นักวิชาการคอมพิวเตอร์', requires_level: true, sort_order: 1, is_active: true, created_at: now, updated_at: now }],
      positionLevels: [{ id: 'pl1', code: 'K2', name_th: 'ชำนาญการ', rank_order: 50, sort_order: 1, is_active: true, created_at: now, updated_at: now }],
      positionAllowedLevels: [{ position_id: 'pos1', position_level_id: 'pl1' }],
    };

    expect(IMPORT_COLUMNS).toHaveLength(27);
    expect(IMPORT_COLUMNS.find((c) => c.key === 'cid')?.excelCol).toBe('A');
    expect(IMPORT_COLUMNS.find((c) => c.key === 'status_id')?.excelCol).toBe('Z');
    expect(IMPORT_COLUMNS.find((c) => c.key === 'email')?.excelCol).toBe('AA');
    expect(IMPORT_COLUMNS.find((c) => c.key === 'secondary_position')?.labelTh).toBe('ปฏิบัติราชการแทน');

    const example = buildLiveExampleRow(master, null, true);
    expect(example.position_type_id).toBe('ประเภทวิชาการ');
    expect(example.approval_tier_id).toBe('ไม่มีอำนาจลงนาม');
    expect(example.status_id).toBe('ปฏิบัติราชการ');
    expect(example.division_id).toBe('งานสารบรรณ');

    // Compute valid CID for self-import test
    const base = '110070123456';
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += Number(base[i]) * (13 - i);
    example.cid = `${base}${(11 - (sum % 11)) % 10}`;

    const row: StagingRow = {
      rowId: 'r1',
      sheetRowNo: 2,
      selected: true,
      cells: { ...createEmptyCells(), ...example },
      resolved: {},
      validations: {},
      rowStatus: 'NEW',
      errorCount: 0,
      warningCount: 0,
    };

    const index = new RelationalHierarchyIndex(master);
    const validated = validateAllStagingRows([row], {
      index,
      mode: 'UPSERT',
      existingCidMap: new Map(),
      isSuperAdmin: true,
      adminScope: null,
    });
    expect(validated[0].errorCount).toBe(0);
    expect(validated[0].resolved.division_id).toBe('v1');
  });
});

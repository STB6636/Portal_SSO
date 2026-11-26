import { describe, expect, it } from 'vitest';
import {
  compareLookupCategories,
  compareLookupItems,
  compareOrgUnits,
  comparePositionLevels,
  comparePositions,
  comparePositionTypes,
  createPersonnelHierarchyComparator,
  flattenOrgUnitsInTreeOrder,
  resolveOrgUnitAncestors,
  sortAllowedLevels,
  sortMasterDataBundle,
} from '@/lib/masterDataSort';
import type {
  LookupCategoryRow,
  LookupItemRow,
  OrgUnitRow,
  PositionLevelRow,
  PositionRow,
  PositionTypeRow,
} from '@/types/database.types';
import type { MasterDataBundle } from '@/types/domain.types';

const NOW = '2026-01-01T00:00:00Z';

function makeCat(id: string, name_th: string, sort_order: number): LookupCategoryRow {
  return {
    id,
    code: id.toUpperCase(),
    name_th,
    description: null,
    has_provision_flag: false,
    has_approver_flag: false,
    is_system_locked: true,
    sort_order,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

function makeLookup(id: string, name_th: string, sort_order: number, rank_order = 0): LookupItemRow {
  return {
    id,
    category_id: 'cat-1',
    code: id.toUpperCase(),
    name_th,
    short_name: null,
    color_hex: null,
    rank_order,
    is_default: false,
    allows_account_provision: true,
    is_approver: false,
    sort_order,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

function makeOrg(
  id: string,
  level_no: 1 | 2 | 3 | 4,
  parent_id: string | null,
  name_th: string,
  sort_order: number,
  is_active = true
): OrgUnitRow {
  return {
    id,
    level_id: `lv${level_no}`,
    level_no,
    parent_id,
    code: id.toUpperCase(),
    name_th,
    short_name: null,
    sort_order,
    is_active,
    created_at: NOW,
    updated_at: NOW,
  };
}

function makePosType(id: string, name_th: string, sort_order: number): PositionTypeRow {
  return {
    id,
    code: id.toUpperCase(),
    name_th,
    color_hex: '#00744B',
    sort_order,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

function makePos(id: string, name_th: string, sort_order: number): PositionRow {
  return {
    id,
    position_type_id: 'pt1',
    name_th,
    requires_level: true,
    sort_order,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

function makeLevel(id: string, name_th: string, sort_order: number, rank_order: number): PositionLevelRow {
  return {
    id,
    code: id.toUpperCase(),
    name_th,
    rank_order,
    sort_order,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

describe('masterDataSort canonical comparators & tree helpers', () => {
  it('sorts lookup categories and items strictly by sort_order -> rank_order -> name_th', () => {
    const items = [
      makeLookup('c', 'นางสาว', 3, 0),
      makeLookup('a', 'นาย', 1, 0),
      makeLookup('b2', 'ว่าที่ ร.ต.', 2, 2),
      makeLookup('b1', 'นาง', 2, 1),
    ];
    expect(items.sort(compareLookupItems).map((i) => i.id)).toEqual(['a', 'b1', 'b2', 'c']);

    const cats = [makeCat('gender', 'เพศ', 2), makeCat('prefix', 'คำนำหน้า', 1), makeCat('status', 'สถานะ', 2)];
    expect(cats.sort(compareLookupCategories).map((c) => c.name_th)).toEqual(['คำนำหน้า', 'เพศ', 'สถานะ']);
  });

  it('sorts position types, positions, and position levels consistently (including allowedLevels)', () => {
    const pts = [
      makePosType('acad', 'วิชาการ', 3),
      makePosType('exec', 'บริหาร', 1),
      makePosType('mgr', 'อำนวยการ', 2),
    ];
    expect(pts.sort(comparePositionTypes).map((x) => x.name_th)).toEqual(['บริหาร', 'อำนวยการ', 'วิชาการ']);

    const positions = [
      makePos('p2', 'รองผู้อำนวยการสำนัก', 2),
      makePos('p1', 'ผู้อำนวยการสำนัก', 1),
    ];
    expect(positions.sort(comparePositions).map((x) => x.name_th)).toEqual([
      'ผู้อำนวยการสำนัก',
      'รองผู้อำนวยการสำนัก',
    ]);

    const levels = [
      makeLevel('k3', 'ชำนาญการพิเศษ', 3, 60),
      makeLevel('k1', 'ปฏิบัติการ', 1, 40),
      makeLevel('k2', 'ชำนาญการ', 2, 50),
    ];
    expect([...levels].sort(comparePositionLevels).map((l) => l.id)).toEqual(['k1', 'k2', 'k3']);
    expect(sortAllowedLevels(levels, new Set(['k3', 'k1'])).map((l) => l.id)).toEqual(['k1', 'k3']);
  });

  it('flattens org units in parent-first tree order respecting sort_order at every depth and resolves ancestors', () => {
    const orgs: OrgUnitRow[] = [
      makeOrg('d2', 3, 'o1', 'ฝ่ายการคลัง', 2),
      makeOrg('v1', 4, 'd1', 'กลุ่มงานสารบรรณ', 1),
      makeOrg('o2', 2, 'b1', 'สำนักงานตรวจและบังคับการ', 2),
      makeOrg('b1', 1, null, 'สำนักเทศกิจ', 1),
      makeOrg('d1', 3, 'o1', 'ฝ่ายบริหารงานทั่วไป', 1),
      makeOrg('o1', 2, 'b1', 'สำนักงานเลขานุการ', 1),
      makeOrg('o-inactive', 2, 'b1', 'กองเก่า', 3, false),
    ];

    expect(
      [...orgs]
        .filter((u) => u.level_no === 2)
        .sort(compareOrgUnits)
        .map((u) => u.id)
    ).toEqual(['o1', 'o2', 'o-inactive']);

    expect(flattenOrgUnitsInTreeOrder(orgs, { activeOnly: true }).map((n) => n.unit.id)).toEqual([
      'b1',
      'o1',
      'd1',
      'v1',
      'd2',
      'o2',
    ]);

    const anc = resolveOrgUnitAncestors('v1', orgs);
    expect(anc.bureauName).toBe('สำนักเทศกิจ');
    expect(anc.officeName).toBe('สำนักงานเลขานุการ');
    expect(anc.departmentName).toBe('ฝ่ายบริหารงานทั่วไป');
    expect(anc.divisionName).toBe('กลุ่มงานสารบรรณ');
  });

  it('sorts an entire MasterDataBundle deterministically via sortMasterDataBundle', () => {
    const bundle: MasterDataBundle = {
      categories: [makeCat('gender', 'เพศ', 2), makeCat('prefix', 'คำนำหน้า', 1)],
      items: [makeLookup('i2', 'นาง', 2), makeLookup('i1', 'นาย', 1)],
      itemsByCategoryCode: {
        PREFIX: [makeLookup('i2', 'นาง', 2), makeLookup('i1', 'นาย', 1)],
      },
      orgUnitLevels: [],
      orgUnits: [makeOrg('o2', 2, 'b1', 'กอง ข', 2), makeOrg('o1', 2, 'b1', 'กอง ก', 1)],
      positionTypes: [makePosType('pt2', 'วิชาการ', 2), makePosType('pt1', 'บริหาร', 1)],
      positions: [makePos('p2', 'รองผู้อำนวยการสำนัก', 2), makePos('p1', 'ผู้อำนวยการสำนัก', 1)],
      positionLevels: [makeLevel('l2', 'ชำนาญการ', 2, 50), makeLevel('l1', 'ปฏิบัติการ', 1, 40)],
      positionAllowedLevels: [],
    };

    const sorted = sortMasterDataBundle(bundle);
    expect(sorted.categories.map((c) => c.code)).toEqual(['PREFIX', 'GENDER']);
    expect(sorted.itemsByCategoryCode.PREFIX.map((i) => i.name_th)).toEqual(['นาย', 'นาง']);
    expect(sorted.orgUnits.map((u) => u.id)).toEqual(['o1', 'o2']);
    expect(sorted.positionTypes.map((t) => t.id)).toEqual(['pt1', 'pt2']);
    expect(sorted.positions.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(sorted.positionLevels.map((l) => l.id)).toEqual(['l1', 'l2']);
  });

  it('sorts personnel strictly by Org Hierarchy then Position Hierarchy via createPersonnelHierarchyComparator', () => {
    const bundle: MasterDataBundle = {
      categories: [],
      items: [],
      itemsByCategoryCode: {},
      orgUnitLevels: [],
      orgUnits: [
        makeOrg('b1', 1, null, 'สำนักเทศกิจ', 1),
        makeOrg('o1', 2, 'b1', 'สำนักงานเลขานุการ', 1),
        makeOrg('o2', 2, 'b1', 'กองตรวจ', 2),
        makeOrg('d1', 3, 'o1', 'ฝ่ายบริหาร', 1),
      ],
      positionTypes: [makePosType('pt-exec', 'บริหาร', 1), makePosType('pt-acad', 'วิชาการ', 2)],
      positions: [makePos('pos-dir', 'ผู้อำนวยการ', 1), makePos('pos-staff', 'นักวิชาการ', 2)],
      positionLevels: [makeLevel('lvl-high', 'สูง', 1, 100), makeLevel('lvl-low', 'ปฏิบัติการ', 2, 40)],
      positionAllowedLevels: [],
    };
    const cmp = createPersonnelHierarchyComparator(bundle);
    const people = [
      { id: 'u3', bureau_id: 'b1', office_id: 'o2', department_id: null, division_id: null, position_type_id: 'pt-exec', position_id: 'pos-dir', position_level_id: 'lvl-high', full_name: 'ค' },
      { id: 'u2', bureau_id: 'b1', office_id: 'o1', department_id: 'd1', division_id: null, position_type_id: 'pt-acad', position_id: 'pos-staff', position_level_id: 'lvl-low', full_name: 'ข' },
      { id: 'u1', bureau_id: 'b1', office_id: 'o1', department_id: 'd1', division_id: null, position_type_id: 'pt-exec', position_id: 'pos-dir', position_level_id: 'lvl-high', full_name: 'ก' },
    ];
    expect([...people].sort(cmp).map((x) => x.id)).toEqual(['u1', 'u2', 'u3']);
  });
});

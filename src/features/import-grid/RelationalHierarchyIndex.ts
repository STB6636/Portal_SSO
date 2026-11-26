import { findTopSuggestions, normalizeLookupText } from '@/lib/fuzzy-match';
import {
  compareLookupItems,
  compareOrgUnits,
  comparePositionLevels,
  comparePositions,
  comparePositionTypes,
} from '@/lib/masterDataSort';
import type {
  LookupItemRow,
  OrgUnitRow,
  PositionLevelRow,
  PositionRow,
  PositionTypeRow,
} from '@/types/database.types';
import type { MasterDataBundle } from '@/types/domain.types';

export interface LookupMatchResult {
  item: LookupItemRow;
  matchedByShortOrCode: boolean;
}

/**
 * High-speed O(1) in-memory relational index (< 50ms for 2,000 rows).
 * Uses Composite Key `(parentId, normalizedName)` for Org Units so duplicate
 * names like "ฝ่ายบริหารงานทั่วไป" across different Offices NEVER collide.
 */
export class RelationalHierarchyIndex {
  private readonly lookupMaps = new Map<string, Map<string, LookupMatchResult>>();
  private readonly lookupLabels = new Map<string, string[]>();
  private readonly defaultLookupByCategory = new Map<string, LookupItemRow>();

  // Position 3-level hierarchy
  readonly activePositionTypes: PositionTypeRow[];
  private readonly positionTypeByName = new Map<string, PositionTypeRow>();
  private readonly positionTypeById = new Map<string, PositionTypeRow>();

  readonly activePositions: PositionRow[];
  private readonly positionById = new Map<string, PositionRow>();
  private readonly positionByTypeAndName = new Map<string, PositionRow>();
  private readonly positionsByTypeId = new Map<string, PositionRow[]>();
  private readonly positionsByNameAll = new Map<string, PositionRow[]>();

  readonly activePositionLevels: PositionLevelRow[];
  private readonly positionLevelById = new Map<string, PositionLevelRow>();
  private readonly positionLevelByName = new Map<string, PositionLevelRow>();
  private readonly allowedLevelsByPositionId = new Map<string, PositionLevelRow[]>();
  private readonly allowedLevelIdsByPositionId = new Map<string, Set<string>>();

  // Org 4-level hierarchy (Composite Keys)
  readonly bureaus: OrgUnitRow[];
  readonly offices: OrgUnitRow[];
  readonly departments: OrgUnitRow[];
  readonly divisions: OrgUnitRow[];
  readonly singleActiveBureau: OrgUnitRow | null;

  private readonly orgById = new Map<string, OrgUnitRow>();
  private readonly bureauByName = new Map<string, OrgUnitRow>();
  private readonly officeByParentAndName = new Map<string, OrgUnitRow>();
  private readonly officesByBureauId = new Map<string, OrgUnitRow[]>();
  private readonly officesByNameAll = new Map<string, OrgUnitRow[]>();

  private readonly deptByParentAndName = new Map<string, OrgUnitRow>();
  private readonly deptsByOfficeId = new Map<string, OrgUnitRow[]>();
  private readonly deptsByNameAll = new Map<string, OrgUnitRow[]>();

  private readonly divByParentAndName = new Map<string, OrgUnitRow>();
  private readonly divsByDeptId = new Map<string, OrgUnitRow[]>();
  private readonly divsByNameAll = new Map<string, OrgUnitRow[]>();

  constructor(master: MasterDataBundle) {
    // 1. Lookup categories & items
    for (const [catCode, items] of Object.entries(master.itemsByCategoryCode || {})) {
      const map = new Map<string, LookupMatchResult>();
      const labels: string[] = [];
      const activeItems = items.filter((i) => i.is_active).sort(compareLookupItems);
      for (const item of activeItems) {
        labels.push(item.name_th);
        if (item.is_default && !this.defaultLookupByCategory.has(catCode)) {
          this.defaultLookupByCategory.set(catCode, item);
        }
        const normName = normalizeLookupText(item.name_th);
        if (normName) map.set(normName, { item, matchedByShortOrCode: false });

        if (item.short_name) {
          const normShort = normalizeLookupText(item.short_name);
          if (normShort && !map.has(normShort)) {
            map.set(normShort, { item, matchedByShortOrCode: true });
          }
        }
        if (item.code) {
          const normCode = normalizeLookupText(item.code);
          if (normCode && !map.has(normCode)) {
            map.set(normCode, { item, matchedByShortOrCode: true });
          }
        }
      }
      this.lookupMaps.set(catCode, map);
      this.lookupLabels.set(catCode, labels);
    }

    // 2. Position Types (Lv1)
    this.activePositionTypes = (master.positionTypes || []).filter((t) => t.is_active).sort(comparePositionTypes);
    for (const pt of this.activePositionTypes) {
      this.positionTypeById.set(pt.id, pt);
      this.positionTypeByName.set(normalizeLookupText(pt.name_th), pt);
      if (pt.code) this.positionTypeByName.set(normalizeLookupText(pt.code), pt);
    }

    // 3. Positions (Lv2)
    this.activePositions = (master.positions || []).filter((p) => p.is_active).sort(comparePositions);
    for (const pos of this.activePositions) {
      this.positionById.set(pos.id, pos);
      const norm = normalizeLookupText(pos.name_th);
      this.positionByTypeAndName.set(`${pos.position_type_id}::${norm}`, pos);

      const byType = this.positionsByTypeId.get(pos.position_type_id) || [];
      byType.push(pos);
      this.positionsByTypeId.set(pos.position_type_id, byType);

      const byName = this.positionsByNameAll.get(norm) || [];
      byName.push(pos);
      this.positionsByNameAll.set(norm, byName);
    }

    // 4. Position Levels (Lv3) & Junction
    this.activePositionLevels = (master.positionLevels || []).filter((l) => l.is_active).sort(comparePositionLevels);
    for (const lv of this.activePositionLevels) {
      this.positionLevelById.set(lv.id, lv);
      this.positionLevelByName.set(normalizeLookupText(lv.name_th), lv);
      if (lv.code) this.positionLevelByName.set(normalizeLookupText(lv.code), lv);
    }

    for (const link of master.positionAllowedLevels || []) {
      const lv = this.positionLevelById.get(link.position_level_id);
      if (!lv) continue;
      const list = this.allowedLevelsByPositionId.get(link.position_id) || [];
      list.push(lv);
      this.allowedLevelsByPositionId.set(link.position_id, list);

      const set = this.allowedLevelIdsByPositionId.get(link.position_id) || new Set<string>();
      set.add(lv.id);
      this.allowedLevelIdsByPositionId.set(link.position_id, set);
    }
    for (const [posId, list] of this.allowedLevelsByPositionId.entries()) {
      list.sort(comparePositionLevels);
      this.allowedLevelsByPositionId.set(posId, list);
    }

    // 5. Org Units (4 Levels with Composite Keys)
    const levelNoById = new Map<string, number>();
    for (const lvl of master.orgUnitLevels || []) {
      levelNoById.set(lvl.id, lvl.level_no);
    }

    const activeUnits = (master.orgUnits || [])
      .filter((u) => u.is_active)
      .map((u) => ({
        ...u,
        level_no: (u.level_no ?? levelNoById.get(u.level_id) ?? 1) as 1 | 2 | 3 | 4,
      }))
      .sort(compareOrgUnits);

    this.bureaus = [];
    this.offices = [];
    this.departments = [];
    this.divisions = [];

    for (const unit of activeUnits) {
      this.orgById.set(unit.id, unit);
      const normName = normalizeLookupText(unit.name_th);
      const normShort = unit.short_name ? normalizeLookupText(unit.short_name) : '';

      if (unit.level_no === 1) {
        this.bureaus.push(unit);
        this.bureauByName.set(normName, unit);
        if (normShort && !this.bureauByName.has(normShort)) this.bureauByName.set(normShort, unit);
      } else if (unit.level_no === 2) {
        this.offices.push(unit);
        if (unit.parent_id) {
          this.officeByParentAndName.set(`${unit.parent_id}::${normName}`, unit);
          if (normShort) this.officeByParentAndName.set(`${unit.parent_id}::${normShort}`, unit);
          const list = this.officesByBureauId.get(unit.parent_id) || [];
          list.push(unit);
          this.officesByBureauId.set(unit.parent_id, list);
        }
        const all = this.officesByNameAll.get(normName) || [];
        all.push(unit);
        this.officesByNameAll.set(normName, all);
      } else if (unit.level_no === 3) {
        this.departments.push(unit);
        if (unit.parent_id) {
          this.deptByParentAndName.set(`${unit.parent_id}::${normName}`, unit);
          if (normShort) this.deptByParentAndName.set(`${unit.parent_id}::${normShort}`, unit);
          const list = this.deptsByOfficeId.get(unit.parent_id) || [];
          list.push(unit);
          this.deptsByOfficeId.set(unit.parent_id, list);
        }
        const all = this.deptsByNameAll.get(normName) || [];
        all.push(unit);
        this.deptsByNameAll.set(normName, all);
      } else if (unit.level_no === 4) {
        this.divisions.push(unit);
        if (unit.parent_id) {
          this.divByParentAndName.set(`${unit.parent_id}::${normName}`, unit);
          if (normShort) this.divByParentAndName.set(`${unit.parent_id}::${normShort}`, unit);
          const list = this.divsByDeptId.get(unit.parent_id) || [];
          list.push(unit);
          this.divsByDeptId.set(unit.parent_id, list);
        }
        const all = this.divsByNameAll.get(normName) || [];
        all.push(unit);
        this.divsByNameAll.set(normName, all);
      }
    }

    this.singleActiveBureau = this.bureaus.length === 1 ? this.bureaus[0] : null;
  }

  // ---- Lookups ----
  matchLookup(categoryCode: string, raw: string): LookupMatchResult | null {
    const map = this.lookupMaps.get(categoryCode);
    if (!map) return null;
    return map.get(normalizeLookupText(raw)) ?? null;
  }

  getDefaultLookup(categoryCode: string): LookupItemRow | null {
    return this.defaultLookupByCategory.get(categoryCode) ?? null;
  }

  getLookupOptions(categoryCode: string): string[] {
    return this.lookupLabels.get(categoryCode) ?? [];
  }

  suggestLookup(categoryCode: string, raw: string, limit = 3): string[] {
    return findTopSuggestions(raw, this.getLookupOptions(categoryCode), limit);
  }

  // ---- Positions (3-Level Cascade) ----
  matchPositionType(raw: string): PositionTypeRow | null {
    return this.positionTypeByName.get(normalizeLookupText(raw)) ?? null;
  }

  getPositionTypeById(id: string): PositionTypeRow | null {
    return this.positionTypeById.get(id) ?? null;
  }

  getPositionTypeOptions(): string[] {
    return this.activePositionTypes.map((t) => t.name_th);
  }

  suggestPositionType(raw: string): string[] {
    return findTopSuggestions(raw, this.getPositionTypeOptions(), 3);
  }

  matchPositionInType(positionTypeId: string, raw: string): PositionRow | null {
    return this.positionByTypeAndName.get(`${positionTypeId}::${normalizeLookupText(raw)}`) ?? null;
  }

  findPositionsByNameGlobal(raw: string): PositionRow[] {
    return this.positionsByNameAll.get(normalizeLookupText(raw)) ?? [];
  }

  getPositionOptionsForType(positionTypeId?: string | null): string[] {
    const list = positionTypeId ? this.positionsByTypeId.get(positionTypeId) || [] : this.activePositions;
    return list.map((p) => p.name_th);
  }

  suggestPosition(positionTypeId: string | null | undefined, raw: string): string[] {
    return findTopSuggestions(raw, this.getPositionOptionsForType(positionTypeId), 3);
  }

  matchPositionLevel(raw: string): PositionLevelRow | null {
    return this.positionLevelByName.get(normalizeLookupText(raw)) ?? null;
  }

  isLevelAllowedForPosition(positionId: string, levelId: string): boolean {
    const set = this.allowedLevelIdsByPositionId.get(positionId);
    if (!set || set.size === 0) return true; // If no junction restriction rows exist, allow active levels
    return set.has(levelId);
  }

  getAllowedLevelOptions(positionId?: string | null): string[] {
    if (!positionId) return this.activePositionLevels.map((l) => l.name_th);
    const allowed = this.allowedLevelsByPositionId.get(positionId);
    if (!allowed || allowed.length === 0) return this.activePositionLevels.map((l) => l.name_th);
    return allowed.map((l) => l.name_th);
  }

  suggestPositionLevel(positionId: string | null | undefined, raw: string): string[] {
    return findTopSuggestions(raw, this.getAllowedLevelOptions(positionId), 3);
  }

  // ---- Org Units (4-Level Composite Key Cascade) ----
  getOrgById(id: string): OrgUnitRow | null {
    return this.orgById.get(id) ?? null;
  }

  matchBureau(raw: string): OrgUnitRow | null {
    return this.bureauByName.get(normalizeLookupText(raw)) ?? null;
  }

  getBureauOptions(): string[] {
    return this.bureaus.map((b) => b.name_th);
  }

  suggestBureau(raw: string): string[] {
    return findTopSuggestions(raw, this.getBureauOptions(), 3);
  }

  matchOfficeInBureau(bureauId: string, raw: string): OrgUnitRow | null {
    return this.officeByParentAndName.get(`${bureauId}::${normalizeLookupText(raw)}`) ?? null;
  }

  findOfficesByNameGlobal(raw: string): OrgUnitRow[] {
    return this.officesByNameAll.get(normalizeLookupText(raw)) ?? [];
  }

  getOfficeOptions(bureauId?: string | null): string[] {
    const list = bureauId ? this.officesByBureauId.get(bureauId) || [] : this.offices;
    return list.map((o) => o.name_th);
  }

  suggestOffice(bureauId: string | null | undefined, raw: string): string[] {
    return findTopSuggestions(raw, this.getOfficeOptions(bureauId), 3);
  }

  matchDepartmentInOffice(officeId: string, raw: string): OrgUnitRow | null {
    return this.deptByParentAndName.get(`${officeId}::${normalizeLookupText(raw)}`) ?? null;
  }

  findDepartmentsByNameGlobal(raw: string): OrgUnitRow[] {
    return this.deptsByNameAll.get(normalizeLookupText(raw)) ?? [];
  }

  getDepartmentOptions(officeId?: string | null): string[] {
    const list = officeId ? this.deptsByOfficeId.get(officeId) || [] : this.departments;
    return list.map((d) => d.name_th);
  }

  suggestDepartment(officeId: string | null | undefined, raw: string): string[] {
    return findTopSuggestions(raw, this.getDepartmentOptions(officeId), 3);
  }

  matchDivisionInDepartment(departmentId: string, raw: string): OrgUnitRow | null {
    return this.divByParentAndName.get(`${departmentId}::${normalizeLookupText(raw)}`) ?? null;
  }

  findDivisionsByNameGlobal(raw: string): OrgUnitRow[] {
    return this.divsByNameAll.get(normalizeLookupText(raw)) ?? [];
  }

  getDivisionOptions(departmentId?: string | null): string[] {
    const list = departmentId ? this.divsByDeptId.get(departmentId) || [] : this.divisions;
    return list.map((d) => d.name_th);
  }

  suggestDivision(departmentId: string | null | undefined, raw: string): string[] {
    return findTopSuggestions(raw, this.getDivisionOptions(departmentId), 3);
  }
}

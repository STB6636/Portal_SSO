import type {
  LookupCategoryRow,
  LookupItemRow,
  OrgUnitRow,
  PositionLevelRow,
  PositionRow,
  PositionTypeRow,
} from '@/types/database.types';
import type { MasterDataBundle } from '@/types/domain.types';

/**
 * Single Source of Truth sorting comparators guaranteeing that EVERY dropdown
 * across Portal SSO renders in the exact same order configured in System Settings.
 */

function compareThai(a: string | null | undefined, b: string | null | undefined): number {
  return String(a ?? '').localeCompare(String(b ?? ''), 'th');
}

export function compareLookupCategories(a: LookupCategoryRow, b: LookupCategoryRow): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || compareThai(a.name_th, b.name_th);
}

export function compareLookupItems(a: LookupItemRow, b: LookupItemRow): number {
  return (
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    (a.rank_order ?? 0) - (b.rank_order ?? 0) ||
    compareThai(a.name_th, b.name_th)
  );
}

export function compareOrgUnits(a: OrgUnitRow, b: OrgUnitRow): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || compareThai(a.name_th, b.name_th);
}

export function comparePositionTypes(a: PositionTypeRow, b: PositionTypeRow): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || compareThai(a.name_th, b.name_th);
}

export function comparePositions(a: PositionRow, b: PositionRow): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || compareThai(a.name_th, b.name_th);
}

export function comparePositionLevels(a: PositionLevelRow, b: PositionLevelRow): number {
  return (
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    (a.rank_order ?? 0) - (b.rank_order ?? 0) ||
    compareThai(a.name_th, b.name_th)
  );
}

export function sortAllowedLevels(
  levels: PositionLevelRow[],
  allowedLevelIds?: ReadonlySet<string> | null
): PositionLevelRow[] {
  const filtered =
    allowedLevelIds && allowedLevelIds.size > 0
      ? levels.filter((l) => allowedLevelIds.has(l.id))
      : [...levels];
  return filtered.sort(comparePositionLevels);
}

export interface FlattenedOrgUnitNode {
  unit: OrgUnitRow;
  depth: number;
  parentName: string | null;
}

/**
 * Depth-first traversal of the 4-level org hierarchy in exact System Settings order
 * (Lv1 -> Lv2 -> Lv3 -> Lv4, siblings sorted by compareOrgUnits).
 */
export function flattenOrgUnitsInTreeOrder(
  units: OrgUnitRow[],
  options: { activeOnly?: boolean } = {}
): FlattenedOrgUnitNode[] {
  const activeOnly = options.activeOnly !== false;
  const source = activeOnly ? units.filter((u) => u.is_active) : [...units];
  const byId = new Map(source.map((u) => [u.id, u]));
  const childrenMap = new Map<string | null, OrgUnitRow[]>();

  for (const unit of source) {
    const parentKey = unit.parent_id && byId.has(unit.parent_id) ? unit.parent_id : null;
    const bucket = childrenMap.get(parentKey);
    if (bucket) {
      bucket.push(unit);
    } else {
      childrenMap.set(parentKey, [unit]);
    }
  }

  for (const bucket of childrenMap.values()) {
    bucket.sort(compareOrgUnits);
  }

  const result: FlattenedOrgUnitNode[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number, parentName: string | null) => {
    const children = childrenMap.get(parentId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      result.push({ unit: child, depth, parentName });
      walk(child.id, depth + 1, child.name_th);
    }
  };

  walk(null, 0, null);

  // Safety net: append any disconnected/cyclic leftovers in compareOrgUnits order
  const leftovers = source.filter((u) => !visited.has(u.id)).sort(compareOrgUnits);
  for (const u of leftovers) {
    result.push({
      unit: u,
      depth: Math.max(0, (u.level_no ?? 1) - 1),
      parentName: u.parent_id ? byId.get(u.parent_id)?.name_th ?? null : null,
    });
  }

  return result;
}

/**
 * Resolves a single leaf org_unit_id back up its 4-level ancestor chain
 * into { bureauName, officeName, departmentName, divisionName }.
 */
export function resolveOrgUnitAncestors(
  orgUnitId: string | null | undefined,
  units: OrgUnitRow[]
): {
  bureauName: string | null;
  officeName: string | null;
  departmentName: string | null;
  divisionName: string | null;
} {
  const empty = { bureauName: null, officeName: null, departmentName: null, divisionName: null };
  if (!orgUnitId) return empty;
  const byId = new Map(units.map((u) => [u.id, u]));
  const out = { ...empty } as {
    bureauName: string | null;
    officeName: string | null;
    departmentName: string | null;
    divisionName: string | null;
  };
  let cur: OrgUnitRow | undefined = byId.get(orgUnitId);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.level_no === 1) out.bureauName = cur.name_th;
    else if (cur.level_no === 2) out.officeName = cur.name_th;
    else if (cur.level_no === 3) out.departmentName = cur.name_th;
    else if (cur.level_no === 4) out.divisionName = cur.name_th;
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

export function sortMasterDataBundle(bundle: MasterDataBundle): MasterDataBundle {
  const categories = [...bundle.categories].sort(compareLookupCategories);
  const items = [...bundle.items].sort(compareLookupItems);
  const itemsByCategoryCode: Record<string, LookupItemRow[]> = {};
  for (const [code, list] of Object.entries(bundle.itemsByCategoryCode)) {
    itemsByCategoryCode[code] = [...list].sort(compareLookupItems);
  }
  const orgUnits = [...bundle.orgUnits].sort(compareOrgUnits);
  const positionTypes = [...bundle.positionTypes].sort(comparePositionTypes);
  const positions = [...bundle.positions].sort(comparePositions);
  const positionLevels = [...bundle.positionLevels].sort(comparePositionLevels);

  return {
    ...bundle,
    categories,
    items,
    itemsByCategoryCode,
    orgUnits,
    positionTypes,
    positions,
    positionLevels,
  };
}

export interface PersonnelSortableFields {
  bureau_id?: string | null;
  office_id?: string | null;
  department_id?: string | null;
  division_id?: string | null;
  position_type_id?: string | null;
  position_id?: string | null;
  position_level_id?: string | null;
  position_number?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

const MAX_RANK = Number.MAX_SAFE_INTEGER;

/**
 * Builds an O(1) lookup comparator that orders personnel strictly following the
 * Org Hierarchy (Lv1 -> Lv2 -> Lv3 -> Lv4; higher-level leaders without child orgs appear first)
 * and Position Hierarchy (Position Type -> Position -> Position Level) configured in System Settings.
 */
export function createPersonnelHierarchyComparator(master: MasterDataBundle) {
  const orgTreeRank = new Map<string, number>();
  const flattened = flattenOrgUnitsInTreeOrder(master.orgUnits, { activeOnly: false });
  flattened.forEach((node, idx) => {
    orgTreeRank.set(node.unit.id, idx + 1);
  });

  const ptRank = new Map<string, number>();
  [...master.positionTypes].sort(comparePositionTypes).forEach((t, idx) => ptRank.set(t.id, idx + 1));

  const posRank = new Map<string, number>();
  [...master.positions].sort(comparePositions).forEach((p, idx) => posRank.set(p.id, idx + 1));

  const lvlRank = new Map<string, number>();
  [...master.positionLevels].sort(comparePositionLevels).forEach((l, idx) => lvlRank.set(l.id, idx + 1));

  // Missing child org unit = higher-tier leader (e.g. Bureau Director has no Lv2 office -> sorts BEFORE Lv2 units)
  const getOrgTierRank = (id: string | null | undefined, isRoot = false): number => {
    if (!id) return isRoot ? MAX_RANK : 0;
    return orgTreeRank.get(id) ?? MAX_RANK;
  };

  const getRank = (map: Map<string, number>, id: string | null | undefined): number => {
    if (!id) return MAX_RANK;
    return map.get(id) ?? MAX_RANK;
  };

  return (a: PersonnelSortableFields, b: PersonnelSortableFields): number => {
    const cmpBureau = getOrgTierRank(a.bureau_id, true) - getOrgTierRank(b.bureau_id, true);
    if (cmpBureau !== 0) return cmpBureau;

    const cmpOffice = getOrgTierRank(a.office_id) - getOrgTierRank(b.office_id);
    if (cmpOffice !== 0) return cmpOffice;

    const cmpDept = getOrgTierRank(a.department_id) - getOrgTierRank(b.department_id);
    if (cmpDept !== 0) return cmpDept;

    const cmpDiv = getOrgTierRank(a.division_id) - getOrgTierRank(b.division_id);
    if (cmpDiv !== 0) return cmpDiv;

    const cmpPt = getRank(ptRank, a.position_type_id) - getRank(ptRank, b.position_type_id);
    if (cmpPt !== 0) return cmpPt;

    const cmpPos = getRank(posRank, a.position_id) - getRank(posRank, b.position_id);
    if (cmpPos !== 0) return cmpPos;

    const cmpLvl = getRank(lvlRank, a.position_level_id) - getRank(lvlRank, b.position_level_id);
    if (cmpLvl !== 0) return cmpLvl;

    const posNumA = String(a.position_number ?? '').trim();
    const posNumB = String(b.position_number ?? '').trim();
    if (posNumA !== posNumB) {
      if (!posNumA) return 1;
      if (!posNumB) return -1;
      const cmpNum = posNumA.localeCompare(posNumB, 'th', { numeric: true });
      if (cmpNum !== 0) return cmpNum;
    }

    const nameA = String(a.full_name || `${a.first_name || ''} ${a.last_name || ''}`).trim();
    const nameB = String(b.full_name || `${b.first_name || ''} ${b.last_name || ''}`).trim();
    return compareThai(nameA, nameB);
  };
}

export function comparePersonnelByHierarchy(
  a: PersonnelSortableFields,
  b: PersonnelSortableFields,
  master: MasterDataBundle
): number {
  return createPersonnelHierarchyComparator(master)(a, b);
}

export type AccountRoleTagId = 'SUPERADMIN' | 'ADMIN_LV2' | 'ADMIN_LV3' | 'USER';

export interface AccountRoleSortableFields extends PersonnelSortableFields {
  role?: string | null;
  scope_level_no?: number | null;
  username?: string | null;
}

export function getAccountRoleTag(user: {
  role?: string | null;
  scope_level_no?: number | null;
}): AccountRoleTagId {
  const role = String(user.role ?? 'USER').toUpperCase();
  if (role === 'SUPERADMIN') return 'SUPERADMIN';
  if (role === 'ADMIN') {
    return Number(user.scope_level_no) === 3 ? 'ADMIN_LV3' : 'ADMIN_LV2';
  }
  return 'USER';
}

export function getAccountRolePriority(user: {
  role?: string | null;
  scope_level_no?: number | null;
}): number {
  const role = String(user.role ?? 'USER').toUpperCase();
  if (role === 'SUPERADMIN') return 1;
  if (role === 'ADMIN') {
    if (Number(user.scope_level_no) === 2) return 2;
    if (Number(user.scope_level_no) === 3) return 3;
    return 3.5;
  }
  return 4;
}

/**
 * Comparator for Accounts within each Org Group on UsersPage:
 * 1. Core Role & Admin Scope tier: SuperAdmin (1) -> Admin Lv2 (2) -> Admin Lv3 (3) -> Admin unscoped (3.5) -> User (4)
 * 2. Personnel Org & Position Hierarchy configured in System Settings
 * 3. Username fallback
 */
export function createUserRoleHierarchyComparator(master: MasterDataBundle) {
  const personnelCmp = createPersonnelHierarchyComparator(master);
  return (a: AccountRoleSortableFields, b: AccountRoleSortableFields): number => {
    const cmpRole = getAccountRolePriority(a) - getAccountRolePriority(b);
    if (cmpRole !== 0) return cmpRole;

    const cmpPersonnel = personnelCmp(a, b);
    if (cmpPersonnel !== 0) return cmpPersonnel;

    return compareThai(a.username, b.username);
  };
}

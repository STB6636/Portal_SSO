import type {
  PersonnelDisciplinaryRecordRow,
  PersonnelExecutiveDutyRow,
  PersonnelPositionHistoryRow,
  PersonnelSalaryHistoryRow,
  PositionRow,
} from '@/types/database.types';
import type { MasterDataBundle } from '@/types/domain.types';
import { formatCivilServantPosition } from './positionFormatter';
import { comparePositions, resolveOrgUnitAncestors } from './masterDataSort';

/**
 * Pure deterministic engine for Personnel Form History Ordering, Auto-Sync & Field Locking:
 * - Universal History Order (A4): top row (idx = 0, sort_order = 1) = latest; bottom row (idx = last) = initial;
 *   single row = BOTH latest & initial.
 * - Position History (A3 & C5-A): Exclusive [is_latest, is_initial] tags sync Tab 2 current position
 *   AND Tab 3 Zone A initial position (Bypass Mode when empty).
 * - Executive Duties (1:N EXECUTIVE-only) -> secondary_position & acting_position summaries
 * - Salary History -> Tab 3 current_salary / position_allowance / is_max_step (top row = latest)
 * - Disciplinary History -> Tab 3 disciplinary_flag (true OR false) & disciplinary_note
 */

export interface HistoryFieldLocks {
  positionFieldsDisabled: boolean;
  initialPositionFieldsDisabled: boolean;
  salaryFieldsDisabled: boolean;
  disciplinaryFieldsDisabled: boolean;
  executiveDutiesManagedByList: boolean;
}

export function computeHistoryFieldLocks(counts: {
  positionHistoryCount: number;
  salaryHistoryCount: number;
  disciplinaryRecordsCount: number;
}): HistoryFieldLocks {
  return {
    positionFieldsDisabled: counts.positionHistoryCount > 0,
    initialPositionFieldsDisabled: counts.positionHistoryCount > 0,
    salaryFieldsDisabled: counts.salaryHistoryCount > 0,
    disciplinaryFieldsDisabled: counts.disciplinaryRecordsCount > 0,
    executiveDutiesManagedByList: true,
  };
}

/**
 * Assigns sequential 1..N `sort_order` to any history list (1 = top/latest, N = bottom/initial).
 */
export function normalizeHistoryOrder<T extends { sort_order?: number }>(rows: T[]): T[] {
  return rows.map((row, idx) => ({ ...row, sort_order: idx + 1 }));
}

/**
 * Moves a row up (`dir = -1`) or down (`dir = 1`) and re-indexes `sort_order = 1..N`.
 */
export function moveHistoryItem<T extends { sort_order?: number }>(
  rows: T[],
  idx: number,
  dir: -1 | 1
): T[] {
  const targetIdx = idx + dir;
  if (idx < 0 || idx >= rows.length || targetIdx < 0 || targetIdx >= rows.length) {
    return rows;
  }
  const next = [...rows];
  [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
  return normalizeHistoryOrder(next);
}

/**
 * Enforces Checkpoint C5-A on position history:
 * - Top row (idx = 0) gets `is_latest = true`
 * - Bottom row (idx = rows.length - 1) gets `is_initial = true`
 * - Single row gets BOTH `is_latest = true` AND `is_initial = true`
 * - Sequential `sort_order = 1..N`
 */
export function normalizePositionHistoryTags<T extends Partial<PersonnelPositionHistoryRow>>(
  rows: T[]
): T[] {
  const total = rows.length;
  return rows.map((row, idx) => ({
    ...row,
    sort_order: idx + 1,
    is_latest: idx === 0,
    is_initial: idx === total - 1,
  }));
}

/**
 * Inserts or updates a position history row respecting explicit `[ตำแหน่งล่าสุด, ตำแหน่งแรกบรรจุ]` checkboxes:
 * - Checked `is_latest` -> moves row to index 0 (top)
 * - Checked `is_initial` -> moves row to bottom (index last)
 * - Single row -> always gets BOTH tags
 */
export function applyPositionHistorySaveWithTags<T extends Partial<PersonnelPositionHistoryRow>>(
  rows: T[],
  editIndex: number | null,
  record: T,
  options?: { makeLatest?: boolean; makeInitial?: boolean }
): T[] {
  const makeLatest = options?.makeLatest ?? Boolean(record.is_latest);
  const makeInitial = options?.makeInitial ?? Boolean(record.is_initial);

  const working = [...rows];
  let item: T;
  if (editIndex === null) {
    item = { ...record };
  } else {
    item = { ...working[editIndex], ...record };
    working.splice(editIndex, 1);
  }

  if (working.length === 0) {
    return normalizePositionHistoryTags([item]);
  }

  if (makeLatest) {
    working.unshift(item);
  } else if (makeInitial) {
    working.push(item);
  } else if (editIndex !== null) {
    const insertAt = Math.min(Math.max(editIndex, 0), working.length);
    working.splice(insertAt, 0, item);
  } else {
    // Default for new row without explicit tag: insert at top (newest) unless earlier than all existing
    working.unshift(item);
  }

  return normalizePositionHistoryTags(working);
}

/**
 * Pure UTC date subtraction (`YYYY-MM-DD` -> previous day `YYYY-MM-DD`).
 */
export function subtractOneDayIso(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || '').trim());
  if (!m) return isoDate;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

export function sortPositionHistoryNewestFirst<
  T extends Pick<PersonnelPositionHistoryRow, 'effective_date' | 'end_date'> & {
    created_at?: string;
    sort_order?: number;
    is_latest?: boolean;
    is_initial?: boolean;
  }
>(rows: T[]): T[] {
  const hasExplicitOrder = rows.some((r) => typeof r.sort_order === 'number' && r.sort_order > 0);
  const sorted = [...rows].sort((a, b) => {
    if (hasExplicitOrder) {
      const ordA = a.sort_order && a.sort_order > 0 ? a.sort_order : Number.MAX_SAFE_INTEGER;
      const ordB = b.sort_order && b.sort_order > 0 ? b.sort_order : Number.MAX_SAFE_INTEGER;
      if (ordA !== ordB) return ordA - ordB;
    }
    const aOpen = !a.end_date;
    const bOpen = !b.end_date;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    const effCmp = String(b.effective_date || '').localeCompare(String(a.effective_date || ''));
    if (effCmp !== 0) return effCmp;
    const endCmp = String(b.end_date || '').localeCompare(String(a.end_date || ''));
    if (endCmp !== 0) return endCmp;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  return normalizePositionHistoryTags(sorted);
}

export function findOpenEndedPositionIndices(
  rows: Array<Pick<PersonnelPositionHistoryRow, 'end_date'>>,
  excludeIndex?: number
): number[] {
  const indices: number[] = [];
  rows.forEach((row, idx) => {
    if (idx === excludeIndex) return;
    if (!String(row.end_date || '').trim()) {
      indices.push(idx);
    }
  });
  return indices;
}

/**
 * Auto-closes any existing open-ended position history rows to 1 day before `newEffectiveDate`
 * (clamped at the row's own `effective_date` so end_date >= effective_date is never violated).
 */
export function autoCloseOpenEndedPositionRows<
  T extends Pick<PersonnelPositionHistoryRow, 'effective_date' | 'end_date'>
>(rows: T[], newEffectiveDate: string, excludeIndex?: number): T[] {
  const prevDay = subtractOneDayIso(newEffectiveDate);
  return rows.map((row, idx) => {
    if (idx === excludeIndex) return row;
    if (String(row.end_date || '').trim()) return row;
    const eff = String(row.effective_date || '').trim();
    const closedDate = eff && prevDay < eff ? eff : prevDay;
    return { ...row, end_date: closedDate };
  });
}

export interface ResolvedPositionSnapshot {
  latestRow: Partial<PersonnelPositionHistoryRow> | null;
  hasOpenEnded: boolean;
  position_type_id: string;
  position_id: string;
  position_level_id: string;
  position_number: string;
  current_position_date: string;
  current_level_date: string;
}

export function resolveLatestPositionSnapshot(
  rows: Array<Partial<PersonnelPositionHistoryRow>>
): ResolvedPositionSnapshot | null {
  const valid = rows.filter((r) => Boolean(String(r.effective_date || '').trim()));
  if (valid.length === 0) return null;

  const hasExplicitOrder = valid.some(
    (r) => Boolean(r.is_latest) || (typeof r.sort_order === 'number' && r.sort_order > 0)
  );
  const ordered = hasExplicitOrder
    ? [...valid].sort((a, b) => {
        if (Boolean(a.is_latest) !== Boolean(b.is_latest)) return a.is_latest ? -1 : 1;
        const ordA = a.sort_order && a.sort_order > 0 ? a.sort_order : Number.MAX_SAFE_INTEGER;
        const ordB = b.sort_order && b.sort_order > 0 ? b.sort_order : Number.MAX_SAFE_INTEGER;
        return ordA - ordB;
      })
    : sortPositionHistoryNewestFirst(
        valid as Array<Pick<PersonnelPositionHistoryRow, 'effective_date' | 'end_date'> & Partial<PersonnelPositionHistoryRow>>
      );

  const latest = ordered[0];
  const hasOpenEnded = !String(latest.end_date || '').trim();

  let currentPositionDate = String(latest.effective_date || '');
  let currentLevelDate = latest.position_level_id ? String(latest.effective_date || '') : '';
  let posChainBroken = false;
  let lvlChainBroken = !latest.position_level_id;

  for (const row of ordered) {
    const rowEff = String(row.effective_date || '');
    if (!posChainBroken) {
      if ((row.position_id || '') === (latest.position_id || '')) {
        if (rowEff && rowEff < currentPositionDate) currentPositionDate = rowEff;
      } else {
        posChainBroken = true;
      }
    }
    if (!lvlChainBroken) {
      if ((row.position_level_id || '') === (latest.position_level_id || '')) {
        if (rowEff && rowEff < currentLevelDate) currentLevelDate = rowEff;
      } else {
        lvlChainBroken = true;
      }
    }
    if (posChainBroken && lvlChainBroken) break;
  }

  return {
    latestRow: latest,
    hasOpenEnded,
    position_type_id: latest.position_type_id || '',
    position_id: latest.position_id || '',
    position_level_id: latest.position_level_id || '',
    position_number: latest.position_number || '',
    current_position_date: currentPositionDate,
    current_level_date: currentLevelDate,
  };
}

export interface ResolvedInitialPositionSnapshot {
  initialRow: Partial<PersonnelPositionHistoryRow> | null;
  initial_position_type_id: string;
  initial_position_id: string;
  initial_position_level_id: string;
  initial_position: string;
}

export function resolveInitialPositionSnapshot(
  rows: Array<Partial<PersonnelPositionHistoryRow>>,
  master: MasterDataBundle,
  fallbackBureauName?: string | null
): ResolvedInitialPositionSnapshot | null {
  const valid = rows.filter((r) => Boolean(String(r.effective_date || '').trim()));
  if (valid.length === 0) return null;

  const explicitInitial = valid.find((r) => Boolean(r.is_initial));
  const initial = explicitInitial ?? valid[valid.length - 1];

  const posType = master.positionTypes.find((t) => t.id === initial.position_type_id);
  const posObj = master.positions.find((p) => p.id === initial.position_id);
  const lvlObj = master.positionLevels.find((l) => l.id === initial.position_level_id);
  const anc = resolveOrgUnitAncestors(initial.org_unit_id, master.orgUnits);

  const display = formatCivilServantPosition(
    posObj?.name_th || initial.position_title_snapshot || '',
    lvlObj?.name_th || '',
    posType?.name_th || '',
    {
      positionTypeCode: posType?.code,
      bureauName: anc.bureauName,
      officeName: anc.officeName,
      departmentName: anc.departmentName,
      divisionName: anc.divisionName,
      fallbackBureauName: fallbackBureauName || null,
    }
  );

  return {
    initialRow: initial,
    initial_position_type_id: initial.position_type_id || '',
    initial_position_id: initial.position_id || '',
    initial_position_level_id: initial.position_level_id || '',
    initial_position: display === '-' ? '' : display,
  };
}

export function buildFirstPositionHistoryPrefill(
  assignment: {
    position_type_id: string;
    position_id: string;
    position_level_id: string;
    position_number: string;
    current_position_date: string;
    bureau_id?: string;
    office_id: string;
    department_id: string;
    division_id: string;
  },
  career?: {
    current_salary?: string | number | null;
    position_allowance?: string | number | null;
  }
): Partial<PersonnelPositionHistoryRow> {
  const baseSalaryNum =
    career?.current_salary !== undefined &&
    career?.current_salary !== null &&
    String(career.current_salary).trim() !== '' &&
    !Number.isNaN(Number(career.current_salary))
      ? Number(career.current_salary)
      : null;
  const posAllowNum =
    career?.position_allowance !== undefined &&
    career?.position_allowance !== null &&
    String(career.position_allowance).trim() !== '' &&
    !Number.isNaN(Number(career.position_allowance))
      ? Number(career.position_allowance)
      : 0;
  return {
    position_type_id: assignment.position_type_id || null,
    position_id: assignment.position_id || null,
    position_level_id: assignment.position_level_id || null,
    position_number: assignment.position_number || null,
    org_unit_id:
      assignment.division_id || assignment.department_id || assignment.office_id || assignment.bureau_id || null,
    effective_date: assignment.current_position_date || '',
    end_date: null,
    base_salary: baseSalaryNum,
    position_allowance: posAllowNum,
    order_reference: null,
    is_latest: true,
    is_initial: true,
  };
}

export function buildFirstSalaryHistoryPrefill(career: {
  current_salary: string;
  position_allowance: string;
  is_max_step: boolean;
}): Partial<PersonnelSalaryHistoryRow> {
  return {
    base_salary: career.current_salary ? Number(career.current_salary) : 0,
    position_allowance: career.position_allowance ? Number(career.position_allowance) : 0,
    is_max_step: Boolean(career.is_max_step),
    effective_date: '',
    order_reference: null,
  };
}

/**
 * Returns active positions strictly belonging to `position_types.code === 'EXECUTIVE'`,
 * preserving canonical System Settings order.
 */
export function getExecutiveOnlyPositions(master: MasterDataBundle): PositionRow[] {
  const execTypeIds = new Set(
    master.positionTypes
      .filter((t) => t.is_active && t.code.toUpperCase() === 'EXECUTIVE')
      .map((t) => t.id)
  );
  return master.positions
    .filter((pos) => pos.is_active && execTypeIds.has(pos.position_type_id))
    .sort(comparePositions);
}

export function formatExecutiveDutySummary(
  duty: Partial<PersonnelExecutiveDutyRow>,
  master: MasterDataBundle,
  fallbackBureauName?: string | null
): string {
  const pos = master.positions.find((p) => p.id === duty.position_id);
  const lvl = master.positionLevels.find((l) => l.id === duty.position_level_id);
  const posType = master.positionTypes.find((t) => t.id === (duty.position_type_id || pos?.position_type_id));
  const bureauUnit = master.orgUnits.find((u) => u.id === duty.bureau_id);
  const officeUnit = master.orgUnits.find((u) => u.id === duty.office_id);
  const deptUnit = master.orgUnits.find((u) => u.id === duty.department_id);
  const divUnit = master.orgUnits.find((u) => u.id === duty.division_id);

  const formatted = formatCivilServantPosition(
    pos?.name_th || '',
    lvl?.name_th || '',
    posType?.name_th || 'ประเภทบริหาร',
    {
      positionTypeCode: posType?.code || 'EXECUTIVE',
      bureauName: bureauUnit?.name_th || null,
      officeName: officeUnit?.name_th || null,
      departmentName: deptUnit?.name_th || null,
      divisionName: divUnit?.name_th || null,
      fallbackBureauName: fallbackBureauName || null,
    }
  );

  return formatted === '-' ? '' : formatted;
}

export function resolveExecutiveDutiesSummaries(
  duties: Array<Partial<PersonnelExecutiveDutyRow>>,
  master: MasterDataBundle,
  fallbackBureauName?: string | null
): {
  deputizingSummary: string;
  actingSummary: string;
  activeCount: number;
} {
  const active = duties.filter((d) => !String(d.end_date || '').trim() && Boolean(d.position_id));
  const deputizingSummary = active
    .filter((d) => d.duty_type === 'DEPUTIZING')
    .map((d) => formatExecutiveDutySummary(d, master, fallbackBureauName))
    .filter(Boolean)
    .join(', ');
  const actingSummary = active
    .filter((d) => d.duty_type === 'ACTING')
    .map((d) => formatExecutiveDutySummary(d, master, fallbackBureauName))
    .filter(Boolean)
    .join(', ');

  return {
    deputizingSummary,
    actingSummary,
    activeCount: active.length,
  };
}

export function resolveLatestSalarySnapshot(
  rows: Array<Partial<PersonnelSalaryHistoryRow>>
): {
  latestRow: Partial<PersonnelSalaryHistoryRow>;
  current_salary: string;
  position_allowance: string;
  is_max_step: boolean;
} | null {
  const valid = rows.filter(
    (r) =>
      r.base_salary !== undefined &&
      r.base_salary !== null &&
      String(r.base_salary) !== '' &&
      Boolean(String(r.effective_date || '').trim())
  );
  if (valid.length === 0) return null;

  const hasExplicitOrder = valid.some((r) => typeof r.sort_order === 'number' && r.sort_order > 0);
  const indexed = valid.map((row, idx) => ({ row, idx }));
  indexed.sort((a, b) => {
    if (hasExplicitOrder) {
      const ordA = a.row.sort_order && a.row.sort_order > 0 ? a.row.sort_order : Number.MAX_SAFE_INTEGER;
      const ordB = b.row.sort_order && b.row.sort_order > 0 ? b.row.sort_order : Number.MAX_SAFE_INTEGER;
      if (ordA !== ordB) return ordA - ordB;
    }
    const cmp = String(b.row.effective_date || '').localeCompare(String(a.row.effective_date || ''));
    if (cmp !== 0) return cmp;
    return b.idx - a.idx;
  });

  const latest = indexed[0].row;
  return {
    latestRow: latest,
    current_salary: String(latest.base_salary ?? ''),
    position_allowance: String(latest.position_allowance ?? 0),
    is_max_step: Boolean(latest.is_max_step),
  };
}

export function resolveDisciplinarySnapshot(
  rows: Array<Partial<PersonnelDisciplinaryRecordRow>>,
  master: MasterDataBundle
): {
  disciplinary_flag: boolean;
  disciplinary_note: string;
  activeCount: number;
} {
  const statuses = master.itemsByCategoryCode['DISCIPLINARY_CASE_STATUS'] ?? [];
  const types = master.itemsByCategoryCode['DISCIPLINARY_TYPE'] ?? [];
  const penalties = master.itemsByCategoryCode['DISCIPLINARY_PENALTY'] ?? [];

  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const penaltyById = new Map(penalties.map((p) => [p.id, p]));

  const hasExplicitOrder = rows.some((r) => typeof r.sort_order === 'number' && r.sort_order > 0);
  const activeRows = rows
    .filter((r) => {
      const st = r.case_status_id ? statusById.get(r.case_status_id) : undefined;
      return st?.code === 'ONGOING' || st?.code === 'CLOSED_GUILTY';
    })
    .sort((a, b) => {
      if (hasExplicitOrder) {
        const ordA = a.sort_order && a.sort_order > 0 ? a.sort_order : Number.MAX_SAFE_INTEGER;
        const ordB = b.sort_order && b.sort_order > 0 ? b.sort_order : Number.MAX_SAFE_INTEGER;
        if (ordA !== ordB) return ordA - ordB;
      }
      return String(b.effective_date || '').localeCompare(String(a.effective_date || ''));
    });

  if (activeRows.length === 0) {
    return {
      disciplinary_flag: false,
      disciplinary_note: '',
      activeCount: 0,
    };
  }

  const summary = activeRows
    .map((r) => {
      const parts = [
        r.record_type_id ? typeById.get(r.record_type_id)?.name_th : '',
        r.penalty_level_id ? penaltyById.get(r.penalty_level_id)?.name_th : '',
        r.case_status_id ? statusById.get(r.case_status_id)?.name_th : '',
        String(r.remark || '').trim(),
      ].filter(Boolean);
      return parts.join(' — ');
    })
    .filter(Boolean)
    .join('; ');

  return {
    disciplinary_flag: true,
    disciplinary_note: summary,
    activeCount: activeRows.length,
  };
}

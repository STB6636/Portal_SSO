import { useEffect, useMemo } from 'react';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import { compareOrgUnits } from '@/lib/masterDataSort';
import type { OrgUnitRow } from '@/types/database.types';
import type { OrgFilterState } from '@/types/domain.types';

export interface OrgHierarchyFilterProps {
  orgUnits: OrgUnitRow[];
  value: OrgFilterState;
  onChange: (next: OrgFilterState) => void;
  showBureau?: boolean;
}

/**
 * 4-Level UUID Org Hierarchy Filter (Portal SSO v2.4.0):
 * - Lv1 bureau_id (สำนัก) -> Lv2 office_id (สำนักงาน/กอง) -> Lv3 department_id (ส่วน/ฝ่าย) -> Lv4 division_id (กลุ่มงาน)
 * - ADMIN Lv2 locks Lv1-2 (office_id) and unlocks Lv3-4
 * - ADMIN Lv3 locks Lv1-3 (department_id) and STILL allows filtering Lv4 (division_id กลุ่มงาน)!
 */
export function OrgHierarchyFilter({
  orgUnits,
  value,
  onChange,
  showBureau = false,
}: OrgHierarchyFilterProps) {
  const { isOfficeAdmin, isDepartmentAdmin, adminScope } = useScopedPermissions();

  const activeUnits = useMemo(() => orgUnits.filter((u) => u.is_active).sort(compareOrgUnits), [orgUnits]);
  const byId = useMemo(() => new Map(activeUnits.map((u) => [u.id, u])), [activeUnits]);

  const bureaus = useMemo(() => activeUnits.filter((u) => u.level_no === 1), [activeUnits]);
  const offices = useMemo(
    () =>
      activeUnits.filter(
        (u) => u.level_no === 2 && (!value.bureauId || u.parent_id === value.bureauId)
      ),
    [activeUnits, value.bureauId]
  );
  const departments = useMemo(
    () =>
      activeUnits.filter(
        (u) => u.level_no === 3 && (!value.officeId || u.parent_id === value.officeId)
      ),
    [activeUnits, value.officeId]
  );
  const divisions = useMemo(
    () =>
      activeUnits.filter(
        (u) => u.level_no === 4 && (!value.departmentId || u.parent_id === value.departmentId)
      ),
    [activeUnits, value.departmentId]
  );

  // Enforce Admin scope lock on mount / scope change
  useEffect(() => {
    if (!adminScope) return;
    if (isOfficeAdmin) {
      const office = byId.get(adminScope.org_unit_id);
      const bureauId = office?.parent_id || value.bureauId;
      if (value.officeId !== adminScope.org_unit_id) {
        onChange({ bureauId: bureauId || '', officeId: adminScope.org_unit_id, departmentId: '', divisionId: '' });
      }
    } else if (isDepartmentAdmin) {
      const dept = byId.get(adminScope.org_unit_id);
      const officeId = dept?.parent_id || '';
      const office = officeId ? byId.get(officeId) : undefined;
      const bureauId = office?.parent_id || '';
      if (value.departmentId !== adminScope.org_unit_id || value.officeId !== officeId) {
        onChange({ bureauId, officeId, departmentId: adminScope.org_unit_id, divisionId: value.divisionId });
      }
    }
  }, [adminScope, isOfficeAdmin, isDepartmentAdmin, byId, value.officeId, value.departmentId, value.bureauId, value.divisionId, onChange]);

  const lockLv12 = isOfficeAdmin || isDepartmentAdmin;
  const lockLv3 = isDepartmentAdmin;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {showBureau && (
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">สำนัก (Lv1)</label>
          <select
            value={value.bureauId}
            disabled={lockLv12}
            onChange={(e) => onChange({ bureauId: e.target.value, officeId: '', departmentId: '', divisionId: '' })}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold disabled:opacity-65"
          >
            <option value="">ทั้งหมด</option>
            {bureaus.map((b) => (
              <option key={b.id} value={b.id}>{b.name_th}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
          สำนักงาน/กอง (Lv2) {lockLv12 && <i className="fa-solid fa-lock text-amber-500 ml-1" />}
        </label>
        <select
          value={value.officeId}
          disabled={lockLv12}
          onChange={(e) => onChange({ ...value, officeId: e.target.value, departmentId: '', divisionId: '' })}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold disabled:opacity-65"
        >
          <option value="">ทุกสำนักงาน/กอง</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>{o.name_th}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
          ส่วน/ฝ่าย (Lv3) {lockLv3 && <i className="fa-solid fa-lock text-sky-500 ml-1" />}
        </label>
        <select
          value={value.departmentId}
          disabled={lockLv3}
          onChange={(e) => onChange({ ...value, departmentId: e.target.value, divisionId: '' })}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold disabled:opacity-65"
        >
          <option value="">ทุกส่วน/ฝ่าย</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name_th}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">กลุ่มงาน (Lv4)</label>
        <select
          value={value.divisionId}
          onChange={(e) => onChange({ ...value, divisionId: e.target.value })}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold"
        >
          <option value="">ทุกกลุ่มงาน</option>
          {divisions.map((g) => (
            <option key={g.id} value={g.id}>{g.name_th}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

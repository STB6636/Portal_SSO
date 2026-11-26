import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { OrgHierarchyFilter } from '@/components/common/OrgHierarchyFilter';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { RoleBadge } from '@/components/common/RoleBadge';
import { StatusTagChips, type TagChipOption } from '@/components/common/StatusTagChips';
import { UserRoleScopeModal } from '@/components/admin/UserRoleScopeModal';
import { DriveImage } from '@/components/common/DriveImage';
import { sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import { useSettings } from '@/contexts/SettingsContext';
import { useMasterData } from '@/hooks/useMasterData';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import { personnelService } from '@/services/personnelService';
import { userService, type ScopedUserViewRow } from '@/services/userService';
import { maskCid } from '@/lib/cidValidator';
import {
  createPersonnelHierarchyComparator,
  createUserRoleHierarchyComparator,
  flattenOrgUnitsInTreeOrder,
  getAccountRoleTag,
  type AccountRoleTagId,
} from '@/lib/masterDataSort';
import {
  cleanDisplaySegment,
  formatCivilServantPosition,
  formatOrgDisplay,
} from '@/lib/positionFormatter';
import { formatThaiDateTime } from '@/lib/thaiDate';
import { QUERY_KEYS } from '@/lib/queryClient';
import { useUiStore } from '@/stores/useUiStore';
import type { OrgFilterState } from '@/types/domain.types';

type UserOrgGroupMode = 'office_dept' | 'office_dept_div' | 'office_only';

interface UserDivisionBucket {
  key: string;
  label: string;
  rank: number;
  rows: ScopedUserViewRow[];
}

interface UserOrgGroupSection {
  key: string;
  headerLabel: string;
  officeRank: number;
  deptRank: number;
  totalCount: number;
  rows: ScopedUserViewRow[];
  divisions: UserDivisionBucket[];
}

const ROLE_TAG_META: Array<{ id: AccountRoleTagId; label: string; colorHex: string }> = [
  { id: 'SUPERADMIN', label: 'SuperAdmin', colorHex: '#E11D48' },
  { id: 'ADMIN_LV2', label: 'Admin (สำนักงาน/กอง)', colorHex: '#D97706' },
  { id: 'ADMIN_LV3', label: 'Admin (ส่วน/ฝ่าย)', colorHex: '#0284C7' },
  { id: 'USER', label: 'User', colorHex: '#059669' },
];

export default function UsersPage() {
  const { settings } = useSettings();
  const { data: master } = useMasterData();
  const { isSuperAdmin } = useScopedPermissions();
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);

  const hierarchyComparator = useMemo(() => createPersonnelHierarchyComparator(master), [master]);
  const userRoleComparator = useMemo(() => createUserRoleHierarchyComparator(master), [master]);

  const orgRankMap = useMemo(() => {
    const map = new Map<string, number>();
    flattenOrgUnitsInTreeOrder(master.orgUnits, { activeOnly: false }).forEach((node, idx) => {
      map.set(node.unit.id, idx + 1);
    });
    return map;
  }, [master.orgUnits]);

  const getUserPositionDisplay = (u: ScopedUserViewRow) =>
    cleanDisplaySegment(u.position_display) ||
    formatCivilServantPosition(u.position_name, u.position_level_name, u.position_type_name, {
      positionTypeCode: u.position_type_code,
      bureauName: u.bureau_name,
      officeName: u.office_name,
      departmentName: u.department_name,
      divisionName: u.division_name,
      fallbackBureauName: settings.bureau_name,
    });

  const [search, setSearch] = useState('');
  const [groupMode, setGroupMode] = useState<UserOrgGroupMode>('office_dept');
  const [selectedRoleTags, setSelectedRoleTags] = useState<string[]>([]);
  const [orgFilter, setOrgFilter] = useState<OrgFilterState>({
    bureauId: '',
    officeId: '',
    departmentId: '',
    divisionId: '',
  });
  const [scopeTarget, setScopeTarget] = useState<ScopedUserViewRow | null>(null);

  // Provision Accounts from Personnel Directory Modal
  const [provOpen, setProvOpen] = useState(false);
  const [provSearch, setProvSearch] = useState('');
  const [selectedPidList, setSelectedPidList] = useState<string[]>([]);
  const [provisioning, setProvisioning] = useState(false);

  const {
    data: users = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.users(),
    queryFn: () => userService.listScopedUsers(),
  });

  const { data: personnelRows = [] } = useQuery({
    queryKey: QUERY_KEYS.personnel(),
    queryFn: () => personnelService.listDirectory(),
    enabled: provOpen,
  });

  const eligiblePersonnel = useMemo(() => {
    const q = provSearch.trim().toLowerCase();
    return personnelRows
      .filter((p) => {
        if (p.has_user_account || !p.allows_account_provision) return false;
        if (!q) return true;
        return `${p.full_name} ${p.cid} ${p.office_name || ''} ${p.department_name || ''}`
          .toLowerCase()
          .includes(q);
      })
      .sort(hierarchyComparator);
  }, [personnelRows, provSearch, hierarchyComparator]);

  // Step 1: Filter by Org Hierarchy + Search (used to compute live Role TAG counts)
  const orgAndSearchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (orgFilter.bureauId && u.bureau_id !== orgFilter.bureauId) return false;
      if (orgFilter.officeId && u.office_id !== orgFilter.officeId) return false;
      if (orgFilter.departmentId && u.department_id !== orgFilter.departmentId) return false;
      if (orgFilter.divisionId && u.division_id !== orgFilter.divisionId) return false;
      if (q) {
        const posText = getUserPositionDisplay(u);
        const hay = `${u.username} ${u.full_name || ''} ${u.cid_masked || ''} ${posText} ${u.office_name || ''} ${u.department_name || ''} ${u.division_name || ''} ${u.scope_org_unit_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, orgFilter, search, settings.bureau_name]);

  // Role TAG Multi-Select Chips
  const roleTagOptions = useMemo<TagChipOption[]>(
    () => [
      {
        id: 'ALL',
        label: 'ทั้งหมด',
        count: orgAndSearchFiltered.length,
        colorHex: '#00744B',
        icon: 'fa-layer-group',
      },
      ...ROLE_TAG_META.map((meta) => ({
        id: meta.id,
        label: meta.label,
        count: orgAndSearchFiltered.filter((u) => getAccountRoleTag(u) === meta.id).length,
        colorHex: meta.colorHex,
      })),
    ],
    [orgAndSearchFiltered]
  );

  // Step 2: Filter by selected Role TAGs
  const filtered = useMemo(() => {
    const base =
      selectedRoleTags.length === 0
        ? orgAndSearchFiltered
        : orgAndSearchFiltered.filter((u) => selectedRoleTags.includes(getAccountRoleTag(u)));
    return [...base].sort(userRoleComparator);
  }, [orgAndSearchFiltered, selectedRoleTags, userRoleComparator]);

  // Step 3: Group by Org Hierarchy (ordered strictly via flattenOrgUnitsInTreeOrder)
  // and sort rows inside each group by SuperAdmin -> Admin Lv2 -> Admin Lv3 -> User
  const groupedSections = useMemo<UserOrgGroupSection[]>(() => {
    const sectionMap = new Map<string, UserOrgGroupSection>();

    for (const u of filtered) {
      const officeName = cleanDisplaySegment(u.office_name);
      const deptName = cleanDisplaySegment(u.department_name);
      const divName = cleanDisplaySegment(u.division_name);

      const officeIdKey = u.office_id || '__NO_OFFICE__';
      const deptIdKey = u.department_id || '__NO_DEPT__';
      const officeRank = u.office_id ? (orgRankMap.get(u.office_id) ?? Number.MAX_SAFE_INTEGER) : 0;
      const deptRank = u.department_id ? (orgRankMap.get(u.department_id) ?? Number.MAX_SAFE_INTEGER) : 0;

      const sectionKey = groupMode === 'office_only' ? officeIdKey : `${officeIdKey}::${deptIdKey}`;
      let headerLabel = '';
      if (groupMode === 'office_only') {
        headerLabel = officeName || 'ส่วนกลาง / ไม่ระบุสำนักงาน/กอง';
      } else if (officeName && deptName) {
        headerLabel = `${officeName} > ${deptName}`;
      } else if (officeName) {
        headerLabel = officeName;
      } else if (deptName) {
        headerLabel = deptName;
      } else {
        headerLabel = 'ส่วนกลาง / ไม่ระบุสังกัด';
      }

      let sec = sectionMap.get(sectionKey);
      if (!sec) {
        sec = {
          key: sectionKey,
          headerLabel,
          officeRank,
          deptRank: groupMode === 'office_only' ? 0 : deptRank,
          totalCount: 0,
          rows: [],
          divisions: [],
        };
        sectionMap.set(sectionKey, sec);
      }

      sec.totalCount += 1;
      sec.rows.push(u);

      if (groupMode === 'office_dept_div') {
        const divKey = u.division_id || '__NO_DIV__';
        const divRank = u.division_id ? (orgRankMap.get(u.division_id) ?? Number.MAX_SAFE_INTEGER) : 0;
        const divLabel = divName || 'สังกัดส่วน/ฝ่ายโดยตรง';
        let divBucket = sec.divisions.find((d) => d.key === divKey);
        if (!divBucket) {
          divBucket = { key: divKey, label: divLabel, rank: divRank, rows: [] };
          sec.divisions.push(divBucket);
        }
        divBucket.rows.push(u);
      }
    }

    const sections = Array.from(sectionMap.values());
    sections.sort(
      (a, b) =>
        a.officeRank - b.officeRank ||
        a.deptRank - b.deptRank ||
        a.headerLabel.localeCompare(b.headerLabel, 'th')
    );

    for (const sec of sections) {
      sec.rows.sort(userRoleComparator);
      sec.divisions.sort(
        (a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'th')
      );
      for (const div of sec.divisions) {
        div.rows.sort(userRoleComparator);
      }
    }

    return sections;
  }, [filtered, groupMode, orgRankMap, userRoleComparator]);

  const handleToggle = async (u: ScopedUserViewRow) => {
    const next = u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await userService.toggleUserStatus(u.id, next);
      await qc.invalidateQueries({ queryKey: ['users'] });
      showToast(`เปลี่ยนสถานะบัญชี ${u.username} เป็น ${next} แล้ว`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'เปลี่ยนสถานะไม่สำเร็จ', 'error');
    }
  };

  const handleBulkProvision = async () => {
    if (selectedPidList.length === 0) return;
    setProvisioning(true);
    let totalCreated = 0;
    const allSkipped: Array<{ personnel_id: string; reason: string }> = [];
    try {
      for (let i = 0; i < selectedPidList.length; i += 25) {
        const chunk = selectedPidList.slice(i, i + 25);
        const res = await userService.provisionAccounts(chunk);
        totalCreated += Number(res.created ?? 0);
        if (Array.isArray(res.skipped)) allSkipped.push(...res.skipped);
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ['users'] }),
        qc.invalidateQueries({ queryKey: ['personnel'] }),
        qc.invalidateQueries({ queryKey: QUERY_KEYS.dashboardStats }),
      ]);

      if (totalCreated > 0) {
        showToast(
          `สร้างบัญชี SSO สำเร็จ ${totalCreated} บัญชี${
            allSkipped.length > 0 ? ` (ข้าม ${allSkipped.length} รายการ)` : ''
          }`,
          'success'
        );
      } else {
        const firstReason = allSkipped[0]?.reason || 'ไม่พบบุคลากรที่สร้างบัญชีได้';
        showToast(`ไม่สามารถสร้างบัญชีได้ (${firstReason})`, 'warning');
      }
      setSelectedPidList([]);
      setProvOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'สร้างบัญชีผู้ใช้ไม่สำเร็จ', 'error');
    } finally {
      setProvisioning(false);
    }
  };

  const renderAvatar = (u: ScopedUserViewRow) => {
    const photoUrl = sanitizeImageUrl(u.photo_path);
    const initials = (u.full_name || u.username || 'U').trim().slice(0, 2);
    const fallbackNode = (
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white font-extrabold text-xs flex items-center justify-center shrink-0 shadow-xs">
        {initials}
      </div>
    );
    if (photoUrl) {
      return (
        <DriveImage
          src={photoUrl}
          alt={u.full_name || u.username}
          category="image"
          className="w-9 h-9 rounded-full object-cover border border-emerald-500/30 shrink-0"
          fallback={fallbackNode}
        />
      );
    }
    return fallbackNode;
  };

  const renderRoleCell = (u: ScopedUserViewRow) => (
    <div className="space-y-1">
      <RoleBadge role={u.role} />
      {u.role === 'ADMIN' && (
        <p
          className={`text-[11px] font-bold ${
            u.scope_level_no === 2
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-sky-700 dark:text-sky-300'
          }`}
        >
          <i
            className={`fa-solid ${
              u.scope_level_no === 2 ? 'fa-building' : 'fa-sitemap'
            } mr-1 text-[10px]`}
          />
          {u.scope_level_no === 2 ? 'สำนักงาน/กอง' : 'ส่วน/ฝ่าย'}:{' '}
          {cleanDisplaySegment(u.scope_org_unit_name) || 'ยังไม่ระบุ'}
        </p>
      )}
    </div>
  );

  let desktopSeq = 1;
  let mobileSeq = 1;

  const renderDesktopRow = (u: ScopedUserViewRow, seq: number) => {
    const posText = getUserPositionDisplay(u);
    const orgText = formatOrgDisplay({
      officeName: u.office_name,
      departmentName: u.department_name,
      divisionName: u.division_name,
    });
    return (
      <tr key={u.id} className="hover:bg-emerald-50/40 dark:hover:bg-slate-800/50 transition">
        <td className="px-3 py-3 text-center font-mono text-slate-400">{seq}</td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {renderAvatar(u)}
            <div className="min-w-0">
              <p className="font-bold text-sm text-slate-800 dark:text-white truncate">
                {u.full_name || u.username}
              </p>
              {posText && posText !== '-' && (
                <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 truncate">
                  {posText}
                </p>
              )}
              <p className="font-mono text-[11px] text-slate-400 truncate">
                {u.username} · {u.cid_masked || '-'}
              </p>
            </div>
          </div>
        </td>
        <td className="px-3 py-3">{renderRoleCell(u)}</td>
        <td className="px-3 py-3">
          <p className="font-semibold text-slate-700 dark:text-slate-200">{orgText.primary || '-'}</p>
          {orgText.secondary && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{orgText.secondary}</p>
          )}
        </td>
        <td className="px-3 py-3">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              u.status === 'ACTIVE'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
            }`}
          >
            {u.status === 'ACTIVE' ? 'เปิดใช้งาน' : u.status === 'SUSPENDED' ? 'ระงับใช้งาน' : u.status}
          </span>
          <p className="text-[10px] text-slate-400 mt-1 whitespace-nowrap">
            {u.last_login_at ? `เข้าใช้ล่าสุด: ${formatThaiDateTime(u.last_login_at)}` : 'ยังไม่เคยเข้าใช้'}
          </p>
        </td>
        <td className="px-3 py-3 text-right space-x-1.5 whitespace-nowrap">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setScopeTarget(u)}
              className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-300 font-bold transition"
            >
              <i className="fa-solid fa-user-shield mr-1" />
              สิทธิ์/ขอบเขต
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleToggle(u)}
            className={`px-2.5 py-1.5 rounded-lg font-bold transition ${
              u.status === 'ACTIVE'
                ? 'bg-slate-100 hover:bg-rose-50 hover:text-rose-700 dark:bg-slate-800 dark:hover:bg-rose-950/40'
                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            }`}
          >
            {u.status === 'ACTIVE' ? 'ระงับ' : 'เปิดใช้'}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <AdminLayout
      title="บัญชีผู้ใช้งาน"
      subtitle="บริหารบัญชีผู้ใช้งาน แยกตามโครงสร้างสังกัด เรียงตามระดับสิทธิ์ SuperAdmin → Admin → User"
      activePage="users"
    >
      <div className="space-y-5 pt-4">
        {/* Floating Emerald Header + Filter Card */}
        <div className="bma-card">
          <div className="-mt-6 mx-4 sm:mx-6 rounded-2xl bg-gradient-to-r from-[#00351B] via-[#00744B] to-[#00A368] text-white p-4 sm:p-5 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-base sm:text-lg flex items-center gap-2">
                <i className="fa-solid fa-users-gear" />
                บัญชีผู้ใช้งาน ({filtered.length.toLocaleString()} / {users.length.toLocaleString()} บัญชี)
              </h2>
              <p className="text-xs text-emerald-100 mt-0.5">
                จัดกลุ่มตามโครงสร้างสังกัด เรียงลำดับสิทธิ์ภายในแต่ละสังกัด: SuperAdmin → Admin (สำนักงาน/กอง) → Admin (ส่วน/ฝ่าย) → User
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedPidList([]);
                  setProvSearch('');
                  setProvOpen(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-white text-[#005C3B] hover:bg-emerald-50 text-xs font-extrabold shadow-sm transition inline-flex items-center gap-1.5"
              >
                <i className="fa-solid fa-user-plus" />
                สร้างบัญชีผู้ใช้ (จากทะเบียนบุคลากร)
              </button>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition inline-flex items-center gap-1.5"
              >
                <i className={`fa-solid fa-rotate ${isFetching ? 'fa-spin' : ''}`} />
                รีเฟรช
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {/* Search & Org Grouping Mode Row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหาชื่อผู้ใช้, ชื่อ-สกุล, ตำแหน่ง, สังกัด..."
                  className="bma-input pl-8 text-xs w-full"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  <i className="fa-solid fa-sitemap mr-1 text-[#00744B]" />
                  มุมมองแยกสังกัด:
                </label>
                <select
                  value={groupMode}
                  onChange={(e) => setGroupMode(e.target.value as UserOrgGroupMode)}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200"
                >
                  <option value="office_dept">สำนักงาน/กอง &gt; ส่วน/ฝ่าย</option>
                  <option value="office_dept_div">สำนักงาน/กอง &gt; ส่วน/ฝ่าย &gt; กลุ่มงาน</option>
                  <option value="office_only">สำนักงาน/กอง</option>
                </select>
              </div>
            </div>

            {/* 4-Level Org Hierarchy Filter */}
            <OrgHierarchyFilter
              orgUnits={master.orgUnits}
              value={orgFilter}
              onChange={setOrgFilter}
              showBureau={isSuperAdmin}
            />

            {/* Role TAG Multi-Select Filter Chips */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <i className="fa-solid fa-filter mr-1 text-[#00744B]" />
                กรองตามระดับสิทธิ์บัญชีผู้ใช้งาน (เลือกได้หลายรายการ):
              </p>
              <StatusTagChips
                options={roleTagOptions}
                activeIds={selectedRoleTags}
                onChange={setSelectedRoleTags}
              />
            </div>
          </div>
        </div>

        {/* Single Main Grouped Table Card (C3-A) */}
        <div className="bma-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/40">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#00744B]" />
              <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">
                ตารางบัญชีผู้ใช้งานแยกตามสังกัด
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                {filtered.length.toLocaleString()} บัญชี · {groupedSections.length} สังกัด
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              เรียงลำดับ: SuperAdmin → Admin (สำนักงาน/กอง) → Admin (ส่วน/ฝ่าย) → User
            </p>
          </div>

          {isLoading ? (
            <div className="p-10 text-center text-slate-400">
              <i className="fa-solid fa-circle-notch fa-spin text-2xl text-[#00744B] mb-2" />
              <p className="text-xs font-semibold">กำลังโหลดรายการบัญชีผู้ใช้งาน...</p>
            </div>
          ) : groupedSections.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">
              ไม่พบบัญชีผู้ใช้งานตามเงื่อนไขที่กรอง
            </div>
          ) : (
            <>
              {/* Desktop Grouped Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 font-extrabold border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-3 py-3 w-12 text-center">ลำดับ</th>
                      <th className="px-3 py-3">บัญชี / ชื่อ-สกุล / ตำแหน่ง</th>
                      <th className="px-3 py-3">บทบาท & ขอบเขต Admin</th>
                      <th className="px-3 py-3">สังกัด</th>
                      <th className="px-3 py-3">สถานะ / เข้าใช้ล่าสุด</th>
                      <th className="px-3 py-3 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {groupedSections.map((sec) => (
                      <React.Fragment key={sec.key}>
                        <tr className="bg-emerald-500/10 text-[#005C3B] dark:text-emerald-300 border-l-4 border-[#00744B]">
                          <td colSpan={6} className="font-bold text-xs sm:text-sm py-2.5 px-4">
                            <i className="fa-solid fa-building-user mr-1.5" />
                            {sec.headerLabel}{' '}
                            <span className="ml-1 px-2 py-0.5 rounded-full bg-emerald-600/15 text-[11px] font-extrabold">
                              {sec.totalCount} บัญชี
                            </span>
                          </td>
                        </tr>
                        {groupMode === 'office_dept_div'
                          ? sec.divisions.map((div) => (
                              <React.Fragment key={`${sec.key}::${div.key}`}>
                                <tr className="bg-slate-100/80 dark:bg-slate-800/50">
                                  <td
                                    colSpan={6}
                                    className="font-semibold text-xs py-2 pl-8 text-slate-700 dark:text-slate-200"
                                  >
                                    <i className="fa-solid fa-layer-group mr-1.5 text-[#00744B]" />
                                    กลุ่มงาน: {div.label} ({div.rows.length} บัญชี)
                                  </td>
                                </tr>
                                {div.rows.map((u) => renderDesktopRow(u, desktopSeq++))}
                              </React.Fragment>
                            ))
                          : sec.rows.map((u) => renderDesktopRow(u, desktopSeq++))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Grouped Cards */}
              <div className="lg:hidden p-3 space-y-4">
                {groupedSections.map((sec) => (
                  <div key={`m-${sec.key}`} className="space-y-2">
                    <div className="rounded-xl px-3.5 py-2 font-bold text-xs bg-emerald-500/10 text-[#005C3B] dark:text-emerald-300 border-l-4 border-[#00744B] flex items-center justify-between gap-2">
                      <span className="truncate">
                        <i className="fa-solid fa-building-user mr-1.5" />
                        {sec.headerLabel}
                      </span>
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-emerald-600/15 text-[10px] font-extrabold">
                        {sec.totalCount} บัญชี
                      </span>
                    </div>

                    {(groupMode === 'office_dept_div' ? sec.divisions.flatMap((d) => d.rows) : sec.rows).map(
                      (u) => {
                        const seq = mobileSeq++;
                        const posText = getUserPositionDisplay(u);
                        return (
                          <div
                            key={u.id}
                            className="rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-3.5 space-y-2.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1 rounded bg-slate-100 dark:bg-slate-700 text-[11px] font-extrabold text-slate-600 dark:text-slate-200 shrink-0">
                                  {seq}
                                </span>
                                {renderAvatar(u)}
                                <div className="min-w-0">
                                  <p className="font-bold text-sm text-slate-800 dark:text-white truncate">
                                    {u.full_name || u.username}
                                  </p>
                                  {posText && posText !== '-' && (
                                    <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 truncate">
                                      {posText}
                                    </p>
                                  )}
                                  <p className="font-mono text-[10px] text-slate-400 truncate">
                                    {u.username} · {u.cid_masked || '-'}
                                  </p>
                                </div>
                              </div>
                              <span
                                className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  u.status === 'ACTIVE'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-700'
                                }`}
                              >
                                {u.status === 'ACTIVE' ? 'เปิดใช้' : 'ระงับ'}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/70">
                              {renderRoleCell(u)}
                              <div className="flex items-center gap-1.5">
                                {isSuperAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => setScopeTarget(u)}
                                    className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs font-bold"
                                  >
                                    <i className="fa-solid fa-user-shield mr-1" />
                                    สิทธิ์/ขอบเขต
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void handleToggle(u)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-xs font-bold"
                                >
                                  {u.status === 'ACTIVE' ? 'ระงับ' : 'เปิดใช้'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Provision Accounts Modal */}
      <ResponsiveModal
        open={provOpen}
        onClose={() => setProvOpen(false)}
        title="สร้างบัญชีผู้ใช้ SSO จากทะเบียนบุคลากร"
        subtitle="Username = เลขบัตรประชาชน 13 หลัก, รหัสเริ่มต้น = 6 หลักท้าย (บังคับเปลี่ยนครั้งแรก)"
        icon="fa-user-plus"
        maxWidthClass="max-w-2xl"
        footer={
          <>
            <button type="button" onClick={() => setProvOpen(false)} className="bma-btn-outline">
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={provisioning || selectedPidList.length === 0}
              onClick={() => void handleBulkProvision()}
              className="bma-btn-primary"
            >
              <i className={`fa-solid ${provisioning ? 'fa-spinner fa-spin' : 'fa-bolt'}`} />
              สร้างบัญชี ({selectedPidList.length} คน)
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              type="text"
              value={provSearch}
              onChange={(e) => setProvSearch(e.target.value)}
              placeholder="ค้นหาชื่อ-สกุล หรือสังกัด..."
              className="bma-input text-xs flex-1 min-w-[200px]"
            />
            <button
              type="button"
              onClick={() =>
                setSelectedPidList(
                  selectedPidList.length === eligiblePersonnel.length
                    ? []
                    : eligiblePersonnel.map((p) => p.id)
                )
              }
              className="bma-btn-outline text-xs py-1.5"
            >
              {selectedPidList.length === eligiblePersonnel.length && eligiblePersonnel.length > 0
                ? 'ยกเลิกเลือกทั้งหมด'
                : `เลือกทั้งหมด (${eligiblePersonnel.length})`}
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            {eligiblePersonnel.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-400">
                บุคลากรที่พร้อมสร้างบัญชีในขอบเขตของคุณมีบัญชี SSO ครบแล้วทุกคน
              </p>
            ) : (
              eligiblePersonnel.map((p) => {
                const checked = selectedPidList.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className="flex items-center justify-between gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelectedPidList((prev) =>
                            e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                          )
                        }
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-slate-800 dark:text-white truncate">{p.full_name}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {formatOrgDisplay({ officeName: p.office_name, departmentName: p.department_name }).full || '-'}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-slate-400 shrink-0">{maskCid(p.cid)}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </ResponsiveModal>

      <UserRoleScopeModal
        open={Boolean(scopeTarget)}
        onClose={() => setScopeTarget(null)}
        targetUser={scopeTarget}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['users'] })}
      />
    </AdminLayout>
  );
}

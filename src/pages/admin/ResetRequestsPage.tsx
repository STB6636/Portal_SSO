import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Swal from 'sweetalert2';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { OrgHierarchyFilter } from '@/components/common/OrgHierarchyFilter';
import { DriveImage } from '@/components/common/DriveImage';
import { sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import { useSettings } from '@/contexts/SettingsContext';
import { useMasterData } from '@/hooks/useMasterData';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import { resetRequestService, type ResetRequestEnriched } from '@/services/resetRequestService';
import { QUERY_KEYS } from '@/lib/queryClient';
import { useUiStore } from '@/stores/useUiStore';
import { confirmAction } from '@/lib/swalHelpers';
import { formatThaiDateTime } from '@/lib/thaiDate';
import {
  cleanDisplaySegment,
  formatCivilServantPosition,
  formatOrgDisplay,
} from '@/lib/positionFormatter';
import {
  createPersonnelHierarchyComparator,
  flattenOrgUnitsInTreeOrder,
} from '@/lib/masterDataSort';
import type { OrgFilterState } from '@/types/domain.types';

type ResetStatusTab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
type ResetOrgGroupMode = 'office_dept' | 'office_dept_div';

const STATUS_TABS: Array<{ key: ResetStatusTab; label: string; icon: string }> = [
  { key: 'PENDING', label: 'รออนุมัติ', icon: 'fa-hourglass-half' },
  { key: 'APPROVED', label: 'อนุมัติแล้ว', icon: 'fa-circle-check' },
  { key: 'REJECTED', label: 'ไม่อนุมัติ', icon: 'fa-circle-xmark' },
  { key: 'ALL', label: 'ทั้งหมด', icon: 'fa-list' },
];

interface ResetDivisionBucket {
  key: string;
  label: string;
  rank: number;
  rows: ResetRequestEnriched[];
}

interface ResetOrgGroupSection {
  key: string;
  headerLabel: string;
  officeRank: number;
  deptRank: number;
  totalCount: number;
  rows: ResetRequestEnriched[];
  divisions: ResetDivisionBucket[];
}

async function promptRejectReason(count: number): Promise<{ confirmed: boolean; reason?: string }> {
  const isDark = document.documentElement.classList.contains('dark');
  const res = await Swal.fire({
    title: `ยืนยันไม่อนุมัติคำขอรีเซ็ตรหัส (${count} รายการ)`,
    text: 'สามารถระบุเหตุผลการไม่อนุมัติเพิ่มเติมได้ (ไม่บังคับ)',
    input: 'text',
    inputPlaceholder: 'เช่น ไม่พบการยืนยันตัวตน / ข้อมูลไม่ตรงกัน',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ยืนยันไม่อนุมัติ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#DC2626',
    cancelButtonColor: '#64748B',
    background: isDark ? '#11231B' : '#FFFFFF',
    color: isDark ? '#F1F5F9' : '#1E293B',
    reverseButtons: true,
  });
  return {
    confirmed: Boolean(res.isConfirmed),
    reason: typeof res.value === 'string' && res.value.trim() ? res.value.trim() : undefined,
  };
}

export default function ResetRequestsPage() {
  const { settings } = useSettings();
  const { data: master } = useMasterData();
  const { isSuperAdmin } = useScopedPermissions();
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);

  const [statusTab, setStatusTab] = useState<ResetStatusTab>('PENDING');
  const [groupBy, setGroupBy] = useState<ResetOrgGroupMode>('office_dept');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [orgFilter, setOrgFilter] = useState<OrgFilterState>({
    bureauId: '',
    officeId: '',
    departmentId: '',
    divisionId: '',
  });

  const hierarchyComparator = useMemo(() => createPersonnelHierarchyComparator(master), [master]);
  const orgRankMap = useMemo(() => {
    const map = new Map<string, number>();
    flattenOrgUnitsInTreeOrder(master.orgUnits, { activeOnly: false }).forEach((node, idx) => {
      map.set(node.unit.id, idx + 1);
    });
    return map;
  }, [master.orgUnits]);

  const {
    data: requests = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.resetRequests('ALL'),
    queryFn: () => resetRequestService.list(),
  });

  const getRequesterPosition = (r: ResetRequestEnriched) => {
    const u = r.user;
    if (!u) return '-';
    return (
      cleanDisplaySegment(u.position_display) ||
      formatCivilServantPosition(u.position_name, u.position_level_name, u.position_type_name, {
        positionTypeCode: u.position_type_code,
        bureauName: u.bureau_name,
        officeName: u.office_name,
        departmentName: u.department_name,
        divisionName: u.division_name,
        fallbackBureauName: settings.bureau_name,
      })
    );
  };

  // Persistent pending total count across all tabs (mirrors ApprovalsPage.jsx)
  const statusCounts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const r of requests) {
      if (r.status === 'PENDING') pending += 1;
      else if (r.status === 'APPROVED') approved += 1;
      else if (r.status === 'REJECTED') rejected += 1;
    }
    return {
      PENDING: pending,
      APPROVED: approved,
      REJECTED: rejected,
      ALL: requests.length,
    };
  }, [requests]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusTab !== 'ALL' && r.status !== statusTab) return false;
      const u = r.user;
      if (orgFilter.bureauId && u?.bureau_id !== orgFilter.bureauId) return false;
      if (orgFilter.officeId && u?.office_id !== orgFilter.officeId) return false;
      if (orgFilter.departmentId && u?.department_id !== orgFilter.departmentId) return false;
      if (orgFilter.divisionId && u?.division_id !== orgFilter.divisionId) return false;
      if (q) {
        const hay = `${u?.full_name || ''} ${u?.username || ''} ${u?.cid_masked || ''} ${getRequesterPosition(r)} ${u?.office_name || ''} ${u?.department_name || ''} ${u?.division_name || ''} ${r.reason || ''} ${r.reject_reason || ''} ${r.handled_by_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [requests, statusTab, orgFilter, search, settings.bureau_name]);

  const groupedSections = useMemo<ResetOrgGroupSection[]>(() => {
    const map = new Map<string, ResetOrgGroupSection>();

    const compareRequests = (a: ResetRequestEnriched, b: ResetRequestEnriched) => {
      // Newest request first; tie-break by personnel hierarchy
      const tDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (tDiff !== 0) return tDiff;
      if (a.user && b.user) return hierarchyComparator(a.user, b.user);
      return 0;
    };

    for (const r of filtered) {
      const u = r.user;
      const officeName = cleanDisplaySegment(u?.office_name);
      const deptName = cleanDisplaySegment(u?.department_name);
      const divName = cleanDisplaySegment(u?.division_name);

      const officeKey = u?.office_id || '__NO_OFFICE__';
      const deptKey = u?.department_id || '__NO_DEPT__';
      const officeRank = u?.office_id ? (orgRankMap.get(u.office_id) ?? Number.MAX_SAFE_INTEGER) : 0;
      const deptRank = u?.department_id ? (orgRankMap.get(u.department_id) ?? Number.MAX_SAFE_INTEGER) : 0;

      const secKey = `${officeKey}::${deptKey}`;
      let headerLabel = '';
      if (officeName && deptName) headerLabel = `${officeName} > ${deptName}`;
      else if (officeName) headerLabel = officeName;
      else if (deptName) headerLabel = deptName;
      else headerLabel = 'ส่วนกลาง / ไม่ระบุสังกัด';

      let sec = map.get(secKey);
      if (!sec) {
        sec = {
          key: secKey,
          headerLabel,
          officeRank,
          deptRank,
          totalCount: 0,
          rows: [],
          divisions: [],
        };
        map.set(secKey, sec);
      }

      sec.totalCount += 1;
      sec.rows.push(r);

      if (groupBy === 'office_dept_div') {
        const divKey = u?.division_id || '__NO_DIV__';
        const divRank = u?.division_id ? (orgRankMap.get(u.division_id) ?? Number.MAX_SAFE_INTEGER) : 0;
        const divLabel = divName || 'สังกัดส่วน/ฝ่ายโดยตรง';
        let divBucket = sec.divisions.find((d) => d.key === divKey);
        if (!divBucket) {
          divBucket = { key: divKey, label: divLabel, rank: divRank, rows: [] };
          sec.divisions.push(divBucket);
        }
        divBucket.rows.push(r);
      }
    }

    const sections = Array.from(map.values()).sort(
      (a, b) =>
        a.officeRank - b.officeRank ||
        a.deptRank - b.deptRank ||
        a.headerLabel.localeCompare(b.headerLabel, 'th')
    );

    for (const sec of sections) {
      sec.rows.sort(compareRequests);
      sec.divisions.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'th'));
      for (const div of sec.divisions) {
        div.rows.sort(compareRequests);
      }
    }

    return sections;
  }, [filtered, groupBy, orgRankMap, hierarchyComparator]);

  const pendingVisibleIds = useMemo(
    () => filtered.filter((r) => r.status === 'PENDING').map((r) => r.id),
    [filtered]
  );

  const selectedValidIds = useMemo(
    () => selectedIds.filter((id) => pendingVisibleIds.includes(id)),
    [selectedIds, pendingVisibleIds]
  );

  const allVisibleSelected =
    pendingVisibleIds.length > 0 && pendingVisibleIds.every((id) => selectedValidIds.includes(id));

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleDecision = async (ids: string[], approve: boolean) => {
    if (!ids.length || processing) return;

    let rejectReason: string | undefined;
    if (approve) {
      const ok = await confirmAction(
        `ยืนยันอนุมัติรีเซ็ตรหัสเข้าใช้ (${ids.length} รายการ)`,
        'ระบบจะรีเซ็ตรหัสผ่านกลับเป็นตัวเลข 6 หลักท้าย CID และบังคับให้ผู้ใช้งานเปลี่ยนรหัสเข้าใช้ใหม่เมื่อเข้าสู่ระบบครั้งถัดไป',
        'ยืนยันอนุมัติ',
        'question'
      );
      if (!ok) return;
    } else {
      const prompt = await promptRejectReason(ids.length);
      if (!prompt.confirmed) return;
      rejectReason = prompt.reason;
    }

    setProcessing(true);
    try {
      const res =
        ids.length === 1
          ? await resetRequestService.approveOrReject(ids[0], approve, rejectReason)
          : await resetRequestService.bulkApproveOrReject(ids, approve, rejectReason);

      await Promise.all([
        qc.invalidateQueries({ queryKey: QUERY_KEYS.resetRequests('ALL') }),
        qc.invalidateQueries({ queryKey: QUERY_KEYS.resetRequests('PENDING') }),
      ]);
      setSelectedIds([]);
      showToast(
        res?.message || (approve ? 'อนุมัติรีเซ็ตรหัสเข้าใช้เรียบร้อยแล้ว' : 'ปฏิเสธคำขอเรียบร้อยแล้ว'),
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถดำเนินการได้', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const renderAvatar = (r: ResetRequestEnriched) => {
    const photoUrl = sanitizeImageUrl(r.user?.photo_path);
    const label = r.user?.full_name || r.user?.username || 'U';
    const initials = label.trim().slice(0, 2);
    const fallbackNode = (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white font-extrabold text-[11px] flex items-center justify-center shrink-0">
        {initials}
      </div>
    );
    if (photoUrl) {
      return (
        <DriveImage
          src={photoUrl}
          alt={label}
          category="image"
          className="w-8 h-8 rounded-full object-cover border border-indigo-400/30 shrink-0"
          fallback={fallbackNode}
        />
      );
    }
    return fallbackNode;
  };

  const renderStatusBadge = (r: ResetRequestEnriched) => {
    if (r.status === 'PENDING') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
          <i className="fa-solid fa-hourglass-half text-[9px]" />
          รออนุมัติ
        </span>
      );
    }
    if (r.status === 'APPROVED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
          <i className="fa-solid fa-circle-check text-[9px]" />
          อนุมัติแล้ว
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
        <i className="fa-solid fa-circle-xmark text-[9px]" />
        ไม่อนุมัติ
      </span>
    );
  };

  let desktopSeq = 1;
  let mobileSeq = 1;

  const renderDesktopRow = (r: ResetRequestEnriched, seq: number) => {
    const isPending = r.status === 'PENDING';
    const posText = getRequesterPosition(r);
    const orgText = formatOrgDisplay({
      officeName: r.user?.office_name,
      departmentName: r.user?.department_name,
      divisionName: r.user?.division_name,
    });

    return (
      <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
        <td className="px-3 py-3 text-center">
          {isPending && (
            <input
              type="checkbox"
              checked={selectedValidIds.includes(r.id)}
              onChange={() => toggleSelect(r.id)}
            />
          )}
        </td>
        <td className="px-3 py-3 text-center font-mono text-slate-400">{seq}</td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {renderAvatar(r)}
            <div className="min-w-0">
              <p className="font-bold text-slate-800 dark:text-white truncate">
                {r.user?.full_name || r.user?.username || '-'}
              </p>
              <p className="font-mono text-[11px] text-slate-400 truncate">
                {r.user?.username || '-'} · {r.user?.cid_masked || '-'}
              </p>
            </div>
          </div>
        </td>
        <td className="px-3 py-3">
          <p className="font-semibold text-slate-700 dark:text-slate-200">{posText || '-'}</p>
          <p className="text-[11px] text-slate-400">{orgText.full || '-'}</p>
        </td>
        <td className="px-3 py-3 whitespace-nowrap font-mono text-[11px] text-slate-600 dark:text-slate-300">
          {formatThaiDateTime(r.created_at) || '-'}
        </td>
        <td className="px-3 py-3 max-w-[240px] space-y-1">
          <span className="inline-block px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-semibold border border-amber-200/70 dark:border-amber-800/60">
            {r.reason || 'ขอรีเซ็ตรหัสเข้าใช้เริ่มต้น'}
          </span>
          {r.reject_reason && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
              เหตุผลปฏิเสธ: {r.reject_reason}
            </p>
          )}
        </td>
        <td className="px-3 py-3 whitespace-nowrap space-y-1">
          {renderStatusBadge(r)}
          {!isPending && (r.handled_by_name || r.handled_at) && (
            <div className="text-[10px] text-slate-400 space-y-0.5">
              {r.handled_by_name && <p className="font-semibold text-slate-600 dark:text-slate-300">โดย: {r.handled_by_name}</p>}
              {r.handled_at && <p className="font-mono">{formatThaiDateTime(r.handled_at)}</p>}
            </div>
          )}
        </td>
        <td className="px-3 py-3 text-center">
          {isPending ? (
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                title="อนุมัติรีเซ็ต (CID 6 หลักท้าย)"
                disabled={processing}
                onClick={() => void handleDecision([r.id], true)}
                className="w-8 h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-xs disabled:opacity-50 transition"
              >
                <i className="fa-solid fa-check" />
              </button>
              <button
                type="button"
                title="ไม่อนุมัติ"
                disabled={processing}
                onClick={() => void handleDecision([r.id], false)}
                className="w-8 h-8 rounded-xl bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-xs disabled:opacity-50 transition"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-slate-400 font-semibold">ดำเนินการแล้ว</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <AdminLayout
      title="คำขอรีเซ็ตรหัสเข้าใช้"
      subtitle="พิจารณาอนุมัติคำขอรีเซ็ตรหัสเริ่มต้น (CID 6 หลักท้าย) แยกตามสังกัดในขอบเขตที่รับผิดชอบ"
      activePage="reset-requests"
    >
      <div className="pt-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md overflow-visible">
          {/* Floating Emerald Header (-mt-6) with Persistent Pending Badge & Bulk Actions Always Visible */}
          <div className="-mt-6 mx-4 px-5 py-4 rounded-2xl bg-gradient-to-r from-[#00351B] via-[#00744B] to-[#00A368] text-white shadow-lg flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <i className="fa-solid fa-key text-lg" />
              <div>
                <h2 className="font-extrabold text-sm sm:text-base flex flex-wrap items-center gap-2">
                  <span>รายการคำขอรีเซ็ตรหัสเข้าใช้</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 text-xs font-extrabold">
                    {statusCounts.PENDING} รออนุมัติ
                  </span>
                </h2>
                <p className="text-[11px] text-emerald-100 mt-0.5">
                  อนุมัติแล้วระบบจะตั้งรหัสเริ่มต้นเป็นเลข 6 หลักท้าย CID และบังคับเปลี่ยนรหัสครั้งแรก
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={processing || selectedValidIds.length === 0}
                onClick={() => void handleDecision(selectedValidIds, true)}
                className="px-3 py-1.5 rounded-xl bg-white text-[#00744B] hover:bg-emerald-50 text-xs font-extrabold shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <i className="fa-solid fa-check-double mr-1" />
                อนุมัติที่เลือก ({selectedValidIds.length})
              </button>
              <button
                type="button"
                disabled={processing || selectedValidIds.length === 0}
                onClick={() => void handleDecision(selectedValidIds, false)}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <i className="fa-solid fa-xmark mr-1" />
                ไม่อนุมัติที่เลือก
              </button>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition"
              >
                <i className={`fa-solid fa-rotate mr-1 ${isFetching ? 'fa-spin' : ''}`} />
                รีเฟรช
              </button>
            </div>
          </div>

          {/* Filter Tabs + Group Mode + Search + OrgHierarchyFilter */}
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {STATUS_TABS.map((t) => {
                  const count = statusCounts[t.key];
                  const active = statusTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        setStatusTab(t.key);
                        setSelectedIds([]);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                        active
                          ? 'bg-[#00744B] text-white shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      <i className={`fa-solid ${t.icon}`} />
                      <span>{t.label}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                          active
                            ? 'bg-white/25 text-white'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as ResetOrgGroupMode)}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold"
                >
                  <option value="office_dept">มุมมองที่ 1: สำนักงาน/กอง &gt; ส่วน/ฝ่าย</option>
                  <option value="office_dept_div">มุมมองที่ 2: สำนักงาน/กอง &gt; ส่วน/ฝ่าย &gt; กลุ่มงาน</option>
                </select>
                <div className="relative">
                  <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ค้นหาชื่อ / บัญชี / เหตุผล..."
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-7 pr-3 py-1.5 text-xs w-56"
                  />
                </div>
              </div>
            </div>

            <OrgHierarchyFilter
              orgUnits={master.orgUnits}
              value={orgFilter}
              onChange={setOrgFilter}
              showBureau={isSuperAdmin}
            />
          </div>

          {/* Mobile Select All Bar */}
          {pendingVisibleIds.length > 0 && (
            <div className="lg:hidden px-4 py-2.5 bg-emerald-50/70 dark:bg-emerald-950/30 border-b border-emerald-200/70 dark:border-emerald-800 flex items-center justify-between text-xs font-bold">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => setSelectedIds(e.target.checked ? pendingVisibleIds : [])}
                />
                <span>เลือกทั้งหมด ({pendingVisibleIds.length} รายการ)</span>
              </label>
              {selectedValidIds.length > 0 && (
                <span className="text-[#00744B] dark:text-emerald-400">เลือกแล้ว {selectedValidIds.length}</span>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="p-10 text-center text-slate-400">
              <i className="fa-solid fa-circle-notch fa-spin text-2xl text-[#00744B] mb-2" />
              <p className="text-sm font-semibold">กำลังโหลดรายการคำขอรีเซ็ตรหัสเข้าใช้...</p>
            </div>
          ) : groupedSections.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">
              ไม่มีรายการคำขอรีเซ็ตรหัสเข้าใช้ในหมวดนี้
            </div>
          ) : (
            <>
              {/* Desktop 8-Column Grouped Table (NO Pagination — 100% ApprovalsPage.jsx parity) */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 font-extrabold border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-3 py-3 w-10 text-center">
                        {pendingVisibleIds.length > 0 && (
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={(e) => setSelectedIds(e.target.checked ? pendingVisibleIds : [])}
                          />
                        )}
                      </th>
                      <th className="px-3 py-3 w-12 text-center">ลำดับ</th>
                      <th className="px-3 py-3">ผู้ขอรีเซ็ต / บัญชี</th>
                      <th className="px-3 py-3">ตำแหน่ง / สังกัด</th>
                      <th className="px-3 py-3">วันเวลาที่ขอ</th>
                      <th className="px-3 py-3">เหตุผล</th>
                      <th className="px-3 py-3">สถานะ / ผู้ดำเนินการ</th>
                      <th className="px-3 py-3 text-center">คำสั่ง</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {groupedSections.map((sec) => (
                      <React.Fragment key={sec.key}>
                        <tr className="bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-l-4 border-indigo-500">
                          <td colSpan={8} className="font-bold text-xs sm:text-sm py-2.5 px-4">
                            <i className="fa-solid fa-building-user mr-1.5" />
                            {sec.headerLabel} ({sec.totalCount} รายการ)
                          </td>
                        </tr>
                        {groupBy === 'office_dept_div'
                          ? sec.divisions.map((div) => (
                              <React.Fragment key={`${sec.key}::${div.key}`}>
                                <tr className="bg-slate-100/80 dark:bg-slate-800/50">
                                  <td
                                    colSpan={8}
                                    className="font-semibold text-xs py-2 pl-8 text-slate-700 dark:text-slate-200"
                                  >
                                    <i className="fa-solid fa-layer-group mr-1.5 text-indigo-600" />
                                    กลุ่มงาน: {div.label} ({div.rows.length} รายการ)
                                  </td>
                                </tr>
                                {div.rows.map((item) => renderDesktopRow(item, desktopSeq++))}
                              </React.Fragment>
                            ))
                          : sec.rows.map((item) => renderDesktopRow(item, desktopSeq++))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Grouped Cards */}
              <div className="lg:hidden p-3 space-y-3">
                {groupedSections.map((sec) => {
                  const flatMembers =
                    groupBy === 'office_dept_div'
                      ? sec.divisions.flatMap((d) => d.rows)
                      : sec.rows;
                  return (
                    <div key={`m-${sec.key}`} className="space-y-2">
                      <div className="rounded-xl px-3.5 py-2 font-bold text-xs bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-l-4 border-indigo-500">
                        <i className="fa-solid fa-building-user mr-1.5" />
                        {sec.headerLabel} ({sec.totalCount} รายการ)
                      </div>

                      {flatMembers.map((r) => {
                        const seq = mobileSeq++;
                        const isPending = r.status === 'PENDING';
                        return (
                          <div
                            key={r.id}
                            className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 space-y-2.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2.5 min-w-0">
                                {isPending && (
                                  <input
                                    type="checkbox"
                                    className="mt-1.5"
                                    checked={selectedValidIds.includes(r.id)}
                                    onChange={() => toggleSelect(r.id)}
                                  />
                                )}
                                {renderAvatar(r)}
                                <div className="min-w-0">
                                  <p className="font-bold text-sm text-slate-800 dark:text-white truncate">
                                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 mr-1.5 rounded bg-slate-100 dark:bg-slate-700 text-[11px] font-extrabold">
                                      {seq}
                                    </span>
                                    {r.user?.full_name || r.user?.username || '-'}
                                  </p>
                                  <p className="text-[11px] text-slate-500 truncate">
                                    {getRequesterPosition(r)}
                                  </p>
                                  <p className="font-mono text-[10px] text-slate-400">
                                    {formatThaiDateTime(r.created_at) || '-'}
                                  </p>
                                </div>
                              </div>
                              <div className="shrink-0">{renderStatusBadge(r)}</div>
                            </div>

                            <div className="text-xs bg-slate-50 dark:bg-slate-800/80 rounded-xl p-2.5 space-y-1">
                              <p className="font-semibold text-amber-700 dark:text-amber-300">
                                {r.reason || 'ขอรีเซ็ตรหัสเข้าใช้เริ่มต้น'}
                              </p>
                              {r.reject_reason && (
                                <p className="text-rose-600 dark:text-rose-400 text-[11px]">
                                  เหตุผลปฏิเสธ: {r.reject_reason}
                                </p>
                              )}
                              {!isPending && r.handled_by_name && (
                                <p className="text-slate-500 text-[11px]">
                                  ผู้ดำเนินการ: {r.handled_by_name} ({formatThaiDateTime(r.handled_at)})
                                </p>
                              )}
                            </div>

                            {isPending && (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={processing}
                                  onClick={() => void handleDecision([r.id], true)}
                                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition"
                                >
                                  <i className="fa-solid fa-check mr-1" />
                                  อนุมัติรีเซ็ต
                                </button>
                                <button
                                  type="button"
                                  disabled={processing}
                                  onClick={() => void handleDecision([r.id], false)}
                                  className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition"
                                >
                                  <i className="fa-solid fa-xmark mr-1" />
                                  ไม่อนุมัติ
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

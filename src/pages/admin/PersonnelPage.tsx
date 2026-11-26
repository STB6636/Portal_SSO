import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { OrgHierarchyFilter } from '@/components/common/OrgHierarchyFilter';
import { StatusTagChips } from '@/components/common/StatusTagChips';
import { PersonnelFormModal } from '@/components/admin/PersonnelFormModal';
import { PersonnelProfileModal } from '@/components/personnel/PersonnelProfileModal';
import { openKp7PrintTab } from '@/features/kp7-canvas/kp7Navigation';
import { deleteFromGoogleDrive } from '@/services/driveStorageService';
import { useSettings } from '@/contexts/SettingsContext';
import { useMasterData } from '@/hooks/useMasterData';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import { personnelService } from '@/services/personnelService';
import { userService } from '@/services/userService';
import { downloadDynamicExcelTemplate } from '@/features/import-grid/DynamicExcelTemplateBuilder';
import { IMPORT_COLUMNS } from '@/features/import-grid/importColumnsConfig';
import { loadExcelJS } from '@/lib/vendorBridge';
import { compareLookupItems, createPersonnelHierarchyComparator } from '@/lib/masterDataSort';
import {
  cleanDisplaySegment,
  formatCivilServantPosition,
  formatOrgDisplay,
} from '@/lib/positionFormatter';
import { maskCid } from '@/lib/cidValidator';
import { formatThaiDate, getTodayBeFileTag } from '@/lib/thaiDate';
import { confirmAction } from '@/lib/swalHelpers';
import { QUERY_KEYS } from '@/lib/queryClient';
import { useUiStore } from '@/stores/useUiStore';
import type { OrgFilterState, PersonnelDirectoryItem } from '@/types/domain.types';

interface StatusTableSection {
  id: string;
  label: string;
  colorHex: string;
  rows: PersonnelDirectoryItem[];
}

export default function PersonnelPage() {
  const { settings } = useSettings();
  const { data: master } = useMasterData();
  const { isSuperAdmin, adminScope } = useScopedPermissions();
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);

  const formatRowPosition = (r: PersonnelDirectoryItem) =>
    cleanDisplaySegment(r.position_display) ||
    formatCivilServantPosition(r.position_name, r.position_level_name, r.position_type_name, {
      positionTypeCode: r.position_type_code,
      bureauName: r.bureau_name,
      officeName: r.office_name,
      departmentName: r.department_name,
      divisionName: r.division_name,
      fallbackBureauName: settings.bureau_name,
    });

  const [search, setSearch] = useState('');
  const [selectedStatusIds, setSelectedStatusIds] = useState<string[]>([]);
  const [orgFilter, setOrgFilter] = useState<OrgFilterState>({
    bureauId: '',
    officeId: '',
    departmentId: '',
    divisionId: '',
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PersonnelDirectoryItem | null>(null);
  const [viewingPerson, setViewingPerson] = useState<PersonnelDirectoryItem | null>(null);
  const [exporting, setExporting] = useState(false);
  const [downloadingTpl, setDownloadingTpl] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.personnel(),
    queryFn: () => personnelService.listDirectory(),
  });

  const hierarchyComparator = useMemo(() => createPersonnelHierarchyComparator(master), [master]);

  const sortedStatuses = useMemo(
    () =>
      [...(master.itemsByCategoryCode['PERSONNEL_STATUS'] ?? [])]
        .filter((s) => s.is_active)
        .sort(compareLookupItems),
    [master.itemsByCategoryCode]
  );

  // Filter by Org & Search first, then sort strictly by Org + Position Hierarchy
  const orgAndSearchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (orgFilter.bureauId && r.bureau_id !== orgFilter.bureauId) return false;
        if (orgFilter.officeId && r.office_id !== orgFilter.officeId) return false;
        if (orgFilter.departmentId && r.department_id !== orgFilter.departmentId) return false;
        if (orgFilter.divisionId && r.division_id !== orgFilter.divisionId) return false;
        if (q) {
          const formattedPos = formatRowPosition(r);
          const hay = `${r.full_name} ${r.cid} ${r.position_name || ''} ${formattedPos} ${r.office_name || ''} ${r.department_name || ''} ${r.division_name || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort(hierarchyComparator);
  }, [rows, orgFilter, search, settings.bureau_name, hierarchyComparator]);

  const statusChips = useMemo(
    () => [
      { id: 'ALL', label: 'ทั้งหมด', count: orgAndSearchFiltered.length, colorHex: '#00744B' },
      ...sortedStatuses.map((st) => ({
        id: st.id,
        label: st.name_th,
        count: orgAndSearchFiltered.filter((r) => r.status_id === st.id).length,
        colorHex: st.color_hex || '#00744B',
      })),
    ],
    [sortedStatuses, orgAndSearchFiltered]
  );

  // Checkpoint C4-A Adjusted:
  // When "ทั้งหมด" (selectedStatusIds.length === 0) is active, render separate cards for EVERY status TAG
  // as if the user manually selected all TAGs; when 1+ TAGs selected, render cards for those selected TAGs.
  const tableSections = useMemo<StatusTableSection[]>(() => {
    const isAllMode = selectedStatusIds.length === 0;
    const targetStatuses = isAllMode
      ? sortedStatuses
      : sortedStatuses.filter((st) => selectedStatusIds.includes(st.id));

    const sections: StatusTableSection[] = targetStatuses.map((st) => ({
      id: st.id,
      label: st.name_th,
      colorHex: st.color_hex || '#00744B',
      rows: orgAndSearchFiltered.filter((r) => r.status_id === st.id),
    }));

    if (isAllMode) {
      const knownStatusIds = new Set(sortedStatuses.map((s) => s.id));
      const unassignedRows = orgAndSearchFiltered.filter(
        (r) => !r.status_id || !knownStatusIds.has(r.status_id)
      );
      if (unassignedRows.length > 0) {
        sections.push({
          id: '__UNASSIGNED__',
          label: 'ไม่ระบุสถานะ',
          colorHex: '#64748B',
          rows: unassignedRows,
        });
      }
    }

    return sections;
  }, [selectedStatusIds, sortedStatuses, orgAndSearchFiltered]);

  const filtered = useMemo(
    () => tableSections.flatMap((sec) => sec.rows),
    [tableSections]
  );

  const invalidateAllRelated = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['personnel'] }),
      qc.invalidateQueries({ queryKey: ['users'] }),
      qc.invalidateQueries({ queryKey: QUERY_KEYS.dashboardStats }),
    ]);
  };

  const handleProvisionOne = async (item: PersonnelDirectoryItem) => {
    try {
      const res = await userService.provisionAccounts([item.id]);
      if (res.created > 0) {
        await invalidateAllRelated();
        showToast(
          `สร้างบัญชีอัตโนมัติ (Username=CID, รหัสเริ่มต้น 6 หลักท้าย) ให้ ${item.full_name} แล้ว`,
          'success'
        );
      } else {
        const reason = res.skipped?.[0]?.reason || 'ตรวจสอบสถานะ allows_account_provision หรือบัญชีซ้ำ';
        showToast(`ไม่สามารถสร้างบัญชีได้ (${reason})`, 'warning');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'สร้างบัญชีไม่สำเร็จ', 'error');
    }
  };

  const handleDelete = async (item: PersonnelDirectoryItem) => {
    const ok = await confirmAction(
      'ลบข้อมูลบุคลากร',
      `ต้องการลบข้อมูล "${item.full_name}" ใช่หรือไม่?`,
      'ลบ',
      'warning'
    );
    if (!ok) return;
    try {
      await personnelService.deletePersonnel(item.id);
      if (item.photo_path) {
        void deleteFromGoogleDrive({ fileUrlOrId: item.photo_path, category: 'image', settings });
      }
      if (item.signature_path) {
        void deleteFromGoogleDrive({ fileUrlOrId: item.signature_path, category: 'signature', settings });
      }
      await invalidateAllRelated();
      showToast('ลบข้อมูลบุคลากรแล้ว', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ลบไม่สำเร็จ', 'error');
    }
  };

  const handleExportExcel = async () => {
    if (filtered.length === 0) {
      showToast('ไม่มีข้อมูลบุคลากรสำหรับส่งออก', 'warning');
      return;
    }
    setExporting(true);
    try {
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Personnel');
      ws.columns = [
        { header: 'เลขประจำตัวประชาชน (PDPA)', key: 'cid', width: 22 },
        { header: 'ชื่อ-นามสกุล', key: 'full_name', width: 28 },
        { header: 'วันเกิด (พ.ศ.)', key: 'birth_date', width: 16 },
        { header: 'วันบรรจุ (พ.ศ.)', key: 'start_service_date', width: 16 },
        { header: 'ตำแหน่งและระดับ', key: 'position', width: 32 },
        { header: 'สำนัก', key: 'bureau', width: 22 },
        { header: 'สำนักงาน/กอง', key: 'office', width: 26 },
        { header: 'ส่วน/ฝ่าย', key: 'dept', width: 24 },
        { header: 'กลุ่มงาน', key: 'div', width: 22 },
        { header: 'เบอร์โทร', key: 'phone', width: 16 },
        { header: 'อีเมล', key: 'email', width: 24 },
        { header: 'สถานะ', key: 'status', width: 18 },
        { header: 'บัญชี SSO', key: 'account', width: 16 },
      ];
      ws.getRow(1).eachCell((cell) => {
        cell.font = { name: 'Sarabun', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00744B' } };
      });
      for (const r of filtered) {
        ws.addRow({
          cid: maskCid(r.cid),
          full_name: r.full_name,
          birth_date: formatThaiDate(r.birth_date, 'numeric'),
          start_service_date: formatThaiDate(r.start_service_date, 'numeric'),
          position: formatRowPosition(r),
          bureau: cleanDisplaySegment(r.bureau_name),
          office: cleanDisplaySegment(r.office_name),
          dept: cleanDisplaySegment(r.department_name),
          div: cleanDisplaySegment(r.division_name),
          phone: r.phone_number || '',
          email: r.email || '',
          status: r.status_name || '',
          account: r.has_user_account ? `มีบัญชี (${r.user_role})` : 'ยังไม่มีบัญชี',
        });
      }
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PortalSSO_Personnel_Export_${getTodayBeFileTag()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`ส่งออกข้อมูลบุคลากร ${filtered.length.toLocaleString()} รายการสำเร็จ`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ส่งออก Excel ไม่สำเร็จ', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminLayout
      title="ข้อมูลบุคลากร"
      subtitle="ทะเบียนประวัติบุคลากรกลาง (เรียงลำดับตามโครงสร้างหน่วยงานและตำแหน่ง)"
      activePage="personnel"
    >
      <div className="space-y-5 pt-4">
        {/* Floating Emerald Header Card */}
        <div className="bma-card">
          <div className="-mt-6 mx-4 sm:mx-6 rounded-2xl bg-gradient-to-r from-[#00351B] via-[#00744B] to-[#00A368] text-white p-4 sm:p-5 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-base sm:text-lg flex items-center gap-2">
                <i className="fa-solid fa-id-card" />
                ทะเบียนประวัติบุคลากร ({filtered.length.toLocaleString()} / {rows.length.toLocaleString()} คน)
              </h2>
              <p className="text-xs text-emerald-100 mt-0.5">
                เพิ่มรายบุคคล นำเข้าแบบตาราง CSV/Excel ส่งออกรายงาน หรือดาวน์โหลดแม่แบบ {IMPORT_COLUMNS.length} คอลัมน์
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-white text-[#005C3B] hover:bg-emerald-50 text-xs font-extrabold shadow-sm transition inline-flex items-center gap-1.5"
              >
                <i className="fa-solid fa-user-plus" />
                + เพิ่มบุคลากร
              </button>

              <Link
                to="/admin/personnel/import"
                className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-extrabold shadow-sm transition inline-flex items-center gap-1.5"
              >
                <i className="fa-solid fa-file-import" />
                นำเข้า CSV / Excel
              </Link>

              <button
                type="button"
                disabled={exporting}
                onClick={() => void handleExportExcel()}
                className="px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-900 text-xs font-extrabold shadow-sm transition inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <i className={`fa-solid ${exporting ? 'fa-spinner fa-spin' : 'fa-file-export'}`} />
                ส่งออก Excel
              </button>

              <button
                type="button"
                disabled={downloadingTpl}
                onClick={async () => {
                  setDownloadingTpl(true);
                  try {
                    await downloadDynamicExcelTemplate(master, adminScope, isSuperAdmin);
                    showToast(`ดาวน์โหลดแม่แบบ Excel ${IMPORT_COLUMNS.length} คอลัมน์สำเร็จ`, 'success');
                  } finally {
                    setDownloadingTpl(false);
                  }
                }}
                className="px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-bold transition inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <i className={`fa-solid ${downloadingTpl ? 'fa-spinner fa-spin' : 'fa-file-excel'}`} />
                แม่แบบ Excel
              </button>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="relative max-w-md">
              <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อ-สกุล, เลขบัตรประชาชน, ตำแหน่ง, สังกัด..."
                className="bma-input pl-9 text-xs"
              />
            </div>

            <OrgHierarchyFilter
              orgUnits={master.orgUnits}
              value={orgFilter}
              onChange={setOrgFilter}
              showBureau={isSuperAdmin}
            />
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-500">
                กรองตามสถานะบุคลากร (เลือกได้หลายสถานะพร้อมกัน):
              </div>
              <StatusTagChips
                options={statusChips}
                activeIds={selectedStatusIds}
                onChange={setSelectedStatusIds}
              />
            </div>
          </div>
        </div>

        {/* Multi-TAG Split Directory Table Cards */}
        {isLoading ? (
          <div className="bma-card p-10 text-center text-xs text-slate-400">
            <i className="fa-solid fa-spinner fa-spin mr-1.5" />
            กำลังโหลดข้อมูลบุคลากร...
          </div>
        ) : tableSections.length === 0 ? (
          <div className="bma-card p-10 text-center text-xs text-slate-400">
            ไม่พบข้อมูลบุคลากรตามเงื่อนไขที่เลือก
          </div>
        ) : (
          <div className="space-y-5">
            {tableSections.map((section) => (
              <div
                key={section.id}
                className="bma-card overflow-hidden"
                style={{ borderTop: `4px solid ${section.colorHex}` }}
              >
                <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60 dark:bg-slate-900/40">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: section.colorHex }}
                    />
                    <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">
                      ตารางข้อมูลบุคลากร: {section.label}
                    </h3>
                  </div>
                  <span
                    className="px-2.5 py-0.5 rounded-full text-xs font-extrabold text-white"
                    style={{ backgroundColor: section.colorHex }}
                  >
                    รวม {section.rows.length.toLocaleString()} คน
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-100/80 dark:bg-slate-800 text-left">
                        <th className="p-3 w-12 text-center">#</th>
                        <th className="p-3">ชื่อ-นามสกุล / เลขประจำตัวประชาชน</th>
                        <th className="p-3">ตำแหน่งและระดับ</th>
                        <th className="p-3">สังกัด</th>
                        <th className="p-3">บัญชี SSO</th>
                        <th className="p-3 text-right">จัดการ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {section.rows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-slate-400">
                            ไม่มีข้อมูลบุคลากรในสถานะ "{section.label}" ตามเงื่อนไขที่ค้นหา
                          </td>
                        </tr>
                      ) : (
                        section.rows.map((item, rowIdx) => {
                          const cleanOffice = cleanDisplaySegment(item.office_name);
                          const subOrg = formatOrgDisplay({
                            departmentName: item.department_name,
                            divisionName: item.division_name,
                          }).full;
                          return (
                            <tr
                              key={item.id}
                              onClick={() => setViewingPerson(item)}
                              className="hover:bg-emerald-50/50 dark:hover:bg-slate-800/60 cursor-pointer transition"
                              title="คลิกเพื่อดูข้อมูลประวัติบุคลากร (Resume & ก.พ. ๗)"
                            >
                              <td className="p-3 text-center font-mono text-slate-400">{rowIdx + 1}</td>
                              <td className="p-3">
                                <p className="font-bold text-sm text-slate-800 dark:text-white group-hover:text-[#00744B]">
                                  {item.full_name}
                                </p>
                                <p className="font-mono text-[11px] text-slate-400">{maskCid(item.cid)}</p>
                              </td>
                              <td className="p-3 font-semibold">{formatRowPosition(item)}</td>
                              <td className="p-3">
                                <p className="font-semibold">{cleanOffice || '-'}</p>
                                {subOrg && (
                                  <p className="text-[11px] text-slate-500">{subOrg}</p>
                                )}
                              </td>
                              <td className="p-3">
                                {item.has_user_account ? (
                                  <span className="text-emerald-600 font-bold">
                                    <i className="fa-solid fa-circle-check mr-1" />
                                    มีบัญชีแล้ว ({item.user_role})
                                  </span>
                                ) : item.allows_account_provision ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleProvisionOne(item);
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-bold hover:bg-sky-100"
                                  >
                                    <i className="fa-solid fa-user-plus mr-1" />
                                    สร้างบัญชี SSO
                                  </button>
                                ) : (
                                  <span className="text-slate-400">สถานะระงับบัญชี</span>
                                )}
                              </td>
                              <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openKp7PrintTab(item.id);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 font-bold"
                                  title="พิมพ์แบบฟอร์ม ก.พ. ๗ (เปิดแท็บใหม่)"
                                >
                                  <i className="fa-solid fa-print" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditing(item);
                                    setModalOpen(true);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-100 font-bold"
                                  title="แก้ไขข้อมูลบุคลากร"
                                >
                                  <i className="fa-solid fa-pen" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDelete(item);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 font-bold"
                                  title="ลบข้อมูลบุคลากร"
                                >
                                  <i className="fa-solid fa-trash" />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <PersonnelProfileModal
        open={Boolean(viewingPerson)}
        onClose={() => setViewingPerson(null)}
        personnelId={viewingPerson?.id ?? null}
        initialPerson={viewingPerson}
        canEdit={true}
        onUpdated={() => void invalidateAllRelated()}
      />

      <PersonnelFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={editing}
        onSaved={() => void invalidateAllRelated()}
      />
    </AdminLayout>
  );
}

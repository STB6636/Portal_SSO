import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { webappService } from '@/services/webappService';
import { userService, type ScopedUserViewRow } from '@/services/userService';
import { appAccessService, type AppAccessMatrixRow } from '@/services/appAccessService';
import { useMasterData } from '@/hooks/useMasterData';
import { OrgHierarchyFilter } from '@/components/common/OrgHierarchyFilter';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { ThaiDatePicker, focusInvalidThaiDateInput } from '@/components/common/ThaiDatePicker';
import { UserAppDrawer } from '@/components/admin/UserAppDrawer';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import { formatThaiDate, isoDateToBangkokEndOfDayIso } from '@/lib/thaiDate';
import { createPersonnelHierarchyComparator } from '@/lib/masterDataSort';
import { formatOrgDisplay } from '@/lib/positionFormatter';
import { useUiStore } from '@/stores/useUiStore';
import { QUERY_KEYS } from '@/lib/queryClient';
import type { OrgFilterState } from '@/types/domain.types';

export default function AppAccessPage() {
  const qc = useQueryClient();
  const { isSuperAdmin, scopeLabel } = useScopedPermissions();
  const showToast = useUiStore((s) => s.showToast);

  const [search, setSearch] = useState('');
  const [selectedWebappId, setSelectedWebappId] = useState('');
  const [orgFilter, setOrgFilter] = useState<OrgFilterState>({
    bureauId: '',
    officeId: '',
    departmentId: '',
    divisionId: '',
  });
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [drawerUser, setDrawerUser] = useState<ScopedUserViewRow | null>(null);

  // Bulk Grant Modal state
  const bulkModalRef = useRef<HTMLDivElement | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAppId, setBulkAppId] = useState('');
  const [bulkRoleId, setBulkRoleId] = useState('');
  const [bulkAllowed, setBulkAllowed] = useState(true);
  const [bulkExpires, setBulkExpires] = useState('');
  const [bulkExpiresInvalid, setBulkExpiresInvalid] = useState(false);
  const [bulkNote, setBulkNote] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const { data: master } = useMasterData();
  const { data: webapps = [] } = useQuery({
    queryKey: QUERY_KEYS.webapps,
    queryFn: () => webappService.listAll(),
  });

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: QUERY_KEYS.users(),
    queryFn: () => userService.listScopedUsers(),
  });

  // Always fetch FULL scoped matrix once so UserAppDrawer never shows false-disabled apps when filtering!
  const { data: matrix = [] } = useQuery({
    queryKey: QUERY_KEYS.appAccess('ALL'),
    queryFn: () => appAccessService.listMatrix(),
  });

  const activeWebapps = useMemo(() => webapps.filter((w) => w.status !== 'DISABLED'), [webapps]);

  const permLookup = useMemo(() => {
    const map = new Map<string, AppAccessMatrixRow>();
    for (const row of matrix) {
      map.set(`${row.user_id}::${row.webapp_id}`, row);
    }
    return map;
  }, [matrix]);

  const hierarchyComparator = useMemo(() => createPersonnelHierarchyComparator(master), [master]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => {
        if (orgFilter.officeId && u.office_id !== orgFilter.officeId) return false;
        if (orgFilter.departmentId && u.department_id !== orgFilter.departmentId) return false;
        if (orgFilter.divisionId && u.division_id !== orgFilter.divisionId) return false;
        if (!q) return true;
        return (
          (u.full_name || '').toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          (u.office_name || '').toLowerCase().includes(q) ||
          (u.department_name || '').toLowerCase().includes(q)
        );
      })
      .sort(hierarchyComparator);
  }, [users, orgFilter, search, hierarchyComparator]);

  const displayedWebapps = useMemo(
    () => (selectedWebappId ? activeWebapps.filter((w) => w.id === selectedWebappId) : activeWebapps),
    [activeWebapps, selectedWebappId]
  );

  const bulkTargetApp = useMemo(
    () => activeWebapps.find((w) => w.id === bulkAppId) ?? null,
    [activeWebapps, bulkAppId]
  );
  const bulkGrantableRoles = useMemo(
    () =>
      (bulkTargetApp?.roles || []).filter(
        (r) => r.is_active && (isSuperAdmin || r.allow_scoped_admin_grant)
      ),
    [bulkTargetApp, isSuperAdmin]
  );

  const handleOpenBulk = () => {
    const firstApp = activeWebapps.find((w) => w.id === selectedWebappId) || activeWebapps[0];
    if (firstApp) {
      setBulkAppId(firstApp.id);
      const roles = (firstApp.roles || []).filter(
        (r) => r.is_active && (isSuperAdmin || r.allow_scoped_admin_grant)
      );
      setBulkRoleId((roles.find((r) => r.is_default_on_grant) || roles[0])?.id || '');
    }
    setBulkAllowed(true);
    setBulkExpires('');
    setBulkExpiresInvalid(false);
    setBulkNote('');
    setBulkOpen(true);
  };

  const handleConfirmBulk = async () => {
    if (!bulkAppId || !bulkRoleId || selectedUserIds.length === 0) return;
    const invalidDateInput = focusInvalidThaiDateInput(bulkModalRef.current);
    if (bulkExpiresInvalid || invalidDateInput) {
      showToast('วันหมดอายุสิทธิ์ (พ.ศ.) ไม่ถูกต้อง กรุณาแก้ไขให้ถูกต้องหรือล้างค่าก่อนบันทึก', 'error');
      return;
    }
    setBulkSaving(true);
    try {
      const count = await appAccessService.bulkGrant({
        webappId: bulkAppId,
        webappRoleId: bulkRoleId,
        userIds: selectedUserIds,
        isAllowed: bulkAllowed,
        expiresAt: isoDateToBangkokEndOfDayIso(bulkExpires),
        note: bulkNote.trim() || null,
      });
      showToast(`อัปเดตสิทธิ์เข้าถึงเว็บแอปสำเร็จ ${count} บัญชี`, 'success');
      setSelectedUserIds([]);
      setBulkOpen(false);
      await qc.invalidateQueries({ queryKey: ['app-access'] });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถอัปเดตสิทธิ์แบบกลุ่มได้', 'error');
    } finally {
      setBulkSaving(false);
    }
  };

  const selectableUsers = useMemo(
    () => filteredUsers.filter((u) => isSuperAdmin || u.role === 'USER'),
    [filteredUsers, isSuperAdmin]
  );

  const toggleSelectAll = (checked: boolean) => {
    setSelectedUserIds(checked ? selectableUsers.map((u) => u.id) : []);
  };

  return (
    <AdminLayout
      title="กำหนดสิทธิ์เข้าถึงเว็บแอปย่อย"
      subtitle="เปิด-ปิดสิทธิ์และเลือกระดับสิทธิ์เฉพาะของแต่ละเว็บแอปย่อย"
      activePage="app-access"
    >
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-600 to-emerald-600 text-white flex items-center justify-center shadow">
              <i className="fa-solid fa-shield-halved text-base" />
            </span>
            กำหนดสิทธิ์เข้าถึงเว็บแอปย่อย (App Access Matrix)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            เปิด-ปิดสิทธิ์และกำหนดระดับสิทธิ์รายเว็บแอป · ขอบเขตสิทธิ์:{' '}
            <strong className="text-[#00744B] dark:text-emerald-400">{scopeLabel}</strong>
          </p>
        </div>

        <button
          type="button"
          disabled={selectedUserIds.length === 0 || activeWebapps.length === 0}
          onClick={handleOpenBulk}
          className="bma-btn-primary disabled:opacity-45"
        >
          <i className="fa-solid fa-users-gear mr-1.5" />
          กำหนดสิทธิ์แบบกลุ่ม ({selectedUserIds.length} คน)
        </button>
      </div>

      {/* Filters */}
      <div className="bma-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass text-xs text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              className="bma-input pl-8 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อ-สกุล หรือชื่อผู้ใช้..."
            />
          </div>
          <select
            className="bma-input text-sm"
            value={selectedWebappId}
            onChange={(e) => setSelectedWebappId(e.target.value)}
          >
            <option value="">แสดงทุกเว็บแอปย่อย ({activeWebapps.length})</option>
            {activeWebapps.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.app_code})
              </option>
            ))}
          </select>
          <div className="flex items-center justify-end text-xs text-slate-500">
            แสดง {filteredUsers.length.toLocaleString()} บัญชีผู้ใช้
          </div>
        </div>
        <OrgHierarchyFilter orgUnits={master.orgUnits} value={orgFilter} onChange={setOrgFilter} />
      </div>

      {/* Access Matrix Table */}
      <div className="bma-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-left text-xs text-slate-500">
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={
                      selectableUsers.length > 0 && selectedUserIds.length === selectableUsers.length
                    }
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                  />
                </th>
                <th className="px-3 py-3 min-w-[210px]">ผู้ใช้งาน / สังกัด</th>
                {displayedWebapps.map((app) => (
                  <th key={app.id} className="px-3 py-3 text-center min-w-[140px]">
                    <div className="inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200">
                      <i className={`fa-solid ${app.icon || 'fa-window-maximize'}`} style={{ color: app.color || '#00744B' }} />
                      <span className="truncate max-w-[120px]">{app.name}</span>
                    </div>
                  </th>
                ))}
                <th className="px-3 py-3 text-right w-28">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loadingUsers ? (
                <tr>
                  <td colSpan={displayedWebapps.length + 3} className="px-4 py-10 text-center text-slate-400">
                    กำลังโหลดข้อมูลสิทธิ์...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={displayedWebapps.length + 3} className="px-4 py-10 text-center text-slate-400">
                    ไม่พบบัญชีผู้ใช้ตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const canGrantTarget = isSuperAdmin || u.role === 'USER';
                  const checked = selectedUserIds.includes(u.id);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          disabled={!canGrantTarget}
                          checked={checked}
                          onChange={(e) =>
                            setSelectedUserIds((prev) =>
                              e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-slate-800 dark:text-slate-100">
                          {u.full_name || u.username}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {formatOrgDisplay({ officeName: u.office_name, departmentName: u.department_name }).full || '-'}
                        </div>
                      </td>
                      {displayedWebapps.map((app) => {
                        if (u.role === 'SUPERADMIN') {
                          return (
                            <td key={app.id} className="px-3 py-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                                SUPERADMIN
                              </span>
                            </td>
                          );
                        }
                        const perm = permLookup.get(`${u.id}::${app.id}`);
                        return (
                          <td key={app.id} className="px-3 py-3 text-center">
                            {perm && perm.is_allowed ? (
                              <div className="inline-flex flex-col items-center gap-0.5">
                                <span
                                  className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                                  style={{ backgroundColor: perm.role_color || '#00744B' }}
                                >
                                  {perm.role_name_th}
                                </span>
                                {perm.expires_at && (
                                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                                    หมดอายุ {formatThaiDate(perm.expires_at, 'short')}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-300 dark:text-slate-600">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setDrawerUser(u)}
                          className="bma-btn-outline text-xs py-1 px-2.5"
                        >
                          <i className="fa-solid fa-sliders mr-1" />
                          ตั้งค่า
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

      {/* Single-User Drawer */}
      <UserAppDrawer
        open={Boolean(drawerUser)}
        user={drawerUser}
        webapps={activeWebapps}
        existingPermissions={matrix}
        onClose={() => setDrawerUser(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['app-access'] })}
      />

      {/* Bulk Grant Modal */}
      <ResponsiveModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`กำหนดสิทธิ์แบบกลุ่ม (${selectedUserIds.length} บัญชี)`}
        subtitle="มอบหรือยกเลิกสิทธิ์เว็บแอปย่อยพร้อมกันหลายคนในครั้งเดียว"
        icon="fa-users-gear"
        maxWidthClass="max-w-lg"
        footer={
          <>
            <button type="button" onClick={() => setBulkOpen(false)} className="bma-btn-outline">
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={bulkSaving || !bulkAppId || !bulkRoleId}
              onClick={() => void handleConfirmBulk()}
              className="bma-btn-primary"
            >
              <i className={`fa-solid ${bulkSaving ? 'fa-spinner fa-spin' : 'fa-check'} mr-1.5`} />
              ยืนยันบันทึกสิทธิ์
            </button>
          </>
        }
      >
        <div ref={bulkModalRef} className="space-y-4 text-sm">
          <div>
            <label className="bma-label">เลือกเว็บแอปย่อย</label>
            <select
              className="bma-input"
              value={bulkAppId}
              onChange={(e) => {
                const nextId = e.target.value;
                setBulkAppId(nextId);
                const app = activeWebapps.find((w) => w.id === nextId);
                const roles = (app?.roles || []).filter(
                  (r) => r.is_active && (isSuperAdmin || r.allow_scoped_admin_grant)
                );
                setBulkRoleId((roles.find((r) => r.is_default_on_grant) || roles[0])?.id || '');
              }}
            >
              {activeWebapps.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.app_code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="bma-label">ระดับสิทธิ์ในเว็บแอป</label>
            <select
              className="bma-input"
              value={bulkRoleId}
              onChange={(e) => setBulkRoleId(e.target.value)}
            >
              {bulkGrantableRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.role_name_th} ({r.role_code})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold">
              <input
                type="radio"
                checked={bulkAllowed}
                onChange={() => setBulkAllowed(true)}
              />
              อนุญาตใช้งาน
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-rose-600">
              <input
                type="radio"
                checked={!bulkAllowed}
                onChange={() => setBulkAllowed(false)}
              />
              ปิดสิทธิ์ใช้งาน
            </label>
          </div>
          <div>
            <label className="bma-label">วันหมดอายุสิทธิ์ (พ.ศ. — เว้นว่าง = ถาวร)</label>
            <ThaiDatePicker
              value={bulkExpires}
              onChange={setBulkExpires}
              onInvalidChange={(invalid) => setBulkExpiresInvalid(invalid)}
              placeholder="วว/ดด/พ.ศ. (เว้นว่าง = ถาวร)"
            />
          </div>
          <div>
            <label className="bma-label">หมายเหตุการมอบสิทธิ์ (ไม่บังคับ)</label>
            <input
              type="text"
              className="bma-input"
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
              placeholder="เช่น แต่งตั้งเป็นเจ้าหน้าที่ประจำกอง..."
            />
          </div>
        </div>
      </ResponsiveModal>
    </div>
    </AdminLayout>
  );
}

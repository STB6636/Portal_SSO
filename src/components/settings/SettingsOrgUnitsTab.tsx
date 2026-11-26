import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { useMasterData } from '@/hooks/useMasterData';
import { masterDataService } from '@/services/masterDataService';
import { QUERY_KEYS } from '@/lib/queryClient';
import { useUiStore } from '@/stores/useUiStore';
import { confirmAction } from '@/lib/swalHelpers';
import { compareOrgUnits, flattenOrgUnitsInTreeOrder } from '@/lib/masterDataSort';
import type { OrgUnitRow } from '@/types/database.types';

const LEVEL_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'สำนัก',
  2: 'สำนักงาน/กอง',
  3: 'ส่วน/ฝ่าย',
  4: 'กลุ่มงาน',
};

const LEVEL_BADGE: Record<1 | 2 | 3 | 4, string> = {
  1: 'bg-emerald-700 text-white',
  2: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  3: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
  4: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300',
};

export function SettingsOrgUnitsTab() {
  const { data: master } = useMasterData();
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);

  const [viewMode, setViewMode] = useState<'cascade' | 'tree'>('cascade');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);

  // Active selection in cascade view (mirrors SettingsPositionsTab pill pattern)
  const [activeBureauId, setActiveBureauId] = useState('');
  const [activeOfficeId, setActiveOfficeId] = useState('');
  const [activeDeptId, setActiveDeptId] = useState('');

  // 4-Step Cascading Multi-Row Add Modal
  const [addLevel, setAddLevel] = useState<1 | 2 | 3 | 4 | null>(null);
  const [selBureauId, setSelBureauId] = useState('');
  const [selOfficeId, setSelOfficeId] = useState('');
  const [selDeptId, setSelDeptId] = useState('');
  const [multiRows, setMultiRows] = useState<Array<{ name_th: string; code: string; short_name: string }>>([]);

  // Single Edit Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<OrgUnitRow> & { level_no?: 1 | 2 | 3 | 4 }>({});

  const bureaus = useMemo(
    () => master.orgUnits.filter((u) => u.level_no === 1).sort(compareOrgUnits),
    [master.orgUnits]
  );
  const offices = useMemo(
    () => master.orgUnits.filter((u) => u.level_no === 2).sort(compareOrgUnits),
    [master.orgUnits]
  );
  const departments = useMemo(
    () => master.orgUnits.filter((u) => u.level_no === 3).sort(compareOrgUnits),
    [master.orgUnits]
  );
  const divisions = useMemo(
    () => master.orgUnits.filter((u) => u.level_no === 4).sort(compareOrgUnits),
    [master.orgUnits]
  );

  // Resolve active cascading selections gracefully
  const selectedBureau = useMemo(
    () => bureaus.find((b) => b.id === activeBureauId) || bureaus[0] || null,
    [bureaus, activeBureauId]
  );
  const officesInBureau = useMemo(
    () =>
      selectedBureau
        ? offices.filter((o) => o.parent_id === selectedBureau.id)
        : offices,
    [offices, selectedBureau]
  );
  const selectedOffice = useMemo(
    () => officesInBureau.find((o) => o.id === activeOfficeId) || officesInBureau[0] || null,
    [officesInBureau, activeOfficeId]
  );
  const deptsInOffice = useMemo(() => {
    const base = selectedOffice
      ? departments.filter((d) => d.parent_id === selectedOffice.id)
      : [];
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((d) => {
      if (d.name_th.toLowerCase().includes(q) || (d.code || '').toLowerCase().includes(q)) return true;
      return divisions.some(
        (v) =>
          v.parent_id === d.id &&
          (v.name_th.toLowerCase().includes(q) || (v.code || '').toLowerCase().includes(q))
      );
    });
  }, [departments, divisions, selectedOffice, search]);

  const selectedDept = useMemo(
    () => deptsInOffice.find((d) => d.id === activeDeptId) || deptsInOffice[0] || null,
    [deptsInOffice, activeDeptId]
  );

  const divsInSelectedDept = useMemo(
    () => (selectedDept ? divisions.filter((v) => v.parent_id === selectedDept.id) : []),
    [divisions, selectedDept]
  );

  useEffect(() => {
    if (selectedBureau && activeBureauId !== selectedBureau.id) {
      setActiveBureauId(selectedBureau.id);
    }
  }, [selectedBureau, activeBureauId]);

  useEffect(() => {
    if (selectedOffice && activeOfficeId !== selectedOffice.id) {
      setActiveOfficeId(selectedOffice.id);
    }
  }, [selectedOffice, activeOfficeId]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: QUERY_KEYS.masterData });
  };

  const openStepAdd = (levelNo: 1 | 2 | 3 | 4, presetParent?: { bureauId?: string; officeId?: string; deptId?: string }) => {
    const lvlDef = master.orgUnitLevels.find((l) => l.level_no === levelNo);
    if (!lvlDef) {
      showToast('ไม่พบข้อมูลระดับหน่วยงานในฐานข้อมูล กรุณารีเฟรชหน้าเว็บ', 'error');
      return;
    }
    if (levelNo >= 2 && bureaus.length === 0) {
      showToast('กรุณาเพิ่ม "สำนัก" ก่อนเพิ่มหน่วยงานระดับถัดไป', 'warning');
      return;
    }
    if (levelNo >= 3 && offices.length === 0) {
      showToast('กรุณาเพิ่ม "สำนักงาน/กอง" ก่อนเพิ่มส่วน/ฝ่าย', 'warning');
      return;
    }
    if (levelNo === 4 && departments.length === 0) {
      showToast('กรุณาเพิ่ม "ส่วน/ฝ่าย" ก่อนเพิ่มกลุ่มงาน', 'warning');
      return;
    }

    const defBureau = presetParent?.bureauId || selectedBureau?.id || bureaus[0]?.id || '';
    const defOffice =
      presetParent?.officeId ||
      selectedOffice?.id ||
      offices.find((o) => o.parent_id === defBureau)?.id ||
      offices[0]?.id ||
      '';
    const defDept =
      presetParent?.deptId ||
      selectedDept?.id ||
      departments.find((d) => d.parent_id === defOffice)?.id ||
      departments[0]?.id ||
      '';

    setSelBureauId(defBureau);
    setSelOfficeId(defOffice);
    setSelDeptId(defDept);
    setMultiRows([{ name_th: '', code: '', short_name: '' }]);
    setAddLevel(levelNo);
  };

  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addLevel) return;
    const lvlDef = master.orgUnitLevels.find((l) => l.level_no === addLevel);
    if (!lvlDef) return;

    const parentId =
      addLevel === 1 ? null : addLevel === 2 ? selBureauId : addLevel === 3 ? selOfficeId : selDeptId;
    if (addLevel > 1 && !parentId) {
      showToast('กรุณาเลือกหน่วยงานต้นสังกัดก่อนบันทึก', 'warning');
      return;
    }

    const valid = multiRows.filter((r) => r.name_th.trim());
    if (valid.length === 0) {
      showToast('กรุณากรอกชื่อหน่วยงานอย่างน้อย 1 รายการ', 'warning');
      return;
    }

    setSaving(true);
    try {
      const siblingCount = master.orgUnits.filter(
        (u) => u.level_no === addLevel && (u.parent_id || null) === (parentId || null)
      ).length;
      await masterDataService.saveOrgUnitsBatch(
        valid.map((r, i) => ({
          level_id: lvlDef.id,
          parent_id: parentId,
          name_th: r.name_th,
          code: r.code,
          short_name: r.short_name,
          sort_order: siblingCount + i + 1,
        }))
      );
      await refresh();
      setAddLevel(null);
      showToast(`เพิ่ม${LEVEL_LABELS[addLevel]} สำเร็จ ${valid.length} รายการ`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'เพิ่มหน่วยงานไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing.name_th?.trim()) {
      showToast('กรุณาระบุชื่อหน่วยงาน', 'warning');
      return;
    }
    setSaving(true);
    try {
      await masterDataService.saveOrgUnit(editing);
      await refresh();
      setEditModalOpen(false);
      showToast('อัปเดตหน่วยงานเรียบร้อย', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u: OrgUnitRow) => {
    const ok = await confirmAction('ลบหน่วยงาน', `ต้องการลบ "${u.name_th}" ใช่หรือไม่?`, 'ลบ', 'warning');
    if (!ok) return;
    try {
      await masterDataService.deleteOrgUnit(u.id);
      await refresh();
      showToast('ลบหน่วยงานเรียบร้อย', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถลบได้ (อาจมีหน่วยงานลูกหรือบุคลากรสังกัดอยู่)', 'error');
    }
  };

  const handleToggleActive = async (u: OrgUnitRow) => {
    try {
      await masterDataService.toggleActive('org_units', u.id, !u.is_active);
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'เปลี่ยนสถานะไม่สำเร็จ', 'error');
    }
  };

  const moveWithinList = async (siblings: OrgUnitRow[], idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (reordering || idx < 0 || targetIdx < 0 || targetIdx >= siblings.length) return;
    const nextIds = siblings.map((s) => s.id);
    [nextIds[idx], nextIds[targetIdx]] = [nextIds[targetIdx], nextIds[idx]];
    setReordering(true);
    try {
      await masterDataService.reorderSortOrder('org_units', nextIds);
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'สลับลำดับไม่สำเร็จ', 'error');
    } finally {
      setReordering(false);
    }
  };

  const renderTree = (parentId: string | null, depth = 0) => {
    const children = master.orgUnits
      .filter((u) => (u.parent_id || null) === parentId)
      .sort(compareOrgUnits);
    if (children.length === 0) return null;

    return (
      <div
        className={
          depth > 0
            ? 'ml-5 pl-3 border-l-2 border-emerald-200 dark:border-emerald-900 space-y-2 mt-2'
            : 'space-y-2'
        }
      >
        {children.map((u, idx) => {
          const lv = (u.level_no ?? 1) as 1 | 2 | 3 | 4;
          return (
            <div key={u.id}>
              <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold shrink-0 ${LEVEL_BADGE[lv]}`}>
                    {LEVEL_LABELS[lv]}
                  </span>
                  <span className={`font-bold text-sm truncate ${!u.is_active ? 'line-through opacity-50' : ''}`}>
                    {u.name_th}
                  </span>
                  {u.code && <span className="text-[11px] font-mono text-slate-400">({u.code})</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={reordering || idx === 0}
                    onClick={() => void moveWithinList(children, idx, -1)}
                    className="btn-sort-arrow"
                    title="เลื่อนขึ้น"
                  >
                    <i className="fa-solid fa-chevron-up" />
                  </button>
                  <button
                    type="button"
                    disabled={reordering || idx === children.length - 1}
                    onClick={() => void moveWithinList(children, idx, 1)}
                    className="btn-sort-arrow"
                    title="เลื่อนลง"
                  >
                    <i className="fa-solid fa-chevron-down" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleActive(u)}
                    className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs"
                    title={u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                  >
                    <i className={`fa-solid ${u.is_active ? 'fa-eye' : 'fa-eye-slash'}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing({ ...u });
                      setEditModalOpen(true);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs"
                    title="แก้ไข"
                  >
                    <i className="fa-solid fa-pen" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(u)}
                    className="px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-xs"
                    title="ลบ"
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
              {renderTree(u.id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  const parentCandidatesForEdit =
    editing.level_no && editing.level_no > 1
      ? flattenOrgUnitsInTreeOrder(master.orgUnits, { activeOnly: false })
          .map((n) => n.unit)
          .filter((u) => u.level_no === editing.level_no! - 1 && u.id !== editing.id)
      : [];

  // Raw (unfiltered) siblings of selectedOffice for reliable reordering in main table
  const rawDeptsInOffice = useMemo(
    () => (selectedOffice ? departments.filter((d) => d.parent_id === selectedOffice.id) : []),
    [departments, selectedOffice]
  );

  return (
    <div className="space-y-6 pt-4">
      {/* Main Card with Floating Emerald Header (Mirrors SettingsPositionsTab UX) */}
      <div className="bma-card">
        <div className="-mt-6 mx-4 sm:mx-6 rounded-2xl bg-gradient-to-r from-[#00351B] via-[#00744B] to-[#00A368] text-white p-4 sm:p-5 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="font-extrabold text-base flex items-center gap-2">
              <i className="fa-solid fa-sitemap" />
              โครงสร้างหน่วยงาน 4 ระดับ ({master.orgUnits.length} หน่วย)
            </h3>
            <p className="text-xs text-emerald-100 mt-0.5">
              1. สำนัก → 2. สำนักงาน/กอง → 3. ส่วน/ฝ่าย → 4. กลุ่มงาน
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => openStepAdd(1)}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-bold transition"
            >
              1. + สำนัก
            </button>
            <button
              type="button"
              onClick={() => openStepAdd(2)}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-bold transition"
            >
              2. + สำนักงาน/กอง
            </button>
            <button
              type="button"
              onClick={() => openStepAdd(3)}
              className="px-3 py-1.5 rounded-xl bg-white text-[#005C3B] hover:bg-emerald-50 text-xs font-extrabold transition shadow-sm"
            >
              3. + ส่วน/ฝ่าย
            </button>
            <button
              type="button"
              onClick={() => openStepAdd(4)}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-bold transition"
            >
              4. + กลุ่มงาน
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <i className="fa-solid fa-magnifying-glass text-xs text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อส่วน/ฝ่าย หรือกลุ่มงาน..."
                className="bma-input pl-8 text-xs"
              />
            </div>

            <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-1 bg-slate-50 dark:bg-slate-800/60 text-xs font-bold">
              <button
                type="button"
                onClick={() => setViewMode('cascade')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  viewMode === 'cascade' ? 'bg-[#00744B] text-white' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <i className="fa-solid fa-layer-group mr-1.5" />
                จัดการทีละระดับ
              </button>
              <button
                type="button"
                onClick={() => setViewMode('tree')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  viewMode === 'tree' ? 'bg-[#00744B] text-white' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <i className="fa-solid fa-diagram-project mr-1.5" />
                มุมมองต้นไม้
              </button>
            </div>
          </div>

          {master.orgUnits.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              ยังไม่มีโครงสร้างหน่วยงาน — เริ่มคลิก <strong>"1. + สำนัก"</strong> ด้านบนเพื่อสร้างระดับแรก
            </div>
          ) : viewMode === 'tree' ? (
            renderTree(null)
          ) : (
            <div className="space-y-4">
              {/* Step 1 Pills: สำนัก */}
              {bureaus.length > 1 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-500">เลือกสำนัก:</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {bureaus.map((b) => {
                      const active = selectedBureau?.id === b.id;
                      const cnt = offices.filter((o) => o.parent_id === b.id).length;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            setActiveBureauId(b.id);
                            setActiveOfficeId('');
                            setActiveDeptId('');
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 ${
                            active
                              ? 'bg-[#00351B] text-white border-[#00351B] shadow-sm'
                              : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <span>{b.name_th}</span>
                          <span
                            className={`px-1.5 rounded text-[10px] ${
                              active ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700'
                            }`}
                          >
                            {cnt}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 2 Pills: สำนักงาน/กอง */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-500">
                  สำนักงาน/กอง {selectedBureau ? `สังกัด ${selectedBureau.name_th}` : ''}:
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {officesInBureau.length === 0 ? (
                    <span className="text-xs text-slate-400">
                      ยังไม่มีสำนักงาน/กอง คลิก <strong>"2. + สำนักงาน/กอง"</strong> ด้านบน
                    </span>
                  ) : (
                    officesInBureau.map((off) => {
                      const active = selectedOffice?.id === off.id;
                      const cnt = departments.filter((d) => d.parent_id === off.id).length;
                      return (
                        <button
                          key={off.id}
                          type="button"
                          onClick={() => {
                            setActiveOfficeId(off.id);
                            setActiveDeptId('');
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 ${
                            active
                              ? 'bg-[#00744B] text-white border-[#00744B] shadow-sm'
                              : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-400'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full bg-current opacity-70" />
                          <span>{off.name_th}</span>
                          <span
                            className={`px-1.5 rounded text-[10px] ${
                              active ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700'
                            }`}
                          >
                            {cnt}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Step 3 Table: ส่วน/ฝ่าย under selectedOffice + Step 4 กลุ่มงาน badges */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 text-left">
                      <th className="py-2 pr-2 w-16">ลำดับ</th>
                      <th className="py-2 pr-2">ชื่อส่วน/ฝ่าย</th>
                      <th className="py-2 pr-2">กลุ่มงานภายใต้สังกัด</th>
                      <th className="py-2 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {deptsInOffice.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400">
                          {selectedOffice
                            ? `ยังไม่มีส่วน/ฝ่ายใน "${selectedOffice.name_th}" คลิกปุ่ม "3. + ส่วน/ฝ่าย" ด้านบน`
                            : 'กรุณาเลือกหรือเพิ่มสำนักงาน/กองก่อน'}
                        </td>
                      </tr>
                    ) : (
                      deptsInOffice.map((dept) => {
                        const rawIdx = rawDeptsInOffice.findIndex((d) => d.id === dept.id);
                        const deptDivs = divisions.filter((v) => v.parent_id === dept.id);
                        const isFocused = selectedDept?.id === dept.id;
                        return (
                          <tr
                            key={dept.id}
                            onClick={() => setActiveDeptId(dept.id)}
                            className={`cursor-pointer transition ${
                              !dept.is_active ? 'opacity-50' : ''
                            } ${isFocused ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                          >
                            <td className="py-2.5 pr-2" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={reordering || Boolean(search.trim()) || rawIdx <= 0}
                                  onClick={() => void moveWithinList(rawDeptsInOffice, rawIdx, -1)}
                                  className="btn-sort-arrow"
                                  title="เลื่อนขึ้น"
                                >
                                  <i className="fa-solid fa-chevron-up" />
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    reordering || Boolean(search.trim()) || rawIdx >= rawDeptsInOffice.length - 1
                                  }
                                  onClick={() => void moveWithinList(rawDeptsInOffice, rawIdx, 1)}
                                  className="btn-sort-arrow"
                                  title="เลื่อนลง"
                                >
                                  <i className="fa-solid fa-chevron-down" />
                                </button>
                              </div>
                            </td>
                            <td className="py-2.5 pr-2">
                              <div className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                                {isFocused && <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />}
                                <span>{dept.name_th}</span>
                                {dept.code && (
                                  <span className="text-[10px] font-mono text-slate-400">({dept.code})</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 pr-2">
                              <div className="flex flex-wrap items-center gap-1">
                                {deptDivs.length === 0 ? (
                                  <span className="text-[11px] text-slate-400">ไม่มีกลุ่มงานย่อย</span>
                                ) : (
                                  deptDivs.map((v) => (
                                    <span
                                      key={v.id}
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                        v.is_active
                                          ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                                          : 'bg-slate-200 text-slate-500 line-through'
                                      }`}
                                    >
                                      {v.name_th}
                                    </span>
                                  ))
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openStepAdd(4, {
                                      bureauId: selectedBureau?.id,
                                      officeId: selectedOffice?.id,
                                      deptId: dept.id,
                                    });
                                  }}
                                  className="px-1.5 py-0.5 rounded-full border border-dashed border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-300 text-[10px] font-bold hover:bg-violet-50 dark:hover:bg-violet-950/40"
                                  title="เพิ่มกลุ่มงานในส่วน/ฝ่ายนี้"
                                >
                                  + กลุ่มงาน
                                </button>
                              </div>
                            </td>
                            <td
                              className="py-2.5 text-right whitespace-nowrap space-x-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => void handleToggleActive(dept)}
                                className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800"
                                title={dept.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                              >
                                <i className={`fa-solid ${dept.is_active ? 'fa-eye' : 'fa-eye-slash'}`} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing({ ...dept });
                                  setEditModalOpen(true);
                                }}
                                className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800"
                                title="แก้ไข"
                              >
                                <i className="fa-solid fa-pen" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(dept)}
                                className="px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600"
                                title="ลบ"
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
          )}
        </div>
      </div>

      {/* Bottom 2-Column Master Management Strip (Mirrors SettingsPositionsTab) */}
      {viewMode === 'cascade' && master.orgUnits.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left: สำนัก และ สำนักงาน/กอง */}
          <div className="bma-card p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-extrabold text-sm text-slate-800 dark:text-white">
                จัดการสำนัก และ สำนักงาน/กอง ({bureaus.length + offices.length})
              </h4>
              <button
                type="button"
                onClick={() => openStepAdd(2)}
                className="bma-btn-outline text-xs py-1"
              >
                <i className="fa-solid fa-plus text-emerald-600" />
                เพิ่มสำนักงาน/กอง
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {bureaus.map((b, bIdx) => {
                const childOffices = offices.filter((o) => o.parent_id === b.id);
                return (
                  <div key={b.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex gap-0.5">
                          <button
                            type="button"
                            disabled={reordering || bIdx === 0}
                            onClick={() => void moveWithinList(bureaus, bIdx, -1)}
                            className="btn-sort-arrow"
                          >
                            <i className="fa-solid fa-chevron-up" />
                          </button>
                          <button
                            type="button"
                            disabled={reordering || bIdx === bureaus.length - 1}
                            onClick={() => void moveWithinList(bureaus, bIdx, 1)}
                            className="btn-sort-arrow"
                          >
                            <i className="fa-solid fa-chevron-down" />
                          </button>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${LEVEL_BADGE[1]}`}>
                          สำนัก
                        </span>
                        <span className="font-extrabold truncate">{b.name_th}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing({ ...b });
                            setEditModalOpen(true);
                          }}
                          className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                        >
                          <i className="fa-solid fa-pen" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(b)}
                          className="px-2 py-1 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600"
                        >
                          <i className="fa-solid fa-trash" />
                        </button>
                      </div>
                    </div>

                    {childOffices.map((off, oIdx) => (
                      <div
                        key={off.id}
                        className="ml-4 flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex gap-0.5">
                            <button
                              type="button"
                              disabled={reordering || oIdx === 0}
                              onClick={() => void moveWithinList(childOffices, oIdx, -1)}
                              className="btn-sort-arrow"
                            >
                              <i className="fa-solid fa-chevron-up" />
                            </button>
                            <button
                              type="button"
                              disabled={reordering || oIdx === childOffices.length - 1}
                              onClick={() => void moveWithinList(childOffices, oIdx, 1)}
                              className="btn-sort-arrow"
                            >
                              <i className="fa-solid fa-chevron-down" />
                            </button>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${LEVEL_BADGE[2]}`}>
                            สำนักงาน/กอง
                          </span>
                          <span className={`font-bold truncate ${!off.is_active ? 'line-through opacity-50' : ''}`}>
                            {off.name_th}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleToggleActive(off)}
                            className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                          >
                            <i className={`fa-solid ${off.is_active ? 'fa-eye' : 'fa-eye-slash'}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditing({ ...off });
                              setEditModalOpen(true);
                            }}
                            className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                          >
                            <i className="fa-solid fa-pen" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(off)}
                            className="px-2 py-1 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600"
                          >
                            <i className="fa-solid fa-trash" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: กลุ่มงาน under Selected Department */}
          <div className="bma-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-extrabold text-sm text-slate-800 dark:text-white truncate">
                  จัดการกลุ่มงาน ({divsInSelectedDept.length})
                </h4>
                <p className="text-[11px] text-slate-500 truncate">
                  {selectedDept
                    ? `สังกัด: ${selectedDept.name_th}`
                    : 'คลิกเลือกแถวส่วน/ฝ่ายด้านบนเพื่อจัดการกลุ่มงาน'}
                </p>
              </div>
              <button
                type="button"
                disabled={!selectedDept}
                onClick={() =>
                  openStepAdd(4, {
                    bureauId: selectedBureau?.id,
                    officeId: selectedOffice?.id,
                    deptId: selectedDept?.id,
                  })
                }
                className="bma-btn-outline text-xs py-1 disabled:opacity-40"
              >
                <i className="fa-solid fa-plus text-emerald-600" />
                เพิ่มกลุ่มงาน
              </button>
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {divsInSelectedDept.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  {selectedDept
                    ? `ยังไม่มีกลุ่มงานใน "${selectedDept.name_th}"`
                    : 'ยังไม่ได้เลือกส่วน/ฝ่าย'}
                </div>
              ) : (
                divsInSelectedDept.map((v, vIdx) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex gap-0.5">
                        <button
                          type="button"
                          disabled={reordering || vIdx === 0}
                          onClick={() => void moveWithinList(divsInSelectedDept, vIdx, -1)}
                          className="btn-sort-arrow"
                        >
                          <i className="fa-solid fa-chevron-up" />
                        </button>
                        <button
                          type="button"
                          disabled={reordering || vIdx === divsInSelectedDept.length - 1}
                          onClick={() => void moveWithinList(divsInSelectedDept, vIdx, 1)}
                          className="btn-sort-arrow"
                        >
                          <i className="fa-solid fa-chevron-down" />
                        </button>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${LEVEL_BADGE[4]}`}>
                        กลุ่มงาน
                      </span>
                      <span className={`font-bold truncate ${!v.is_active ? 'line-through opacity-50' : ''}`}>
                        {v.name_th}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(v)}
                        className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      >
                        <i className={`fa-solid ${v.is_active ? 'fa-eye' : 'fa-eye-slash'}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing({ ...v });
                          setEditModalOpen(true);
                        }}
                        className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      >
                        <i className="fa-solid fa-pen" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(v)}
                        className="px-2 py-1 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600"
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4-Step Cascading Multi-Row Add Modal */}
      <ResponsiveModal
        open={addLevel !== null}
        onClose={() => setAddLevel(null)}
        title={addLevel ? `เพิ่ม${LEVEL_LABELS[addLevel]}` : ''}
        subtitle="เลือกสังกัดต้นทางตามลำดับชั้น แล้วกรอกชื่อหน่วยงานได้หลายแถวพร้อมกัน"
        icon="fa-sitemap"
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={(e) => void handleSaveBatch(e)} className="space-y-4 text-sm">
          {addLevel && addLevel >= 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
              <div>
                <label className="bma-label">สำนัก *</label>
                <select
                  required
                  value={selBureauId}
                  onChange={(e) => {
                    const bId = e.target.value;
                    setSelBureauId(bId);
                    const firstOff = offices.find((o) => o.parent_id === bId)?.id || '';
                    setSelOfficeId(firstOff);
                    setSelDeptId(departments.find((d) => d.parent_id === firstOff)?.id || '');
                  }}
                  className="bma-input text-xs"
                >
                  <option value="">เลือกสำนัก</option>
                  {bureaus.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name_th}
                    </option>
                  ))}
                </select>
              </div>
              {addLevel >= 3 && (
                <div>
                  <label className="bma-label">สำนักงาน/กอง *</label>
                  <select
                    required
                    value={selOfficeId}
                    onChange={(e) => {
                      const oId = e.target.value;
                      setSelOfficeId(oId);
                      setSelDeptId(departments.find((d) => d.parent_id === oId)?.id || '');
                    }}
                    className="bma-input text-xs"
                  >
                    <option value="">เลือกสำนักงาน/กอง</option>
                    {offices
                      .filter((o) => !selBureauId || o.parent_id === selBureauId)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name_th}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              {addLevel === 4 && (
                <div>
                  <label className="bma-label">ส่วน/ฝ่าย *</label>
                  <select
                    required
                    value={selDeptId}
                    onChange={(e) => setSelDeptId(e.target.value)}
                    className="bma-input text-xs"
                  >
                    <option value="">เลือกส่วน/ฝ่าย</option>
                    {departments
                      .filter((d) => !selOfficeId || d.parent_id === selOfficeId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name_th}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            {multiRows.map((row, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <input
                  required
                  value={row.name_th}
                  onChange={(e) =>
                    setMultiRows((p) => p.map((x, i) => (i === idx ? { ...x, name_th: e.target.value } : x)))
                  }
                  placeholder={`ชื่อ${addLevel ? LEVEL_LABELS[addLevel] : ''} *`}
                  className="bma-input text-xs col-span-6"
                />
                <input
                  value={row.code}
                  onChange={(e) =>
                    setMultiRows((p) => p.map((x, i) => (i === idx ? { ...x, code: e.target.value } : x)))
                  }
                  placeholder="รหัส (ไม่บังคับ)"
                  className="bma-input text-xs font-mono col-span-3"
                />
                <input
                  value={row.short_name}
                  onChange={(e) =>
                    setMultiRows((p) => p.map((x, i) => (i === idx ? { ...x, short_name: e.target.value } : x)))
                  }
                  placeholder="ชื่อย่อ"
                  className="bma-input text-xs col-span-2"
                />
                <button
                  type="button"
                  disabled={multiRows.length === 1}
                  onClick={() => setMultiRows((p) => p.filter((_, i) => i !== idx))}
                  className="col-span-1 text-rose-500 disabled:opacity-30"
                >
                  <i className="fa-solid fa-trash-can" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setMultiRows((p) => [...p, { name_th: '', code: '', short_name: '' }])}
            className="bma-btn-outline text-xs"
          >
            <i className="fa-solid fa-plus text-emerald-600" />
            เพิ่มแถวรายการ
          </button>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button type="button" onClick={() => setAddLevel(null)} className="bma-btn-outline">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving} className="bma-btn-primary">
              บันทึกทั้งหมด ({multiRows.length} รายการ)
            </button>
          </div>
        </form>
      </ResponsiveModal>

      {/* Edit Org Unit Modal */}
      <ResponsiveModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`แก้ไขหน่วยงาน (${editing.level_no ? LEVEL_LABELS[editing.level_no] : ''})`}
        icon="fa-pen-to-square"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-3 text-sm">
          {parentCandidatesForEdit.length > 0 && (
            <div>
              <label className="bma-label">หน่วยงานต้นสังกัด</label>
              <select
                value={editing.parent_id || ''}
                onChange={(e) => setEditing({ ...editing, parent_id: e.target.value || null })}
                className="bma-input"
              >
                {parentCandidatesForEdit.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_th}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="bma-label">ชื่อหน่วยงาน *</label>
            <input
              required
              value={editing.name_th || ''}
              onChange={(e) => setEditing({ ...editing, name_th: e.target.value })}
              className="bma-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="bma-label">รหัสหน่วยงาน</label>
              <input
                value={editing.code || ''}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                className="bma-input font-mono"
              />
            </div>
            <div>
              <label className="bma-label">ชื่อย่อ</label>
              <input
                value={editing.short_name || ''}
                onChange={(e) => setEditing({ ...editing, short_name: e.target.value })}
                className="bma-input"
              />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={editing.is_active !== false}
              onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
            />
            เปิดใช้งาน
          </label>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button type="button" onClick={() => setEditModalOpen(false)} className="bma-btn-outline">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving} className="bma-btn-primary">
              บันทึกการแก้ไข
            </button>
          </div>
        </form>
      </ResponsiveModal>
    </div>
  );
}

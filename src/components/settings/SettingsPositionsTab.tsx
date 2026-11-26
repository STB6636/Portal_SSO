import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { useMasterData } from '@/hooks/useMasterData';
import { masterDataService } from '@/services/masterDataService';
import { QUERY_KEYS } from '@/lib/queryClient';
import { useUiStore } from '@/stores/useUiStore';
import { confirmAction } from '@/lib/swalHelpers';
import { comparePositionLevels, comparePositions, comparePositionTypes } from '@/lib/masterDataSort';
import type { PositionLevelRow, PositionRow, PositionTypeRow } from '@/types/database.types';

export function SettingsPositionsTab() {
  const { data: master } = useMasterData();
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);

  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [saving, setSaving] = useState(false);

  // Step 1: Position Types Modal (Multi-Row Add or Single Edit)
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [editingType, setEditingType] = useState<Partial<PositionTypeRow> | null>(null);
  const [multiTypes, setMultiTypes] = useState<Array<{ code: string; name_th: string; color_hex: string }>>([]);

  // Step 2: Positions Modal (Multi-Row Add or Single Edit + Allowed Levels)
  const [posModalOpen, setPosModalOpen] = useState(false);
  const [editingPos, setEditingPos] = useState<Partial<PositionRow> | null>(null);
  const [posTypeForNew, setPosTypeForNew] = useState('');
  const [multiPosNames, setMultiPosNames] = useState<string[]>(['']);
  const [requiresLevel, setRequiresLevel] = useState(true);
  const [allowedLevels, setAllowedLevels] = useState<string[]>([]);

  // Step 3: Position Levels Modal (Multi-Row Add or Single Edit)
  const [levelModalOpen, setLevelModalOpen] = useState(false);
  const [editingLevel, setEditingLevel] = useState<Partial<PositionLevelRow> | null>(null);
  const [multiLevels, setMultiLevels] = useState<Array<{ code: string; name_th: string; rank_order: number }>>([]);

  const sortedTypes = useMemo(
    () => [...master.positionTypes].sort(comparePositionTypes),
    [master.positionTypes]
  );
  const sortedLevels = useMemo(
    () => [...master.positionLevels].sort(comparePositionLevels),
    [master.positionLevels]
  );

  const activeType = sortedTypes.find((t) => t.id === selectedTypeId) || sortedTypes[0] || null;
  const positions = useMemo(
    () =>
      (activeType ? master.positions.filter((p) => p.position_type_id === activeType.id) : master.positions).sort(
        comparePositions
      ),
    [master.positions, activeType]
  );

  const moveListOrder = async (
    table: 'positions' | 'position_types' | 'position_levels',
    list: Array<{ id: string }>,
    idx: number,
    dir: -1 | 1
  ) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const nextIds = list.map((item) => item.id);
    [nextIds[idx], nextIds[targetIdx]] = [nextIds[targetIdx], nextIds[idx]];
    try {
      await masterDataService.reorderSortOrder(table, nextIds);
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'สลับลำดับไม่สำเร็จ', 'error');
    }
  };

  const levelById = useMemo(() => new Map(sortedLevels.map((l) => [l.id, l])), [sortedLevels]);
  const typeById = useMemo(() => new Map(sortedTypes.map((t) => [t.id, t])), [sortedTypes]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: QUERY_KEYS.masterData });
  };

  // ---- Step 1: Position Types ----
  const openAddTypes = () => {
    setEditingType(null);
    setMultiTypes([{ code: '', name_th: '', color_hex: '#00744B' }]);
    setTypeModalOpen(true);
  };

  const handleSaveTypes = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingType) {
        await masterDataService.savePositionType(editingType);
        showToast('บันทึกประเภทตำแหน่งเรียบร้อย', 'success');
      } else {
        await masterDataService.savePositionTypesBatch(
          multiTypes.map((t, i) => ({ ...t, sort_order: sortedTypes.length + i + 1 }))
        );
        showToast('เพิ่มประเภทตำแหน่งเรียบร้อย', 'success');
      }
      await refresh();
      setTypeModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteType = async (t: PositionTypeRow) => {
    const ok = await confirmAction('ลบประเภทตำแหน่ง', `ต้องการลบ "${t.name_th}" ใช่หรือไม่?`, 'ลบ', 'warning');
    if (!ok) return;
    try {
      await masterDataService.deletePositionType(t.id);
      if (selectedTypeId === t.id) setSelectedTypeId('');
      await refresh();
      showToast('ลบประเภทตำแหน่งเรียบร้อย', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถลบได้', 'error');
    }
  };

  // ---- Step 2: Positions + Allowed Levels ----
  const openAddPositions = () => {
    if (sortedTypes.length === 0) {
      showToast('กรุณาเพิ่ม "ประเภทตำแหน่ง" ก่อนเพิ่มตำแหน่งในสายงาน', 'warning');
      return;
    }
    setEditingPos(null);
    setPosTypeForNew(activeType?.id || sortedTypes[0].id);
    setMultiPosNames(['']);
    setRequiresLevel(true);
    setAllowedLevels([]);
    setPosModalOpen(true);
  };

  const openEditPosition = (pos: PositionRow) => {
    setEditingPos({ ...pos });
    setPosTypeForNew(pos.position_type_id);
    setRequiresLevel(pos.requires_level);
    setAllowedLevels(
      master.positionAllowedLevels
        .filter((a) => a.position_id === pos.id)
        .map((a) => a.position_level_id)
    );
    setPosModalOpen(true);
  };

  const handleSavePositions = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingPos) {
        await masterDataService.savePosition(
          { ...editingPos, position_type_id: posTypeForNew, requires_level: requiresLevel },
          requiresLevel ? allowedLevels : []
        );
        showToast('อัปเดตตำแหน่งเรียบร้อย', 'success');
      } else {
        const validNames = multiPosNames.map((s) => s.trim()).filter(Boolean);
        await masterDataService.savePositionsBatch(
          validNames.map((name_th, i) => ({
            position_type_id: posTypeForNew,
            name_th,
            requires_level: requiresLevel,
            sort_order: positions.length + i + 1,
          })),
          requiresLevel ? allowedLevels : []
        );
        showToast(`เพิ่มตำแหน่งสำเร็จ ${validNames.length} รายการ`, 'success');
      }
      await refresh();
      setPosModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'บันทึกตำแหน่งไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePosition = async (p: PositionRow) => {
    const ok = await confirmAction('ลบตำแหน่ง', `ต้องการลบตำแหน่ง "${p.name_th}" ใช่หรือไม่?`, 'ลบ', 'warning');
    if (!ok) return;
    try {
      await masterDataService.deletePosition(p.id);
      await refresh();
      showToast('ลบตำแหน่งเรียบร้อย', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถลบตำแหน่งได้', 'error');
    }
  };

  // ---- Step 3: Position Levels ----
  const openAddLevels = () => {
    setEditingLevel(null);
    setMultiLevels([{ code: '', name_th: '', rank_order: (sortedLevels.length + 1) * 10 }]);
    setLevelModalOpen(true);
  };

  const handleSaveLevels = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingLevel) {
        await masterDataService.savePositionLevel(editingLevel);
        showToast('บันทึกระดับตำแหน่งเรียบร้อย', 'success');
      } else {
        await masterDataService.savePositionLevelsBatch(
          multiLevels.map((l, i) => ({ ...l, sort_order: sortedLevels.length + i + 1 }))
        );
        showToast('เพิ่มระดับตำแหน่งเรียบร้อย', 'success');
      }
      await refresh();
      setLevelModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'บันทึกระดับตำแหน่งไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLevel = async (lv: PositionLevelRow) => {
    const ok = await confirmAction('ลบระดับตำแหน่ง', `ต้องการลบระดับ "${lv.name_th}" ใช่หรือไม่?`, 'ลบ', 'warning');
    if (!ok) return;
    try {
      await masterDataService.deletePositionLevel(lv.id);
      await refresh();
      showToast('ลบระดับตำแหน่งเรียบร้อย', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถลบระดับตำแหน่งได้', 'error');
    }
  };

  return (
    <div className="space-y-6 pt-4">
      {/* Main Card with Floating Purple Header (Checkin 3-Step Pattern) */}
      <div className="bma-card">
        <div className="-mt-6 mx-4 sm:mx-6 rounded-2xl bg-gradient-to-r from-[#3B0764] via-[#6D28D9] to-[#00744B] text-white p-4 sm:p-5 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="font-extrabold text-base flex items-center gap-2">
              <i className="fa-solid fa-briefcase" />
              โครงสร้างสายงานและตำแหน่ง ({master.positions.length} ตำแหน่ง)
            </h3>
            <p className="text-xs text-purple-100 mt-0.5">
              1. ประเภทตำแหน่ง → 2. ตำแหน่งในสายงาน → 3. ระดับตำแหน่งที่อนุญาต
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={openAddTypes}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-bold transition"
            >
              1. + ประเภทตำแหน่ง
            </button>
            <button
              type="button"
              onClick={openAddPositions}
              className="px-3 py-1.5 rounded-xl bg-white text-[#005C3B] hover:bg-emerald-50 text-xs font-extrabold transition shadow-sm"
            >
              2. + ตำแหน่งในสายงาน
            </button>
            <button
              type="button"
              onClick={openAddLevels}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-bold transition"
            >
              3. + ระดับตำแหน่ง
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Position Type Filter Pills */}
          <div className="flex flex-wrap items-center gap-2">
            {sortedTypes.map((pt) => {
              const active = activeType?.id === pt.id;
              const cnt = master.positions.filter((p) => p.position_type_id === pt.id).length;
              return (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => setSelectedTypeId(pt.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 ${
                    active
                      ? 'bg-[#00744B] text-white border-[#00744B] shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pt.color_hex || '#00744B' }} />
                  <span>{pt.name_th}</span>
                  <span className={`px-1.5 rounded text-[10px] ${active ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700'}`}>
                    {cnt}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Positions Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 text-left">
                  <th className="py-2 pr-2 w-16">ลำดับ</th>
                  <th className="py-2 pr-2">ประเภทตำแหน่ง</th>
                  <th className="py-2 pr-2">ชื่อตำแหน่งในสายงาน</th>
                  <th className="py-2 pr-2">ระดับที่อนุญาต</th>
                  <th className="py-2 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      ยังไม่มีตำแหน่งในประเภทนี้ คลิกปุ่ม <strong>"2. + ตำแหน่งในสายงาน"</strong> ด้านบน
                    </td>
                  </tr>
                ) : (
                  positions.map((pos, idx) => {
                    const allowed = (
                      master.positionAllowedLevels
                        .filter((a) => a.position_id === pos.id)
                        .map((a) => levelById.get(a.position_level_id))
                        .filter(Boolean) as PositionLevelRow[]
                    ).sort(comparePositionLevels);
                    const pt = typeById.get(pos.position_type_id);
                    return (
                      <tr key={pos.id} className={!pos.is_active ? 'opacity-50' : ''}>
                        <td className="py-2.5 pr-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => void moveListOrder('positions', positions, idx, -1)}
                              className="btn-sort-arrow"
                            >
                              <i className="fa-solid fa-chevron-up" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === positions.length - 1}
                              onClick={() => void moveListOrder('positions', positions, idx, 1)}
                              className="btn-sort-arrow"
                            >
                              <i className="fa-solid fa-chevron-down" />
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 pr-2">
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                            style={{ backgroundColor: pt?.color_hex || '#00744B' }}
                          >
                            {pt?.name_th || '-'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-2 font-bold text-slate-800 dark:text-white">{pos.name_th}</td>
                        <td className="py-2.5 pr-2">
                          {!pos.requires_level ? (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-bold">
                              ไม่มีระดับ (ไม่ต้องระบุ)
                            </span>
                          ) : allowed.length === 0 ? (
                            <span className="text-amber-600 text-[11px] font-semibold">
                              ยังไม่จำกัด (ใช้ได้ทุกระดับ)
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {allowed.map((l) => (
                                <span
                                  key={l.id}
                                  className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold"
                                >
                                  {l.name_th}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap space-x-1">
                          <button
                            type="button"
                            onClick={() => openEditPosition(pos)}
                            className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800"
                          >
                            <i className="fa-solid fa-pen" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeletePosition(pos)}
                            className="px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600"
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
      </div>

      {/* Master Management Strip: Position Types & Position Levels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Manage Position Types */}
        <div className="bma-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-extrabold text-sm text-slate-800 dark:text-white">
              จัดการประเภทตำแหน่ง ({sortedTypes.length})
            </h4>
            <button type="button" onClick={openAddTypes} className="bma-btn-outline text-xs py-1">
              <i className="fa-solid fa-plus text-emerald-600" />
              เพิ่มประเภท
            </button>
          </div>
          <div className="space-y-1.5">
            {sortedTypes.map((t, idx) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => void moveListOrder('position_types', sortedTypes, idx, -1)}
                      className="btn-sort-arrow"
                    >
                      <i className="fa-solid fa-chevron-up" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === sortedTypes.length - 1}
                      onClick={() => void moveListOrder('position_types', sortedTypes, idx, 1)}
                      className="btn-sort-arrow"
                    >
                      <i className="fa-solid fa-chevron-down" />
                    </button>
                  </div>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color_hex || '#00744B' }} />
                  <span className="font-bold truncate">{t.name_th}</span>
                  <span className="font-mono text-[10px] text-slate-400">({t.code})</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingType({ ...t });
                      setTypeModalOpen(true);
                    }}
                    className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  >
                    <i className="fa-solid fa-pen" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteType(t)}
                    className="px-2 py-1 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600"
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Manage Position Levels */}
        <div className="bma-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-extrabold text-sm text-slate-800 dark:text-white">
              จัดการระดับตำแหน่ง ({sortedLevels.length})
            </h4>
            <button type="button" onClick={openAddLevels} className="bma-btn-outline text-xs py-1">
              <i className="fa-solid fa-plus text-emerald-600" />
              เพิ่มระดับ
            </button>
          </div>
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {sortedLevels.map((lv, idx) => (
              <div
                key={lv.id}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => void moveListOrder('position_levels', sortedLevels, idx, -1)}
                      className="btn-sort-arrow"
                    >
                      <i className="fa-solid fa-chevron-up" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === sortedLevels.length - 1}
                      onClick={() => void moveListOrder('position_levels', sortedLevels, idx, 1)}
                      className="btn-sort-arrow"
                    >
                      <i className="fa-solid fa-chevron-down" />
                    </button>
                  </div>
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 min-w-[4.5rem] shrink-0">{lv.code}</span>
                  <span className="font-bold truncate">{lv.name_th}</span>
                  <span className="text-[10px] text-slate-400">Rank {lv.rank_order}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLevel({ ...lv });
                      setLevelModalOpen(true);
                    }}
                    className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  >
                    <i className="fa-solid fa-pen" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteLevel(lv)}
                    className="px-2 py-1 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600"
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal 1: Position Types */}
      <ResponsiveModal
        open={typeModalOpen}
        onClose={() => setTypeModalOpen(false)}
        title={editingType ? 'แก้ไขประเภทตำแหน่ง' : 'เพิ่มประเภทตำแหน่ง (เพิ่มได้หลายรายการ)'}
        icon="fa-layer-group"
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={(e) => void handleSaveTypes(e)} className="space-y-3 text-sm">
          {editingType ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="bma-label">รหัส *</label>
                <input
                  required
                  value={editingType.code || ''}
                  onChange={(e) => setEditingType({ ...editingType, code: e.target.value.toUpperCase() })}
                  className="bma-input font-mono uppercase"
                />
              </div>
              <div>
                <label className="bma-label">ชื่อประเภทตำแหน่ง *</label>
                <input
                  required
                  value={editingType.name_th || ''}
                  onChange={(e) => setEditingType({ ...editingType, name_th: e.target.value })}
                  className="bma-input"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="bma-label">สีป้าย</label>
                <input
                  type="color"
                  value={editingType.color_hex || '#00744B'}
                  onChange={(e) => setEditingType({ ...editingType, color_hex: e.target.value })}
                  className="h-10 w-20 rounded border cursor-pointer"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {multiTypes.map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    required
                    value={row.code}
                    onChange={(e) =>
                      setMultiTypes((p) => p.map((x, i) => (i === idx ? { ...x, code: e.target.value.toUpperCase() } : x)))
                    }
                    placeholder="CODE*"
                    className="bma-input text-xs font-mono uppercase col-span-4"
                  />
                  <input
                    required
                    value={row.name_th}
                    onChange={(e) =>
                      setMultiTypes((p) => p.map((x, i) => (i === idx ? { ...x, name_th: e.target.value } : x)))
                    }
                    placeholder="ชื่อประเภทตำแหน่ง*"
                    className="bma-input text-xs col-span-6"
                  />
                  <input
                    type="color"
                    value={row.color_hex}
                    onChange={(e) =>
                      setMultiTypes((p) => p.map((x, i) => (i === idx ? { ...x, color_hex: e.target.value } : x)))
                    }
                    className="h-9 w-full rounded border col-span-1"
                  />
                  <button
                    type="button"
                    disabled={multiTypes.length === 1}
                    onClick={() => setMultiTypes((p) => p.filter((_, i) => i !== idx))}
                    className="col-span-1 text-rose-500 disabled:opacity-30"
                  >
                    <i className="fa-solid fa-trash-can" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setMultiTypes((p) => [...p, { code: '', name_th: '', color_hex: '#00744B' }])}
                className="bma-btn-outline text-xs"
              >
                <i className="fa-solid fa-plus text-emerald-600" />
                เพิ่มแถว
              </button>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button type="button" onClick={() => setTypeModalOpen(false)} className="bma-btn-outline">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving} className="bma-btn-primary">
              บันทึกประเภทตำแหน่ง
            </button>
          </div>
        </form>
      </ResponsiveModal>

      {/* Modal 2: Positions + Allowed Levels */}
      <ResponsiveModal
        open={posModalOpen}
        onClose={() => setPosModalOpen(false)}
        title={editingPos ? 'แก้ไขตำแหน่งในสายงาน' : 'เพิ่มตำแหน่งในสายงาน (เพิ่มได้หลายตำแหน่ง)'}
        icon="fa-briefcase"
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={(e) => void handleSavePositions(e)} className="space-y-4 text-sm">
          <div>
            <label className="bma-label">ประเภทตำแหน่ง *</label>
            <select
              required
              value={posTypeForNew}
              onChange={(e) => setPosTypeForNew(e.target.value)}
              className="bma-input"
            >
              {sortedTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name_th}
                </option>
              ))}
            </select>
          </div>

          {editingPos ? (
            <div>
              <label className="bma-label">ชื่อตำแหน่ง *</label>
              <input
                required
                value={editingPos.name_th || ''}
                onChange={(e) => setEditingPos({ ...editingPos, name_th: e.target.value })}
                className="bma-input"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="bma-label">รายชื่อตำแหน่งในสายงาน *</label>
              {multiPosNames.map((name, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    required
                    value={name}
                    onChange={(e) => setMultiPosNames((p) => p.map((x, i) => (i === idx ? e.target.value : x)))}
                    placeholder="เช่น เจ้าพนักงานเทศกิจ, นักวิชาการคอมพิวเตอร์"
                    className="bma-input text-xs flex-1"
                  />
                  <button
                    type="button"
                    disabled={multiPosNames.length === 1}
                    onClick={() => setMultiPosNames((p) => p.filter((_, i) => i !== idx))}
                    className="text-rose-500 disabled:opacity-30 px-2"
                  >
                    <i className="fa-solid fa-trash-can" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setMultiPosNames((p) => [...p, ''])}
                className="bma-btn-outline text-xs"
              >
                <i className="fa-solid fa-plus text-emerald-600" />
                เพิ่มแถวตำแหน่ง
              </button>
            </div>
          )}

          <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={requiresLevel}
              onChange={(e) => setRequiresLevel(e.target.checked)}
            />
            ตำแหน่งนี้ต้องระบุระดับตำแหน่ง
          </label>

          {requiresLevel && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                ระดับตำแหน่งที่อนุญาต:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sortedLevels.map((lv) => {
                  const sel = allowedLevels.includes(lv.id);
                  return (
                    <button
                      key={lv.id}
                      type="button"
                      onClick={() =>
                        setAllowedLevels((prev) =>
                          prev.includes(lv.id) ? prev.filter((x) => x !== lv.id) : [...prev, lv.id]
                        )
                      }
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                        sel
                          ? 'bg-[#00744B] text-white border-[#00744B]'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {lv.name_th}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button type="button" onClick={() => setPosModalOpen(false)} className="bma-btn-outline">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving} className="bma-btn-primary">
              บันทึกตำแหน่ง
            </button>
          </div>
        </form>
      </ResponsiveModal>

      {/* Modal 3: Position Levels */}
      <ResponsiveModal
        open={levelModalOpen}
        onClose={() => setLevelModalOpen(false)}
        title={editingLevel ? 'แก้ไขระดับตำแหน่ง' : 'เพิ่มระดับตำแหน่ง (เพิ่มได้หลายระดับ)'}
        icon="fa-ranking-star"
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={(e) => void handleSaveLevels(e)} className="space-y-3 text-sm">
          {editingLevel ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="bma-label">รหัส *</label>
                <input
                  required
                  value={editingLevel.code || ''}
                  onChange={(e) => setEditingLevel({ ...editingLevel, code: e.target.value.toUpperCase() })}
                  className="bma-input font-mono uppercase"
                />
              </div>
              <div>
                <label className="bma-label">ชื่อระดับ *</label>
                <input
                  required
                  value={editingLevel.name_th || ''}
                  onChange={(e) => setEditingLevel({ ...editingLevel, name_th: e.target.value })}
                  className="bma-input"
                />
              </div>
              <div>
                <label className="bma-label">ลำดับชั้น</label>
                <input
                  type="number"
                  value={editingLevel.rank_order ?? 10}
                  onChange={(e) => setEditingLevel({ ...editingLevel, rank_order: Number(e.target.value) })}
                  className="bma-input"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {multiLevels.map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    required
                    value={row.code}
                    onChange={(e) =>
                      setMultiLevels((p) => p.map((x, i) => (i === idx ? { ...x, code: e.target.value.toUpperCase() } : x)))
                    }
                    placeholder="รหัส (เช่น K5)*"
                    className="bma-input text-xs font-mono uppercase col-span-3"
                  />
                  <input
                    required
                    value={row.name_th}
                    onChange={(e) =>
                      setMultiLevels((p) => p.map((x, i) => (i === idx ? { ...x, name_th: e.target.value } : x)))
                    }
                    placeholder="ชื่อระดับ (เช่น ทรงคุณวุฒิ)*"
                    className="bma-input text-xs col-span-6"
                  />
                  <input
                    type="number"
                    value={row.rank_order}
                    onChange={(e) =>
                      setMultiLevels((p) => p.map((x, i) => (i === idx ? { ...x, rank_order: Number(e.target.value) } : x)))
                    }
                    placeholder="Rank"
                    className="bma-input text-xs col-span-2"
                  />
                  <button
                    type="button"
                    disabled={multiLevels.length === 1}
                    onClick={() => setMultiLevels((p) => p.filter((_, i) => i !== idx))}
                    className="col-span-1 text-rose-500 disabled:opacity-30"
                  >
                    <i className="fa-solid fa-trash-can" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setMultiLevels((p) => [
                    ...p,
                    { code: '', name_th: '', rank_order: (sortedLevels.length + p.length + 1) * 10 },
                  ])
                }
                className="bma-btn-outline text-xs"
              >
                <i className="fa-solid fa-plus text-emerald-600" />
                เพิ่มแถว
              </button>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button type="button" onClick={() => setLevelModalOpen(false)} className="bma-btn-outline">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving} className="bma-btn-primary">
              บันทึกระดับตำแหน่ง
            </button>
          </div>
        </form>
      </ResponsiveModal>
    </div>
  );
}

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { useMasterData } from '@/hooks/useMasterData';
import { masterDataService } from '@/services/masterDataService';
import { QUERY_KEYS } from '@/lib/queryClient';
import { useUiStore } from '@/stores/useUiStore';
import { confirmAction } from '@/lib/swalHelpers';
import { compareLookupCategories, compareLookupItems } from '@/lib/masterDataSort';
import type { LookupCategoryRow, LookupItemRow } from '@/types/database.types';

interface MultiLookupRow {
  code: string;
  name_th: string;
  short_name: string;
  rank_order: number;
  color_hex: string;
}

export function SettingsLookupsTab() {
  const { data: master, isFetching } = useMasterData();
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);

  const [selectedCatId, setSelectedCatId] = useState('');
  const [saving, setSaving] = useState(false);

  // Category Modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Partial<LookupCategoryRow>>({});

  // Multi-Row Add Item Modal
  const [multiOpen, setMultiOpen] = useState(false);
  const [multiRows, setMultiRows] = useState<MultiLookupRow[]>([]);

  // Single Edit Item Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<LookupItemRow>>({});

  const sortedCategories = [...master.categories].sort(compareLookupCategories);
  const activeCategory =
    sortedCategories.find((c) => c.id === selectedCatId) || sortedCategories[0] || null;
  const items = activeCategory
    ? master.items
        .filter((i) => i.category_id === activeCategory.id)
        .sort(compareLookupItems)
    : [];

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: QUERY_KEYS.masterData });
  };

  // ---- Category Handlers ----
  const openCreateCategory = () => {
    setEditingCat({
      code: '',
      name_th: '',
      description: '',
      has_provision_flag: false,
      has_approver_flag: false,
      sort_order: master.categories.length + 1,
      is_active: true,
    });
    setCatModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCat.code?.trim() || !editingCat.name_th?.trim()) {
      showToast('กรุณาระบุรหัสหมวดหมู่และชื่อภาษาไทย', 'warning');
      return;
    }
    setSaving(true);
    try {
      await masterDataService.saveLookupCategory(editingCat);
      await refresh();
      setCatModalOpen(false);
      showToast('บันทึกหมวดหมู่ตัวเลือกเรียบร้อย', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'บันทึกหมวดหมู่ไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = async (cat: LookupCategoryRow) => {
    if (cat.is_system_locked) {
      showToast('หมวดหมู่หลักของระบบไม่สามารถลบได้', 'warning');
      return;
    }
    const ok = await confirmAction(
      'ลบหมวดหมู่ตัวเลือก',
      `ต้องการลบหมวดหมู่ "${cat.name_th}" ใช่หรือไม่?`,
      'ยืนยันลบ',
      'warning'
    );
    if (!ok) return;
    try {
      await masterDataService.deleteLookupCategory(cat.id);
      if (selectedCatId === cat.id) setSelectedCatId('');
      await refresh();
      showToast('ลบหมวดหมู่เรียบร้อย', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถลบหมวดหมู่ได้', 'error');
    }
  };

  // ---- Multi-Row Add Items ----
  const openMultiAdd = () => {
    if (!activeCategory) {
      showToast('กรุณาสร้างหรือเลือกหมวดหมู่ก่อนเพิ่มตัวเลือก', 'warning');
      return;
    }
    setMultiRows([{ code: '', name_th: '', short_name: '', rank_order: 0, color_hex: '#00744B' }]);
    setMultiOpen(true);
  };

  const handleSaveMulti = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCategory) return;
    const valid = multiRows.filter((r) => r.code.trim() && r.name_th.trim());
    if (valid.length === 0) {
      showToast('กรุณากรอกรหัสและชื่อตัวเลือกอย่างน้อย 1 แถว', 'warning');
      return;
    }
    setSaving(true);
    try {
      const baseSort = items.length;
      await masterDataService.saveLookupItemsBatch(
        valid.map((r, i) => ({
          category_id: activeCategory.id,
          code: r.code,
          name_th: r.name_th,
          short_name: r.short_name,
          rank_order: r.rank_order,
          color_hex: r.color_hex,
          allows_account_provision: true,
          is_approver: activeCategory.has_approver_flag ? r.rank_order > 0 : false,
          sort_order: baseSort + i + 1,
        }))
      );
      await refresh();
      setMultiOpen(false);
      showToast(`เพิ่มตัวเลือกสำเร็จ ${valid.length} รายการ`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'เพิ่มตัวเลือกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ---- Single Edit Item ----
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem.code?.trim() || !editingItem.name_th?.trim()) {
      showToast('กรุณากรอกรหัสและชื่อภาษาไทย', 'warning');
      return;
    }
    setSaving(true);
    try {
      await masterDataService.saveLookupItem(editingItem);
      await refresh();
      setEditModalOpen(false);
      showToast('บันทึกตัวเลือกเรียบร้อยแล้ว', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMove = async (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    const nextIds = items.map((item) => item.id);
    [nextIds[idx], nextIds[targetIdx]] = [nextIds[targetIdx], nextIds[idx]];
    try {
      await masterDataService.reorderSortOrder('lookup_items', nextIds);
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'สลับลำดับไม่สำเร็จ', 'error');
    }
  };

  const handleDeleteItem = async (item: LookupItemRow) => {
    const ok = await confirmAction('ลบตัวเลือก', `ต้องการลบ "${item.name_th}" ใช่หรือไม่?`, 'ลบ', 'warning');
    if (!ok) return;
    try {
      await masterDataService.deleteLookupItem(item.id);
      await refresh();
      showToast('ลบตัวเลือกเรียบร้อยแล้ว', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถลบตัวเลือกได้', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left: Categories */}
      <div className="lg:col-span-4 bma-card p-4 space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
            หมวดหมู่ตัวเลือก ({master.categories.length})
          </h3>
          <button type="button" onClick={openCreateCategory} className="bma-btn-outline text-[11px] py-1 px-2.5">
            <i className="fa-solid fa-folder-plus text-emerald-600" />
            เพิ่มหมวด
          </button>
        </div>

        {isFetching && master.categories.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            <i className="fa-solid fa-spinner fa-spin mr-1.5" />
            กำลังโหลดหมวดหมู่จากฐานข้อมูล...
          </div>
        ) : (
          <div className="space-y-1.5">
            {sortedCategories.map((cat) => {
              const isSel = activeCategory?.id === cat.id;
              const count = master.items.filter((i) => i.category_id === cat.id).length;
              return (
                <div
                  key={cat.id}
                  onClick={() => setSelectedCatId(cat.id)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    isSel
                      ? 'bg-[#00744B] text-white border-[#00744B] shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm truncate">{cat.name_th}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isSel ? 'bg-white/20' : 'bg-slate-200/80 dark:bg-slate-700'}`}>
                        {count}
                      </span>
                      {!cat.is_system_locked && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteCategory(cat);
                          }}
                          className={`text-[11px] px-1 ${isSel ? 'text-rose-200 hover:text-white' : 'text-rose-500'}`}
                          title="ลบหมวดหมู่"
                        >
                          <i className="fa-solid fa-trash-can" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={`text-[10px] font-mono mt-0.5 ${isSel ? 'text-emerald-100' : 'text-slate-400'}`}>
                    {cat.code} {cat.is_system_locked && '· ล็อกระบบ'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: Items Table */}
      <div className="lg:col-span-8 bma-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-base text-slate-800 dark:text-white">
              {activeCategory?.name_th || 'เลือกหมวดหมู่'} ({items.length})
            </h2>
            <p className="text-xs text-slate-500">
              {activeCategory?.description || 'บริหารตัวเลือกและ Behavior Flags แบบไร้ Hardcode'}
            </p>
          </div>
          <button type="button" onClick={openMultiAdd} disabled={!activeCategory} className="bma-btn-primary">
            <i className="fa-solid fa-plus" />
            เพิ่มตัวเลือก (เพิ่มได้หลายรายการ)
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 text-left">
                <th className="py-2 pr-2 w-16">ลำดับ</th>
                <th className="py-2 pr-2">รหัส</th>
                <th className="py-2 pr-2">ชื่อตัวเลือก</th>
                <th className="py-2 pr-2">คำย่อ</th>
                {activeCategory?.has_approver_flag && <th className="py-2 pr-2">ลำดับชั้น</th>}
                <th className="py-2 pr-2">คุณสมบัติและสถานะ</th>
                <th className="py-2 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    ยังไม่มีรายการในหมวดหมู่นี้ คลิกปุ่ม "+ เพิ่มตัวเลือก" ด้านบนเพื่อเริ่มต้น
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => (
                  <tr key={item.id} className={!item.is_active ? 'opacity-55' : ''}>
                    <td className="py-2.5 pr-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => void handleMove(idx, -1)}
                          className="btn-sort-arrow"
                          title="เลื่อนขึ้น"
                        >
                          <i className="fa-solid fa-chevron-up" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === items.length - 1}
                          onClick={() => void handleMove(idx, 1)}
                          className="btn-sort-arrow"
                          title="เลื่อนลง"
                        >
                          <i className="fa-solid fa-chevron-down" />
                        </button>
                      </div>
                    </td>
                    <td className="py-2.5 pr-2 font-mono font-bold text-slate-600 dark:text-slate-300">
                      {item.code}
                    </td>
                    <td className="py-2.5 pr-2 font-semibold text-slate-800 dark:text-white">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle"
                        style={{ backgroundColor: item.color_hex || '#00744B' }}
                      />
                      {item.name_th}
                    </td>
                    <td className="py-2.5 pr-2 text-slate-500">{item.short_name || '-'}</td>
                    {activeCategory?.has_approver_flag && (
                      <td className="py-2.5 pr-2 font-mono font-bold text-sky-600">{item.rank_order}</td>
                    )}
                    <td className="py-2.5 pr-2">
                      <div className="flex flex-wrap gap-1">
                        {item.is_default && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-bold text-[10px]">
                            ค่าเริ่มต้น
                          </span>
                        )}
                        {activeCategory?.has_provision_flag && (
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                              item.allows_account_provision
                                ? 'bg-teal-100 text-teal-700'
                                : 'bg-rose-100 text-rose-700'
                            }`}
                          >
                            {item.allows_account_provision ? 'สร้างบัญชีได้' : 'ระงับบัญชี'}
                          </span>
                        )}
                        {activeCategory?.has_approver_flag && item.is_approver && (
                          <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-bold text-[10px]">
                            ผู้อนุมัติ
                          </span>
                        )}
                        {!item.is_active && (
                          <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-bold text-[10px]">
                            ปิดใช้งาน
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await masterDataService.toggleActive('lookup_items', item.id, !item.is_active);
                            await refresh();
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : 'เปลี่ยนสถานะไม่สำเร็จ', 'error');
                          }
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 text-slate-600 dark:text-slate-300"
                        title={item.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      >
                        <i className={`fa-solid ${item.is_active ? 'fa-eye' : 'fa-eye-slash'}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingItem({ ...item });
                          setEditModalOpen(true);
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-100 text-slate-700 dark:text-slate-200"
                        title="แก้ไข"
                      >
                        <i className="fa-solid fa-pen" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteItem(item)}
                        className="px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-600"
                        title="ลบ"
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Category Modal */}
      <ResponsiveModal
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        title="เพิ่มหมวดหมู่ตัวเลือกใหม่"
        icon="fa-folder-plus"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={(e) => void handleSaveCategory(e)} className="space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="bma-label">รหัสหมวดหมู่ *</label>
              <input
                required
                value={editingCat.code || ''}
                onChange={(e) => setEditingCat({ ...editingCat, code: e.target.value.toUpperCase() })}
                className="bma-input font-mono uppercase"
                placeholder="เช่น EDUCATION_LEVEL"
              />
            </div>
            <div>
              <label className="bma-label">ชื่อหมวดหมู่ภาษาไทย *</label>
              <input
                required
                value={editingCat.name_th || ''}
                onChange={(e) => setEditingCat({ ...editingCat, name_th: e.target.value })}
                className="bma-input"
                placeholder="เช่น วุฒิการศึกษา"
              />
            </div>
          </div>
          <div>
            <label className="bma-label">คำอธิบาย</label>
            <input
              value={editingCat.description || ''}
              onChange={(e) => setEditingCat({ ...editingCat, description: e.target.value })}
              className="bma-input"
            />
          </div>
          <div className="flex flex-wrap gap-3 text-xs pt-1">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(editingCat.has_provision_flag)}
                onChange={(e) => setEditingCat({ ...editingCat, has_provision_flag: e.target.checked })}
              />
              ใช้ Flag สร้างบัญชี
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(editingCat.has_approver_flag)}
                onChange={(e) => setEditingCat({ ...editingCat, has_approver_flag: e.target.checked })}
              />
              ใช้ Flag ผู้อนุมัติ
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCatModalOpen(false)} className="bma-btn-outline">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving} className="bma-btn-primary">
              บันทึกหมวดหมู่
            </button>
          </div>
        </form>
      </ResponsiveModal>

      {/* Multi-Row Batch Add Modal (Checkin-style) */}
      <ResponsiveModal
        open={multiOpen}
        onClose={() => setMultiOpen(false)}
        title={`เพิ่มตัวเลือกในหมวด "${activeCategory?.name_th || ''}"`}
        subtitle="เพิ่มได้หลายรายการพร้อมกันในครั้งเดียว"
        icon="fa-list-check"
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={(e) => void handleSaveMulti(e)} className="space-y-3 text-sm">
          <div className="space-y-2">
            {multiRows.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 gap-2 items-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700"
              >
                <input
                  required
                  value={row.code}
                  onChange={(e) =>
                    setMultiRows((p) =>
                      p.map((x, i) => (i === idx ? { ...x, code: e.target.value.toUpperCase() } : x))
                    )
                  }
                  placeholder="รหัส (CODE)*"
                  className="bma-input text-xs font-mono uppercase col-span-3"
                />
                <input
                  required
                  value={row.name_th}
                  onChange={(e) =>
                    setMultiRows((p) => p.map((x, i) => (i === idx ? { ...x, name_th: e.target.value } : x)))
                  }
                  placeholder="ชื่อภาษาไทย*"
                  className="bma-input text-xs col-span-4"
                />
                <input
                  value={row.short_name}
                  onChange={(e) =>
                    setMultiRows((p) => p.map((x, i) => (i === idx ? { ...x, short_name: e.target.value } : x)))
                  }
                  placeholder="คำย่อ CSV"
                  className="bma-input text-xs col-span-2"
                />
                <input
                  type="number"
                  value={row.rank_order}
                  onChange={(e) =>
                    setMultiRows((p) =>
                      p.map((x, i) => (i === idx ? { ...x, rank_order: Number(e.target.value) } : x))
                    )
                  }
                  placeholder="Rank"
                  title="ลำดับชั้น (Rank Order)"
                  className="bma-input text-xs col-span-1"
                />
                <input
                  type="color"
                  value={row.color_hex}
                  onChange={(e) =>
                    setMultiRows((p) => p.map((x, i) => (i === idx ? { ...x, color_hex: e.target.value } : x)))
                  }
                  className="h-9 w-full rounded-lg border border-slate-300 cursor-pointer col-span-1"
                />
                <button
                  type="button"
                  disabled={multiRows.length === 1}
                  onClick={() => setMultiRows((p) => p.filter((_, i) => i !== idx))}
                  className="col-span-1 text-rose-500 hover:text-rose-700 disabled:opacity-30"
                >
                  <i className="fa-solid fa-trash-can" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setMultiRows((p) => [
                ...p,
                { code: '', name_th: '', short_name: '', rank_order: 0, color_hex: '#00744B' },
              ])
            }
            className="bma-btn-outline text-xs"
          >
            <i className="fa-solid fa-plus text-emerald-600" />
            เพิ่มแถวรายการ
          </button>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button type="button" onClick={() => setMultiOpen(false)} className="bma-btn-outline">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving} className="bma-btn-primary">
              <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-check'}`} />
              บันทึกทั้งหมด ({multiRows.length} รายการ)
            </button>
          </div>
        </form>
      </ResponsiveModal>

      {/* Single Edit Item Modal */}
      <ResponsiveModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`แก้ไขตัวเลือก — ${activeCategory?.name_th || ''}`}
        icon="fa-pen-to-square"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={(e) => void handleSaveItem(e)} className="space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="bma-label">รหัส *</label>
              <input
                required
                value={editingItem.code || ''}
                onChange={(e) => setEditingItem({ ...editingItem, code: e.target.value.toUpperCase() })}
                className="bma-input font-mono uppercase"
              />
            </div>
            <div>
              <label className="bma-label">ชื่อภาษาไทย *</label>
              <input
                required
                value={editingItem.name_th || ''}
                onChange={(e) => setEditingItem({ ...editingItem, name_th: e.target.value })}
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">คำย่อสำหรับนำเข้าข้อมูล</label>
              <input
                value={editingItem.short_name || ''}
                onChange={(e) => setEditingItem({ ...editingItem, short_name: e.target.value })}
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">ลำดับชั้น</label>
              <input
                type="number"
                value={editingItem.rank_order ?? 0}
                onChange={(e) => setEditingItem({ ...editingItem, rank_order: Number(e.target.value) })}
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">สีป้ายแสดงผล</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editingItem.color_hex || '#00744B'}
                  onChange={(e) => setEditingItem({ ...editingItem, color_hex: e.target.value })}
                  className="h-10 w-12 rounded-lg border border-slate-300 cursor-pointer"
                />
                <input
                  value={editingItem.color_hex || '#00744B'}
                  onChange={(e) => setEditingItem({ ...editingItem, color_hex: e.target.value })}
                  className="bma-input font-mono"
                />
              </div>
            </div>
            <div>
              <label className="bma-label">ลำดับแสดงผล</label>
              <input
                type="number"
                value={editingItem.sort_order ?? 0}
                onChange={(e) => setEditingItem({ ...editingItem, sort_order: Number(e.target.value) })}
                className="bma-input"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 pt-2 text-xs font-semibold">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(editingItem.is_default)}
                onChange={(e) => setEditingItem({ ...editingItem, is_default: e.target.checked })}
              />
              ค่าเริ่มต้นของหมวด
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={editingItem.is_active !== false}
                onChange={(e) => setEditingItem({ ...editingItem, is_active: e.target.checked })}
              />
              เปิดใช้งาน
            </label>
            {activeCategory?.has_provision_flag && (
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={editingItem.allows_account_provision !== false}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, allows_account_provision: e.target.checked })
                  }
                />
                อนุญาตสร้างบัญชี/เข้า SSO
              </label>
            )}
            {activeCategory?.has_approver_flag && (
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={Boolean(editingItem.is_approver)}
                  onChange={(e) => setEditingItem({ ...editingItem, is_approver: e.target.checked })}
                />
                เป็นผู้มีอำนาจลงนาม
              </label>
            )}
          </div>

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

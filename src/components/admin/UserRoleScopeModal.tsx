import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { useMasterData } from '@/hooks/useMasterData';
import { flattenOrgUnitsInTreeOrder } from '@/lib/masterDataSort';
import { userService, type ScopedUserViewRow } from '@/services/userService';
import { useUiStore } from '@/stores/useUiStore';
import type { AdminScopeLevelNo, CoreRole } from '@/types/database.types';

export function UserRoleScopeModal({
  open,
  onClose,
  targetUser,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  targetUser: ScopedUserViewRow | null;
  onSaved: () => void;
}) {
  const { data: master } = useMasterData();
  const showToast = useUiStore((s) => s.showToast);

  const [role, setRole] = useState<CoreRole>('USER');
  const [scopeLevel, setScopeLevel] = useState<AdminScopeLevelNo>(2);
  const [orgUnitId, setOrgUnitId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!targetUser || !open) return;
    setRole(targetUser.role);
    setScopeLevel(targetUser.scope_level_no ?? 2);
    setOrgUnitId(targetUser.scope_org_unit_id ?? '');
  }, [targetUser, open]);

  const scopeNodes = useMemo(
    () =>
      flattenOrgUnitsInTreeOrder(master.orgUnits, { activeOnly: true }).filter(
        (n) => n.unit.level_no === scopeLevel
      ),
    [master.orgUnits, scopeLevel]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUser) return;
    if (role === 'ADMIN' && !orgUnitId) {
      showToast('บทบาท ADMIN บังคับต้องระบุขอบเขตสังกัด (สำนักงาน/กอง หรือ ส่วน/ฝ่าย)', 'warning');
      return;
    }
    setSaving(true);
    try {
      await userService.assignRoleAndScope(
        targetUser.id,
        role,
        role === 'ADMIN' ? scopeLevel : null,
        role === 'ADMIN' ? orgUnitId : null
      );
      showToast('บันทึกบทบาทและขอบเขต Admin สำเร็จ', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถบันทึกบทบาทได้', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      title={`กำหนดสิทธิ์และขอบเขต: ${targetUser?.full_name || targetUser?.username || ''}`}
      icon="fa-user-shield"
    >
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-xs font-bold mb-1">บทบาทระบบหลัก (3 สิทธิ์หลัก)</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as CoreRole)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-bold"
          >
            <option value="USER">USER — ผู้ใช้งานทั่วไป</option>
            <option value="ADMIN">ADMIN — ผู้ดูแลระบบประจำสังกัด (บังคับเลือกขอบเขต 2 ระดับ)</option>
            <option value="SUPERADMIN">SUPERADMIN — ผู้ดูแลระบบสูงสุดทั้งหน่วยงาน</option>
          </select>
        </div>

        {role === 'ADMIN' && (
          <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 space-y-3">
            <div>
              <label className="block text-xs font-bold mb-1">ระดับขอบเขตการมองเห็นของ ADMIN *</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setScopeLevel(2);
                    setOrgUnitId('');
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border ${
                    scopeLevel === 2 ? 'bg-[#00744B] text-white border-[#00744B]' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  ขอบเขตสำนักงาน/กอง (Lv2)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScopeLevel(3);
                    setOrgUnitId('');
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border ${
                    scopeLevel === 3 ? 'bg-[#00744B] text-white border-[#00744B]' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  ขอบเขตส่วน/ฝ่าย (Lv3)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">
                เลือก{scopeLevel === 2 ? 'สำนักงาน/กอง' : 'ส่วน/ฝ่าย'}ที่ดูแล *
              </label>
              <select
                required
                value={orgUnitId}
                onChange={(e) => setOrgUnitId(e.target.value)}
                className="bma-input text-sm"
              >
                <option value="">-- เลือกสังกัด --</option>
                {scopeNodes.map(({ unit: u, parentName }) => {
                  const label = scopeLevel === 3 && parentName ? `${u.name_th} (${parentName})` : u.name_th;
                  return (
                    <option key={u.id} value={u.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
              {scopeNodes.length === 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5">
                  ยังไม่มีข้อมูล{scopeLevel === 2 ? 'สำนักงาน/กอง' : 'ส่วน/ฝ่าย'}ในระบบ —{' '}
                  <Link to="/settings/system?tab=org-units" onClick={onClose} className="underline font-bold">
                    ไปเพิ่มโครงสร้างหน่วยงาน
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border text-xs font-bold">ยกเลิก</button>
          <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl bg-[#00744B] text-white text-xs font-bold">
            {saving ? 'กำลังบันทึก...' : 'บันทึกบทบาทและขอบเขต'}
          </button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

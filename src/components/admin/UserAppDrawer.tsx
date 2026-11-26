import { useEffect, useRef, useState } from 'react';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { ThaiDatePicker, focusInvalidThaiDateInput } from '@/components/common/ThaiDatePicker';
import { appAccessService, type AppAccessMatrixRow } from '@/services/appAccessService';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import { extractBangkokIsoDate, isoDateToBangkokEndOfDayIso } from '@/lib/thaiDate';
import { formatOrgDisplay } from '@/lib/positionFormatter';
import { useUiStore } from '@/stores/useUiStore';
import type { ScopedUserViewRow } from '@/services/userService';
import type { WebappWithRoles } from '@/types/domain.types';

interface UserAppDrawerProps {
  open: boolean;
  user: ScopedUserViewRow | null;
  webapps: WebappWithRoles[];
  existingPermissions: AppAccessMatrixRow[];
  onClose: () => void;
  onSaved: () => void;
}

interface AppPermDraft {
  is_allowed: boolean;
  webapp_role_id: string;
  expires_at: string;
  note: string;
  dirty: boolean;
}

export function UserAppDrawer({
  open,
  user,
  webapps,
  existingPermissions,
  onClose,
  onSaved,
}: UserAppDrawerProps) {
  const { isSuperAdmin } = useScopedPermissions();
  const showToast = useUiStore((s) => s.showToast);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AppPermDraft>>({});
  const [invalidApps, setInvalidApps] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    const permByApp = new Map<string, AppAccessMatrixRow>();
    for (const p of existingPermissions) {
      if (p.user_id === user.id) permByApp.set(p.webapp_id, p);
    }

    const next: Record<string, AppPermDraft> = {};
    for (const app of webapps) {
      const existing = permByApp.get(app.id);
      const grantableRoles = (app.roles || []).filter(
        (r) => r.is_active && (isSuperAdmin || r.allow_scoped_admin_grant)
      );
      const defaultRole =
        grantableRoles.find((r) => r.is_default_on_grant) || grantableRoles[0] || app.roles?.[0];
      next[app.id] = {
        is_allowed: existing ? existing.is_allowed : false,
        webapp_role_id: existing?.webapp_role_id || defaultRole?.id || '',
        expires_at: extractBangkokIsoDate(existing?.expires_at),
        note: existing?.note || '',
        dirty: false,
      };
    }
    setDrafts(next);
    setInvalidApps({});
  }, [open, user, webapps, existingPermissions, isSuperAdmin]);

  if (!user) return null;

  const handleSaveAll = async () => {
    const invalidInput = focusInvalidThaiDateInput(contentRef.current);
    const hasInvalidDate = Boolean(invalidInput) || Object.values(invalidApps).some(Boolean);
    if (hasInvalidDate) {
      showToast('พบวันหมดอายุสิทธิ์ (พ.ศ.) ที่ไม่ถูกต้อง กรุณาแก้ไขให้ถูกต้องหรือล้างค่าก่อนบันทึก', 'error');
      return;
    }

    const dirtyApps = Object.entries(drafts).filter(([, d]) => d.dirty && d.webapp_role_id);
    if (dirtyApps.length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      for (const [webappId, d] of dirtyApps) {
        await appAccessService.bulkGrant({
          webappId,
          webappRoleId: d.webapp_role_id,
          userIds: [user.id],
          isAllowed: d.is_allowed,
          expiresAt: isoDateToBangkokEndOfDayIso(d.expires_at),
          note: d.note.trim() || null,
        });
      }
      showToast(`บันทึกสิทธิ์เว็บแอปของ ${user.full_name || user.username} เรียบร้อย`, 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถบันทึกสิทธิ์เว็บแอปได้', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      title={`กำหนดสิทธิ์เว็บแอป: ${user.full_name || user.username}`}
      subtitle={formatOrgDisplay({ officeName: user.office_name, departmentName: user.department_name }).full || '-'}
      icon="fa-shield-halved"
      maxWidthClass="max-w-2xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="bma-btn-outline">
            ยกเลิก
          </button>
          <button type="button" disabled={saving} onClick={() => void handleSaveAll()} className="bma-btn-primary">
            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-check'} mr-1.5`} />
            บันทึกสิทธิ์ทั้งหมด
          </button>
        </>
      }
    >
      <div ref={contentRef} className="space-y-3">
        {webapps.map((app) => {
          const d = drafts[app.id];
          if (!d) return null;
          const grantableRoles = (app.roles || []).filter(
            (r) => r.is_active && (isSuperAdmin || r.allow_scoped_admin_grant)
          );
          const lockedBySuperAdmin =
            !isSuperAdmin &&
            d.webapp_role_id &&
            !grantableRoles.some((r) => r.id === d.webapp_role_id);

          return (
            <div
              key={app.id}
              className={`rounded-xl border p-3.5 space-y-3 transition ${
                d.is_allowed
                  ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/20'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-9 h-9 rounded-xl text-white flex items-center justify-center shrink-0"
                    style={{ backgroundColor: app.color || '#00744B' }}
                  >
                    <i className={`fa-solid ${app.icon || 'fa-window-maximize'} text-sm`} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">
                      {app.name}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">{app.app_code}</div>
                  </div>
                </div>

                <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    disabled={Boolean(lockedBySuperAdmin)}
                    checked={d.is_allowed}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [app.id]: { ...(prev[app.id] ?? d), is_allowed: e.target.checked, dirty: true },
                      }))
                    }
                  />
                  {d.is_allowed ? (
                    <span className="text-emerald-700 dark:text-emerald-400">อนุญาตใช้งาน</span>
                  ) : (
                    <span className="text-slate-400">ปิดสิทธิ์</span>
                  )}
                </label>
              </div>

              {lockedBySuperAdmin ? (
                <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1.5 rounded-lg">
                  <i className="fa-solid fa-lock mr-1.5" />
                  ผู้ใช้นี้ถือสิทธิ์ระดับสูงของแอปซึ่งแก้ไขได้เฉพาะ SUPERADMIN เท่านั้น
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                      ระดับสิทธิ์ภายในแอป
                    </label>
                    <select
                      className="bma-input text-xs py-1.5"
                      value={d.webapp_role_id}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [app.id]: { ...(prev[app.id] ?? d), webapp_role_id: e.target.value, dirty: true },
                        }))
                      }
                    >
                      {grantableRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.role_name_th} ({r.role_code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                      วันหมดอายุสิทธิ์ (พ.ศ. — ถ้ามี)
                    </label>
                    <ThaiDatePicker
                      compact
                      value={d.expires_at}
                      onChange={(iso) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [app.id]: { ...(prev[app.id] ?? d), expires_at: iso, dirty: true },
                        }))
                      }
                      onInvalidChange={(invalid) =>
                        setInvalidApps((prev) => ({ ...prev, [app.id]: invalid }))
                      }
                      placeholder="วว/ดด/พ.ศ."
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                      หมายเหตุ (Note)
                    </label>
                    <input
                      type="text"
                      className="bma-input text-xs py-1.5"
                      value={d.note}
                      placeholder="ระบุเหตุผลหรือคำสั่งแต่งตั้ง..."
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [app.id]: { ...(prev[app.id] ?? d), note: e.target.value, dirty: true },
                        }))
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ResponsiveModal>
  );
}

import { useRef, useState } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { useUiStore } from '@/stores/useUiStore';
import {
  DriveNotConfiguredError,
  deleteFromGoogleDrive,
  readFileAsDataUrl,
  uploadToGoogleDrive,
} from '@/services/driveStorageService';
import { showDriveNotConfiguredAlert } from '@/lib/swalHelpers';
import { sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import { DriveImage } from '@/components/common/DriveImage';

export interface SettingsGeneralTabProps {
  form: Record<string, string>;
  setVal: (key: string, value: string) => void;
  saving: boolean;
  onSave: () => Promise<boolean> | void;
  onGoToDriveTab: () => void;
}

export function SettingsGeneralTab({
  form,
  setVal,
  saving,
  onSave,
  onGoToDriveTab,
}: SettingsGeneralTabProps) {
  const { settings } = useSettings();
  const showToast = useUiStore((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const initialLogoRef = useRef<string>((settings.logo_url || '').trim());
  const pendingLogoUploadsRef = useRef<string[]>([]);

  const effectiveDriveSettings = {
    ...settings,
    google_drive_script_url: form.google_drive_script_url || settings.google_drive_script_url,
    google_drive_logo_folder_id:
      form.google_drive_logo_folder_id || settings.google_drive_logo_folder_id,
    google_drive_image_folder_id:
      form.google_drive_image_folder_id || settings.google_drive_image_folder_id,
  };

  const handleUploadLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await uploadToGoogleDrive({
        base64DataUrl: dataUrl,
        mimeType: file.type || 'image/png',
        fileName: `portal_logo_${Date.now()}_${file.name}`,
        category: 'logo',
        settings: effectiveDriveSettings,
      });
      pendingLogoUploadsRef.current.push(res.url);
      setVal('logo_url', res.url);
      if (res.sharingWarning) {
        showToast(res.sharingWarning, 'warning');
      } else {
        showToast('อัปโหลดโลโก้ขึ้น Google Drive สำเร็จ (อย่าลืมกดบันทึกการตั้งค่า)', 'success');
      }
    } catch (err) {
      if (err instanceof DriveNotConfiguredError) {
        await showDriveNotConfiguredAlert(err.missingLabel, true, onGoToDriveTab);
      } else {
        showToast(err instanceof Error ? err.message : 'อัปโหลดโลโก้ไม่สำเร็จ', 'error');
      }
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSaveGeneral = async () => {
    const ok = await onSave();
    if (ok !== false) {
      const finalLogo = (form.logo_url || '').trim();
      const toDelete = new Set<string>();
      if (initialLogoRef.current && initialLogoRef.current !== finalLogo) {
        toDelete.add(initialLogoRef.current);
      }
      for (const u of pendingLogoUploadsRef.current) {
        if (u && u !== finalLogo) toDelete.add(u);
      }
      for (const url of toDelete) {
        void deleteFromGoogleDrive({
          fileUrlOrId: url,
          category: 'logo',
          settings: effectiveDriveSettings,
        });
      }
      initialLogoRef.current = finalLogo;
      pendingLogoUploadsRef.current = [];
    }
  };

  const previewLogo = sanitizeImageUrl(form.logo_url);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Card 1: Branding & Identity */}
        <div className="bma-card p-5 space-y-4">
          <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100 dark:border-slate-800">
            <span className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-[#00744B] dark:text-emerald-300 flex items-center justify-center">
              <i className="fa-solid fa-building-columns text-sm" />
            </span>
            <div>
              <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">ข้อมูลองค์กรและอัตลักษณ์ระบบ</h3>
              <p className="text-[11px] text-slate-500">แสดงบนแถบเมนูด้านข้าง หน้าเข้าสู่ระบบ และส่วนท้ายหน้าเว็บ</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="bma-label">ชื่อองค์กรหลัก</label>
              <input
                value={form.organization_name || ''}
                onChange={(e) => setVal('organization_name', e.target.value)}
                className="bma-input"
                placeholder="กรุงเทพมหานคร"
              />
            </div>
            <div>
              <label className="bma-label">ชื่อหน่วยงาน</label>
              <input
                value={form.bureau_name || ''}
                onChange={(e) => setVal('bureau_name', e.target.value)}
                className="bma-input"
                placeholder="สำนักเทศกิจ"
              />
            </div>
          </div>

          <div>
            <label className="bma-label">ชื่อเต็มระบบ</label>
            <input
              value={form.system_title || ''}
              onChange={(e) => setVal('system_title', e.target.value)}
              className="bma-input"
              placeholder="ศูนย์กลางข้อมูลบุคลากรและยืนยันตัวตน"
            />
          </div>

          <div>
            <label className="bma-label">คำอธิบายท้ายหน้า</label>
            <input
              value={form.footer_description || ''}
              onChange={(e) => setVal('footer_description', e.target.value)}
              className="bma-input"
            />
          </div>

          <div className="space-y-2">
            <label className="bma-label">โลโก้หน่วยงาน</label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-14 h-14 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                {previewLogo ? (
                  <DriveImage
                    src={previewLogo}
                    alt="ตัวอย่างโลโก้"
                    category="logo"
                    settingsOverride={effectiveDriveSettings}
                    className="w-full h-full object-contain p-1"
                    fallback={<i className="fa-solid fa-shield-halved text-xl text-emerald-600" />}
                  />
                ) : (
                  <i className="fa-solid fa-shield-halved text-xl text-emerald-600" />
                )}
              </div>
              <div className="flex-1 min-w-[200px] space-y-2">
                <input
                  value={form.logo_url || ''}
                  onChange={(e) => setVal('logo_url', e.target.value)}
                  className="bma-input text-xs font-mono"
                  placeholder="https://lh3.googleusercontent.com/d/..."
                />
                <div className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadLogo(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploadingLogo}
                    onClick={() => fileRef.current?.click()}
                    className="bma-btn-outline text-xs py-1.5"
                  >
                    <i className={`fa-solid ${uploadingLogo ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'} text-emerald-600`} />
                    อัปโหลดโลโก้ขึ้น Google Drive
                  </button>
                  {form.logo_url && (
                    <button
                      type="button"
                      onClick={() => setVal('logo_url', '')}
                      className="text-xs text-rose-500 hover:underline font-semibold"
                    >
                      ล้างรูป
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Security & Registration Policy */}
        <div className="bma-card p-5 space-y-4">
          <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100 dark:border-slate-800">
            <span className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center">
              <i className="fa-solid fa-shield-halved text-sm" />
            </span>
            <div>
              <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">ความปลอดภัยและการลงทะเบียน</h3>
              <p className="text-[11px] text-slate-500">นโยบายลงทะเบียนด้วยตนเองและการล็อกบัญชีชั่วคราว</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-slate-50/70 dark:bg-slate-800/40">
            <label className="inline-flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.allow_self_register === 'true'}
                onChange={(e) => setVal('allow_self_register', e.target.checked ? 'true' : 'false')}
              />
              <div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  เปิดให้บุคลากรลงทะเบียนด้วยตนเอง
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  อนุญาตให้เข้าหน้าลงทะเบียนเพื่อขอเปิดบัญชีด้วยเลขประจำตัวประชาชน 13 หลัก (ต้องมีรายชื่อในทะเบียนบุคลากรแล้ว)
                </p>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="bma-label">จำนวนครั้งเข้าสู่ระบบผิดสูงสุด</label>
              <input
                type="number"
                min={3}
                max={20}
                value={form.max_login_attempts || '5'}
                onChange={(e) => setVal('max_login_attempts', e.target.value)}
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">เวลาล็อกบัญชีชั่วคราว (นาที)</label>
              <input
                type="number"
                min={1}
                max={120}
                value={form.login_lock_minutes || '15'}
                onChange={(e) => setVal('login_lock_minutes', e.target.value)}
                className="bma-input"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSaveGeneral()}
          className="bma-btn-primary px-6 py-2.5"
        >
          <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
          บันทึกข้อมูลหน่วยงานและความปลอดภัย
        </button>
      </div>
    </div>
  );
}

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
import { getTodayIsoBangkok } from '@/lib/thaiDate';
import { ThaiDatePicker, focusInvalidThaiDateInput } from '@/components/common/ThaiDatePicker';
import { SystemUpdateModal, sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import { DriveImage } from '@/components/common/DriveImage';

export interface SettingsAnnouncementTabProps {
  form: Record<string, string>;
  setVal: (key: string, value: string) => void;
  saving: boolean;
  onSaveAnnouncement: () => Promise<boolean> | void;
  onGoToDriveTab: () => void;
}

export function SettingsAnnouncementTab({
  form,
  setVal,
  saving,
  onSaveAnnouncement,
  onGoToDriveTab,
}: SettingsAnnouncementTabProps) {
  const { settings } = useSettings();
  const showToast = useUiStore((s) => s.showToast);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [startDateInvalid, setStartDateInvalid] = useState(false);
  const [endDateInvalid, setEndDateInvalid] = useState(false);
  const initialImgRef = useRef<string>((settings.announcement_image_url || '').trim());
  const pendingImgUploadsRef = useRef<string[]>([]);
  const hasInvalidDateInput = startDateInvalid || endDateInvalid;

  const effectiveDriveSettings = {
    ...settings,
    google_drive_script_url: form.google_drive_script_url || settings.google_drive_script_url,
    google_drive_image_folder_id:
      form.google_drive_image_folder_id || settings.google_drive_image_folder_id,
  };

  const handleSave = async () => {
    const invalidInput = focusInvalidThaiDateInput(containerRef.current);
    if (hasInvalidDateInput || invalidInput) {
      showToast('พบวันที่ประกาศ (พ.ศ.) ที่ไม่ถูกต้อง กรุณาแก้ไขให้ถูกต้องหรือล้างค่าก่อนบันทึก', 'error');
      return;
    }
    const ok = await onSaveAnnouncement();
    if (ok !== false) {
      const finalImg = (form.announcement_image_url || '').trim();
      const toDelete = new Set<string>();
      if (initialImgRef.current && initialImgRef.current !== finalImg) {
        toDelete.add(initialImgRef.current);
      }
      for (const u of pendingImgUploadsRef.current) {
        if (u && u !== finalImg) toDelete.add(u);
      }
      for (const url of toDelete) {
        void deleteFromGoogleDrive({
          fileUrlOrId: url,
          category: 'image',
          settings: effectiveDriveSettings,
        });
      }
      initialImgRef.current = finalImg;
      pendingImgUploadsRef.current = [];
    }
  };

  const enabled = form.announcement_enabled === 'true';
  const mode = form.announcement_mode === 'image' ? 'image' : 'text';
  const today = getTodayIsoBangkok();
  const invalidDateRange = Boolean(
    form.announcement_start_date &&
      form.announcement_end_date &&
      form.announcement_start_date > form.announcement_end_date
  );
  const inDateRange =
    !invalidDateRange &&
    (!form.announcement_start_date || today >= form.announcement_start_date) &&
    (!form.announcement_end_date || today <= form.announcement_end_date);

  const handleUploadImage = async (file: File) => {
    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await uploadToGoogleDrive({
        base64DataUrl: dataUrl,
        mimeType: file.type || 'image/png',
        fileName: `announcement_${Date.now()}_${file.name}`,
        category: 'image',
        subFolderName: 'System_Announcements',
        settings: effectiveDriveSettings,
      });
      pendingImgUploadsRef.current.push(res.url);
      setVal('announcement_image_url', res.url);
      setVal('announcement_mode', 'image');
      if (res.sharingWarning) {
        showToast(res.sharingWarning, 'warning');
      } else {
        showToast('อัปโหลดรูปประกาศขึ้น Google Drive สำเร็จ', 'success');
      }
    } catch (err) {
      if (err instanceof DriveNotConfiguredError) {
        await showDriveNotConfiguredAlert(err.missingLabel, true, onGoToDriveTab);
      } else {
        showToast(err instanceof Error ? err.message : 'อัปโหลดรูปประกาศไม่สำเร็จ', 'error');
      }
    } finally {
      setUploading(false);
    }
  };

  const safeImg = sanitizeImageUrl(form.announcement_image_url);

  return (
    <div ref={containerRef} className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Form Controls */}
        <div className="lg:col-span-7 bma-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center">
                <i className="fa-solid fa-bullhorn text-sm" />
              </span>
              <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">
                ตั้งค่าประกาศระบบเมื่อเข้าใช้งาน
              </h3>
            </div>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                !enabled
                  ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  : inDateRange
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
              }`}
            >
              {!enabled ? 'ปิดการแสดงผล' : inDateRange ? 'กำลังเผยแพร่อยู่' : 'อยู่นอกช่วงวันที่กำหนด'}
            </span>
          </div>

          <label className="inline-flex items-center gap-2.5 text-sm font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setVal('announcement_enabled', e.target.checked ? 'true' : 'false')}
            />
            เปิดแสดงหน้าต่างประกาศระบบอัตโนมัติ
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="bma-label">วันที่เริ่มแสดง (วว/ดด/พ.ศ.)</label>
              <ThaiDatePicker
                compact
                value={form.announcement_start_date || ''}
                onChange={(iso) => setVal('announcement_start_date', iso)}
                onInvalidChange={(invalid) => setStartDateInvalid(invalid)}
                placeholder="วว/ดด/พ.ศ."
              />
            </div>
            <div>
              <label className="bma-label">วันที่สิ้นสุด (วว/ดด/พ.ศ.)</label>
              <ThaiDatePicker
                compact
                value={form.announcement_end_date || ''}
                onChange={(iso) => setVal('announcement_end_date', iso)}
                onInvalidChange={(invalid) => setEndDateInvalid(invalid)}
                placeholder="วว/ดด/พ.ศ."
              />
            </div>
          </div>
          {hasInvalidDateInput && (
            <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <i className="fa-solid fa-triangle-exclamation" />
              <span>พบวันที่ประกาศ (พ.ศ.) ที่ไม่ถูกต้อง กรุณาแก้ไขให้ถูกต้องหรือล้างค่าก่อนบันทึก</span>
            </p>
          )}
          {invalidDateRange && (
            <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <i className="fa-solid fa-triangle-exclamation" />
              <span>วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มแสดง กรุณาตรวจสอบช่วงวันที่ประกาศ</span>
            </p>
          )}

          <div className="flex items-center gap-4 text-xs font-bold">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                checked={mode === 'text'}
                onChange={() => setVal('announcement_mode', 'text')}
              />
              โหมดข้อความ
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                checked={mode === 'image'}
                onChange={() => setVal('announcement_mode', 'image')}
              />
              โหมดรูปภาพ / โปสเตอร์
            </label>
          </div>

          <div>
            <label className="bma-label">หัวข้อประกาศ</label>
            <input
              value={form.announcement_title || ''}
              onChange={(e) => setVal('announcement_title', e.target.value)}
              placeholder="เช่น ประกาศปรับปรุงระบบประจำเดือน..."
              className="bma-input"
            />
          </div>

          <div>
            <label className="bma-label">เนื้อหาประกาศ</label>
            <textarea
              rows={4}
              value={form.announcement_body || ''}
              onChange={(e) => setVal('announcement_body', e.target.value)}
              placeholder="รายละเอียดประกาศสำหรับบุคลากร..."
              className="bma-input"
            />
          </div>

          <div className="space-y-2">
            <label className="bma-label">รูปภาพประกาศ (อัปโหลดผ่าน GAS Google Drive โฟลเดอร์รูปภาพ)</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={form.announcement_image_url || ''}
                onChange={(e) => setVal('announcement_image_url', e.target.value)}
                placeholder="https://lh3.googleusercontent.com/d/..."
                className="bma-input font-mono text-xs flex-1"
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadImage(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="bma-btn-outline text-xs shrink-0"
              >
                <i className={`fa-solid ${uploading ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'} text-emerald-600`} />
                อัปโหลดรูป
              </button>
            </div>
          </div>
        </div>

        {/* Live Mobile Preview Card */}
        <div className="lg:col-span-5 bma-card p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-sm text-slate-800 dark:text-white">
                ตัวอย่างการแสดงผล
              </h4>
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="bma-btn-outline text-xs py-1"
              >
                <i className="fa-solid fa-eye text-emerald-600" />
                ดูป๊อปอัปจริง
              </button>
            </div>

            <div className="rounded-2xl border-2 border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-900">
              <div className="bg-gradient-to-r from-[#00351B] via-[#00744B] to-[#00A368] text-white px-4 py-3 text-xs font-bold flex items-center gap-2">
                <i className="fa-solid fa-bullhorn" />
                <span className="truncate">{form.announcement_title || 'หัวข้อประกาศระบบ'}</span>
              </div>
              <div className="p-4 space-y-3">
                {mode === 'image' && safeImg ? (
                  <DriveImage
                    src={safeImg}
                    alt="Announcement Preview"
                    category="image"
                    settingsOverride={effectiveDriveSettings}
                    className="w-full max-h-56 object-contain rounded-xl border border-slate-200 dark:border-slate-700"
                    fallback={
                      <div className="py-6 text-center text-xs text-slate-400">
                        <i className="fa-regular fa-image mr-1" />
                        ไม่สามารถแสดงภาพตัวอย่างได้
                      </div>
                    }
                  />
                ) : null}
                <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line">
                  {form.announcement_body || 'ยังไม่มีเนื้อหาประกาศ...'}
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={saving || invalidDateRange}
            onClick={() => void handleSave()}
            className="bma-btn-primary w-full py-2.5 disabled:opacity-50"
          >
            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`} />
            บันทึกและเผยแพร่ประกาศระบบ
          </button>
        </div>
      </div>

      <SystemUpdateModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        settings={{
          ...effectiveDriveSettings,
          announcement_enabled: true,
          announcement_mode: mode,
          announcement_title: form.announcement_title || '',
          announcement_body: form.announcement_body || '',
          announcement_image_url: form.announcement_image_url || '',
        }}
        versionInfo={{ appVersion: 'v2.7.0', buildId: 'PREVIEW', updatedAt: '', releaseNotes: null }}
      />
    </div>
  );
}

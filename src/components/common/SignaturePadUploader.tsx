import React, { useContext, useState } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
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

const CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundColor: '#f8fafc',
  backgroundImage:
    'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
};

export function SignaturePadUploader({
  value,
  filePrefix = 'signature',
  subFolderName,
  deferDriveDelete = false,
  onUploaded,
  onRemove,
}: {
  value?: string | null;
  filePrefix?: string;
  subFolderName?: string;
  deferDriveDelete?: boolean;
  onUploaded: (url: string) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { settings } = useSettings();
  const { isSuperAdmin } = useScopedPermissions();
  const showToast = useUiStore((s) => s.showToast);
  const navCtx = useContext(UNSAFE_NavigationContext);
  const navigate = (to: string) => navCtx?.navigator?.push(to);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/webp']);
    const mimeType = file.type || 'image/png';
    if (!allowedMimes.has(mimeType)) {
      showToast('รองรับเฉพาะไฟล์รูปภาพ PNG, JPG หรือ WebP เท่านั้น', 'error');
      return;
    }

    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const ext = mimeType === 'image/webp' ? 'webp' : mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const res = await uploadToGoogleDrive({
        base64DataUrl: dataUrl,
        mimeType,
        fileName: `${filePrefix}_${Date.now()}.${ext}`,
        category: 'signature',
        settings,
        subFolderName,
        replaceFileUrl: deferDriveDelete ? undefined : value || undefined,
      });
      await onUploaded(res.url);
      if (res.sharingWarning) {
        showToast(res.sharingWarning, 'warning');
      } else {
        showToast('อัปโหลดไฟล์ลายเซ็นไปยัง Google Drive สำเร็จ', 'success');
      }
    } catch (err) {
      if (err instanceof DriveNotConfiguredError) {
        await showDriveNotConfiguredAlert(err.missingLabel, isSuperAdmin, () => navigate('/settings/system?tab=gdrive'));
      } else {
        showToast(err instanceof Error ? err.message : 'อัปโหลดลายเซ็นไม่สำเร็จ', 'error');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveClick = async () => {
    if (!onRemove || removing) return;
    setRemoving(true);
    try {
      const oldUrl = value;
      await onRemove();
      if (!deferDriveDelete && oldUrl) {
        void deleteFromGoogleDrive({
          fileUrlOrId: oldUrl,
          category: 'signature',
          settings,
        });
      }
      showToast('ลบลายเซ็นเรียบร้อยแล้ว', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ลบลายเซ็นไม่สำเร็จ', 'error');
    } finally {
      setRemoving(false);
    }
  };

  const currentUrl = sanitizeImageUrl(value);

  return (
    <div className="space-y-3">
      {currentUrl ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
          <div
            style={CHECKERBOARD_STYLE}
            className="p-5 flex items-center justify-center min-h-[120px] border-b border-slate-200 dark:border-slate-700"
          >
            <DriveImage
              src={currentUrl}
              alt="ลายเซ็นปัจจุบัน"
              category="signature"
              className="max-h-24 max-w-full object-contain drop-shadow-sm"
              fallback={
                <span className="text-xs text-slate-400">
                  <i className="fa-solid fa-signature mr-1.5" />
                  กำลังโหลดภาพลายเซ็น...
                </span>
              }
            />
          </div>
          <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900/80">
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
              <i className="fa-brands fa-google-drive" />
              บันทึกลายเซ็นบน Google Drive แล้ว
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={currentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition inline-flex items-center gap-1.5"
              >
                <i className="fa-solid fa-up-right-from-square text-[11px]" />
                ดูภาพเต็ม
              </a>
              <label className="px-3 py-1.5 rounded-lg bg-[#00744B] hover:bg-[#005B2E] text-white text-xs font-bold cursor-pointer transition inline-flex items-center gap-1.5">
                <i className={`fa-solid ${uploading ? 'fa-spinner fa-spin' : 'fa-upload'}`} />
                {uploading ? 'กำลังอัปโหลด...' : 'เปลี่ยนรูปลายเซ็น'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              {onRemove && (
                <button
                  type="button"
                  onClick={handleRemoveClick}
                  disabled={removing || uploading}
                  className="px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <i className={`fa-solid ${removing ? 'fa-spinner fa-spin' : 'fa-trash'}`} />
                  ลบลายเซ็น
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-2.5 p-6 rounded-xl border-2 border-dashed border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer transition text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/60 text-[#00744B] dark:text-emerald-300 flex items-center justify-center text-xl">
            <i className={`fa-solid ${uploading ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`} />
          </div>
          <div className="space-y-0.5">
            <div className="text-sm font-extrabold text-slate-800 dark:text-white">
              {uploading ? 'กำลังอัปโหลดไฟล์ลายเซ็นไปยัง Google Drive...' : 'คลิกเพื่ออัปโหลดไฟล์รูปลายเซ็น'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              รองรับไฟล์ PNG (แนะนำพื้นใส), JPG หรือ WebP สำหรับใช้งานบนเอกสารราชการ
            </div>
          </div>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={uploading}
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
}

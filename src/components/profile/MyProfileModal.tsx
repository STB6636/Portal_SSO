import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { DriveImage } from '@/components/common/DriveImage';
import { RoleBadge } from '@/components/common/RoleBadge';
import { ScopeBadge } from '@/components/common/ScopeBadge';
import { SignaturePadUploader } from '@/components/common/SignaturePadUploader';
import { PersonnelFormModal } from '@/components/admin/PersonnelFormModal';
import { sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import { openKp7PrintTab } from '@/features/kp7-canvas/kp7Navigation';
import { useAuthStore } from '@/stores/useAuthStore';
import { useSettings } from '@/contexts/SettingsContext';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import { useUiStore } from '@/stores/useUiStore';
import { authService } from '@/services/authService';
import { personnelService } from '@/services/personnelService';
import {
  DriveNotConfiguredError,
  buildPersonnelSubFolderName,
  deleteFromGoogleDrive,
  readFileAsDataUrl,
  uploadToGoogleDrive,
} from '@/services/driveStorageService';
import { showDriveNotConfiguredAlert } from '@/lib/swalHelpers';
import { cleanDisplaySegment, formatOrgDisplay } from '@/lib/positionFormatter';
import { formatThaiDate, getRetirementDateInfo } from '@/lib/thaiDate';
import { QUERY_KEYS } from '@/lib/queryClient';
import type { PersonnelTimelinesBundle } from '@/types/domain.types';

type MyProfileTabId = 'info' | 'kp7' | 'signature' | 'password';

const EMPTY_TIMELINES: PersonnelTimelinesBundle = {
  nameHistory: [],
  positionHistory: [],
  executiveDuties: [],
  salaryHistory: [],
  evaluations: [],
  disciplinaryRecords: [],
  serviceInterruptions: [],
  educations: [],
  licenses: [],
  trainings: [],
};

export function MyProfileContent({
  onRequestClose,
  inModal = false,
}: {
  onRequestClose?: () => void;
  inModal?: boolean;
}) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { settings } = useSettings();
  const { isSuperAdmin, isAdminOrAbove } = useScopedPermissions();
  const showToast = useUiStore((s) => s.showToast);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<MyProfileTabId>('info');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [editSelfOpen, setEditSelfOpen] = useState(false);

  const personnelId = user?.personnel_id || null;

  const { data: personRecord } = useQuery({
    queryKey: QUERY_KEYS.personnelById(personnelId || ''),
    queryFn: () => personnelService.getPersonnelById(personnelId!),
    enabled: Boolean(personnelId),
  });

  const { data: timelines = EMPTY_TIMELINES, isLoading: loadingTimelines } = useQuery({
    queryKey: QUERY_KEYS.personnelTimelines(personnelId || ''),
    queryFn: () => personnelService.getPersonnelTimelines(personnelId!),
    enabled: Boolean(personnelId),
  });

  const personnelSubFolder = buildPersonnelSubFolderName({
    prefixName: personRecord?.prefix_name,
    firstName: personRecord?.first_name,
    lastName: personRecord?.last_name,
    fullName: personRecord?.full_name || user?.full_name,
    cid: personRecord?.cid,
    cidMasked: user?.cid_masked,
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!user?.personnel_id) {
      showToast('บัญชีนี้ยังไม่ได้ผูกกับทะเบียนประวัติบุคลากร จึงยังไม่สามารถบันทึกรูปโปรไฟล์ได้', 'warning');
      return;
    }
    setUploadingPhoto(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const ext = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg';
      const uploaded = await uploadToGoogleDrive({
        base64DataUrl: dataUrl,
        mimeType: file.type || 'image/jpeg',
        fileName: `profile_${user.personnel_id}_${Date.now()}.${ext}`,
        category: 'image',
        subFolderName: personnelSubFolder,
        replaceFileUrl: user.photo_path || undefined,
        settings,
      });
      await personnelService.updateOwnMedia(user.personnel_id, { photo_path: uploaded.url });
      setUser({ ...user, photo_path: uploaded.url });
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.personnelById(user.personnel_id) });
      if (uploaded.sharingWarning) {
        showToast(uploaded.sharingWarning, 'warning');
      } else {
        showToast('อัปโหลดรูปโปรไฟล์ไปยัง Google Drive สำเร็จ', 'success');
      }
    } catch (err) {
      if (err instanceof DriveNotConfiguredError) {
        await showDriveNotConfiguredAlert(err.missingLabel, isSuperAdmin, () => {
          onRequestClose?.();
          navigate('/settings/system?tab=gdrive');
        });
      } else {
        showToast(err instanceof Error ? err.message : 'อัปโหลดรูปโปรไฟล์ไม่สำเร็จ', 'error');
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handlePhotoRemove = async () => {
    if (!user?.personnel_id || !user.photo_path || removingPhoto) return;
    setRemovingPhoto(true);
    try {
      const oldPhoto = user.photo_path;
      await personnelService.updateOwnMedia(user.personnel_id, { photo_path: null });
      void deleteFromGoogleDrive({ fileUrlOrId: oldPhoto, category: 'image', settings });
      setUser({ ...user, photo_path: null });
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.personnelById(user.personnel_id) });
      showToast('ลบรูปโปรไฟล์เรียบร้อยแล้ว', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ลบรูปโปรไฟล์ไม่สำเร็จ', 'error');
    } finally {
      setRemovingPhoto(false);
    }
  };

  const handleSignatureUploaded = async (url: string) => {
    if (!user?.personnel_id) {
      showToast('บัญชีนี้ยังไม่ได้ผูกกับทะเบียนประวัติบุคลากร จึงยังไม่สามารถบันทึกลายเซ็นได้', 'warning');
      return;
    }
    await personnelService.updateOwnMedia(user.personnel_id, { signature_path: url });
    setUser({ ...user, signature_path: url });
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.personnelById(user.personnel_id) });
  };

  const handleSignatureRemove = async () => {
    if (!user?.personnel_id) return;
    await personnelService.updateOwnMedia(user.personnel_id, { signature_path: null });
    setUser({ ...user, signature_path: null });
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.personnelById(user.personnel_id) });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8 || newPassword !== confirmPassword) {
      showToast('รหัสเข้าใช้ใหม่ต้องมีอย่างน้อย 8 ตัวอักษรและตรงกัน', 'error');
      return;
    }
    setSavingPw(true);
    try {
      await authService.changeCredential(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      showToast('เปลี่ยนรหัสเข้าใช้เรียบร้อยแล้ว', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'เปลี่ยนรหัสเข้าใช้ไม่สำเร็จ', 'error');
    } finally {
      setSavingPw(false);
    }
  };

  const photoUrl = sanitizeImageUrl(user?.photo_path);
  const cleanPosition = cleanDisplaySegment(user?.position_display) || '-';
  const cleanBureau = cleanDisplaySegment(user?.bureau_name || personRecord?.bureau_name) || '-';
  const cleanOffice = cleanDisplaySegment(user?.office_name || personRecord?.office_name) || '-';
  const cleanDept = cleanDisplaySegment(user?.department_name || personRecord?.department_name) || '-';
  const cleanDiv = cleanDisplaySegment(user?.division_name || personRecord?.division_name) || '-';
  const cleanOrgSummary = formatOrgDisplay({
    officeName: user?.office_name || personRecord?.office_name,
    departmentName: user?.department_name || personRecord?.department_name,
    divisionName: user?.division_name || personRecord?.division_name,
  }).full;
  const retirementInfo = getRetirementDateInfo(personRecord?.birth_date);

  const tabs: Array<{ id: MyProfileTabId; label: string; icon: string }> = [
    { id: 'info', label: 'ข้อมูลส่วนตัว & สังกัด', icon: 'fa-id-card' },
    { id: 'kp7', label: 'ประวัติรับราชการ (ก.พ. ๗)', icon: 'fa-file-lines' },
    { id: 'signature', label: 'ลายเซ็นเอกสารราชการ', icon: 'fa-signature' },
    { id: 'password', label: 'เปลี่ยนรหัสเข้าใช้', icon: 'fa-key' },
  ];

  return (
    <>
      <div className={inModal ? 'space-y-4' : 'bma-card overflow-hidden'}>
        {/* Emerald Profile Hero Banner */}
        <div
          className={`bg-gradient-to-r from-[#00351B] via-[#005B2E] to-[#00744B] px-5 py-5 text-white ${
            inModal ? 'rounded-2xl' : ''
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="relative shrink-0 self-start sm:self-center">
              {photoUrl ? (
                <DriveImage
                  src={photoUrl}
                  alt={user?.full_name || ''}
                  category="image"
                  className="w-20 h-20 rounded-2xl object-cover border-2 border-white/80 shadow-lg bg-white"
                  fallback={
                    <div className="w-20 h-20 rounded-2xl bg-white/15 border-2 border-white/40 text-white flex items-center justify-center text-2xl font-extrabold shadow-lg">
                      {(user?.full_name || user?.username || 'U').slice(0, 2)}
                    </div>
                  }
                />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-white/15 border-2 border-white/40 text-white flex items-center justify-center text-2xl font-extrabold shadow-lg">
                  {(user?.full_name || user?.username || 'U').slice(0, 2)}
                </div>
              )}
              <label
                title="เปลี่ยนรูปโปรไฟล์"
                className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-xl bg-white text-[#00744B] hover:bg-emerald-50 shadow-md flex items-center justify-center cursor-pointer transition"
              >
                <i className={`fa-solid ${uploadingPhoto ? 'fa-spinner fa-spin' : 'fa-camera'} text-[11px]`} />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploadingPhoto}
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
              {photoUrl && user?.personnel_id && (
                <button
                  type="button"
                  title="ลบรูปโปรไฟล์"
                  disabled={removingPhoto || uploadingPhoto}
                  onClick={() => void handlePhotoRemove()}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-md flex items-center justify-center transition disabled:opacity-50"
                >
                  <i className={`fa-solid ${removingPhoto ? 'fa-spinner fa-spin' : 'fa-trash'} text-[9px]`} />
                </button>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="text-lg font-extrabold tracking-tight truncate">
                {user?.full_name || user?.username || '-'}
              </h2>
              <p className="text-xs sm:text-sm text-emerald-100 font-medium">{cleanPosition}</p>
              {cleanOrgSummary && (
                <p className="text-[11px] text-emerald-200/90 flex items-center gap-1.5">
                  <i className="fa-solid fa-building-user text-[10px]" />
                  <span className="truncate">{cleanOrgSummary}</span>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <RoleBadge role={user?.role} />
                <ScopeBadge compact />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={!personRecord}
                title={
                  personRecord
                    ? 'เปิดหน้าพิมพ์แบบฟอร์ม ก.พ. ๗ (A4 300 DPI) ในแท็บใหม่'
                    : 'บัญชีนี้ยังไม่ได้เชื่อมโยงกับทะเบียนประวัติบุคลากร'
                }
                onClick={() => personRecord && openKp7PrintTab(personRecord.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 text-xs font-extrabold shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <i className="fa-solid fa-print" />
                <span>พิมพ์ประวัติ (ก.พ. ๗)</span>
              </button>

              {isAdminOrAbove && personRecord && (
                <button
                  type="button"
                  onClick={() => setEditSelfOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/30 text-white text-xs font-bold transition"
                >
                  <i className="fa-solid fa-pen-to-square" />
                  <span>แก้ไขประวัติ</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 4 Tabs Navigation */}
        <div className={inModal ? 'space-y-4' : 'p-5 space-y-5'}>
          <div className="flex flex-wrap gap-1.5 pb-3 border-b border-slate-200 dark:border-slate-800">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                  activeTab === t.id
                    ? 'bg-[#00744B] text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <i className={`fa-solid ${t.icon}`} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Tab 1: ข้อมูลส่วนตัว & สังกัด */}
          {activeTab === 'info' && (
            <div className="space-y-4">
              {!isAdminOrAbove && (
                <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                  <i className="fa-solid fa-circle-info text-emerald-600" />
                  <span>
                    คุณสามารถดูประวัติรับราชการ พิมพ์ ก.พ. ๗ เปลี่ยนรูปโปรไฟล์ อัปโหลดลายเซ็น และเปลี่ยนรหัสเข้าใช้ได้ทันที (หากต้องการปรับปรุงข้อมูลทะเบียนประวัติ กรุณาแจ้งผู้ดูแลในสังกัด)
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
                <div>
                  <label className="bma-label">ชื่อผู้ใช้งาน</label>
                  <input type="text" readOnly value={user?.username || '-'} className="bma-input font-mono bg-slate-50 dark:bg-slate-800/60" />
                </div>
                <div>
                  <label className="bma-label">เลขประจำตัวประชาชน</label>
                  <input type="text" readOnly value={user?.cid_masked || '-'} className="bma-input font-mono bg-slate-50 dark:bg-slate-800/60" />
                </div>
                <div className="sm:col-span-2">
                  <label className="bma-label">ตำแหน่งปัจจุบัน</label>
                  <input type="text" readOnly value={cleanPosition} className="bma-input bg-slate-50 dark:bg-slate-800/60" />
                </div>
                <div>
                  <label className="bma-label">สำนัก</label>
                  <input type="text" readOnly value={cleanBureau} className="bma-input bg-slate-50 dark:bg-slate-800/60" />
                </div>
                <div>
                  <label className="bma-label">สำนักงาน/กอง</label>
                  <input type="text" readOnly value={cleanOffice} className="bma-input bg-slate-50 dark:bg-slate-800/60" />
                </div>
                <div>
                  <label className="bma-label">ส่วน/ฝ่าย</label>
                  <input type="text" readOnly value={cleanDept} className="bma-input bg-slate-50 dark:bg-slate-800/60" />
                </div>
                <div>
                  <label className="bma-label">กลุ่มงาน</label>
                  <input type="text" readOnly value={cleanDiv} className="bma-input bg-slate-50 dark:bg-slate-800/60" />
                </div>
                {personRecord && (
                  <>
                    <div>
                      <label className="bma-label">วันเกิด / ครบเกษียณ</label>
                      <input
                        type="text"
                        readOnly
                        value={
                          personRecord.birth_date
                            ? `${formatThaiDate(personRecord.birth_date, 'short')}${
                                retirementInfo ? ` (เกษียณ ${retirementInfo.retirementDateShort})` : ''
                              }`
                            : '-'
                        }
                        className="bma-input bg-slate-50 dark:bg-slate-800/60"
                      />
                    </div>
                    <div>
                      <label className="bma-label">วันบรรจุเข้ารับราชการ</label>
                      <input
                        type="text"
                        readOnly
                        value={formatThaiDate(personRecord.start_service_date, 'short') || '-'}
                        className="bma-input bg-slate-50 dark:bg-slate-800/60"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: ประวัติรับราชการ (ก.พ. ๗) */}
          {activeTab === 'kp7' && (
            <div className="space-y-4 text-xs">
              {!personRecord ? (
                <p className="py-8 text-center text-slate-400">
                  บัญชีนี้ยังไม่ได้ผูกกับทะเบียนประวัติบุคลากร
                </p>
              ) : loadingTimelines ? (
                <p className="py-8 text-center text-slate-400">
                  <i className="fa-solid fa-spinner fa-spin mr-1.5" />
                  กำลังโหลดประวัติรับราชการ...
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-center">
                      <p className="text-[10px] text-slate-400">ประวัติตำแหน่ง</p>
                      <p className="text-lg font-black text-[#00744B] dark:text-emerald-400 font-mono">
                        {timelines.positionHistory.length}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-center">
                      <p className="text-[10px] text-slate-400">ประวัติเงินเดือน</p>
                      <p className="text-lg font-black text-[#00744B] dark:text-emerald-400 font-mono">
                        {timelines.salaryHistory.length}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-center">
                      <p className="text-[10px] text-slate-400">วุฒิการศึกษา</p>
                      <p className="text-lg font-black text-[#00744B] dark:text-emerald-400 font-mono">
                        {timelines.educations.length}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-center">
                      <p className="text-[10px] text-slate-400">ฝึกอบรม/ดูงาน</p>
                      <p className="text-lg font-black text-[#00744B] dark:text-emerald-400 font-mono">
                        {timelines.trainings.length}
                      </p>
                    </div>
                  </div>

                  {/* Family Summary */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-2">
                    <h4 className="font-extrabold text-slate-700 dark:text-slate-200">
                      ข้อมูลครอบครัว (ก.พ. ๗ ข้อ ๗–๙)
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <p>
                        <span className="text-slate-400">บิดา:</span>{' '}
                        <strong>{cleanDisplaySegment(personRecord.father_full_name) || '-'}</strong>
                      </p>
                      <p>
                        <span className="text-slate-400">มารดา:</span>{' '}
                        <strong>{cleanDisplaySegment(personRecord.mother_full_name) || '-'}</strong>
                      </p>
                      <p>
                        <span className="text-slate-400">คู่สมรส:</span>{' '}
                        <strong>{cleanDisplaySegment(personRecord.spouse_full_name) || '-'}</strong>
                      </p>
                    </div>
                  </div>

                  {/* Education Summary */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-2">
                    <h4 className="font-extrabold text-slate-700 dark:text-slate-200">
                      ประวัติการศึกษา ({timelines.educations.length})
                    </h4>
                    {timelines.educations.length === 0 ? (
                      <p className="text-slate-400">ยังไม่มีข้อมูลประวัติการศึกษา</p>
                    ) : (
                      <div className="space-y-1.5">
                        {timelines.educations.map((ed) => (
                          <div key={ed.id} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                            <p className="font-bold text-slate-800 dark:text-white">
                              {ed.degree_title} {ed.major_name ? `(${ed.major_name})` : ''}
                            </p>
                            <p className="text-slate-500">
                              {ed.institution_name}
                              {(ed.start_period || ed.end_period) &&
                                ` · ${[ed.start_period, ed.end_period].filter(Boolean).join(' – ')}`}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Position Summary */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-2">
                    <h4 className="font-extrabold text-slate-700 dark:text-slate-200">
                      ประวัติการดำรงตำแหน่งล่าสุด ({timelines.positionHistory.length})
                    </h4>
                    {timelines.positionHistory.length === 0 ? (
                      <p className="text-slate-400">ยังไม่มีประวัติการดำรงตำแหน่ง</p>
                    ) : (
                      <div className="space-y-1.5">
                        {timelines.positionHistory.slice(0, 5).map((ph) => (
                          <div key={ph.id} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 flex flex-wrap justify-between gap-2">
                            <span className="font-bold text-slate-800 dark:text-white">
                              {ph.position_title_snapshot || 'ตำแหน่ง'}
                              {ph.position_number ? ` (#${ph.position_number})` : ''}
                            </span>
                            <span className="text-slate-500">
                              {formatThaiDate(ph.effective_date, 'short')} –{' '}
                              {ph.end_date ? formatThaiDate(ph.end_date, 'short') : 'ปัจจุบัน'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tab 3: ลายเซ็นเอกสารราชการ */}
          {activeTab === 'signature' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                อัปโหลดไฟล์รูปลายเซ็นพื้นใสเพื่อนำไปใช้งานในแบบฟอร์ม ก.พ. ๗ และเว็บแอปย่อยในระบบ Portal SSO
              </p>
              <SignaturePadUploader
                value={user?.signature_path}
                filePrefix={`sig_${user?.personnel_id || 'me'}`}
                subFolderName={personnelSubFolder}
                onUploaded={handleSignatureUploaded}
                onRemove={user?.personnel_id ? handleSignatureRemove : undefined}
              />
            </div>
          )}

          {/* Tab 4: เปลี่ยนรหัสเข้าใช้ */}
          {activeTab === 'password' && (
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="bma-label">รหัสเข้าใช้ใหม่ *</label>
                  <input
                    type="password"
                    minLength={8}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="อย่างน้อย 8 ตัวอักษร"
                    className="bma-input"
                  />
                </div>
                <div>
                  <label className="bma-label">ยืนยันรหัสเข้าใช้ใหม่ *</label>
                  <input
                    type="password"
                    minLength={8}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="กรอกรหัสเข้าใช้ใหม่อีกครั้ง"
                    className="bma-input"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" disabled={savingPw} className="bma-btn-primary disabled:opacity-60">
                  <i className={`fa-solid ${savingPw ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
                  บันทึกรหัสเข้าใช้ใหม่
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Self-Edit PersonnelFormModal for ADMIN/SUPERADMIN (z-[9995] -> overlay z-[9998]) */}
      {isAdminOrAbove && personRecord && (
        <PersonnelFormModal
          open={editSelfOpen}
          onClose={() => setEditSelfOpen(false)}
          initial={personRecord}
          zIndexClass="z-[9995]"
          onSaved={() => {
            if (personnelId) {
              void qc.invalidateQueries({ queryKey: QUERY_KEYS.personnelById(personnelId) });
              void qc.invalidateQueries({ queryKey: QUERY_KEYS.personnelTimelines(personnelId) });
            }
            void qc.invalidateQueries({ queryKey: ['personnel'] });
          }}
        />
      )}
    </>
  );
}

export function MyProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      title="โปรไฟล์ของฉัน"
      subtitle="ข้อมูลส่วนตัว ประวัติรับราชการ (ก.พ. ๗) ลายเซ็นอิเล็กทรอนิกส์ และรหัสเข้าใช้"
      icon="fa-circle-user"
      maxWidthClass="max-w-4xl"
      zIndexClass="z-[9990]"
      footer={
        <div className="w-full flex justify-end">
          <button type="button" onClick={onClose} className="bma-btn-outline text-xs">
            ปิดหน้าต่าง
          </button>
        </div>
      }
    >
      <MyProfileContent onRequestClose={onClose} inModal />
    </ResponsiveModal>
  );
}

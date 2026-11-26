import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { DriveImage } from '@/components/common/DriveImage';
import { SignaturePadUploader } from '@/components/common/SignaturePadUploader';
import { ThaiDatePicker, focusInvalidThaiDateInput } from '@/components/common/ThaiDatePicker';
import {
  PersonnelHistoryOverlayModal,
  type HistoryOverlayDomain,
  type HistoryOverlayRequest,
} from '@/components/admin/PersonnelHistoryOverlayModal';
import { useSettings } from '@/contexts/SettingsContext';
import { useMasterData } from '@/hooks/useMasterData';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import {
  DriveNotConfiguredError,
  buildPersonnelSubFolderName,
  deleteFromGoogleDrive,
  readFileAsDataUrl,
  uploadToGoogleDrive,
} from '@/services/driveStorageService';
import { personnelService } from '@/services/personnelService';
import { userService } from '@/services/userService';
import { showDriveNotConfiguredAlert } from '@/lib/swalHelpers';
import { useAuthStore } from '@/stores/useAuthStore';
import { validateCid } from '@/lib/cidValidator';
import {
  compareLookupItems,
  compareOrgUnits,
  comparePositionLevels,
  comparePositions,
  comparePositionTypes,
  resolveOrgUnitAncestors,
} from '@/lib/masterDataSort';
import { formatDatabaseError } from '@/lib/pgErrorHelpers';
import { formatCivilServantPosition } from '@/lib/positionFormatter';
import {
  applyPositionHistorySaveWithTags,
  autoCloseOpenEndedPositionRows,
  buildFirstPositionHistoryPrefill,
  buildFirstSalaryHistoryPrefill,
  computeHistoryFieldLocks,
  findOpenEndedPositionIndices,
  formatExecutiveDutySummary,
  moveHistoryItem,
  normalizeHistoryOrder,
  normalizePositionHistoryTags,
  resolveDisciplinarySnapshot,
  resolveExecutiveDutiesSummaries,
  resolveInitialPositionSnapshot,
  resolveLatestPositionSnapshot,
  resolveLatestSalarySnapshot,
  sortPositionHistoryNewestFirst,
} from '@/lib/personnelHistorySync';
import {
  formatThaiDate,
  getCurrentYearBeBangkok,
  getRetirementDateInfo,
} from '@/lib/thaiDate';
import { useUiStore } from '@/stores/useUiStore';
import type { PersonnelDirectoryItem } from '@/types/domain.types';
import type {
  PersonnelDisciplinaryRecordRow,
  PersonnelEducationRow,
  PersonnelEvaluationRow,
  PersonnelExecutiveDutyRow,
  PersonnelLicenseRow,
  PersonnelNameHistoryRow,
  PersonnelPositionHistoryRow,
  PersonnelSalaryHistoryRow,
  PersonnelServiceInterruptionRow,
  PersonnelTrainingRow,
} from '@/types/database.types';

type KeyedRow<T> = Partial<T> & { _rowKey?: string };

let rowKeySeq = 0;
function nextRowKey(prefix: string): string {
  rowKeySeq += 1;
  return `${prefix}_${rowKeySeq}`;
}

function withRowKeys<T>(rows: Array<Partial<T>>, prefix: string): Array<KeyedRow<T>> {
  return rows.map((r) => ({ ...r, _rowKey: nextRowKey(prefix) }));
}

function LockBadge({ label = 'อัปเดตจากประวัติฯ' }: { label?: string }) {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-[10px] font-bold align-middle">
      <i className="fa-solid fa-lock text-[9px]" />
      {label}
    </span>
  );
}

function HistoryOrderTags({
  idx,
  total,
  latestLabel = 'ล่าสุด',
  initialLabel = 'เริ่มต้น',
  isLatestOverride,
  isInitialOverride,
}: {
  idx: number;
  total: number;
  latestLabel?: string;
  initialLabel?: string;
  isLatestOverride?: boolean;
  isInitialOverride?: boolean;
}) {
  const showLatest = isLatestOverride !== undefined ? isLatestOverride : idx === 0;
  const showInitial = isInitialOverride !== undefined ? isInitialOverride : idx === total - 1;
  if (!showLatest && !showInitial) return null;
  return (
    <>
      {showLatest && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
          {latestLabel}
        </span>
      )}
      {showInitial && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300">
          {initialLabel}
        </span>
      )}
    </>
  );
}

function HistoryRowControls({
  idx,
  total,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  idx: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        disabled={idx === 0}
        onClick={onMoveUp}
        className="px-1.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed"
        title="เลื่อนขึ้น (ใหม่กว่า)"
      >
        <i className="fa-solid fa-chevron-up text-[10px]" />
      </button>
      <button
        type="button"
        disabled={idx === total - 1}
        onClick={onMoveDown}
        className="px-1.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed"
        title="เลื่อนลง (เก่ากว่า)"
      >
        <i className="fa-solid fa-chevron-down text-[10px]" />
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        title="แก้ไขรายการ"
      >
        <i className="fa-solid fa-pen" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="px-2 py-1 rounded-lg border border-rose-200 dark:border-rose-900 text-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
        title="ลบรายการ"
      >
        <i className="fa-solid fa-trash" />
      </button>
    </div>
  );
}

function HistorySectionCard({
  title,
  icon,
  count,
  badgeText,
  open,
  onToggle,
  onAdd,
  addLabel = 'เพิ่มรายการ',
  loadError,
  onRetry,
  children,
}: {
  title: string;
  icon: string;
  count: number;
  badgeText?: string;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  addLabel?: string;
  loadError?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-emerald-700 dark:hover:text-emerald-300 transition flex-1 text-left min-w-0"
        >
          <i className={`fa-solid ${icon} text-emerald-600 dark:text-emerald-400 shrink-0`} />
          <span className="truncate">{title}</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 shrink-0">
            {count}
          </span>
          {badgeText && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 shrink-0">
              {badgeText}
            </span>
          )}
          {loadError && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 shrink-0">
              โหลดไม่สำเร็จ
            </span>
          )}
          <i
            className={`fa-solid fa-chevron-down text-[10px] text-slate-400 ml-auto transition-transform shrink-0 ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
        <button
          type="button"
          disabled={Boolean(loadError)}
          onClick={() => {
            if (!open) onToggle();
            onAdd();
          }}
          className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 text-[11px] font-bold transition shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
        >
          <i className="fa-solid fa-plus mr-1" />
          {addLabel}
        </button>
      </div>
      {open && (
        <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2 bg-white/70 dark:bg-slate-900/40">
          {loadError ? (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-2.5 text-xs text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
              <span>
                <i className="fa-solid fa-triangle-exclamation mr-1.5" />
                ไม่สามารถโหลดข้อมูลประวัติเดิมได้ — หากบันทึกตอนนี้ ระบบจะคงข้อมูลประวัติเดิมในฐานข้อมูลไว้โดยไม่ลบ
              </span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 font-bold text-[11px] hover:bg-amber-100 transition shrink-0"
                >
                  <i className="fa-solid fa-rotate-right mr-1" />
                  ลองโหลดใหม่
                </button>
              )}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

const DISABLED_INPUT_CLASS = 'bg-slate-100 dark:bg-slate-800/70 cursor-not-allowed opacity-80';

export type PersonnelFormTab = 'basic' | 'assignment' | 'career' | 'kp7';

export function PersonnelFormModal({
  open,
  onClose,
  initial,
  onSaved,
  initialTab = 'basic',
  zIndexClass = 'z-[9990]',
}: {
  open: boolean;
  onClose: () => void;
  initial: PersonnelDirectoryItem | null;
  onSaved: () => void;
  initialTab?: PersonnelFormTab;
  zIndexClass?: string;
}) {
  const { settings } = useSettings();
  const { data: master } = useMasterData();
  const { isSuperAdmin, isOfficeAdmin, isDepartmentAdmin, adminScope } = useScopedPermissions();
  const currentUser = useAuthStore((s) => s.user);
  const setCurrentUser = useAuthStore((s) => s.setUser);
  const showToast = useUiStore((s) => s.showToast);
  const navCtx = useContext(UNSAFE_NavigationContext);
  const navigate = (to: string) => navCtx?.navigator?.push(to);
  const fallbackBureauName = settings.bureau_name || '';

  const formRef = useRef<HTMLFormElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const initialPhotoUrlRef = useRef<string>('');
  const initialSigUrlRef = useRef<string>('');
  const pendingPhotoUrlsRef = useRef<string[]>([]);
  const pendingSigUrlsRef = useRef<string[]>([]);
  const [tab, setTab] = useState<PersonnelFormTab>(initialTab);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [autoProvisionNow, setAutoProvisionNow] = useState(true);

  const [p, setP] = useState({
    id: '' as string | undefined,
    cid: '',
    prefix_id: '',
    noble_or_rank_title: '',
    first_name: '',
    last_name: '',
    gender_id: '',
    birth_date: '',
    phone_number: '',
    email: '',
    photo_path: '',
    signature_path: '',
    father_full_name: '',
    mother_full_name: '',
    mother_maiden_name: '',
    spouse_full_name: '',
    spouse_maiden_name: '',
    status_id: '',
  });

  const [a, setA] = useState({
    employment_type_id: '',
    position_type_id: '',
    position_id: '',
    position_level_id: '',
    position_number: '',
    secondary_position: '',
    acting_position: '',
    bureau_id: '',
    office_id: '',
    department_id: '',
    division_id: '',
    approval_tier_id: '',
    current_position_date: '',
    current_level_date: '',
  });

  const [c, setC] = useState({
    start_service_date: '',
    start_service_year_be: '',
    re_appointment_date: '',
    transfer_in_date: '',
    prior_continuous_service_days: '0',
    double_service_days: '0',
    initial_position_type_id: '',
    initial_position_id: '',
    initial_position_level_id: '',
    initial_position: '',
    initial_salary: '',
    current_salary: '',
    position_allowance: '0',
    is_max_step: false,
    disciplinary_flag: false,
    disciplinary_note: '',
  });

  // 10 History / 1:N Lists (7 Career + 3 KP7 Education/License/Training)
  const [nameHistory, setNameHistory] = useState<Array<KeyedRow<PersonnelNameHistoryRow>>>([]);
  const [positionHistory, setPositionHistory] = useState<Array<KeyedRow<PersonnelPositionHistoryRow>>>([]);
  const [executiveDuties, setExecutiveDuties] = useState<Array<KeyedRow<PersonnelExecutiveDutyRow>>>([]);
  const [salaryHistory, setSalaryHistory] = useState<Array<KeyedRow<PersonnelSalaryHistoryRow>>>([]);
  const [evaluations, setEvaluations] = useState<Array<KeyedRow<PersonnelEvaluationRow>>>([]);
  const [disciplinaryRecords, setDisciplinaryRecords] = useState<Array<KeyedRow<PersonnelDisciplinaryRecordRow>>>([]);
  const [serviceInterruptions, setServiceInterruptions] = useState<Array<KeyedRow<PersonnelServiceInterruptionRow>>>([]);
  const [educations, setEducations] = useState<Array<KeyedRow<PersonnelEducationRow>>>([]);
  const [licenses, setLicenses] = useState<Array<KeyedRow<PersonnelLicenseRow>>>([]);
  const [trainings, setTrainings] = useState<Array<KeyedRow<PersonnelTrainingRow>>>([]);

  const [birthDateInvalid, setBirthDateInvalid] = useState(false);
  const [timelinesLoaded, setTimelinesLoaded] = useState(true);
  const [timelinesLoadError, setTimelinesLoadError] = useState('');
  const [overlayRequest, setOverlayRequest] = useState<HistoryOverlayRequest | null>(null);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    nameHistory: false,
    executiveDuties: true,
    positionHistory: true,
    salaryHistory: false,
    evaluations: false,
    disciplinary: false,
    interruptions: false,
    specialService: false,
    educations: true,
    licenses: true,
    trainings: true,
  });

  const hydratedSessionKeyRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const lockLv12 = isOfficeAdmin || isDepartmentAdmin;

  const locks = useMemo(
    () =>
      computeHistoryFieldLocks({
        positionHistoryCount: positionHistory.length,
        salaryHistoryCount: salaryHistory.length,
        disciplinaryRecordsCount: disciplinaryRecords.length,
      }),
    [positionHistory.length, salaryHistory.length, disciplinaryRecords.length]
  );

  const checkInvalidThaiDate = (actionLabel: string): boolean => {
    const invalidInput = focusInvalidThaiDateInput(formRef.current);
    if (!invalidInput) return false;
    showToast(
      `พบช่องวันที่ (พ.ศ.) ที่ไม่ถูกต้อง กรุณาแก้ไขให้ถูกต้องหรือล้างค่าก่อน${actionLabel}`,
      'error'
    );
    return true;
  };

  const applyPositionSync = (nextRows: Array<KeyedRow<PersonnelPositionHistoryRow>>) => {
    const snap = resolveLatestPositionSnapshot(nextRows);
    if (!snap) return;
    setA((prev) => ({
      ...prev,
      position_type_id: snap.position_type_id,
      position_id: snap.position_id,
      position_level_id: snap.position_level_id,
      position_number: snap.position_number,
      current_position_date: snap.current_position_date,
      current_level_date: snap.current_level_date,
    }));
  };

  const applyInitialPositionSync = (nextRows: Array<KeyedRow<PersonnelPositionHistoryRow>>) => {
    const snap = resolveInitialPositionSnapshot(nextRows, master, fallbackBureauName);
    if (!snap) return;
    setC((prev) => ({
      ...prev,
      initial_position_type_id: snap.initial_position_type_id,
      initial_position_id: snap.initial_position_id,
      initial_position_level_id: snap.initial_position_level_id,
      initial_position: snap.initial_position,
    }));
  };

  const applyExecutiveDutiesSync = (nextRows: Array<KeyedRow<PersonnelExecutiveDutyRow>>, hadRowsBefore: boolean) => {
    if (nextRows.length > 0) {
      const { deputizingSummary, actingSummary } = resolveExecutiveDutiesSummaries(
        nextRows,
        master,
        fallbackBureauName
      );
      setA((prev) => ({
        ...prev,
        secondary_position: deputizingSummary,
        acting_position: actingSummary,
      }));
    } else if (hadRowsBefore) {
      // Clear summary cleanly when deleting the last executive duty (1 -> 0)
      setA((prev) => ({
        ...prev,
        secondary_position: '',
        acting_position: '',
      }));
    }
  };

  const applySalarySync = (nextRows: Array<KeyedRow<PersonnelSalaryHistoryRow>>) => {
    const snap = resolveLatestSalarySnapshot(nextRows);
    if (!snap) return;
    setC((prev) => ({
      ...prev,
      current_salary: snap.current_salary,
      position_allowance: snap.position_allowance,
      is_max_step: snap.is_max_step,
    }));
  };

  const applyDisciplinarySync = (nextRows: Array<KeyedRow<PersonnelDisciplinaryRecordRow>>) => {
    if (nextRows.length === 0) return;
    const snap = resolveDisciplinarySnapshot(nextRows, master);
    setC((prev) => ({
      ...prev,
      disciplinary_flag: snap.disciplinary_flag,
      disciplinary_note: snap.disciplinary_note,
    }));
  };

  const loadTimelinesFor = (personnelId: string, seq: number) => {
    setTimelinesLoaded(false);
    setTimelinesLoadError('');
    personnelService
      .getPersonnelTimelines(personnelId)
      .then((bundle) => {
        if (loadSeqRef.current !== seq) return;
        const nextName = withRowKeys(normalizeHistoryOrder(bundle.nameHistory), 'nh');
        const nextPos = withRowKeys(
          normalizePositionHistoryTags(sortPositionHistoryNewestFirst(bundle.positionHistory)),
          'ph'
        );
        const nextExec = withRowKeys(normalizeHistoryOrder(bundle.executiveDuties), 'ed');
        const nextSal = withRowKeys(normalizeHistoryOrder(bundle.salaryHistory), 'sh');
        const nextEval = withRowKeys(normalizeHistoryOrder(bundle.evaluations), 'ev');
        const nextDisc = withRowKeys(normalizeHistoryOrder(bundle.disciplinaryRecords), 'dr');
        const nextInter = withRowKeys(normalizeHistoryOrder(bundle.serviceInterruptions), 'si');
        const nextEdu = withRowKeys(normalizeHistoryOrder(bundle.educations ?? []), 'edu');
        const nextLic = withRowKeys(normalizeHistoryOrder(bundle.licenses ?? []), 'lic');
        const nextTrain = withRowKeys(normalizeHistoryOrder(bundle.trainings ?? []), 'trn');

        setNameHistory(nextName);
        setPositionHistory(nextPos);
        setExecutiveDuties(nextExec);
        setSalaryHistory(nextSal);
        setEvaluations(nextEval);
        setDisciplinaryRecords(nextDisc);
        setServiceInterruptions(nextInter);
        setEducations(nextEdu);
        setLicenses(nextLic);
        setTrainings(nextTrain);

        if (nextPos.length > 0) {
          applyPositionSync(nextPos);
          applyInitialPositionSync(nextPos);
        }
        if (nextExec.length > 0) applyExecutiveDutiesSync(nextExec, false);
        if (nextSal.length > 0) applySalarySync(nextSal);
        if (nextDisc.length > 0) applyDisciplinarySync(nextDisc);

        setTimelinesLoaded(true);
        setOpenSections((prev) => ({
          ...prev,
          nameHistory: nextName.length > 0,
          executiveDuties: true,
          positionHistory: true,
          salaryHistory: nextSal.length > 0,
          evaluations: nextEval.length > 0,
          disciplinary: nextDisc.length > 0,
          interruptions: nextInter.length > 0,
        }));
      })
      .catch((err) => {
        if (loadSeqRef.current !== seq) return;
        setTimelinesLoaded(false);
        setTimelinesLoadError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลประวัติย้อนหลังได้');
      });
  };

  useEffect(() => {
    if (!open) {
      loadSeqRef.current += 1;
      hydratedSessionKeyRef.current = null;
      setOverlayRequest(null);
      return;
    }

    const sessionKey = initial ? `edit:${initial.id}` : 'create';
    if (hydratedSessionKeyRef.current === sessionKey) return;
    hydratedSessionKeyRef.current = sessionKey;
    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;

    setTab(initialTab);
    setAutoProvisionNow(true);
    setBirthDateInvalid(false);
    setOverlayRequest(null);
    const hasInitialSpecialService = Boolean(
      initial &&
        (initial.re_appointment_date ||
          initial.transfer_in_date ||
          Number(initial.prior_continuous_service_days ?? 0) > 0 ||
          Number(initial.double_service_days ?? 0) > 0)
    );
    setOpenSections({
      nameHistory: false,
      executiveDuties: true,
      positionHistory: true,
      salaryHistory: false,
      evaluations: false,
      disciplinary: false,
      interruptions: false,
      specialService: hasInitialSpecialService,
      educations: true,
      licenses: true,
      trainings: true,
    });

    const defaultStatus =
      (master.itemsByCategoryCode['PERSONNEL_STATUS'] ?? []).find((i) => i.is_default)?.id || '';
    const activeBureaus = master.orgUnits.filter((u) => u.is_active && u.level_no === 1).sort(compareOrgUnits);
    const singleBureauId = activeBureaus.length === 1 ? activeBureaus[0].id : '';

    if (initial) {
      initialPhotoUrlRef.current = (initial.photo_path || '').trim();
      initialSigUrlRef.current = (initial.signature_path || '').trim();
      pendingPhotoUrlsRef.current = [];
      pendingSigUrlsRef.current = [];
      setP({
        id: initial.id,
        cid: initial.cid || '',
        prefix_id: initial.prefix_id || '',
        noble_or_rank_title: initial.noble_or_rank_title || '',
        first_name: initial.first_name || '',
        last_name: initial.last_name || '',
        gender_id: initial.gender_id || '',
        birth_date: initial.birth_date || '',
        phone_number: initial.phone_number || '',
        email: initial.email || '',
        photo_path: initial.photo_path || '',
        signature_path: initial.signature_path || '',
        father_full_name: initial.father_full_name || '',
        mother_full_name: initial.mother_full_name || '',
        mother_maiden_name: initial.mother_maiden_name || '',
        spouse_full_name: initial.spouse_full_name || '',
        spouse_maiden_name: initial.spouse_maiden_name || '',
        status_id: initial.status_id || defaultStatus,
      });
      setA({
        employment_type_id: initial.employment_type_id || '',
        position_type_id: initial.position_type_id || '',
        position_id: initial.position_id || '',
        position_level_id: initial.position_level_id || '',
        position_number: initial.position_number || '',
        secondary_position: initial.secondary_position || '',
        acting_position: initial.acting_position || '',
        bureau_id: initial.bureau_id || singleBureauId,
        office_id: initial.office_id || '',
        department_id: initial.department_id || '',
        division_id: initial.division_id || '',
        approval_tier_id: initial.approval_tier_id || '',
        current_position_date: initial.current_position_date || '',
        current_level_date: initial.current_level_date || '',
      });
      const derivedInitYear = initial.start_service_date
        ? String(Number(initial.start_service_date.slice(0, 4)) + 543)
        : initial.start_service_year_be
          ? String(initial.start_service_year_be)
          : '';
      setC({
        start_service_date: initial.start_service_date || '',
        start_service_year_be: derivedInitYear,
        re_appointment_date: initial.re_appointment_date || '',
        transfer_in_date: initial.transfer_in_date || '',
        prior_continuous_service_days: String(initial.prior_continuous_service_days ?? 0),
        double_service_days: String(initial.double_service_days ?? 0),
        initial_position_type_id: initial.initial_position_type_id || '',
        initial_position_id: initial.initial_position_id || '',
        initial_position_level_id: initial.initial_position_level_id || '',
        initial_position: initial.initial_position || '',
        initial_salary: initial.initial_salary != null ? String(initial.initial_salary) : '',
        current_salary: initial.current_salary != null ? String(initial.current_salary) : '',
        position_allowance: String(initial.position_allowance ?? 0),
        is_max_step: Boolean(initial.is_max_step),
        disciplinary_flag: initial.disciplinary_flag,
        disciplinary_note: initial.disciplinary_note || '',
      });

      loadTimelinesFor(initial.id, seq);
    } else {
      const scopedOffice =
        isOfficeAdmin && adminScope
          ? adminScope.org_unit_id
          : isDepartmentAdmin && adminScope
            ? adminScope.parent_office_id || ''
            : '';
      const scopedDept = isDepartmentAdmin && adminScope ? adminScope.org_unit_id : '';
      const scopedBureau =
        (scopedOffice && master.orgUnits.find((u) => u.id === scopedOffice)?.parent_id) ||
        singleBureauId;

      initialPhotoUrlRef.current = '';
      initialSigUrlRef.current = '';
      pendingPhotoUrlsRef.current = [];
      pendingSigUrlsRef.current = [];
      setP({
        id: undefined,
        cid: '',
        prefix_id: '',
        noble_or_rank_title: '',
        first_name: '',
        last_name: '',
        gender_id: '',
        birth_date: '',
        phone_number: '',
        email: '',
        photo_path: '',
        signature_path: '',
        father_full_name: '',
        mother_full_name: '',
        mother_maiden_name: '',
        spouse_full_name: '',
        spouse_maiden_name: '',
        status_id: defaultStatus,
      });
      setA({
        employment_type_id: '',
        position_type_id: '',
        position_id: '',
        position_level_id: '',
        position_number: '',
        secondary_position: '',
        acting_position: '',
        bureau_id: scopedBureau,
        office_id: scopedOffice,
        department_id: scopedDept,
        division_id: '',
        approval_tier_id: '',
        current_position_date: '',
        current_level_date: '',
      });
      setC({
        start_service_date: '',
        start_service_year_be: '',
        re_appointment_date: '',
        transfer_in_date: '',
        prior_continuous_service_days: '0',
        double_service_days: '0',
        initial_position_type_id: '',
        initial_position_id: '',
        initial_position_level_id: '',
        initial_position: '',
        initial_salary: '',
        current_salary: '',
        position_allowance: '0',
        is_max_step: false,
        disciplinary_flag: false,
        disciplinary_note: '',
      });
      setNameHistory([]);
      setPositionHistory([]);
      setExecutiveDuties([]);
      setSalaryHistory([]);
      setEvaluations([]);
      setDisciplinaryRecords([]);
      setServiceInterruptions([]);
      setEducations([]);
      setLicenses([]);
      setTrainings([]);
      setTimelinesLoaded(true);
      setTimelinesLoadError('');
    }
  }, [open, initial, initialTab, master, isOfficeAdmin, isDepartmentAdmin, adminScope]);

  const sortedPositionTypes = useMemo(
    () => master.positionTypes.filter((t) => t.is_active).sort(comparePositionTypes),
    [master.positionTypes]
  );

  const positionsForType = useMemo(
    () =>
      master.positions
        .filter((pos) => pos.is_active && (!a.position_type_id || pos.position_type_id === a.position_type_id))
        .sort(comparePositions),
    [master.positions, a.position_type_id]
  );

  const selectedPosition = useMemo(
    () => master.positions.find((pos) => pos.id === a.position_id) ?? null,
    [master.positions, a.position_id]
  );

  const allowedLevelsForPos = useMemo(() => {
    const activeLevels = master.positionLevels.filter((l) => l.is_active).sort(comparePositionLevels);
    if (!a.position_id) return activeLevels;
    const ids = new Set(
      master.positionAllowedLevels
        .filter((x) => x.position_id === a.position_id)
        .map((x) => x.position_level_id)
    );
    return ids.size > 0 ? activeLevels.filter((l) => ids.has(l.id)) : activeLevels;
  }, [master.positionAllowedLevels, master.positionLevels, a.position_id]);

  // Initial Position 3-tier cascading memos (Tab 3 Zone A)
  const initPositionsForType = useMemo(
    () =>
      master.positions
        .filter(
          (pos) =>
            pos.is_active && (!c.initial_position_type_id || pos.position_type_id === c.initial_position_type_id)
        )
        .sort(comparePositions),
    [master.positions, c.initial_position_type_id]
  );

  const selectedInitPosition = useMemo(
    () => master.positions.find((pos) => pos.id === c.initial_position_id) ?? null,
    [master.positions, c.initial_position_id]
  );

  const allowedLevelsForInitPos = useMemo(() => {
    const activeLevels = master.positionLevels.filter((l) => l.is_active).sort(comparePositionLevels);
    if (!c.initial_position_id) return activeLevels;
    const ids = new Set(
      master.positionAllowedLevels
        .filter((x) => x.position_id === c.initial_position_id)
        .map((x) => x.position_level_id)
    );
    return ids.size > 0 ? activeLevels.filter((l) => ids.has(l.id)) : activeLevels;
  }, [master.positionAllowedLevels, master.positionLevels, c.initial_position_id]);

  const liveInitialPositionDisplay = useMemo(() => {
    if (!selectedInitPosition) return c.initial_position || '';
    const pt = master.positionTypes.find(
      (t) => t.id === (c.initial_position_type_id || selectedInitPosition.position_type_id)
    );
    const lvl = master.positionLevels.find((l) => l.id === c.initial_position_level_id);
    const formatted = formatCivilServantPosition(selectedInitPosition.name_th, lvl?.name_th, pt?.name_th, {
      positionTypeCode: pt?.code,
      fallbackBureauName,
    });
    return formatted === '-' ? '' : formatted;
  }, [
    selectedInitPosition,
    c.initial_position_type_id,
    c.initial_position_level_id,
    c.initial_position,
    master.positionTypes,
    master.positionLevels,
    fallbackBureauName,
  ]);

  const bureausList = useMemo(
    () => master.orgUnits.filter((u) => u.is_active && u.level_no === 1).sort(compareOrgUnits),
    [master.orgUnits]
  );
  const offices = useMemo(
    () =>
      master.orgUnits
        .filter((u) => u.is_active && u.level_no === 2 && (!a.bureau_id || u.parent_id === a.bureau_id))
        .sort(compareOrgUnits),
    [master.orgUnits, a.bureau_id]
  );
  const depts = useMemo(
    () =>
      master.orgUnits
        .filter((u) => u.is_active && u.level_no === 3 && (!a.office_id || u.parent_id === a.office_id))
        .sort(compareOrgUnits),
    [master.orgUnits, a.office_id]
  );
  const divs = useMemo(
    () =>
      master.orgUnits
        .filter((u) => u.is_active && u.level_no === 4 && (!a.department_id || u.parent_id === a.department_id))
        .sort(compareOrgUnits),
    [master.orgUnits, a.department_id]
  );

  const prefixItems = useMemo(
    () => (master.itemsByCategoryCode['PREFIX'] ?? []).filter((i) => i.is_active).sort(compareLookupItems),
    [master.itemsByCategoryCode]
  );
  const genderItems = useMemo(
    () => (master.itemsByCategoryCode['GENDER'] ?? []).filter((i) => i.is_active).sort(compareLookupItems),
    [master.itemsByCategoryCode]
  );
  const statusItems = useMemo(
    () => (master.itemsByCategoryCode['PERSONNEL_STATUS'] ?? []).filter((i) => i.is_active).sort(compareLookupItems),
    [master.itemsByCategoryCode]
  );
  const employmentTypeItems = useMemo(
    () => (master.itemsByCategoryCode['EMPLOYMENT_TYPE'] ?? []).filter((i) => i.is_active).sort(compareLookupItems),
    [master.itemsByCategoryCode]
  );
  const approvalTierItems = useMemo(
    () => (master.itemsByCategoryCode['APPROVAL_TIER'] ?? []).filter((i) => i.is_active).sort(compareLookupItems),
    [master.itemsByCategoryCode]
  );

  const livePositionDisplay = useMemo(() => {
    if (!selectedPosition) return '';
    const pt = master.positionTypes.find((t) => t.id === (a.position_type_id || selectedPosition.position_type_id));
    const lvl = master.positionLevels.find((l) => l.id === a.position_level_id);
    const bureau = master.orgUnits.find((u) => u.id === a.bureau_id);
    const office = master.orgUnits.find((u) => u.id === a.office_id);
    const dept = master.orgUnits.find((u) => u.id === a.department_id);
    const div = master.orgUnits.find((u) => u.id === a.division_id);
    return formatCivilServantPosition(selectedPosition.name_th, lvl?.name_th, pt?.name_th, {
      positionTypeCode: pt?.code,
      bureauName: bureau?.name_th,
      officeName: office?.name_th,
      departmentName: dept?.name_th,
      divisionName: div?.name_th,
      fallbackBureauName,
    });
  }, [
    selectedPosition,
    a.position_type_id,
    a.position_level_id,
    a.bureau_id,
    a.office_id,
    a.department_id,
    a.division_id,
    master.positionTypes,
    master.positionLevels,
    master.orgUnits,
    fallbackBureauName,
  ]);

  const serviceTenureLabel = useMemo(() => {
    if (!c.start_service_date || !/^\d{4}-\d{2}-\d{2}$/.test(c.start_service_date)) return '';
    const [sy, sm, sd] = c.start_service_date.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const now = new Date();
    if (Number.isNaN(start.getTime()) || start > now) return '';
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (now.getDate() < start.getDate()) months -= 1;
    if (months < 0) return '';
    const years = Math.floor(months / 12);
    const remMonths = months % 12;
    return `${years} ปี ${remMonths} เดือน`;
  }, [c.start_service_date]);

  const specialServiceFilledCount = useMemo(() => {
    let n = 0;
    if (c.re_appointment_date) n += 1;
    if (c.transfer_in_date) n += 1;
    if (Number(c.prior_continuous_service_days || 0) > 0) n += 1;
    if (Number(c.double_service_days || 0) > 0) n += 1;
    return n;
  }, [c.re_appointment_date, c.transfer_in_date, c.prior_continuous_service_days, c.double_service_days]);

  const retirementInfo = useMemo(() => getRetirementDateInfo(p.birth_date), [p.birth_date]);
  const currentYearBe = getCurrentYearBeBangkok();
  const totalDeductibleDays = useMemo(
    () => serviceInterruptions.reduce((sum, si) => sum + Math.max(0, Number(si.deductible_days ?? 0)), 0),
    [serviceInterruptions]
  );

  const positionSnapshot = useMemo(() => resolveLatestPositionSnapshot(positionHistory), [positionHistory]);

  const openOverlayForAdd = (domain: HistoryOverlayDomain) => {
    let initialData: Record<string, unknown> = {};
    if (domain === 'position' && positionHistory.length === 0) {
      initialData = buildFirstPositionHistoryPrefill(a, c) as Record<string, unknown>;
    } else if (domain === 'salary' && salaryHistory.length === 0) {
      initialData = buildFirstSalaryHistoryPrefill(c) as Record<string, unknown>;
    } else if (domain === 'evaluation') {
      initialData = { fiscal_year_be: currentYearBe, eval_round: 1 };
    } else if (domain === 'executiveDuty') {
      initialData = { duty_type: 'DEPUTIZING', bureau_id: a.bureau_id || '', office_id: a.office_id || '' };
    }
    setOverlayRequest({ domain, editIndex: null, initialData });
  };

  const openOverlayForEdit = (domain: HistoryOverlayDomain, editIndex: number, row: Record<string, unknown>) => {
    setOverlayRequest({ domain, editIndex, initialData: row });
  };

  const handleOverlaySave = (
    domain: HistoryOverlayDomain,
    editIndex: number | null,
    record: Record<string, unknown>,
    options?: { autoCloseOtherOpenPositions?: boolean; makeLatest?: boolean; makeInitial?: boolean }
  ) => {
    if (domain === 'name') {
      const next = [...nameHistory];
      if (editIndex === null) {
        next.unshift({ ...(record as Partial<PersonnelNameHistoryRow>), _rowKey: nextRowKey('nh') });
      } else {
        next[editIndex] = { ...next[editIndex], ...(record as Partial<PersonnelNameHistoryRow>) };
      }
      setNameHistory(normalizeHistoryOrder(next));
    } else if (domain === 'position') {
      let working = [...positionHistory];
      if (options?.autoCloseOtherOpenPositions && record.effective_date) {
        working = autoCloseOpenEndedPositionRows(
          working as Array<KeyedRow<PersonnelPositionHistoryRow> & Pick<PersonnelPositionHistoryRow, 'effective_date' | 'end_date'>>,
          String(record.effective_date),
          editIndex ?? undefined
        );
      }
      const nextRecord: KeyedRow<PersonnelPositionHistoryRow> =
        editIndex === null
          ? { ...(record as Partial<PersonnelPositionHistoryRow>), _rowKey: nextRowKey('ph') }
          : { ...working[editIndex], ...(record as Partial<PersonnelPositionHistoryRow>) };
      const ordered = applyPositionHistorySaveWithTags(working, editIndex, nextRecord, {
        makeLatest: options?.makeLatest,
        makeInitial: options?.makeInitial,
      });
      setPositionHistory(ordered);
      applyPositionSync(ordered);
      applyInitialPositionSync(ordered);
    } else if (domain === 'executiveDuty') {
      const next = [...executiveDuties];
      if (editIndex === null) {
        next.unshift({ ...(record as Partial<PersonnelExecutiveDutyRow>), _rowKey: nextRowKey('ed') });
      } else {
        next[editIndex] = { ...next[editIndex], ...(record as Partial<PersonnelExecutiveDutyRow>) };
      }
      const ordered = normalizeHistoryOrder(next);
      setExecutiveDuties(ordered);
      applyExecutiveDutiesSync(ordered, executiveDuties.length > 0);
    } else if (domain === 'salary') {
      const next = [...salaryHistory];
      if (editIndex === null) {
        next.unshift({ ...(record as Partial<PersonnelSalaryHistoryRow>), _rowKey: nextRowKey('sh') });
      } else {
        next[editIndex] = { ...next[editIndex], ...(record as Partial<PersonnelSalaryHistoryRow>) };
      }
      const ordered = normalizeHistoryOrder(next);
      setSalaryHistory(ordered);
      applySalarySync(ordered);
    } else if (domain === 'evaluation') {
      const next = [...evaluations];
      if (editIndex === null) {
        next.unshift({ ...(record as Partial<PersonnelEvaluationRow>), _rowKey: nextRowKey('ev') });
      } else {
        next[editIndex] = { ...next[editIndex], ...(record as Partial<PersonnelEvaluationRow>) };
      }
      setEvaluations(normalizeHistoryOrder(next));
    } else if (domain === 'disciplinary') {
      const next = [...disciplinaryRecords];
      if (editIndex === null) {
        next.unshift({ ...(record as Partial<PersonnelDisciplinaryRecordRow>), _rowKey: nextRowKey('dr') });
      } else {
        next[editIndex] = { ...next[editIndex], ...(record as Partial<PersonnelDisciplinaryRecordRow>) };
      }
      const ordered = normalizeHistoryOrder(next);
      setDisciplinaryRecords(ordered);
      applyDisciplinarySync(ordered);
    } else if (domain === 'interruption') {
      const next = [...serviceInterruptions];
      if (editIndex === null) {
        next.unshift({ ...(record as Partial<PersonnelServiceInterruptionRow>), _rowKey: nextRowKey('si') });
      } else {
        next[editIndex] = { ...next[editIndex], ...(record as Partial<PersonnelServiceInterruptionRow>) };
      }
      setServiceInterruptions(normalizeHistoryOrder(next));
    } else if (domain === 'education') {
      const next = [...educations];
      if (editIndex === null) {
        next.unshift({ ...(record as Partial<PersonnelEducationRow>), _rowKey: nextRowKey('edu') });
      } else {
        next[editIndex] = { ...next[editIndex], ...(record as Partial<PersonnelEducationRow>) };
      }
      setEducations(normalizeHistoryOrder(next));
    } else if (domain === 'license') {
      const next = [...licenses];
      if (editIndex === null) {
        next.unshift({ ...(record as Partial<PersonnelLicenseRow>), _rowKey: nextRowKey('lic') });
      } else {
        next[editIndex] = { ...next[editIndex], ...(record as Partial<PersonnelLicenseRow>) };
      }
      setLicenses(normalizeHistoryOrder(next));
    } else if (domain === 'training') {
      const next = [...trainings];
      if (editIndex === null) {
        next.unshift({ ...(record as Partial<PersonnelTrainingRow>), _rowKey: nextRowKey('trn') });
      } else {
        next[editIndex] = { ...next[editIndex], ...(record as Partial<PersonnelTrainingRow>) };
      }
      setTrainings(normalizeHistoryOrder(next));
    }

    setOverlayRequest(null);
  };

  const moveHistoryRow = (domain: HistoryOverlayDomain, idx: number, dir: -1 | 1) => {
    if (domain === 'name') {
      setNameHistory((prev) => moveHistoryItem(prev, idx, dir));
    } else if (domain === 'position') {
      const next = normalizePositionHistoryTags(moveHistoryItem(positionHistory, idx, dir));
      setPositionHistory(next);
      applyPositionSync(next);
      applyInitialPositionSync(next);
    } else if (domain === 'executiveDuty') {
      const next = moveHistoryItem(executiveDuties, idx, dir);
      setExecutiveDuties(next);
      applyExecutiveDutiesSync(next, true);
    } else if (domain === 'salary') {
      const next = moveHistoryItem(salaryHistory, idx, dir);
      setSalaryHistory(next);
      applySalarySync(next);
    } else if (domain === 'evaluation') {
      setEvaluations((prev) => moveHistoryItem(prev, idx, dir));
    } else if (domain === 'disciplinary') {
      const next = moveHistoryItem(disciplinaryRecords, idx, dir);
      setDisciplinaryRecords(next);
      applyDisciplinarySync(next);
    } else if (domain === 'interruption') {
      setServiceInterruptions((prev) => moveHistoryItem(prev, idx, dir));
    } else if (domain === 'education') {
      setEducations((prev) => moveHistoryItem(prev, idx, dir));
    } else if (domain === 'license') {
      setLicenses((prev) => moveHistoryItem(prev, idx, dir));
    } else if (domain === 'training') {
      setTrainings((prev) => moveHistoryItem(prev, idx, dir));
    }
  };

  const handleDeleteRow = (domain: HistoryOverlayDomain, idx: number) => {
    if (domain === 'name') {
      setNameHistory(normalizeHistoryOrder(nameHistory.filter((_, i) => i !== idx)));
    } else if (domain === 'position') {
      const next = normalizePositionHistoryTags(positionHistory.filter((_, i) => i !== idx));
      setPositionHistory(next);
      if (next.length > 0) {
        applyPositionSync(next);
        applyInitialPositionSync(next);
      }
    } else if (domain === 'executiveDuty') {
      const hadRows = executiveDuties.length > 0;
      const next = normalizeHistoryOrder(executiveDuties.filter((_, i) => i !== idx));
      setExecutiveDuties(next);
      applyExecutiveDutiesSync(next, hadRows);
    } else if (domain === 'salary') {
      const next = normalizeHistoryOrder(salaryHistory.filter((_, i) => i !== idx));
      setSalaryHistory(next);
      if (next.length > 0) applySalarySync(next);
    } else if (domain === 'evaluation') {
      setEvaluations(normalizeHistoryOrder(evaluations.filter((_, i) => i !== idx)));
    } else if (domain === 'disciplinary') {
      const next = normalizeHistoryOrder(disciplinaryRecords.filter((_, i) => i !== idx));
      setDisciplinaryRecords(next);
      if (next.length > 0) {
        applyDisciplinarySync(next);
      } else {
        setC((prev) => ({ ...prev, disciplinary_flag: false, disciplinary_note: '' }));
      }
    } else if (domain === 'interruption') {
      setServiceInterruptions(normalizeHistoryOrder(serviceInterruptions.filter((_, i) => i !== idx)));
    } else if (domain === 'education') {
      setEducations(normalizeHistoryOrder(educations.filter((_, i) => i !== idx)));
    } else if (domain === 'license') {
      setLicenses(normalizeHistoryOrder(licenses.filter((_, i) => i !== idx)));
    } else if (domain === 'training') {
      setTrainings(normalizeHistoryOrder(trainings.filter((_, i) => i !== idx)));
    }
  };

  const personnelSubFolder = useMemo(() => {
    const prefixObj = prefixItems.find((i) => i.id === p.prefix_id);
    return buildPersonnelSubFolderName({
      prefixName: prefixObj?.name_th,
      firstName: p.first_name,
      lastName: p.last_name,
      fullName: initial?.full_name,
      cid: p.cid || initial?.cid,
    });
  }, [prefixItems, p.prefix_id, p.first_name, p.last_name, p.cid, initial?.full_name, initial?.cid]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type || '')) {
      showToast('รองรับเฉพาะไฟล์รูปภาพ PNG, JPG หรือ WebP เท่านั้น', 'error');
      return;
    }
    setUploadingPhoto(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const ext = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg';
      const res = await uploadToGoogleDrive({
        base64DataUrl: dataUrl,
        mimeType: file.type || 'image/jpeg',
        fileName: `profile_${p.id || 'new'}_${Date.now()}.${ext}`,
        category: 'image',
        subFolderName: personnelSubFolder,
        settings,
      });
      pendingPhotoUrlsRef.current.push(res.url);
      setP((prev) => ({ ...prev, photo_path: res.url }));
      if (res.sharingWarning) {
        showToast(res.sharingWarning, 'warning');
      } else {
        showToast('อัปโหลดรูปโปรไฟล์ขึ้น Google Drive สำเร็จ (กดบันทึกข้อมูลบุคลากรเพื่อยืนยัน)', 'success');
      }
    } catch (err) {
      if (err instanceof DriveNotConfiguredError) {
        await showDriveNotConfiguredAlert(err.missingLabel, isSuperAdmin, () => {
          handleCancelClose();
          navigate('/settings/system?tab=gdrive');
        });
      } else {
        showToast(err instanceof Error ? err.message : 'อัปโหลดรูปโปรไฟล์ไม่สำเร็จ', 'error');
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleCancelClose = () => {
    // Deferred Delete on Cancel: trash ONLY newly uploaded files from this unsaved session; preserve initial Drive files!
    for (const u of pendingPhotoUrlsRef.current) {
      if (u && u !== initialPhotoUrlRef.current) {
        void deleteFromGoogleDrive({ fileUrlOrId: u, category: 'image', settings });
      }
    }
    for (const u of pendingSigUrlsRef.current) {
      if (u && u !== initialSigUrlRef.current) {
        void deleteFromGoogleDrive({ fileUrlOrId: u, category: 'signature', settings });
      }
    }
    pendingPhotoUrlsRef.current = [];
    pendingSigUrlsRef.current = [];
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (checkInvalidThaiDate('บันทึกข้อมูล')) return;

    const cidRes = validateCid(p.cid);
    if (!cidRes.valid) {
      showToast(cidRes.message || 'เลขประจำตัวประชาชนไม่ถูกต้อง', 'error');
      setTab('basic');
      return;
    }
    if (!p.first_name.trim() || !p.last_name.trim()) {
      showToast('กรุณาระบุชื่อจริงและนามสกุลให้ครบถ้วน', 'error');
      setTab('basic');
      return;
    }
    if (p.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) {
      showToast('รูปแบบอีเมลไม่ถูกต้อง', 'error');
      setTab('basic');
      return;
    }

    if (selectedPosition && selectedPosition.requires_level && !a.position_level_id) {
      showToast(`ตำแหน่ง "${selectedPosition.name_th}" จำเป็นต้องเลือกระดับตำแหน่ง`, 'warning');
      setTab(locks.positionFieldsDisabled ? 'career' : 'assignment');
      return;
    }

    const openPosIndices = findOpenEndedPositionIndices(
      positionHistory as Array<Pick<PersonnelPositionHistoryRow, 'end_date'>>
    );
    if (openPosIndices.length > 1) {
      showToast('ประวัติการดำรงตำแหน่งสามารถเว้นว่างวันสิ้นสุดได้เพียง 1 รายการเท่านั้น', 'error');
      setTab('career');
      setOpenSections((prev) => ({ ...prev, positionHistory: true }));
      return;
    }

    const resolvedStartYearBe = c.start_service_date
      ? Number(c.start_service_date.slice(0, 4)) + 543
      : c.start_service_year_be
        ? Number(c.start_service_year_be)
        : null;

    if (resolvedStartYearBe !== null) {
      if (!Number.isInteger(resolvedStartYearBe) || resolvedStartYearBe < 2450 || resolvedStartYearBe > 2700) {
        showToast('ปี พ.ศ. เริ่มรับราชการต้องอยู่ระหว่าง 2450–2700', 'error');
        setTab('career');
        return;
      }
    }

    for (const [label, val] of [
      ['เงินเดือนแรกบรรจุ', c.initial_salary],
      ['เงินเดือนปัจจุบัน', c.current_salary],
      ['เงินประจำตำแหน่ง', c.position_allowance],
    ] as const) {
      if (val !== '' && (Number.isNaN(Number(val)) || Number(val) < 0)) {
        showToast(`${label}ต้องเป็นตัวเลขที่ไม่ติดลบ`, 'error');
        setTab('career');
        return;
      }
    }

    for (const [label, val] of [
      ['วันอายุราชการเดิม (รับโอน)', c.prior_continuous_service_days],
      ['วันราชการทวีคูณ', c.double_service_days],
    ] as const) {
      if (val !== '' && (!Number.isInteger(Number(val)) || Number(val) < 0)) {
        showToast(`${label}ต้องเป็นจำนวนเต็มที่ไม่ติดลบ`, 'error');
        setTab('career');
        return;
      }
    }

    setSaving(true);
    try {
      const resolvedInitialPosText = liveInitialPositionDisplay || c.initial_position.trim() || null;
      const savedId = await personnelService.saveBundle({
        personnel: {
          id: p.id,
          cid: cidRes.normalized,
          prefix_id: p.prefix_id || null,
          noble_or_rank_title: p.noble_or_rank_title.trim() || null,
          first_name: p.first_name.trim(),
          last_name: p.last_name.trim(),
          gender_id: p.gender_id || null,
          birth_date: p.birth_date || null,
          phone_number: p.phone_number.trim() || null,
          email: p.email.trim() || null,
          photo_path: p.photo_path.trim() || null,
          signature_path: p.signature_path.trim() || null,
          father_full_name: p.father_full_name.trim() || null,
          mother_full_name: p.mother_full_name.trim() || null,
          mother_maiden_name: p.mother_maiden_name.trim() || null,
          spouse_full_name: p.spouse_full_name.trim() || null,
          spouse_maiden_name: p.spouse_maiden_name.trim() || null,
          status_id: p.status_id || null,
        },
        assignment: {
          employment_type_id: a.employment_type_id || null,
          position_type_id: a.position_type_id || null,
          position_id: a.position_id || null,
          position_level_id: selectedPosition && !selectedPosition.requires_level ? null : a.position_level_id || null,
          position_number: a.position_number.trim() || null,
          secondary_position: a.secondary_position.trim() || null,
          acting_position: a.acting_position.trim() || null,
          bureau_id: a.bureau_id || null,
          office_id: a.office_id || null,
          department_id: a.department_id || null,
          division_id: a.division_id || null,
          approval_tier_id: a.approval_tier_id || null,
          current_position_date: a.current_position_date || null,
          current_level_date: a.current_level_date || null,
        },
        career: {
          start_service_date: c.start_service_date || null,
          start_service_year_be: resolvedStartYearBe,
          re_appointment_date: c.re_appointment_date || null,
          transfer_in_date: c.transfer_in_date || null,
          prior_continuous_service_days: Number(c.prior_continuous_service_days || 0),
          double_service_days: Number(c.double_service_days || 0),
          initial_position_type_id: c.initial_position_type_id || null,
          initial_position_id: c.initial_position_id || null,
          initial_position_level_id:
            selectedInitPosition && !selectedInitPosition.requires_level ? null : c.initial_position_level_id || null,
          initial_position: resolvedInitialPosText,
          initial_salary: c.initial_salary ? Number(c.initial_salary) : null,
          current_salary: c.current_salary ? Number(c.current_salary) : null,
          position_allowance: Number(c.position_allowance || 0),
          is_max_step: c.is_max_step,
          disciplinary_flag: c.disciplinary_flag,
          disciplinary_note: c.disciplinary_note.trim() || null,
        },
        ...(timelinesLoaded
          ? {
              name_history: nameHistory.map((nh, idx) => ({
                old_prefix_id: nh.old_prefix_id || null,
                old_prefix: nh.old_prefix?.trim() || null,
                old_first_name: nh.old_first_name?.trim() || '',
                old_last_name: nh.old_last_name?.trim() || '',
                changed_date: nh.changed_date || '',
                document_ref: nh.document_ref?.trim() || null,
                sort_order: idx + 1,
              })),
              position_history: positionHistory.map((ph, idx) => ({
                position_number: ph.position_number?.trim() || null,
                position_type_id: ph.position_type_id || null,
                position_id: ph.position_id || null,
                position_level_id: ph.position_level_id || null,
                position_title_snapshot: ph.position_title_snapshot?.trim() || null,
                org_unit_id: ph.org_unit_id || null,
                effective_date: ph.effective_date || '',
                end_date: ph.end_date || null,
                base_salary:
                  ph.base_salary !== null && ph.base_salary !== undefined && String(ph.base_salary) !== ''
                    ? Number(ph.base_salary)
                    : null,
                position_allowance: Number(ph.position_allowance ?? 0),
                order_reference: ph.order_reference?.trim() || null,
                sort_order: idx + 1,
                is_latest: idx === 0,
                is_initial: idx === positionHistory.length - 1,
              })),
              executive_duties: executiveDuties.map((ed, idx) => ({
                duty_type: ed.duty_type || 'DEPUTIZING',
                position_type_id: ed.position_type_id || null,
                position_id: ed.position_id || '',
                position_level_id: ed.position_level_id || null,
                bureau_id: ed.bureau_id || null,
                office_id: ed.office_id || null,
                department_id: ed.department_id || null,
                division_id: ed.division_id || null,
                effective_date: ed.effective_date || null,
                end_date: ed.end_date || null,
                order_reference: ed.order_reference?.trim() || null,
                sort_order: idx + 1,
              })),
              salary_history: salaryHistory.map((sh, idx) => ({
                base_salary: Number(sh.base_salary ?? 0),
                position_allowance: Number(sh.position_allowance ?? 0),
                is_max_step: Boolean(sh.is_max_step),
                effective_date: sh.effective_date || '',
                order_reference: sh.order_reference?.trim() || null,
                sort_order: idx + 1,
              })),
              evaluations: evaluations.map((ev, idx) => ({
                fiscal_year_be: Number(ev.fiscal_year_be),
                eval_round: Number(ev.eval_round) === 2 ? 2 : 1,
                score_percent:
                  ev.score_percent !== null && ev.score_percent !== undefined && String(ev.score_percent) !== ''
                    ? Number(ev.score_percent)
                    : null,
                eval_grade_id: ev.eval_grade_id || '',
                note: ev.note?.trim() || null,
                sort_order: idx + 1,
              })),
              disciplinary_records: disciplinaryRecords.map((dr, idx) => ({
                record_type_id: dr.record_type_id || '',
                penalty_level_id: dr.penalty_level_id || null,
                case_status_id: dr.case_status_id || '',
                effective_date: dr.effective_date || '',
                resolved_date: dr.resolved_date || null,
                document_ref: dr.document_ref?.trim() || null,
                remark: dr.remark?.trim() || null,
                sort_order: idx + 1,
              })),
              service_interruptions: serviceInterruptions.map((si, idx) => ({
                interruption_type_id: si.interruption_type_id || '',
                start_date: si.start_date || '',
                end_date: si.end_date || null,
                deductible_days: Number(si.deductible_days ?? 0),
                remark: si.remark?.trim() || null,
                sort_order: idx + 1,
              })),
              educations: educations.map((ed, idx) => ({
                institution_name: ed.institution_name?.trim() || '',
                start_period: ed.start_period?.trim() || null,
                end_period: ed.end_period?.trim() || null,
                degree_title: ed.degree_title?.trim() || '',
                major_name: ed.major_name?.trim() || null,
                sort_order: idx + 1,
              })),
              licenses: licenses.map((lc, idx) => ({
                license_name: lc.license_name?.trim() || '',
                issuing_agency: lc.issuing_agency?.trim() || null,
                license_number: lc.license_number?.trim() || null,
                effective_date: lc.effective_date || null,
                sort_order: idx + 1,
              })),
              trainings: trainings.map((tr, idx) => ({
                course_name: tr.course_name?.trim() || '',
                start_date: tr.start_date || null,
                end_date: tr.end_date || null,
                organizer_name: tr.organizer_name?.trim() || null,
                sort_order: idx + 1,
              })),
            }
          : {}),
      });

      // Deferred Delete on Save: remove replaced/deleted Drive files now that DB save succeeded
      const finalPhoto = p.photo_path.trim();
      const photosToDelete = new Set<string>();
      if (initialPhotoUrlRef.current && initialPhotoUrlRef.current !== finalPhoto) {
        photosToDelete.add(initialPhotoUrlRef.current);
      }
      for (const u of pendingPhotoUrlsRef.current) {
        if (u && u !== finalPhoto) photosToDelete.add(u);
      }
      for (const u of photosToDelete) {
        void deleteFromGoogleDrive({ fileUrlOrId: u, category: 'image', settings });
      }

      const finalSig = p.signature_path.trim();
      const sigsToDelete = new Set<string>();
      if (initialSigUrlRef.current && initialSigUrlRef.current !== finalSig) {
        sigsToDelete.add(initialSigUrlRef.current);
      }
      for (const u of pendingSigUrlsRef.current) {
        if (u && u !== finalSig) sigsToDelete.add(u);
      }
      for (const u of sigsToDelete) {
        void deleteFromGoogleDrive({ fileUrlOrId: u, category: 'signature', settings });
      }

      initialPhotoUrlRef.current = finalPhoto;
      initialSigUrlRef.current = finalSig;
      pendingPhotoUrlsRef.current = [];
      pendingSigUrlsRef.current = [];

      // Sync auth store if admin just edited their own profile media
      if (currentUser && savedId && currentUser.personnel_id === savedId) {
        setCurrentUser({
          ...currentUser,
          photo_path: finalPhoto || null,
          signature_path: finalSig || null,
        });
      }

      let provMsg = '';
      if (!initial && autoProvisionNow && savedId) {
        try {
          const prov = await userService.provisionAccounts([savedId]);
          if (prov.created > 0) {
            provMsg = ' พร้อมสร้างบัญชีผู้ใช้ SSO อัตโนมัติแล้ว';
          }
        } catch {
          provMsg = ' (บันทึกบุคลากรแล้ว แต่สร้างบัญชีอัตโนมัติไม่สำเร็จ สามารถกดสร้างภายหลังได้)';
        }
      }

      showToast(`บันทึกข้อมูลบุคลากรเรียบร้อยแล้ว${provMsg}`, 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(formatDatabaseError(err, 'บันทึกข้อมูลบุคลากรไม่สำเร็จ'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'basic' as const, label: '1. พื้นฐาน', icon: 'fa-id-card' },
    { id: 'assignment' as const, label: '2. สังกัด & ตำแหน่ง', icon: 'fa-sitemap' },
    { id: 'career' as const, label: '3. ประวัติรับราชการ', icon: 'fa-clock-rotate-left' },
    { id: 'kp7' as const, label: '4. การศึกษา & อบรม (ก.พ. ๗)', icon: 'fa-graduation-cap' },
  ];

  const existingOpenCountForOverlay = useMemo(() => {
    if (!overlayRequest || overlayRequest.domain !== 'position') return 0;
    return findOpenEndedPositionIndices(
      positionHistory as Array<Pick<PersonnelPositionHistoryRow, 'end_date'>>,
      overlayRequest.editIndex ?? undefined
    ).length;
  }, [overlayRequest, positionHistory]);

  const overlayZIndexClass = zIndexClass === 'z-[9995]' ? 'z-[9998]' : 'z-[9995]';

  return (
    <>
      <ResponsiveModal
        open={open}
        onClose={handleCancelClose}
        title={initial ? `แก้ไขข้อมูล: ${initial.full_name}` : 'เพิ่มบุคลากรใหม่'}
        icon="fa-user-pen"
        maxWidthClass="max-w-3xl"
        zIndexClass={zIndexClass}
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            {!initial ? (
              <label className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoProvisionNow}
                  onChange={(e) => setAutoProvisionNow(e.target.checked)}
                />
                สร้างบัญชีผู้ใช้งาน SSO อัตโนมัติทันที
              </label>
            ) : (
              <span className="text-[11px] text-slate-400">
                ไฟล์รูป/ลายเซ็นที่เปลี่ยนจะลบไฟล์เก่าบน Drive อัตโนมัติเมื่อกดบันทึก
              </span>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <button type="button" onClick={handleCancelClose} className="bma-btn-outline">
                ยกเลิก
              </button>
              <button type="submit" form="personnelBundleForm" disabled={saving} className="bma-btn-primary">
                <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
                บันทึกข้อมูลบุคลากร
              </button>
            </div>
          </div>
        }
      >
        <div className="flex flex-wrap gap-1.5 mb-4 pb-3 border-b border-slate-200 dark:border-slate-700">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (t.id !== tab && checkInvalidThaiDate('เปลี่ยนแท็บ')) return;
                setTab(t.id);
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                tab === t.id
                  ? 'bg-[#00744B] text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <i className={`fa-solid ${t.icon} mr-1.5`} />
              {t.label}
            </button>
          ))}
        </div>

        <form id="personnelBundleForm" ref={formRef} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* ======================== TAB 1: ข้อมูลพื้นฐาน ======================== */}
          {tab === 'basic' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="bma-label">เลขประจำตัวประชาชน 13 หลัก *</label>
                  <input
                    type="text"
                    maxLength={13}
                    value={p.cid}
                    onChange={(e) => setP({ ...p, cid: e.target.value.replace(/\D/g, '') })}
                    className="bma-input font-mono"
                  />
                </div>
                <div>
                  <label className="bma-label">สถานะบุคลากร</label>
                  <select
                    value={p.status_id}
                    onChange={(e) => setP({ ...p, status_id: e.target.value })}
                    className="bma-input"
                  >
                    <option value="">เลือกสถานะ</option>
                    {statusItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name_th}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="bma-label">คำนำหน้า</label>
                  <select
                    value={p.prefix_id}
                    onChange={(e) => setP({ ...p, prefix_id: e.target.value })}
                    className="bma-input"
                  >
                    <option value="">เลือกคำนำหน้า</option>
                    {prefixItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name_th}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="bma-label">ยศ / ฐานันดรศักดิ์</label>
                  <input
                    type="text"
                    value={p.noble_or_rank_title}
                    onChange={(e) => setP({ ...p, noble_or_rank_title: e.target.value })}
                    className="bma-input"
                  />
                </div>
                <div>
                  <label className="bma-label">ชื่อ *</label>
                  <input
                    type="text"
                    value={p.first_name}
                    onChange={(e) => setP({ ...p, first_name: e.target.value })}
                    className="bma-input"
                  />
                </div>
                <div>
                  <label className="bma-label">นามสกุล *</label>
                  <input
                    type="text"
                    value={p.last_name}
                    onChange={(e) => setP({ ...p, last_name: e.target.value })}
                    className="bma-input"
                  />
                </div>
                <div>
                  <label className="bma-label">เพศ</label>
                  <select
                    value={p.gender_id}
                    onChange={(e) => setP({ ...p, gender_id: e.target.value })}
                    className="bma-input"
                  >
                    <option value="">เลือกเพศ</option>
                    {genderItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name_th}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="bma-label">วันเกิด (พ.ศ.)</label>
                  <ThaiDatePicker
                    value={p.birth_date}
                    onChange={(iso) => setP({ ...p, birth_date: iso })}
                    onInvalidChange={setBirthDateInvalid}
                    minYearBe={2450}
                    maxYearBe={2620}
                    placeholder="วว/ดด/พ.ศ. (เช่น 01/10/2509)"
                  />
                  {!birthDateInvalid && p.birth_date && retirementInfo && (
                    <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-[11px] text-emerald-800 dark:text-emerald-200 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>
                        <i className="fa-regular fa-calendar-check mr-1" />
                        วันเกิด: <strong>{formatThaiDate(p.birth_date, 'long')}</strong>
                      </span>
                      <span className="text-emerald-400">·</span>
                      <span>
                        เกษียณอายุราชการ: <strong>{retirementInfo.retirementDateShort}</strong> (ปีงบฯ{' '}
                        {retirementInfo.fiscalYearBe})
                      </span>
                    </div>
                  )}
                </div>
                <div>
                  <label className="bma-label">เบอร์โทรศัพท์มือถือ</label>
                  <input
                    type="tel"
                    value={p.phone_number}
                    onChange={(e) => setP({ ...p, phone_number: e.target.value })}
                    className="bma-input font-mono"
                  />
                </div>
                <div>
                  <label className="bma-label">อีเมล</label>
                  <input
                    type="email"
                    value={p.email}
                    onChange={(e) => setP({ ...p, email: e.target.value })}
                    className="bma-input"
                  />
                </div>
              </div>

              {/* รูปโปรไฟล์ & ลายเซ็นอิเล็กทรอนิกส์ (แยกโฟลเดอร์ย่อยตามชื่อบุคลากร) */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <span className="flex items-center gap-2">
                    <i className="fa-solid fa-camera-retro text-emerald-600 dark:text-emerald-400" />
                    <span>รูปโปรไฟล์ & ลายเซ็นอิเล็กทรอนิกส์ (Google Drive)</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 truncate max-w-[260px]" title={personnelSubFolder}>
                    โฟลเดอร์ย่อย: {personnelSubFolder}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                  {/* Profile Photo */}
                  <div className="md:col-span-5 flex items-center gap-3">
                    <div className="w-20 h-20 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden flex items-center justify-center shrink-0">
                      {p.photo_path ? (
                        <DriveImage
                          src={p.photo_path}
                          alt={p.first_name || 'รูปโปรไฟล์'}
                          category="image"
                          className="w-full h-full object-cover"
                          fallback={
                            <span className="text-xl font-extrabold text-emerald-700 dark:text-emerald-300">
                              {(p.first_name || 'P').slice(0, 2)}
                            </span>
                          }
                        />
                      ) : (
                        <i className="fa-solid fa-user text-2xl text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200">รูปโปรไฟล์บุคลากร</p>
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => void handlePhotoUpload(e)}
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={uploadingPhoto}
                          onClick={() => photoInputRef.current?.click()}
                          className="px-2.5 py-1.5 rounded-lg bg-[#00744B] hover:bg-[#005B2E] text-white text-[11px] font-bold transition inline-flex items-center gap-1"
                        >
                          <i className={`fa-solid ${uploadingPhoto ? 'fa-spinner fa-spin' : 'fa-upload'}`} />
                          {p.photo_path ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
                        </button>
                        {p.photo_path && (
                          <button
                            type="button"
                            onClick={() => setP((prev) => ({ ...prev, photo_path: '' }))}
                            className="px-2 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-[11px] font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                          >
                            <i className="fa-solid fa-trash mr-1" />
                            ลบ
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Electronic Signature */}
                  <div className="md:col-span-7">
                    <SignaturePadUploader
                      value={p.signature_path}
                      filePrefix={`sig_${p.id || 'new'}`}
                      subFolderName={personnelSubFolder}
                      deferDriveDelete={true}
                      onUploaded={(url) => {
                        pendingSigUrlsRef.current.push(url);
                        setP((prev) => ({ ...prev, signature_path: url }));
                      }}
                      onRemove={() => setP((prev) => ({ ...prev, signature_path: '' }))}
                    />
                  </div>
                </div>
              </div>

              {/* ข้อมูลครอบครัวสำหรับแบบฟอร์ม ก.พ. ๗ (ข้อ ๗–๙) */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <i className="fa-solid fa-people-roof text-emerald-600 dark:text-emerald-400" />
                  <span>ข้อมูลครอบครัว (สำหรับแบบฟอร์ม ก.พ. ๗ ข้อ ๗–๙)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="bma-label">ชื่อ-สกุล บิดา</label>
                    <input
                      type="text"
                      value={p.father_full_name}
                      onChange={(e) => setP({ ...p, father_full_name: e.target.value })}
                      placeholder="เช่น นายสมชาย ใจดี"
                      className="bma-input"
                    />
                  </div>
                  <div>
                    <label className="bma-label">ชื่อ-สกุล มารดา</label>
                    <input
                      type="text"
                      value={p.mother_full_name}
                      onChange={(e) => setP({ ...p, mother_full_name: e.target.value })}
                      placeholder="เช่น นางสมหญิง ใจดี"
                      className="bma-input"
                    />
                  </div>
                  <div>
                    <label className="bma-label">นามสกุลเดิมมารดา</label>
                    <input
                      type="text"
                      value={p.mother_maiden_name}
                      onChange={(e) => setP({ ...p, mother_maiden_name: e.target.value })}
                      placeholder="นามสกุลเดิมก่อนสมรส (ถ้ามี)"
                      className="bma-input"
                    />
                  </div>
                  <div>
                    <label className="bma-label">ชื่อ-สกุล คู่สมรส</label>
                    <input
                      type="text"
                      value={p.spouse_full_name}
                      onChange={(e) => setP({ ...p, spouse_full_name: e.target.value })}
                      placeholder="ระบุหากสมรสแล้ว"
                      className="bma-input"
                    />
                  </div>
                  <div>
                    <label className="bma-label">นามสกุลเดิมคู่สมรส</label>
                    <input
                      type="text"
                      value={p.spouse_maiden_name}
                      onChange={(e) => setP({ ...p, spouse_maiden_name: e.target.value })}
                      placeholder="นามสกุลเดิมก่อนสมรส (ถ้ามี)"
                      className="bma-input"
                    />
                  </div>
                </div>
              </div>

              <HistorySectionCard
                title="ประวัติการเปลี่ยนชื่อ-สกุล (สำหรับตรวจราชกิจจานุเบกษา)"
                icon="fa-clock-rotate-left"
                count={nameHistory.length}
                open={openSections.nameHistory}
                onToggle={() => setOpenSections((prev) => ({ ...prev, nameHistory: !prev.nameHistory }))}
                loadError={timelinesLoadError}
                onRetry={initial ? () => loadTimelinesFor(initial.id, loadSeqRef.current) : undefined}
                onAdd={() => openOverlayForAdd('name')}
              >
                {nameHistory.length === 0 ? (
                  <p className="text-xs text-slate-400">ยังไม่มีประวัติการเปลี่ยนชื่อ-สกุล (ไม่บังคับกรอก)</p>
                ) : (
                  nameHistory.map((nh, idx) => (
                    <div
                      key={nh._rowKey ?? `nh_${idx}`}
                      className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <div className="min-w-0 text-xs space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <HistoryOrderTags idx={idx} total={nameHistory.length} />
                          <span className="font-bold text-slate-800 dark:text-slate-100">
                            {[nh.old_prefix, nh.old_first_name, nh.old_last_name].filter(Boolean).join(' ')}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                          <span>วันที่เปลี่ยน: {formatThaiDate(nh.changed_date, 'short')}</span>
                          {nh.document_ref && <span>· อ้างอิง: {nh.document_ref}</span>}
                        </div>
                      </div>
                      <HistoryRowControls
                        idx={idx}
                        total={nameHistory.length}
                        onMoveUp={() => moveHistoryRow('name', idx, -1)}
                        onMoveDown={() => moveHistoryRow('name', idx, 1)}
                        onEdit={() => openOverlayForEdit('name', idx, nh as Record<string, unknown>)}
                        onDelete={() => handleDeleteRow('name', idx)}
                      />
                    </div>
                  ))
                )}
              </HistorySectionCard>
            </div>
          )}

          {/* ======================== TAB 2: สังกัด & ตำแหน่ง ======================== */}
          {tab === 'assignment' && (
            <div className="space-y-4">
              {locks.positionFieldsDisabled && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <i className="fa-solid fa-lock mr-1.5 text-amber-600" />
                    ข้อมูลตำแหน่ง ระดับ เลขที่ตำแหน่ง และวันที่ดำรงตำแหน่งถูกอัปเดตอัตโนมัติจาก{' '}
                    <strong>ประวัติการดำรงตำแหน่ง ({positionHistory.length} รายการ)</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('career');
                      setOpenSections((prev) => ({ ...prev, positionHistory: true }));
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 font-bold text-[11px] text-amber-800 dark:text-amber-200 hover:bg-amber-100 transition shrink-0"
                  >
                    แก้ไขในแท็บ 3: ประวัติรับราชการ →
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="bma-label">ประเภทบุคลากร</label>
                  <select
                    value={a.employment_type_id}
                    onChange={(e) => setA({ ...a, employment_type_id: e.target.value })}
                    className="bma-input"
                  >
                    <option value="">เลือกประเภทบุคลากร</option>
                    {employmentTypeItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name_th}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="bma-label">
                    ประเภทตำแหน่ง {locks.positionFieldsDisabled && <LockBadge />}
                  </label>
                  <select
                    value={a.position_type_id}
                    disabled={locks.positionFieldsDisabled}
                    onChange={(e) =>
                      setA({ ...a, position_type_id: e.target.value, position_id: '', position_level_id: '' })
                    }
                    className={`bma-input ${locks.positionFieldsDisabled ? DISABLED_INPUT_CLASS : ''}`}
                  >
                    <option value="">เลือกประเภทตำแหน่ง</option>
                    {sortedPositionTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name_th}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="bma-label">
                    ตำแหน่งในสายงาน {locks.positionFieldsDisabled && <LockBadge />}
                  </label>
                  <select
                    value={a.position_id}
                    disabled={locks.positionFieldsDisabled}
                    onChange={(e) => setA({ ...a, position_id: e.target.value, position_level_id: '' })}
                    className={`bma-input ${locks.positionFieldsDisabled ? DISABLED_INPUT_CLASS : ''}`}
                  >
                    <option value="">เลือกตำแหน่ง</option>
                    {positionsForType.map((pos) => (
                      <option key={pos.id} value={pos.id}>
                        {pos.name_th}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="bma-label">
                    ระดับตำแหน่ง {selectedPosition?.requires_level ? '*' : ''}{' '}
                    {locks.positionFieldsDisabled && <LockBadge />}
                  </label>
                  <select
                    value={a.position_level_id}
                    disabled={
                      locks.positionFieldsDisabled || Boolean(selectedPosition && !selectedPosition.requires_level)
                    }
                    onChange={(e) => setA({ ...a, position_level_id: e.target.value })}
                    className={`bma-input ${locks.positionFieldsDisabled ? DISABLED_INPUT_CLASS : ''}`}
                  >
                    <option value="">
                      {selectedPosition && !selectedPosition.requires_level
                        ? 'ตำแหน่งนี้ไม่มีระดับ'
                        : 'เลือกระดับตำแหน่ง'}
                    </option>
                    {allowedLevelsForPos.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name_th}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="bma-label">
                    เลขที่ตำแหน่ง {locks.positionFieldsDisabled && <LockBadge />}
                  </label>
                  <input
                    type="text"
                    value={a.position_number}
                    disabled={locks.positionFieldsDisabled}
                    onChange={(e) => setA({ ...a, position_number: e.target.value })}
                    className={`bma-input font-mono ${locks.positionFieldsDisabled ? DISABLED_INPUT_CLASS : ''}`}
                  />
                </div>
                <div>
                  <label className="bma-label">ระดับผู้มีอำนาจลงนาม</label>
                  <select
                    value={a.approval_tier_id}
                    onChange={(e) => setA({ ...a, approval_tier_id: e.target.value })}
                    className="bma-input"
                  >
                    <option value="">ไม่ระบุ</option>
                    {approvalTierItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name_th}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="bma-label">
                    สำนัก {lockLv12 && <i className="fa-solid fa-lock text-amber-500 ml-1" />}
                  </label>
                  <select
                    value={a.bureau_id}
                    disabled={lockLv12}
                    onChange={(e) =>
                      setA({ ...a, bureau_id: e.target.value, office_id: '', department_id: '', division_id: '' })
                    }
                    className="bma-input"
                  >
                    <option value="">เลือกสำนัก</option>
                    {bureausList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name_th}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="bma-label">
                    สำนักงาน/กอง {lockLv12 && <i className="fa-solid fa-lock text-amber-500 ml-1" />}
                  </label>
                  <select
                    value={a.office_id}
                    disabled={lockLv12}
                    onChange={(e) => setA({ ...a, office_id: e.target.value, department_id: '', division_id: '' })}
                    className="bma-input"
                  >
                    <option value="">เลือกสำนักงาน/กอง</option>
                    {offices.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name_th}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="bma-label">
                    ส่วน/ฝ่าย {isDepartmentAdmin && <i className="fa-solid fa-lock text-amber-500 ml-1" />}
                  </label>
                  <select
                    value={a.department_id}
                    disabled={isDepartmentAdmin}
                    onChange={(e) => setA({ ...a, department_id: e.target.value, division_id: '' })}
                    className="bma-input"
                  >
                    <option value="">เลือกส่วน/ฝ่าย</option>
                    {depts.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name_th}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="bma-label">กลุ่มงาน</label>
                  <select
                    value={a.division_id}
                    onChange={(e) => setA({ ...a, division_id: e.target.value })}
                    className="bma-input"
                  >
                    <option value="">เลือกกลุ่มงาน</option>
                    {divs.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name_th}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="bma-label">
                    วันที่ดำรงตำแหน่งปัจจุบัน (พ.ศ.) {locks.positionFieldsDisabled && <LockBadge />}
                  </label>
                  <ThaiDatePicker
                    value={a.current_position_date}
                    disabled={locks.positionFieldsDisabled}
                    onChange={(iso) => setA({ ...a, current_position_date: iso })}
                  />
                </div>
                <div>
                  <label className="bma-label">
                    วันที่ดำรงระดับปัจจุบัน (พ.ศ.) {locks.positionFieldsDisabled && <LockBadge />}
                  </label>
                  <ThaiDatePicker
                    value={a.current_level_date}
                    disabled={locks.positionFieldsDisabled}
                    onChange={(iso) => setA({ ...a, current_level_date: iso })}
                  />
                </div>

                <div>
                  <label className="bma-label">
                    ปฏิบัติราชการแทน <LockBadge label="อัปเดตจากรายการด้านล่าง" />
                  </label>
                  <input
                    type="text"
                    disabled
                    value={a.secondary_position}
                    placeholder="ยังไม่มีรายการปฏิบัติราชการแทนที่ปฏิบัติอยู่ในปัจจุบัน"
                    className={`bma-input ${DISABLED_INPUT_CLASS}`}
                  />
                </div>
                <div>
                  <label className="bma-label">
                    รักษาการในตำแหน่ง <LockBadge label="อัปเดตจากรายการด้านล่าง" />
                  </label>
                  <input
                    type="text"
                    disabled
                    value={a.acting_position}
                    placeholder="ยังไม่มีรายการรักษาการในตำแหน่งที่ปฏิบัติอยู่ในปัจจุบัน"
                    className={`bma-input ${DISABLED_INPUT_CLASS}`}
                  />
                </div>

                {livePositionDisplay && livePositionDisplay !== '-' && (
                  <div className="sm:col-span-2 rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                    <i className="fa-solid fa-id-badge text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="truncate">
                      ชื่อตำแหน่งแสดงผลในระบบ: <strong>{livePositionDisplay}</strong>
                    </span>
                  </div>
                )}
              </div>

              <HistorySectionCard
                title="ปฏิบัติราชการแทน / รักษาการในตำแหน่ง (ตำแหน่งประเภทบริหาร)"
                icon="fa-user-tie"
                count={executiveDuties.length}
                open={openSections.executiveDuties}
                onToggle={() => setOpenSections((prev) => ({ ...prev, executiveDuties: !prev.executiveDuties }))}
                loadError={timelinesLoadError}
                onRetry={initial ? () => loadTimelinesFor(initial.id, loadSeqRef.current) : undefined}
                onAdd={() => openOverlayForAdd('executiveDuty')}
              >
                {executiveDuties.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    ยังไม่มีรายการปฏิบัติราชการแทนหรือรักษาการในตำแหน่ง (สามารถเพิ่มได้หลายตำแหน่งต่อ 1 บุคลากร)
                  </p>
                ) : (
                  executiveDuties.map((ed, idx) => {
                    const isActiveDuty = !ed.end_date;
                    const summary = formatExecutiveDutySummary(ed, master, fallbackBureauName);
                    return (
                      <div
                        key={ed._rowKey ?? `ed_${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <div className="min-w-0 text-xs space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <HistoryOrderTags idx={idx} total={executiveDuties.length} />
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                ed.duty_type === 'DEPUTIZING'
                                  ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200'
                                  : 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200'
                              }`}
                            >
                              {ed.duty_type === 'DEPUTIZING' ? 'ปฏิบัติราชการแทน' : 'รักษาการในตำแหน่ง'}
                            </span>
                            {isActiveDuty ? (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-200">
                                ปัจจุบัน
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">
                                สิ้นสุดแล้ว
                              </span>
                            )}
                            <span className="font-bold text-slate-800 dark:text-slate-100">{summary || '-'}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                            {ed.effective_date && <span>มีผล: {formatThaiDate(ed.effective_date, 'short')}</span>}
                            {ed.end_date && <span>– {formatThaiDate(ed.end_date, 'short')}</span>}
                            {ed.order_reference && <span>· คำสั่ง: {ed.order_reference}</span>}
                          </div>
                        </div>
                        <HistoryRowControls
                          idx={idx}
                          total={executiveDuties.length}
                          onMoveUp={() => moveHistoryRow('executiveDuty', idx, -1)}
                          onMoveDown={() => moveHistoryRow('executiveDuty', idx, 1)}
                          onEdit={() => openOverlayForEdit('executiveDuty', idx, ed as Record<string, unknown>)}
                          onDelete={() => handleDeleteRow('executiveDuty', idx)}
                        />
                      </div>
                    );
                  })
                )}
              </HistorySectionCard>
            </div>
          )}

          {/* ======================== TAB 3: ประวัติรับราชการ ======================== */}
          {tab === 'career' && (
            <div className="space-y-4">
              {/* Zone A: ข้อมูลแรกบรรจุเข้ารับราชการ */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/50 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                  <span className="flex items-center gap-2">
                    <i className="fa-solid fa-flag-checkered text-emerald-600 dark:text-emerald-400" />
                    <span>ข้อมูลแรกบรรจุเข้ารับราชการ</span>
                  </span>
                  {locks.initialPositionFieldsDisabled && <LockBadge label="ซิงก์จากตำแหน่งแรกบรรจุในประวัติฯ" />}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="bma-label">วันบรรจุเข้ารับราชการ (พ.ศ.)</label>
                    <ThaiDatePicker
                      value={c.start_service_date}
                      onChange={(iso) => {
                        const yearBe = iso ? String(Number(iso.slice(0, 4)) + 543) : '';
                        setC({ ...c, start_service_date: iso, start_service_year_be: yearBe });
                      }}
                    />
                    {serviceTenureLabel && (
                      <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">
                        <i className="fa-regular fa-hourglass-half mr-1" />
                        อายุราชการโดยประมาณ: <strong>{serviceTenureLabel}</strong>
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="bma-label">
                      ปี พ.ศ. เริ่มรับราชการ <LockBadge label="คำนวณอัตโนมัติ" />
                    </label>
                    <input
                      type="text"
                      disabled
                      readOnly
                      value={
                        c.start_service_date
                          ? String(Number(c.start_service_date.slice(0, 4)) + 543)
                          : c.start_service_year_be
                      }
                      placeholder="คำนวณอัตโนมัติจากวันบรรจุ"
                      className={`bma-input font-mono ${DISABLED_INPUT_CLASS}`}
                    />
                  </div>
                  <div>
                    <label className="bma-label">
                      ประเภทตำแหน่งแรกบรรจุ {locks.initialPositionFieldsDisabled && <LockBadge />}
                    </label>
                    <select
                      value={c.initial_position_type_id}
                      disabled={locks.initialPositionFieldsDisabled}
                      onChange={(e) =>
                        setC({
                          ...c,
                          initial_position_type_id: e.target.value,
                          initial_position_id: '',
                          initial_position_level_id: '',
                        })
                      }
                      className={`bma-input ${locks.initialPositionFieldsDisabled ? DISABLED_INPUT_CLASS : ''}`}
                    >
                      <option value="">เลือกประเภทตำแหน่งแรกบรรจุ</option>
                      {sortedPositionTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name_th}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="bma-label">
                      ตำแหน่งแรกบรรจุ (ตามตั้งค่าระบบ) {locks.initialPositionFieldsDisabled && <LockBadge />}
                    </label>
                    <select
                      value={c.initial_position_id}
                      disabled={locks.initialPositionFieldsDisabled}
                      onChange={(e) => {
                        const picked = master.positions.find((x) => x.id === e.target.value);
                        setC({
                          ...c,
                          initial_position_type_id: picked?.position_type_id || c.initial_position_type_id,
                          initial_position_id: e.target.value,
                          initial_position_level_id: '',
                          initial_position: picked?.name_th || c.initial_position,
                        });
                      }}
                      className={`bma-input ${locks.initialPositionFieldsDisabled ? DISABLED_INPUT_CLASS : ''}`}
                    >
                      <option value="">เลือกตำแหน่งแรกบรรจุ</option>
                      {initPositionsForType.map((pos) => (
                        <option key={pos.id} value={pos.id}>
                          {pos.name_th}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="bma-label">
                      ระดับตำแหน่งแรกบรรจุ {locks.initialPositionFieldsDisabled && <LockBadge />}
                    </label>
                    <select
                      value={c.initial_position_level_id}
                      disabled={
                        locks.initialPositionFieldsDisabled ||
                        Boolean(selectedInitPosition && !selectedInitPosition.requires_level)
                      }
                      onChange={(e) => setC({ ...c, initial_position_level_id: e.target.value })}
                      className={`bma-input ${locks.initialPositionFieldsDisabled ? DISABLED_INPUT_CLASS : ''}`}
                    >
                      <option value="">
                        {selectedInitPosition && !selectedInitPosition.requires_level
                          ? 'ตำแหน่งนี้ไม่มีระดับ'
                          : 'เลือกระดับตำแหน่งแรกบรรจุ'}
                      </option>
                      {allowedLevelsForInitPos.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name_th}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="bma-label">เงินเดือนแรกบรรจุ (บาท)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={c.initial_salary}
                      onChange={(e) => setC({ ...c, initial_salary: e.target.value })}
                      className="bma-input font-mono"
                    />
                  </div>
                  {liveInitialPositionDisplay && (
                    <div className="sm:col-span-2 rounded-lg border border-sky-200 dark:border-sky-800/70 bg-sky-50/70 dark:bg-sky-950/30 px-3 py-1.5 text-[11px] text-sky-900 dark:text-sky-200 flex items-center gap-2">
                      <i className="fa-solid fa-flag text-sky-600 dark:text-sky-400 shrink-0" />
                      <span className="truncate">
                        ชื่อตำแหน่งแรกบรรจุที่บันทึก: <strong>{liveInitialPositionDisplay}</strong>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Zone B: สรุปเงินเดือนปัจจุบัน & สถานะทางวินัย */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/50 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                  <span className="flex items-center gap-2">
                    <i className="fa-solid fa-coins text-emerald-600 dark:text-emerald-400" />
                    <span>สรุปเงินเดือนปัจจุบัน & สถานะทางวินัย</span>
                  </span>
                  {locks.salaryFieldsDisabled && <LockBadge label="ซิงก์จากประวัติเงินเดือน" />}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="bma-label">
                      เงินเดือนปัจจุบัน (บาท) {locks.salaryFieldsDisabled && <LockBadge />}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={locks.salaryFieldsDisabled}
                      value={c.current_salary}
                      onChange={(e) => setC({ ...c, current_salary: e.target.value })}
                      className={`bma-input font-mono ${locks.salaryFieldsDisabled ? DISABLED_INPUT_CLASS : ''}`}
                    />
                  </div>
                  <div>
                    <label className="bma-label">
                      เงินประจำตำแหน่ง (บาท) {locks.salaryFieldsDisabled && <LockBadge />}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={locks.salaryFieldsDisabled}
                      value={c.position_allowance}
                      onChange={(e) => setC({ ...c, position_allowance: e.target.value })}
                      className={`bma-input font-mono ${locks.salaryFieldsDisabled ? DISABLED_INPUT_CLASS : ''}`}
                    />
                  </div>
                  <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-1">
                    <label
                      className={`inline-flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 ${
                        locks.salaryFieldsDisabled ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={locks.salaryFieldsDisabled}
                        checked={c.is_max_step}
                        onChange={(e) => setC({ ...c, is_max_step: e.target.checked })}
                      />
                      <span>เงินเดือนเต็มขั้นของระดับตำแหน่ง</span>
                      {locks.salaryFieldsDisabled && <LockBadge />}
                    </label>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold ${
                          c.disciplinary_flag
                            ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                            : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        }`}
                      >
                        <i
                          className={`fa-solid ${
                            c.disciplinary_flag ? 'fa-triangle-exclamation' : 'fa-circle-check'
                          }`}
                        />
                        {c.disciplinary_flag ? 'มีประวัติ/อยู่ระหว่างดำเนินการทางวินัย' : 'ปกติ — ไม่มีประวัติทางวินัย'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setOpenSections((prev) => ({ ...prev, disciplinary: true }))}
                        className="text-[11px] font-bold text-slate-500 hover:text-emerald-700 dark:hover:text-emerald-300 underline"
                      >
                        ดูประวัติทางวินัย ({disciplinaryRecords.length})
                      </button>
                    </div>
                  </div>

                  {c.disciplinary_flag && disciplinaryRecords.length > 0 && c.disciplinary_note && (
                    <div className="sm:col-span-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 px-3 py-2 text-[11px] text-rose-800 dark:text-rose-200">
                      <i className="fa-solid fa-scale-balanced mr-1.5" />
                      สรุปจากประวัติทางวินัย: <strong>{c.disciplinary_note}</strong>
                    </div>
                  )}

                  {c.disciplinary_flag && disciplinaryRecords.length === 0 && (
                    <div className="sm:col-span-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                      <div className="font-bold flex items-center gap-1.5">
                        <i className="fa-solid fa-triangle-exclamation text-amber-600" />
                        <span>พบสถานะทางวินัยเดิมที่ยังไม่ได้บันทึกรายการในตารางประวัติทางวินัย</span>
                      </div>
                      {c.disciplinary_note && (
                        <p className="text-[11px] opacity-90">หมายเหตุเดิม: {c.disciplinary_note}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenSections((prev) => ({ ...prev, disciplinary: true }));
                            openOverlayForAdd('disciplinary');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold transition"
                        >
                          <i className="fa-solid fa-plus mr-1" />
                          บันทึกประวัติทางวินัย
                        </button>
                        <button
                          type="button"
                          onClick={() => setC((prev) => ({ ...prev, disciplinary_flag: false, disciplinary_note: '' }))}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-[11px] font-bold hover:bg-amber-100 dark:hover:bg-amber-950/60 transition"
                        >
                          ล้างสถานะเดิม
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 1. ประวัติการดำรงตำแหน่ง (ย้ายมาจากแท็บ 2 + Auto-Sync แท็บ 2) */}
              <HistorySectionCard
                title="ประวัติการดำรงตำแหน่ง"
                icon="fa-briefcase"
                count={positionHistory.length}
                badgeText={
                  positionHistory.length === 0
                    ? 'โหมดเริ่มต้น (Bypass)'
                    : positionSnapshot?.hasOpenEnded
                      ? 'ซิงก์ตำแหน่งปัจจุบันแล้ว'
                      : 'ยังไม่มีแถวปัจจุบัน'
                }
                open={openSections.positionHistory}
                onToggle={() => setOpenSections((prev) => ({ ...prev, positionHistory: !prev.positionHistory }))}
                loadError={timelinesLoadError}
                onRetry={initial ? () => loadTimelinesFor(initial.id, loadSeqRef.current) : undefined}
                onAdd={() => openOverlayForAdd('position')}
              >
                {positionHistory.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    ยังไม่มีประวัติการดำรงตำแหน่ง (ระบบอนุโลมให้กรอกตำแหน่งในแท็บ 2 ได้โดยตรง และจะเริ่มซิงก์+ล็อกฟิลด์อัตโนมัติทันทีที่เพิ่มประวัติรายการแรก)
                  </p>
                ) : (
                  <>
                    {!positionSnapshot?.hasOpenEnded && (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                        <i className="fa-solid fa-circle-info mr-1.5" />
                        ทุกรายการมีวันสิ้นสุดครบแล้ว — ระบบใช้รายการที่มีผลล่าสุดเป็นตำแหน่งปัจจุบันชั่วคราว แนะนำให้เว้นว่างวันสิ้นสุดของตำแหน่งปัจจุบัน
                      </div>
                    )}
                    {positionHistory.map((ph, idx) => {
                      const posType = master.positionTypes.find((t) => t.id === ph.position_type_id);
                      const posObj = master.positions.find((x) => x.id === ph.position_id);
                      const lvlObj = master.positionLevels.find((l) => l.id === ph.position_level_id);
                      const orgObj = master.orgUnits.find((u) => u.id === ph.org_unit_id);
                      const anc = resolveOrgUnitAncestors(ph.org_unit_id, master.orgUnits);
                      const currentBureauObj = master.orgUnits.find((u) => u.id === a.bureau_id);
                      const titleDisplay = formatCivilServantPosition(
                        posObj?.name_th || ph.position_title_snapshot || '',
                        lvlObj?.name_th || '',
                        posType?.name_th || '',
                        {
                          positionTypeCode: posType?.code,
                          bureauName: anc.bureauName || currentBureauObj?.name_th,
                          officeName: anc.officeName,
                          departmentName: anc.departmentName,
                          divisionName: anc.divisionName,
                          fallbackBureauName,
                        }
                      );
                      const isCurrent = !ph.end_date;
                      return (
                        <div
                          key={ph._rowKey ?? `ph_${idx}`}
                          className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        >
                          <div className="min-w-0 text-xs space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <HistoryOrderTags
                                idx={idx}
                                total={positionHistory.length}
                                latestLabel="ตำแหน่งล่าสุด"
                                initialLabel="ตำแหน่งแรกบรรจุ"
                                isLatestOverride={idx === 0 || Boolean(ph.is_latest)}
                                isInitialOverride={idx === positionHistory.length - 1 || Boolean(ph.is_initial)}
                              />
                              {isCurrent && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300">
                                  ปัจจุบัน
                                </span>
                              )}
                              {posType && (
                                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                  {posType.name_th}
                                </span>
                              )}
                              <span className="font-bold text-slate-800 dark:text-slate-100">{titleDisplay}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                              <span>
                                {formatThaiDate(ph.effective_date, 'short')} –{' '}
                                {ph.end_date ? formatThaiDate(ph.end_date, 'short') : 'ปัจจุบัน'}
                              </span>
                              {ph.position_number && <span className="font-mono">· เลขที่ {ph.position_number}</span>}
                              {ph.base_salary !== null && ph.base_salary !== undefined && (
                                <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                                  · เงินเดือน {Number(ph.base_salary).toLocaleString()} บ.
                                </span>
                              )}
                              {Number(ph.position_allowance ?? 0) > 0 && (
                                <span className="font-mono font-semibold text-amber-700 dark:text-amber-300">
                                  (+ประจำตำแหน่ง {Number(ph.position_allowance).toLocaleString()})
                                </span>
                              )}
                              {orgObj && <span>· {orgObj.name_th}</span>}
                              {ph.order_reference && <span>· คำสั่ง {ph.order_reference}</span>}
                            </div>
                          </div>
                          <HistoryRowControls
                            idx={idx}
                            total={positionHistory.length}
                            onMoveUp={() => moveHistoryRow('position', idx, -1)}
                            onMoveDown={() => moveHistoryRow('position', idx, 1)}
                            onEdit={() => openOverlayForEdit('position', idx, ph as Record<string, unknown>)}
                            onDelete={() => handleDeleteRow('position', idx)}
                          />
                        </div>
                      );
                    })}
                  </>
                )}
              </HistorySectionCard>

              {/* 2. ประวัติเงินเดือนและเงินประจำตำแหน่ง */}
              <HistorySectionCard
                title="ประวัติเงินเดือนและเงินประจำตำแหน่ง"
                icon="fa-money-bill-trend-up"
                count={salaryHistory.length}
                open={openSections.salaryHistory}
                onToggle={() => setOpenSections((prev) => ({ ...prev, salaryHistory: !prev.salaryHistory }))}
                loadError={timelinesLoadError}
                onRetry={initial ? () => loadTimelinesFor(initial.id, loadSeqRef.current) : undefined}
                onAdd={() => openOverlayForAdd('salary')}
              >
                {salaryHistory.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    ยังไม่มีประวัติเงินเดือนย้อนหลัง (กรอกได้ในช่องด้านบน หรือกดเพิ่มรายการเพื่อให้ระบบอัปเดตและล็อกอัตโนมัติ)
                  </p>
                ) : (
                  salaryHistory.map((sh, idx) => (
                    <div
                      key={sh._rowKey ?? `sh_${idx}`}
                      className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <div className="min-w-0 text-xs space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <HistoryOrderTags idx={idx} total={salaryHistory.length} />
                          <span className="font-extrabold font-mono text-emerald-700 dark:text-emerald-300">
                            {Number(sh.base_salary ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
                          </span>
                          {Number(sh.position_allowance ?? 0) > 0 && (
                            <span className="px-1.5 py-0.5 rounded-md bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 text-[10px] font-bold">
                              + เงินประจำตำแหน่ง {Number(sh.position_allowance).toLocaleString('th-TH')} บาท
                            </span>
                          )}
                          {sh.is_max_step && (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-[10px] font-bold">
                              เต็มขั้น
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                          <span>วันที่มีผล: {formatThaiDate(sh.effective_date, 'short')}</span>
                          {sh.order_reference && <span>· คำสั่ง: {sh.order_reference}</span>}
                        </div>
                      </div>
                      <HistoryRowControls
                        idx={idx}
                        total={salaryHistory.length}
                        onMoveUp={() => moveHistoryRow('salary', idx, -1)}
                        onMoveDown={() => moveHistoryRow('salary', idx, 1)}
                        onEdit={() => openOverlayForEdit('salary', idx, sh as Record<string, unknown>)}
                        onDelete={() => handleDeleteRow('salary', idx)}
                      />
                    </div>
                  ))
                )}
              </HistorySectionCard>

              {/* 3. ประวัติผลการประเมินการปฏิบัติราชการ */}
              <HistorySectionCard
                title="ประวัติผลการประเมินการปฏิบัติราชการ"
                icon="fa-chart-simple"
                count={evaluations.length}
                open={openSections.evaluations}
                onToggle={() => setOpenSections((prev) => ({ ...prev, evaluations: !prev.evaluations }))}
                loadError={timelinesLoadError}
                onRetry={initial ? () => loadTimelinesFor(initial.id, loadSeqRef.current) : undefined}
                onAdd={() => openOverlayForAdd('evaluation')}
              >
                {evaluations.length === 0 ? (
                  <p className="text-xs text-slate-400">ยังไม่มีประวัติผลการประเมินการปฏิบัติราชการ (ไม่บังคับกรอก)</p>
                ) : (
                  evaluations.map((ev, idx) => {
                    const grade = (master.itemsByCategoryCode['EVAL_GRADE'] ?? []).find(
                      (g) => g.id === ev.eval_grade_id
                    );
                    return (
                      <div
                        key={ev._rowKey ?? `ev_${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <div className="min-w-0 text-xs space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <HistoryOrderTags idx={idx} total={evaluations.length} />
                            <span className="font-bold text-slate-800 dark:text-slate-100">
                              ปีงบฯ {ev.fiscal_year_be} รอบที่ {ev.eval_round}
                            </span>
                            {grade && (
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                                style={{ backgroundColor: grade.color_hex || '#047857' }}
                              >
                                {grade.name_th}
                              </span>
                            )}
                            {ev.score_percent != null && (
                              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                ({ev.score_percent}%)
                              </span>
                            )}
                          </div>
                          {ev.note && <div className="text-[11px] text-slate-500">{ev.note}</div>}
                        </div>
                        <HistoryRowControls
                          idx={idx}
                          total={evaluations.length}
                          onMoveUp={() => moveHistoryRow('evaluation', idx, -1)}
                          onMoveDown={() => moveHistoryRow('evaluation', idx, 1)}
                          onEdit={() => openOverlayForEdit('evaluation', idx, ev as Record<string, unknown>)}
                          onDelete={() => handleDeleteRow('evaluation', idx)}
                        />
                      </div>
                    );
                  })
                )}
              </HistorySectionCard>

              {/* 4. ประวัติทางวินัย คดีอาญา และการชี้มูล */}
              <HistorySectionCard
                title="ประวัติทางวินัย คดีอาญา และการชี้มูล (Qualification Gate)"
                icon="fa-scale-balanced"
                count={disciplinaryRecords.length}
                open={openSections.disciplinary}
                onToggle={() => setOpenSections((prev) => ({ ...prev, disciplinary: !prev.disciplinary }))}
                loadError={timelinesLoadError}
                onRetry={initial ? () => loadTimelinesFor(initial.id, loadSeqRef.current) : undefined}
                onAdd={() => openOverlayForAdd('disciplinary')}
              >
                {disciplinaryRecords.length === 0 ? (
                  <p className="text-xs text-slate-400">ยังไม่มีประวัติทางวินัยหรือคดีความ (ไม่บังคับกรอก)</p>
                ) : (
                  disciplinaryRecords.map((dr, idx) => {
                    const recType = (master.itemsByCategoryCode['DISCIPLINARY_TYPE'] ?? []).find(
                      (t) => t.id === dr.record_type_id
                    );
                    const penalty = (master.itemsByCategoryCode['DISCIPLINARY_PENALTY'] ?? []).find(
                      (pItem) => pItem.id === dr.penalty_level_id
                    );
                    const status = (master.itemsByCategoryCode['DISCIPLINARY_CASE_STATUS'] ?? []).find(
                      (s) => s.id === dr.case_status_id
                    );
                    return (
                      <div
                        key={dr._rowKey ?? `dr_${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <div className="min-w-0 text-xs space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <HistoryOrderTags idx={idx} total={disciplinaryRecords.length} />
                            <span className="font-bold text-slate-800 dark:text-slate-100">
                              {recType?.name_th || 'ไม่ระบุประเภท'}
                            </span>
                            {penalty && (
                              <span className="px-1.5 py-0.5 rounded-md bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-200 text-[10px] font-bold">
                                {penalty.name_th}
                              </span>
                            )}
                            {status && (
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                                style={{ backgroundColor: status.color_hex || '#D97706' }}
                              >
                                {status.name_th}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                            <span>มีผล: {formatThaiDate(dr.effective_date, 'short')}</span>
                            {dr.resolved_date && <span>· ยุติ: {formatThaiDate(dr.resolved_date, 'short')}</span>}
                            {dr.document_ref && <span>· อ้างอิง: {dr.document_ref}</span>}
                            {dr.remark && <span>· {dr.remark}</span>}
                          </div>
                        </div>
                        <HistoryRowControls
                          idx={idx}
                          total={disciplinaryRecords.length}
                          onMoveUp={() => moveHistoryRow('disciplinary', idx, -1)}
                          onMoveDown={() => moveHistoryRow('disciplinary', idx, 1)}
                          onEdit={() => openOverlayForEdit('disciplinary', idx, dr as Record<string, unknown>)}
                          onDelete={() => handleDeleteRow('disciplinary', idx)}
                        />
                      </div>
                    );
                  })
                )}
              </HistorySectionCard>

              {/* 5. เหตุการณ์กระทบการนับอายุราชการต่อเนื่อง */}
              <HistorySectionCard
                title="เหตุการณ์กระทบการนับอายุราชการต่อเนื่อง"
                icon="fa-calendar-xmark"
                count={serviceInterruptions.length}
                badgeText={totalDeductibleDays > 0 ? `หักรวม ${totalDeductibleDays} วัน` : undefined}
                open={openSections.interruptions}
                onToggle={() => setOpenSections((prev) => ({ ...prev, interruptions: !prev.interruptions }))}
                loadError={timelinesLoadError}
                onRetry={initial ? () => loadTimelinesFor(initial.id, loadSeqRef.current) : undefined}
                onAdd={() => openOverlayForAdd('interruption')}
              >
                {serviceInterruptions.length === 0 ? (
                  <p className="text-xs text-slate-400">ยังไม่มีเหตุการณ์ที่กระทบการนับอายุราชการ (ไม่บังคับกรอก)</p>
                ) : (
                  serviceInterruptions.map((si, idx) => {
                    const it = (master.itemsByCategoryCode['SERVICE_INTERRUPTION_TYPE'] ?? []).find(
                      (x) => x.id === si.interruption_type_id
                    );
                    return (
                      <div
                        key={si._rowKey ?? `si_${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <div className="min-w-0 text-xs space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <HistoryOrderTags idx={idx} total={serviceInterruptions.length} />
                            <span className="font-bold text-slate-800 dark:text-slate-100">
                              {it?.name_th || 'ไม่ระบุประเภท'}
                            </span>
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-[10px] font-bold font-mono">
                              หัก {Number(si.deductible_days ?? 0)} วัน
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                            <span>
                              {formatThaiDate(si.start_date, 'short')} –{' '}
                              {si.end_date ? formatThaiDate(si.end_date, 'short') : 'ยังไม่สิ้นสุด'}
                            </span>
                            {si.remark && <span>· {si.remark}</span>}
                          </div>
                        </div>
                        <HistoryRowControls
                          idx={idx}
                          total={serviceInterruptions.length}
                          onMoveUp={() => moveHistoryRow('interruption', idx, -1)}
                          onMoveDown={() => moveHistoryRow('interruption', idx, 1)}
                          onEdit={() => openOverlayForEdit('interruption', idx, si as Record<string, unknown>)}
                          onDelete={() => handleDeleteRow('interruption', idx)}
                        />
                      </div>
                    );
                  })
                )}
              </HistorySectionCard>

              {/* ข้อมูลอายุราชการกรณีพิเศษ (โอนย้าย / บรรจุกลับ / ทวีคูณ) — Collapsible */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenSections((prev) => ({ ...prev, specialService: !prev.specialService }))}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-emerald-700 dark:hover:text-emerald-300 transition text-left"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <i className="fa-solid fa-timeline text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="truncate">ข้อมูลอายุราชการกรณีพิเศษ (โอนย้าย / บรรจุกลับ / ทวีคูณ)</span>
                    {specialServiceFilledCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 shrink-0">
                        กรอกแล้ว {specialServiceFilledCount}
                      </span>
                    )}
                  </span>
                  <i
                    className={`fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform shrink-0 ${
                      openSections.specialService ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {openSections.specialService && (
                  <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/40 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="bma-label">วันบรรจุกลับเข้ารับราชการ (พ.ศ.)</label>
                      <ThaiDatePicker
                        value={c.re_appointment_date}
                        onChange={(iso) => setC({ ...c, re_appointment_date: iso })}
                      />
                    </div>
                    <div>
                      <label className="bma-label">วันรับโอนจากหน่วยงานอื่น (พ.ศ.)</label>
                      <ThaiDatePicker
                        value={c.transfer_in_date}
                        onChange={(iso) => setC({ ...c, transfer_in_date: iso })}
                      />
                    </div>
                    <div>
                      <label className="bma-label">วันอายุราชการเดิม (รับโอนต่อเนื่อง — วัน)</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={c.prior_continuous_service_days}
                        onChange={(e) => setC({ ...c, prior_continuous_service_days: e.target.value })}
                        className="bma-input font-mono"
                      />
                    </div>
                    <div>
                      <label className="bma-label">วันราชการทวีคูณ (วัน)</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={c.double_service_days}
                        onChange={(e) => setC({ ...c, double_service_days: e.target.value })}
                        className="bma-input font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======================== TAB 4: การศึกษา & อบรม (ก.พ. ๗) ======================== */}
          {tab === 'kp7' && (
            <div className="space-y-4">
              {/* 1. ประวัติการศึกษา (ข้อ ๑๑) */}
              <HistorySectionCard
                title="ประวัติการศึกษา (แบบฟอร์ม ก.พ. ๗ ข้อ ๑๑)"
                icon="fa-graduation-cap"
                count={educations.length}
                open={openSections.educations}
                onToggle={() => setOpenSections((prev) => ({ ...prev, educations: !prev.educations }))}
                loadError={timelinesLoadError}
                onRetry={initial ? () => loadTimelinesFor(initial.id, loadSeqRef.current) : undefined}
                onAdd={() => openOverlayForAdd('education')}
                addLabel="เพิ่มวุฒิการศึกษา"
              >
                {educations.length === 0 ? (
                  <p className="text-xs text-slate-400">ยังไม่มีประวัติการศึกษา</p>
                ) : (
                  educations.map((ed, idx) => (
                    <div
                      key={ed._rowKey ?? `edu_${idx}`}
                      className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <div className="min-w-0 text-xs space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <HistoryOrderTags idx={idx} total={educations.length} latestLabel="สูงสุด/ล่าสุด" initialLabel="เริ่มต้น" />
                          <span className="font-bold text-slate-800 dark:text-slate-100">{ed.degree_title}</span>
                          {ed.major_name && <span className="text-emerald-700 dark:text-emerald-400 font-semibold">({ed.major_name})</span>}
                        </div>
                        <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                          <span>{ed.institution_name}</span>
                          {(ed.start_period || ed.end_period) && (
                            <span>· {[ed.start_period, ed.end_period].filter(Boolean).join(' – ')}</span>
                          )}
                        </div>
                      </div>
                      <HistoryRowControls
                        idx={idx}
                        total={educations.length}
                        onMoveUp={() => moveHistoryRow('education', idx, -1)}
                        onMoveDown={() => moveHistoryRow('education', idx, 1)}
                        onEdit={() => openOverlayForEdit('education', idx, ed as Record<string, unknown>)}
                        onDelete={() => handleDeleteRow('education', idx)}
                      />
                    </div>
                  ))
                )}
              </HistorySectionCard>

              {/* 2. ใบอนุญาตประกอบวิชาชีพ (ข้อ ๑๑) */}
              <HistorySectionCard
                title="ใบอนุญาตประกอบวิชาชีพ (แบบฟอร์ม ก.พ. ๗ ข้อ ๑๑)"
                icon="fa-certificate"
                count={licenses.length}
                open={openSections.licenses}
                onToggle={() => setOpenSections((prev) => ({ ...prev, licenses: !prev.licenses }))}
                loadError={timelinesLoadError}
                onRetry={initial ? () => loadTimelinesFor(initial.id, loadSeqRef.current) : undefined}
                onAdd={() => openOverlayForAdd('license')}
                addLabel="เพิ่มใบอนุญาต"
              >
                {licenses.length === 0 ? (
                  <p className="text-xs text-slate-400">ยังไม่มีข้อมูลใบอนุญาตประกอบวิชาชีพ</p>
                ) : (
                  licenses.map((lc, idx) => (
                    <div
                      key={lc._rowKey ?? `lic_${idx}`}
                      className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <div className="min-w-0 text-xs space-y-0.5">
                        <p className="font-bold text-slate-800 dark:text-slate-100">{lc.license_name}</p>
                        <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                          {lc.issuing_agency && <span>หน่วยงาน: {lc.issuing_agency}</span>}
                          {lc.license_number && <span className="font-mono">· เลขที่: {lc.license_number}</span>}
                          {lc.effective_date && <span>· มีผล: {formatThaiDate(lc.effective_date, 'short')}</span>}
                        </div>
                      </div>
                      <HistoryRowControls
                        idx={idx}
                        total={licenses.length}
                        onMoveUp={() => moveHistoryRow('license', idx, -1)}
                        onMoveDown={() => moveHistoryRow('license', idx, 1)}
                        onEdit={() => openOverlayForEdit('license', idx, lc as Record<string, unknown>)}
                        onDelete={() => handleDeleteRow('license', idx)}
                      />
                    </div>
                  ))
                )}
              </HistorySectionCard>

              {/* 3. การฝึกอบรมและดูงาน (ข้อ ๑๒) */}
              <HistorySectionCard
                title="การฝึกอบรมและดูงาน (แบบฟอร์ม ก.พ. ๗ ข้อ ๑๒)"
                icon="fa-chalkboard-user"
                count={trainings.length}
                open={openSections.trainings}
                onToggle={() => setOpenSections((prev) => ({ ...prev, trainings: !prev.trainings }))}
                loadError={timelinesLoadError}
                onRetry={initial ? () => loadTimelinesFor(initial.id, loadSeqRef.current) : undefined}
                onAdd={() => openOverlayForAdd('training')}
                addLabel="เพิ่มหลักสูตรอบรม"
              >
                {trainings.length === 0 ? (
                  <p className="text-xs text-slate-400">ยังไม่มีประวัติการฝึกอบรมและดูงาน</p>
                ) : (
                  trainings.map((tr, idx) => (
                    <div
                      key={tr._rowKey ?? `trn_${idx}`}
                      className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <div className="min-w-0 text-xs space-y-0.5">
                        <p className="font-bold text-slate-800 dark:text-slate-100">{tr.course_name}</p>
                        <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                          {(tr.start_date || tr.end_date) && (
                            <span>
                              {[
                                tr.start_date ? formatThaiDate(tr.start_date, 'short') : '',
                                tr.end_date ? formatThaiDate(tr.end_date, 'short') : '',
                              ]
                                .filter(Boolean)
                                .join(' – ')}
                            </span>
                          )}
                          {tr.organizer_name && <span>· จัดโดย: {tr.organizer_name}</span>}
                        </div>
                      </div>
                      <HistoryRowControls
                        idx={idx}
                        total={trainings.length}
                        onMoveUp={() => moveHistoryRow('training', idx, -1)}
                        onMoveDown={() => moveHistoryRow('training', idx, 1)}
                        onEdit={() => openOverlayForEdit('training', idx, tr as Record<string, unknown>)}
                        onDelete={() => handleDeleteRow('training', idx)}
                      />
                    </div>
                  ))
                )}
              </HistorySectionCard>
            </div>
          )}
        </form>
      </ResponsiveModal>

      {/* Sibling Nested Overlay Card Modal (z-[9995] or z-[9998] when stacked inside ProfileModal) */}
      <PersonnelHistoryOverlayModal
        request={overlayRequest}
        master={master}
        defaultBureauId={a.bureau_id}
        defaultOfficeId={a.office_id}
        totalExistingPositions={positionHistory.length}
        existingOpenEndedPositionCount={existingOpenCountForOverlay}
        existingEvaluations={evaluations}
        zIndexClass={overlayZIndexClass}
        onClose={() => setOverlayRequest(null)}
        onSave={handleOverlaySave}
      />
    </>
  );
}

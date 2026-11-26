import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { DriveImage } from '@/components/common/DriveImage';
import { RoleBadge } from '@/components/common/RoleBadge';
import { PersonnelFormModal, type PersonnelFormTab } from '@/components/admin/PersonnelFormModal';
import { sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import { openKp7PrintTab } from '@/features/kp7-canvas/kp7Navigation';
import { useSettings } from '@/contexts/SettingsContext';
import { useMasterData } from '@/hooks/useMasterData';
import { personnelService } from '@/services/personnelService';
import { supabase } from '@/lib/supabaseClient';
import { maskCid } from '@/lib/cidValidator';
import { formatThaiDate, getRetirementDateInfo } from '@/lib/thaiDate';
import {
  cleanDisplaySegment,
  formatCivilServantPosition,
  formatOrgDisplay,
} from '@/lib/positionFormatter';
import { resolveOrgUnitAncestors } from '@/lib/masterDataSort';
import { QUERY_KEYS } from '@/lib/queryClient';
import type { PersonnelDirectoryItem, PersonnelTimelinesBundle } from '@/types/domain.types';

type ProfileTabId = 'personal' | 'education' | 'career' | 'evaluation' | 'disciplinary' | 'sso';

interface UserAppAccessRow {
  permission_id: string;
  webapp_name: string;
  app_code: string;
  role_name_th: string;
  role_color: string | null;
  is_allowed: boolean;
  expires_at: string | null;
}

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

const PROFILE_TABS: Array<{ id: ProfileTabId; label: string; icon: string; formTab: PersonnelFormTab }> = [
  { id: 'personal', label: 'ส่วนตัว & ครอบครัว', icon: 'fa-user', formTab: 'basic' },
  { id: 'education', label: 'การศึกษา & ใบอนุญาต', icon: 'fa-graduation-cap', formTab: 'kp7' },
  { id: 'career', label: 'ตำแหน่ง & เงินเดือน', icon: 'fa-briefcase', formTab: 'career' },
  { id: 'evaluation', label: 'ประเมินผล & อายุราชการ', icon: 'fa-chart-line', formTab: 'career' },
  { id: 'disciplinary', label: 'วินัย & นิรโทษกรรม', icon: 'fa-scale-balanced', formTab: 'career' },
  { id: 'sso', label: 'บัญชี SSO & สิทธิ์แอป', icon: 'fa-shield-halved', formTab: 'assignment' },
];

export interface PersonnelProfileModalProps {
  open: boolean;
  onClose: () => void;
  personnelId: string | null;
  initialPerson?: PersonnelDirectoryItem | null;
  canEdit?: boolean;
  onUpdated?: () => void;
}

export function PersonnelProfileModal({
  open,
  onClose,
  personnelId,
  initialPerson = null,
  canEdit = true,
  onUpdated,
}: PersonnelProfileModalProps) {
  const { settings } = useSettings();
  const { data: master } = useMasterData();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<ProfileTabId>('personal');
  const [revealCid, setRevealCid] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const resolvedId = personnelId || initialPerson?.id || null;

  const { data: fetchedPerson } = useQuery({
    queryKey: QUERY_KEYS.personnelById(resolvedId || ''),
    queryFn: () => personnelService.getPersonnelById(resolvedId!),
    enabled: Boolean(open && resolvedId),
  });

  const person = fetchedPerson ?? initialPerson ?? null;

  const { data: timelines = EMPTY_TIMELINES, isLoading: loadingTimelines } = useQuery({
    queryKey: QUERY_KEYS.personnelTimelines(resolvedId || ''),
    queryFn: () => personnelService.getPersonnelTimelines(resolvedId!),
    enabled: Boolean(open && resolvedId),
  });

  const { data: appAccessList = [] } = useQuery({
    queryKey: ['personnel-app-access', person?.user_id],
    enabled: Boolean(open && person?.user_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_user_app_access_matrix')
        .select('permission_id, webapp_name, app_code, role_name_th, role_color, is_allowed, expires_at')
        .eq('user_id', person!.user_id!)
        .order('webapp_name');
      if (error) return [];
      return (data ?? []) as UserAppAccessRow[];
    },
  });

  const lookupById = useMemo(
    () => new Map(master.items.map((i) => [i.id, i])),
    [master.items]
  );
  const posTypeById = useMemo(
    () => new Map(master.positionTypes.map((t) => [t.id, t])),
    [master.positionTypes]
  );
  const posById = useMemo(
    () => new Map(master.positions.map((p) => [p.id, p])),
    [master.positions]
  );
  const lvlById = useMemo(
    () => new Map(master.positionLevels.map((l) => [l.id, l])),
    [master.positionLevels]
  );

  if (!open || !person) return null;

  const positionDisplay =
    cleanDisplaySegment(person.position_display) ||
    formatCivilServantPosition(person.position_name, person.position_level_name, person.position_type_name, {
      positionTypeCode: person.position_type_code,
      bureauName: person.bureau_name,
      officeName: person.office_name,
      departmentName: person.department_name,
      divisionName: person.division_name,
      fallbackBureauName: settings.bureau_name,
    });

  const orgDisplay = formatOrgDisplay({
    officeName: person.office_name,
    departmentName: person.department_name,
    divisionName: person.division_name,
  });
  const retirementInfo = getRetirementDateInfo(person.birth_date);
  const photoUrl = sanitizeImageUrl(person.photo_path);
  const sigUrl = sanitizeImageUrl(person.signature_path);
  const activeTabMeta = PROFILE_TABS.find((t) => t.id === activeTab) ?? PROFILE_TABS[0];

  const handleSavedFromEdit = () => {
    if (resolvedId) {
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.personnelById(resolvedId) });
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.personnelTimelines(resolvedId) });
    }
    void qc.invalidateQueries({ queryKey: ['personnel'] });
    void qc.invalidateQueries({ queryKey: ['users'] });
    onUpdated?.();
  };

  return (
    <>
      <ResponsiveModal
        open={open}
        onClose={onClose}
        title={person.full_name}
        subtitle={positionDisplay !== '-' ? positionDisplay : 'ข้อมูลทะเบียนประวัติบุคลากร'}
        icon="fa-id-badge"
        maxWidthClass="max-w-6xl"
        zIndexClass="z-[9990]"
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openKp7PrintTab(person.id)}
                className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 text-xs font-extrabold shadow-xs transition inline-flex items-center gap-1.5"
              >
                <i className="fa-solid fa-print" />
                พิมพ์ประวัติ (ก.พ. ๗)
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="px-4 py-2 rounded-xl bg-[#00744B] hover:bg-[#005C3B] text-white text-xs font-extrabold shadow-xs transition inline-flex items-center gap-1.5"
                >
                  <i className="fa-solid fa-pen-to-square" />
                  แก้ไขข้อมูลบุคลากร
                </button>
              )}
            </div>
            <button type="button" onClick={onClose} className="bma-btn-outline text-xs">
              ปิดหน้าต่าง
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left 4-Column Executive Identity Sidebar */}
          <aside className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs">
              <div className="h-20 bg-gradient-to-r from-[#00351B] via-[#00744B] to-[#00A368]" />
              <div className="px-4 pb-4 -mt-12 text-center space-y-2">
                {photoUrl ? (
                  <DriveImage
                    src={photoUrl}
                    alt={person.full_name}
                    category="image"
                    className="w-24 h-24 rounded-2xl object-cover mx-auto border-4 border-white dark:border-slate-900 shadow-md bg-white"
                    fallback={
                      <div className="w-24 h-24 rounded-2xl mx-auto border-4 border-white dark:border-slate-900 shadow-md bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white flex items-center justify-center text-3xl font-extrabold">
                        {(person.first_name || person.full_name || 'P').slice(0, 2)}
                      </div>
                    }
                  />
                ) : (
                  <div className="w-24 h-24 rounded-2xl mx-auto border-4 border-white dark:border-slate-900 shadow-md bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white flex items-center justify-center text-3xl font-extrabold">
                    {(person.first_name || person.full_name || 'P').slice(0, 2)}
                  </div>
                )}

                <div>
                  <h3 className="font-extrabold text-base text-slate-800 dark:text-white leading-snug">
                    {person.full_name}
                  </h3>
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {positionDisplay}
                  </p>
                  {person.position_number && (
                    <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                      ตำแหน่งเลขที่ {person.position_number}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                  {person.status_name && (
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold text-white"
                      style={{ backgroundColor: person.status_color || '#00744B' }}
                    >
                      {person.status_name}
                    </span>
                  )}
                  {person.has_user_account && person.user_role && <RoleBadge role={person.user_role} />}
                </div>
              </div>

              {/* Quick Facts List */}
              <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">เลขบัตรประชาชน</span>
                  <div className="flex items-center gap-1.5 font-mono font-bold text-slate-700 dark:text-slate-200">
                    <span>{revealCid ? person.cid : maskCid(person.cid)}</span>
                    <button
                      type="button"
                      onClick={() => setRevealCid((v) => !v)}
                      className="text-slate-400 hover:text-emerald-600 transition"
                      title={revealCid ? 'ซ่อนเลขบัตร' : 'แสดงเลขบัตรเต็ม (PDPA)'}
                    >
                      <i className={`fa-solid ${revealCid ? 'fa-eye-slash' : 'fa-eye'}`} />
                    </button>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <span className="text-slate-400 shrink-0">สังกัด</span>
                  <span className="text-right font-semibold text-slate-700 dark:text-slate-200">
                    {orgDisplay.full || cleanDisplaySegment(person.bureau_name) || '-'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">วันเกิด</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {formatThaiDate(person.birth_date, 'short') || '-'}
                  </span>
                </div>

                {retirementInfo && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">ครบเกษียณ</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                      {retirementInfo.retirementDateShort}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">วันบรรจุ</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {formatThaiDate(person.start_service_date, 'short') || '-'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">โทรศัพท์</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {person.phone_number || '-'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">อีเมล</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[180px]">
                    {person.email || '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* Signature Preview Card */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                <span>
                  <i className="fa-solid fa-signature text-emerald-600 mr-1.5" />
                  ลายเซ็นอิเล็กทรอนิกส์
                </span>
                <span className="text-[10px] font-semibold text-slate-400">
                  {sigUrl ? 'พร้อมใช้พิมพ์ ก.พ. ๗' : 'ยังไม่อัปโหลด'}
                </span>
              </div>
              {sigUrl ? (
                <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex items-center justify-center min-h-[72px]">
                  <DriveImage
                    src={sigUrl}
                    alt="ลายเซ็น"
                    category="signature"
                    className="max-h-16 object-contain"
                    fallback={<span className="text-[11px] text-slate-400">ไม่สามารถแสดงลายเซ็นได้</span>}
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-5 text-center text-[11px] text-slate-400">
                  ยังไม่มีไฟล์ลายเซ็นในระบบ
                </div>
              )}
            </div>
          </aside>

          {/* Right 8-Column Tabbed Detail Panels */}
          <section className="lg:col-span-8 space-y-4 min-w-0">
            <div className="flex flex-wrap gap-1.5 pb-2 border-b border-slate-200 dark:border-slate-700">
              {PROFILE_TABS.map((t) => (
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

            {loadingTimelines && activeTab !== 'personal' && activeTab !== 'sso' ? (
              <div className="py-12 text-center text-xs text-slate-400">
                <i className="fa-solid fa-spinner fa-spin mr-1.5" />
                กำลังโหลดข้อมูลประวัติจากฐานข้อมูล...
              </div>
            ) : null}

            {/* TAB 1: ส่วนตัว & ครอบครัว */}
            {activeTab === 'personal' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-people-roof text-[#00744B]" />
                    ข้อมูลครอบครัว (แบบฟอร์ม ก.พ. ๗ ข้อ ๗–๙)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                      <p className="text-[10px] text-slate-400">ชื่อ-สกุล บิดา</p>
                      <p className="font-bold text-slate-800 dark:text-white mt-0.5">
                        {cleanDisplaySegment(person.father_full_name) || '-'}
                      </p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                      <p className="text-[10px] text-slate-400">ชื่อ-สกุล มารดา</p>
                      <p className="font-bold text-slate-800 dark:text-white mt-0.5">
                        {cleanDisplaySegment(person.mother_full_name) || '-'}
                        {cleanDisplaySegment(person.mother_maiden_name) && (
                          <span className="text-slate-500 font-normal ml-1">
                            (สกุลเดิม {cleanDisplaySegment(person.mother_maiden_name)})
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="sm:col-span-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                      <p className="text-[10px] text-slate-400">ชื่อ-สกุล คู่สมรส</p>
                      <p className="font-bold text-slate-800 dark:text-white mt-0.5">
                        {cleanDisplaySegment(person.spouse_full_name) || '-'}
                        {cleanDisplaySegment(person.spouse_maiden_name) && (
                          <span className="text-slate-500 font-normal ml-1">
                            (สกุลเดิม {cleanDisplaySegment(person.spouse_maiden_name)})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-clock-rotate-left text-[#00744B]" />
                    ประวัติการเปลี่ยนชื่อตัว-ชื่อสกุล ({timelines.nameHistory.length})
                  </h4>
                  {timelines.nameHistory.length === 0 ? (
                    <p className="text-xs text-slate-400">ไม่มีประวัติการเปลี่ยนชื่อ-สกุล</p>
                  ) : (
                    <div className="space-y-2">
                      {timelines.nameHistory.map((nh) => (
                        <div
                          key={nh.id}
                          className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs flex flex-wrap justify-between gap-2"
                        >
                          <span className="font-bold text-slate-800 dark:text-white">
                            {[nh.old_prefix, nh.old_first_name, nh.old_last_name].filter(Boolean).join(' ')}
                          </span>
                          <span className="text-slate-500">
                            {formatThaiDate(nh.changed_date, 'short')}
                            {nh.document_ref ? ` · ${nh.document_ref}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: การศึกษา & ใบอนุญาต & อบรม */}
            {activeTab === 'education' && !loadingTimelines && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-graduation-cap text-[#00744B]" />
                    ประวัติการศึกษา ({timelines.educations.length})
                  </h4>
                  {timelines.educations.length === 0 ? (
                    <p className="text-xs text-slate-400">ยังไม่มีข้อมูลประวัติการศึกษา</p>
                  ) : (
                    <div className="space-y-2">
                      {timelines.educations.map((ed) => (
                        <div
                          key={ed.id}
                          className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs space-y-0.5"
                        >
                          <p className="font-bold text-slate-800 dark:text-white">
                            {ed.degree_title}{' '}
                            {ed.major_name && (
                              <span className="text-emerald-700 dark:text-emerald-400">({ed.major_name})</span>
                            )}
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

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-certificate text-[#00744B]" />
                    ใบอนุญาตประกอบวิชาชีพ ({timelines.licenses.length})
                  </h4>
                  {timelines.licenses.length === 0 ? (
                    <p className="text-xs text-slate-400">ยังไม่มีข้อมูลใบอนุญาตประกอบวิชาชีพ</p>
                  ) : (
                    <div className="space-y-2">
                      {timelines.licenses.map((lc) => (
                        <div key={lc.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs">
                          <p className="font-bold text-slate-800 dark:text-white">{lc.license_name}</p>
                          <p className="text-slate-500 mt-0.5">
                            {[
                              lc.issuing_agency,
                              lc.license_number ? `เลขที่ ${lc.license_number}` : '',
                              lc.effective_date ? `มีผล ${formatThaiDate(lc.effective_date, 'short')}` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ') || '-'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-chalkboard-user text-[#00744B]" />
                    การฝึกอบรมและดูงาน ({timelines.trainings.length})
                  </h4>
                  {timelines.trainings.length === 0 ? (
                    <p className="text-xs text-slate-400">ยังไม่มีข้อมูลการฝึกอบรมและดูงาน</p>
                  ) : (
                    <div className="space-y-2">
                      {timelines.trainings.map((tr) => (
                        <div key={tr.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs">
                          <p className="font-bold text-slate-800 dark:text-white">{tr.course_name}</p>
                          <p className="text-slate-500 mt-0.5">
                            {[
                              [
                                tr.start_date ? formatThaiDate(tr.start_date, 'short') : '',
                                tr.end_date ? formatThaiDate(tr.end_date, 'short') : '',
                              ]
                                .filter(Boolean)
                                .join(' – '),
                              tr.organizer_name,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '-'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: ตำแหน่ง & เงินเดือน */}
            {activeTab === 'career' && !loadingTimelines && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800">
                    <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold">เงินเดือนปัจจุบัน</p>
                    <p className="text-base font-black text-emerald-800 dark:text-emerald-200 font-mono mt-0.5">
                      {person.current_salary != null ? `${Number(person.current_salary).toLocaleString()} บาท` : '-'}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <p className="text-[10px] text-slate-400 font-bold">เงินประจำตำแหน่ง</p>
                    <p className="text-base font-black text-slate-800 dark:text-white font-mono mt-0.5">
                      {Number(person.position_allowance ?? 0) > 0
                        ? `${Number(person.position_allowance).toLocaleString()} บาท`
                        : '-'}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <p className="text-[10px] text-slate-400 font-bold">ตำแหน่งแรกบรรจุ</p>
                    <p className="text-xs font-bold text-slate-800 dark:text-white mt-1 truncate">
                      {cleanDisplaySegment(person.initial_position) || '-'}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-briefcase text-[#00744B]" />
                    ประวัติการดำรงตำแหน่ง ({timelines.positionHistory.length})
                  </h4>
                  {timelines.positionHistory.length === 0 ? (
                    <p className="text-xs text-slate-400">ยังไม่มีประวัติการดำรงตำแหน่ง</p>
                  ) : (
                    <div className="space-y-2">
                      {timelines.positionHistory.map((ph) => {
                        const pt = ph.position_type_id ? posTypeById.get(ph.position_type_id) : undefined;
                        const pos = ph.position_id ? posById.get(ph.position_id) : undefined;
                        const lvl = ph.position_level_id ? lvlById.get(ph.position_level_id) : undefined;
                        const anc = resolveOrgUnitAncestors(ph.org_unit_id, master.orgUnits);
                        const title = formatCivilServantPosition(
                          pos?.name_th || ph.position_title_snapshot,
                          lvl?.name_th,
                          pt?.name_th,
                          {
                            positionTypeCode: pt?.code,
                            bureauName: anc.bureauName,
                            officeName: anc.officeName,
                            departmentName: anc.departmentName,
                            divisionName: anc.divisionName,
                          }
                        );
                        return (
                          <div key={ph.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {ph.is_latest && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-700">
                                  ตำแหน่งล่าสุด
                                </span>
                              )}
                              {ph.is_initial && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-sky-100 text-sky-700">
                                  ตำแหน่งแรกบรรจุ
                                </span>
                              )}
                              <span className="font-bold text-slate-800 dark:text-white">{title}</span>
                              {ph.position_number && (
                                <span className="font-mono text-[11px] text-slate-400">#{ph.position_number}</span>
                              )}
                            </div>
                            <p className="text-slate-500">
                              {formatThaiDate(ph.effective_date, 'short')} –{' '}
                              {ph.end_date ? formatThaiDate(ph.end_date, 'short') : 'ปัจจุบัน'}
                              {ph.base_salary !== null && ph.base_salary !== undefined
                                ? ` · เงินเดือน ${Number(ph.base_salary).toLocaleString()} บาท`
                                : ''}
                              {Number(ph.position_allowance ?? 0) > 0
                                ? ` (+ประจำตำแหน่ง ${Number(ph.position_allowance).toLocaleString()})`
                                : ''}
                              {ph.order_reference ? ` · ${ph.order_reference}` : ''}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-money-bill-trend-up text-[#00744B]" />
                    ประวัติเงินเดือน ({timelines.salaryHistory.length})
                  </h4>
                  {timelines.salaryHistory.length === 0 ? (
                    <p className="text-xs text-slate-400">ยังไม่มีประวัติการเลื่อนเงินเดือน</p>
                  ) : (
                    <div className="space-y-2">
                      {timelines.salaryHistory.map((sh) => (
                        <div
                          key={sh.id}
                          className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs flex flex-wrap items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-mono font-extrabold text-emerald-700 dark:text-emerald-400">
                              {Number(sh.base_salary).toLocaleString()} บาท
                            </span>
                            {Number(sh.position_allowance ?? 0) > 0 && (
                              <span className="text-slate-500 ml-1.5">
                                (+ประจำตำแหน่ง {Number(sh.position_allowance).toLocaleString()})
                              </span>
                            )}
                          </div>
                          <span className="text-slate-500">
                            {formatThaiDate(sh.effective_date, 'short')}
                            {sh.order_reference ? ` · ${sh.order_reference}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: ประเมินผล & อายุราชการ */}
            {activeTab === 'evaluation' && !loadingTimelines && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-chart-simple text-[#00744B]" />
                    ผลการประเมินการปฏิบัติราชการ ({timelines.evaluations.length})
                  </h4>
                  {timelines.evaluations.length === 0 ? (
                    <p className="text-xs text-slate-400">ยังไม่มีข้อมูลผลการประเมิน</p>
                  ) : (
                    <div className="space-y-2">
                      {timelines.evaluations.map((ev) => {
                        const grade = lookupById.get(ev.eval_grade_id);
                        return (
                          <div
                            key={ev.id}
                            className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs flex flex-wrap justify-between gap-2"
                          >
                            <span className="font-bold text-slate-800 dark:text-white">
                              ปีงบฯ {ev.fiscal_year_be} รอบที่ {ev.eval_round}
                            </span>
                            <div className="flex items-center gap-2">
                              {ev.score_percent != null && (
                                <span className="font-mono text-slate-500">{ev.score_percent}%</span>
                              )}
                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                {grade?.name_th || '-'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-calendar-xmark text-[#00744B]" />
                    เหตุการณ์กระทบอายุราชการต่อเนื่อง ({timelines.serviceInterruptions.length})
                  </h4>
                  {timelines.serviceInterruptions.length === 0 ? (
                    <p className="text-xs text-slate-400">ไม่มีเหตุการณ์ที่กระทบการนับอายุราชการ</p>
                  ) : (
                    <div className="space-y-2">
                      {timelines.serviceInterruptions.map((si) => {
                        const it = lookupById.get(si.interruption_type_id);
                        return (
                          <div
                            key={si.id}
                            className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs flex flex-wrap justify-between gap-2"
                          >
                            <span className="font-bold text-slate-800 dark:text-white">{it?.name_th || '-'}</span>
                            <span className="text-amber-700 dark:text-amber-300 font-mono font-bold">
                              หัก {si.deductible_days} วัน ({formatThaiDate(si.start_date, 'short')})
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 5: วินัย & นิรโทษกรรม */}
            {activeTab === 'disciplinary' && !loadingTimelines && (
              <div className="space-y-4">
                <div
                  className={`rounded-2xl p-4 border text-xs flex items-center gap-3 ${
                    person.disciplinary_flag
                      ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                      : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  }`}
                >
                  <i
                    className={`fa-solid ${
                      person.disciplinary_flag ? 'fa-triangle-exclamation text-rose-600' : 'fa-circle-check text-emerald-600'
                    } text-lg`}
                  />
                  <div>
                    <p className="font-extrabold">
                      {person.disciplinary_flag
                        ? 'มีประวัติ/คดีทางวินัยที่อยู่ระหว่างดำเนินการหรือมีผลกระทบคุณสมบัติ'
                        : 'ไม่พบประวัติโทษทางวินัยที่มีผลกระทบคุณสมบัติ'}
                    </p>
                    {person.disciplinary_note && <p className="mt-0.5">{person.disciplinary_note}</p>}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                    รายการประวัติทางวินัยและนิรโทษกรรม ({timelines.disciplinaryRecords.length})
                  </h4>
                  {timelines.disciplinaryRecords.length === 0 ? (
                    <p className="text-xs text-slate-400">ไม่มีรายการประวัติทางวินัย</p>
                  ) : (
                    <div className="space-y-2">
                      {timelines.disciplinaryRecords.map((dr) => {
                        const rType = lookupById.get(dr.record_type_id);
                        const penalty = dr.penalty_level_id ? lookupById.get(dr.penalty_level_id) : undefined;
                        const status = lookupById.get(dr.case_status_id);
                        return (
                          <div key={dr.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-bold text-slate-800 dark:text-white">{rType?.name_th || '-'}</span>
                              {penalty && (
                                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold">
                                  {penalty.name_th}
                                </span>
                              )}
                              {status && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                                  {status.name_th}
                                </span>
                              )}
                            </div>
                            <p className="text-slate-500">
                              มีผล: {formatThaiDate(dr.effective_date, 'short')}
                              {dr.resolved_date ? ` · ยุติ: ${formatThaiDate(dr.resolved_date, 'short')}` : ''}
                              {dr.document_ref ? ` · เอกสารอ้างอิง: ${dr.document_ref}` : ''}
                            </p>
                            {dr.remark && <p className="text-slate-600 dark:text-slate-300">{dr.remark}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 6: บัญชี SSO & สิทธิ์แอป */}
            {activeTab === 'sso' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5 text-xs">
                  <h4 className="font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-user-shield text-[#00744B]" />
                    สถานะบัญชี Portal SSO
                  </h4>
                  {person.has_user_account ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <RoleBadge role={person.user_role} />
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          person.user_status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {person.user_status === 'ACTIVE' ? 'เปิดใช้งาน' : person.user_status}
                      </span>
                    </div>
                  ) : (
                    <p className="text-slate-400">บุคลากรรายนี้ยังไม่มีบัญชีผู้ใช้งานในระบบ Portal SSO</p>
                  )}
                </div>

                {person.has_user_account && (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5 text-xs">
                    <h4 className="font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                      <i className="fa-solid fa-window-restore text-[#00744B]" />
                      สิทธิ์เข้าถึงเว็บแอปย่อย ({appAccessList.length})
                    </h4>
                    {appAccessList.length === 0 ? (
                      <p className="text-slate-400">ยังไม่ได้รับมอบหมายสิทธิ์เข้าใช้งานเว็บแอปย่อยใดๆ</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {appAccessList.map((app) => (
                          <div
                            key={app.permission_id}
                            className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-slate-800 dark:text-white truncate">{app.webapp_name}</p>
                              <p className="text-[10px] font-mono text-slate-400">{app.app_code}</p>
                            </div>
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-extrabold text-white shrink-0"
                              style={{ backgroundColor: app.role_color || '#00744B' }}
                            >
                              {app.role_name_th}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </ResponsiveModal>

      {/* Stacked Edit Form Modal (z-[9995], whose own overlay sits at z-[9998]) */}
      {canEdit && (
        <PersonnelFormModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          initial={person}
          initialTab={activeTabMeta.formTab}
          zIndexClass="z-[9995]"
          onSaved={handleSavedFromEdit}
        />
      )}
    </>
  );
}

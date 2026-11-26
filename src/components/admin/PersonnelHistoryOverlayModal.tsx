import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { ThaiDatePicker, focusInvalidThaiDateInput } from '@/components/common/ThaiDatePicker';
import { useSettings } from '@/contexts/SettingsContext';
import { getCurrentYearBeBangkok } from '@/lib/thaiDate';
import {
  compareLookupItems,
  compareOrgUnits,
  comparePositionLevels,
  comparePositions,
  comparePositionTypes,
  flattenOrgUnitsInTreeOrder,
  resolveOrgUnitAncestors,
} from '@/lib/masterDataSort';
import { formatCivilServantPosition } from '@/lib/positionFormatter';
import { getExecutiveOnlyPositions } from '@/lib/personnelHistorySync';
import { useUiStore } from '@/stores/useUiStore';
import type { MasterDataBundle } from '@/types/domain.types';
import type {
  ExecutiveDutyType,
  PersonnelDisciplinaryRecordRow,
  PersonnelEducationRow,
  PersonnelEvaluationRow,
  PersonnelExecutiveDutyRow,
  PersonnelLicenseRow,
  PersonnelNameHistoryRow,
  PersonnelPositionHistoryRow,
  PersonnelTrainingRow,
} from '@/types/database.types';

export type HistoryOverlayDomain =
  | 'name'
  | 'position'
  | 'executiveDuty'
  | 'salary'
  | 'evaluation'
  | 'disciplinary'
  | 'interruption'
  | 'education'
  | 'license'
  | 'training';

export interface HistoryOverlayRequest {
  domain: HistoryOverlayDomain;
  editIndex: number | null;
  initialData: Record<string, unknown>;
}

export interface PersonnelHistoryOverlayModalProps {
  request: HistoryOverlayRequest | null;
  master: MasterDataBundle;
  defaultBureauId?: string;
  defaultOfficeId?: string;
  totalExistingPositions?: number;
  existingOpenEndedPositionCount?: number;
  existingEvaluations?: Array<Partial<PersonnelEvaluationRow>>;
  zIndexClass?: string;
  onClose: () => void;
  onSave: (
    domain: HistoryOverlayDomain,
    editIndex: number | null,
    record: Record<string, unknown>,
    options?: { autoCloseOtherOpenPositions?: boolean; makeLatest?: boolean; makeInitial?: boolean }
  ) => void;
}

const DOMAIN_META: Record<
  HistoryOverlayDomain,
  { titleAdd: string; titleEdit: string; subtitle: string; icon: string }
> = {
  name: {
    titleAdd: 'เพิ่มประวัติการเปลี่ยนชื่อ-สกุล',
    titleEdit: 'แก้ไขประวัติการเปลี่ยนชื่อ-สกุล',
    subtitle: 'บันทึกชื่อ-สกุลเดิมและเอกสารอ้างอิง (สำหรับตรวจราชกิจจานุเบกษา)',
    icon: 'fa-clock-rotate-left',
  },
  position: {
    titleAdd: 'เพิ่มประวัติการดำรงตำแหน่ง',
    titleEdit: 'แก้ไขประวัติการดำรงตำแหน่ง',
    subtitle: 'เว้นว่างวันสิ้นสุดเพื่อระบุเป็นตำแหน่งปัจจุบัน (ระบบจะปรับตำแหน่งในแท็บ 2 ให้อัตโนมัติ)',
    icon: 'fa-briefcase',
  },
  executiveDuty: {
    titleAdd: 'เพิ่มปฏิบัติราชการแทน / รักษาการในตำแหน่ง',
    titleEdit: 'แก้ไขปฏิบัติราชการแทน / รักษาการในตำแหน่ง',
    subtitle: 'เลือกตำแหน่งประเภทบริหารและหน่วยงานที่รับผิดชอบ (รองรับหลายตำแหน่งต่อบุคคล)',
    icon: 'fa-user-tie',
  },
  salary: {
    titleAdd: 'เพิ่มประวัติเงินเดือนและเงินประจำตำแหน่ง',
    titleEdit: 'แก้ไขประวัติเงินเดือนและเงินประจำตำแหน่ง',
    subtitle: 'ระบบจะอัปเดตเงินเดือนปัจจุบันและเงินประจำตำแหน่งจากรายการที่มีผลล่าสุดอัตโนมัติ',
    icon: 'fa-money-bill-trend-up',
  },
  evaluation: {
    titleAdd: 'เพิ่มประวัติผลการประเมินการปฏิบัติราชการ',
    titleEdit: 'แก้ไขประวัติผลการประเมินการปฏิบัติราชการ',
    subtitle: 'บันทึกผลประเมินรายรอบปีงบประมาณ พ.ศ. (ห้ามซ้ำปีงบฯ และรอบเดียวกัน)',
    icon: 'fa-chart-simple',
  },
  disciplinary: {
    titleAdd: 'เพิ่มประวัติทางวินัย คดีอาญา และการชี้มูล',
    titleEdit: 'แก้ไขประวัติทางวินัย คดีอาญา และการชี้มูล',
    subtitle: 'ระบบจะอัปเดตสถานะทางวินัย (Qualification Gate) โดยอัตโนมัติจากสถานะคดี',
    icon: 'fa-scale-balanced',
  },
  interruption: {
    titleAdd: 'เพิ่มเหตุการณ์กระทบการนับอายุราชการต่อเนื่อง',
    titleEdit: 'แก้ไขเหตุการณ์กระทบการนับอายุราชการต่อเนื่อง',
    subtitle: 'เช่น ลาศึกษาต่อ ลาไม่รับเงินเดือน สั่งพักราชการ หรือขาดราชการ',
    icon: 'fa-calendar-xmark',
  },
  education: {
    titleAdd: 'เพิ่มประวัติการศึกษา (ก.พ. ๗ ข้อ ๑๐)',
    titleEdit: 'แก้ไขประวัติการศึกษา (ก.พ. ๗ ข้อ ๑๐)',
    subtitle: 'บันทึกสถานศึกษา ช่วงเดือน ปี พ.ศ. วุฒิการศึกษา และสาขาวิชาเอก',
    icon: 'fa-graduation-cap',
  },
  license: {
    titleAdd: 'เพิ่มใบอนุญาตประกอบวิชาชีพ (ก.พ. ๗ ข้อ ๑๑)',
    titleEdit: 'แก้ไขใบอนุญาตประกอบวิชาชีพ (ก.พ. ๗ ข้อ ๑๑)',
    subtitle: 'บันทึกชื่อใบอนุญาต หน่วยงานที่ออก เลขที่ และวันที่มีผล',
    icon: 'fa-certificate',
  },
  training: {
    titleAdd: 'เพิ่มประวัติการฝึกอบรมและดูงาน (ก.พ. ๗ ข้อ ๑๒)',
    titleEdit: 'แก้ไขประวัติการฝึกอบรมและดูงาน (ก.พ. ๗ ข้อ ๑๒)',
    subtitle: 'บันทึกหลักสูตร ระยะเวลาฝึกอบรม และหน่วยงานที่จัด',
    icon: 'fa-chalkboard-user',
  },
};

export function PersonnelHistoryOverlayModal({
  request,
  master,
  defaultBureauId = '',
  defaultOfficeId = '',
  totalExistingPositions = 0,
  existingOpenEndedPositionCount = 0,
  existingEvaluations = [],
  zIndexClass = 'z-[9995]',
  onClose,
  onSave,
}: PersonnelHistoryOverlayModalProps) {
  const { settings } = useSettings();
  const showToast = useUiStore((s) => s.showToast);
  const formRef = useRef<HTMLFormElement | null>(null);
  const currentYearBe = useMemo(() => getCurrentYearBeBangkok(), []);

  const prefixItems = useMemo(
    () => (master.itemsByCategoryCode['PREFIX'] ?? []).filter((i) => i.is_active).sort(compareLookupItems),
    [master.itemsByCategoryCode]
  );

  // Draft state per domain
  const [nameDraft, setNameDraft] = useState<Partial<PersonnelNameHistoryRow>>({});
  const [posDraft, setPosDraft] = useState<Partial<PersonnelPositionHistoryRow>>({});
  const [posSalaryInput, setPosSalaryInput] = useState('');
  const [posHasAllowance, setPosHasAllowance] = useState(false);
  const [posAllowanceInput, setPosAllowanceInput] = useState('');
  const [autoClosePrevious, setAutoClosePrevious] = useState(true);
  const [execDraft, setExecDraft] = useState<Partial<PersonnelExecutiveDutyRow>>({});
  const [salDraft, setSalDraft] = useState<{
    base_salary: string;
    effective_date: string;
    has_position_allowance: boolean;
    position_allowance: string;
    is_max_step: boolean;
    order_reference: string;
  }>({
    base_salary: '',
    effective_date: '',
    has_position_allowance: false,
    position_allowance: '0',
    is_max_step: false,
    order_reference: '',
  });
  const [evalDraft, setEvalDraft] = useState<{
    fiscal_year_be: string;
    eval_round: 1 | 2;
    eval_grade_id: string;
    score_percent: string;
    note: string;
  }>({
    fiscal_year_be: String(currentYearBe),
    eval_round: 1,
    eval_grade_id: '',
    score_percent: '',
    note: '',
  });
  const [discDraft, setDiscDraft] = useState<Partial<PersonnelDisciplinaryRecordRow>>({});
  const [interDraft, setInterDraft] = useState<{
    interruption_type_id: string;
    start_date: string;
    end_date: string;
    deductible_days: string;
    remark: string;
  }>({
    interruption_type_id: '',
    start_date: '',
    end_date: '',
    deductible_days: '0',
    remark: '',
  });
  const [eduDraft, setEduDraft] = useState<Partial<PersonnelEducationRow>>({});
  const [licDraft, setLicDraft] = useState<Partial<PersonnelLicenseRow>>({});
  const [trainDraft, setTrainDraft] = useState<Partial<PersonnelTrainingRow>>({});

  useEffect(() => {
    if (!request) return;
    const d = request.initialData || {};
    if (request.domain === 'name') {
      const rawOldPrefix = String((d.old_prefix as string) || '').trim();
      const matchedPrefix =
        prefixItems.find((p) => p.id === (d.old_prefix_id as string)) ||
        (rawOldPrefix ? prefixItems.find((p) => p.name_th === rawOldPrefix) : undefined);
      setNameDraft({
        old_prefix_id: matchedPrefix?.id || '',
        old_prefix: rawOldPrefix,
        old_first_name: (d.old_first_name as string) || '',
        old_last_name: (d.old_last_name as string) || '',
        changed_date: (d.changed_date as string) || '',
        document_ref: (d.document_ref as string) || '',
      });
    } else if (request.domain === 'position') {
      const isOnlyRow = request.editIndex === null ? totalExistingPositions === 0 : totalExistingPositions <= 1;
      const initBaseSalary =
        d.base_salary !== undefined && d.base_salary !== null && String(d.base_salary).trim() !== ''
          ? String(d.base_salary)
          : '';
      const initAllowNum = Number(d.position_allowance ?? 0);
      setPosDraft({
        position_type_id: (d.position_type_id as string) || '',
        position_id: (d.position_id as string) || '',
        position_level_id: (d.position_level_id as string) || '',
        position_number: (d.position_number as string) || '',
        position_title_snapshot: (d.position_title_snapshot as string) || '',
        org_unit_id: (d.org_unit_id as string) || '',
        effective_date: (d.effective_date as string) || '',
        end_date: (d.end_date as string) || '',
        order_reference: (d.order_reference as string) || '',
        is_latest: isOnlyRow ? true : Boolean(d.is_latest),
        is_initial: isOnlyRow ? true : Boolean(d.is_initial),
      });
      setPosSalaryInput(initBaseSalary);
      setPosHasAllowance(initAllowNum > 0);
      setPosAllowanceInput(initAllowNum > 0 ? String(initAllowNum) : '');
      setAutoClosePrevious(true);
    } else if (request.domain === 'executiveDuty') {
      const initOffice = (d.office_id as string) || (request.editIndex === null ? defaultOfficeId : '');
      const officeUnit = master.orgUnits.find((u) => u.id === initOffice);
      const activeBureausList = master.orgUnits.filter((u) => u.is_active && u.level_no === 1).sort(compareOrgUnits);
      const singleBureau = activeBureausList.length === 1 ? activeBureausList[0].id : '';
      const initBureau =
        (d.bureau_id as string) ||
        officeUnit?.parent_id ||
        (request.editIndex === null ? defaultBureauId || singleBureau : '');
      setExecDraft({
        duty_type: ((d.duty_type as ExecutiveDutyType) || 'DEPUTIZING'),
        position_type_id: (d.position_type_id as string) || '',
        position_id: (d.position_id as string) || '',
        position_level_id: (d.position_level_id as string) || '',
        bureau_id: initBureau,
        office_id: initOffice,
        department_id: (d.department_id as string) || '',
        division_id: (d.division_id as string) || '',
        effective_date: (d.effective_date as string) || '',
        end_date: (d.end_date as string) || '',
        order_reference: (d.order_reference as string) || '',
      });
    } else if (request.domain === 'salary') {
      const posAllowNum = Number(d.position_allowance ?? 0);
      setSalDraft({
        base_salary: d.base_salary !== undefined && d.base_salary !== null && String(d.base_salary) !== '' ? String(d.base_salary) : '',
        effective_date: (d.effective_date as string) || '',
        has_position_allowance: posAllowNum > 0,
        position_allowance: posAllowNum > 0 ? String(posAllowNum) : '',
        is_max_step: Boolean(d.is_max_step),
        order_reference: (d.order_reference as string) || '',
      });
    } else if (request.domain === 'evaluation') {
      setEvalDraft({
        fiscal_year_be: String(d.fiscal_year_be ?? currentYearBe),
        eval_round: Number(d.eval_round) === 2 ? 2 : 1,
        eval_grade_id: (d.eval_grade_id as string) || '',
        score_percent:
          d.score_percent !== undefined && d.score_percent !== null && String(d.score_percent) !== ''
            ? String(d.score_percent)
            : '',
        note: (d.note as string) || '',
      });
    } else if (request.domain === 'disciplinary') {
      setDiscDraft({
        record_type_id: (d.record_type_id as string) || '',
        penalty_level_id: (d.penalty_level_id as string) || '',
        case_status_id: (d.case_status_id as string) || '',
        effective_date: (d.effective_date as string) || '',
        resolved_date: (d.resolved_date as string) || '',
        document_ref: (d.document_ref as string) || '',
        remark: (d.remark as string) || '',
      });
    } else if (request.domain === 'interruption') {
      setInterDraft({
        interruption_type_id: (d.interruption_type_id as string) || '',
        start_date: (d.start_date as string) || '',
        end_date: (d.end_date as string) || '',
        deductible_days: String(d.deductible_days ?? 0),
        remark: (d.remark as string) || '',
      });
    } else if (request.domain === 'education') {
      setEduDraft({
        institution_name: (d.institution_name as string) || '',
        start_period: (d.start_period as string) || '',
        end_period: (d.end_period as string) || '',
        degree_title: (d.degree_title as string) || '',
        major_name: (d.major_name as string) || '',
      });
    } else if (request.domain === 'license') {
      setLicDraft({
        license_name: (d.license_name as string) || '',
        issuing_agency: (d.issuing_agency as string) || '',
        license_number: (d.license_number as string) || '',
        effective_date: (d.effective_date as string) || '',
      });
    } else if (request.domain === 'training') {
      setTrainDraft({
        course_name: (d.course_name as string) || '',
        start_date: (d.start_date as string) || '',
        end_date: (d.end_date as string) || '',
        organizer_name: (d.organizer_name as string) || '',
      });
    }
  }, [request, currentYearBe, defaultBureauId, defaultOfficeId, master.orgUnits, prefixItems, totalExistingPositions]);

  // Derived master data for Position History 3-step cascade (strictly sorted per System Settings)
  const activePositionTypes = useMemo(
    () => master.positionTypes.filter((t) => t.is_active).sort(comparePositionTypes),
    [master.positionTypes]
  );

  const posFilteredPositions = useMemo(
    () =>
      master.positions
        .filter(
          (pos) => pos.is_active && (!posDraft.position_type_id || pos.position_type_id === posDraft.position_type_id)
        )
        .sort(comparePositions),
    [master.positions, posDraft.position_type_id]
  );

  const posSelectedPosition = useMemo(
    () => master.positions.find((pos) => pos.id === posDraft.position_id) ?? null,
    [master.positions, posDraft.position_id]
  );

  const posAllowedLevels = useMemo(() => {
    const activeLevels = master.positionLevels.filter((l) => l.is_active).sort(comparePositionLevels);
    if (!posDraft.position_id) return activeLevels;
    const ids = new Set(
      master.positionAllowedLevels
        .filter((x) => x.position_id === posDraft.position_id)
        .map((x) => x.position_level_id)
    );
    return ids.size > 0 ? activeLevels.filter((l) => ids.has(l.id)) : activeLevels;
  }, [master.positionAllowedLevels, master.positionLevels, posDraft.position_id]);

  const treeOrderedOrgUnits = useMemo(
    () => flattenOrgUnitsInTreeOrder(master.orgUnits, { activeOnly: true }),
    [master.orgUnits]
  );

  // Derived master data for Executive Duties (strictly EXECUTIVE position type)
  const executivePositions = useMemo(() => getExecutiveOnlyPositions(master), [master]);

  const execSelectedPosition = useMemo(
    () => executivePositions.find((pos) => pos.id === execDraft.position_id) ?? null,
    [executivePositions, execDraft.position_id]
  );

  const execAllowedLevels = useMemo(() => {
    const activeLevels = master.positionLevels.filter((l) => l.is_active).sort(comparePositionLevels);
    if (!execDraft.position_id) return activeLevels;
    const ids = new Set(
      master.positionAllowedLevels
        .filter((x) => x.position_id === execDraft.position_id)
        .map((x) => x.position_level_id)
    );
    return ids.size > 0 ? activeLevels.filter((l) => ids.has(l.id)) : activeLevels;
  }, [master.positionAllowedLevels, master.positionLevels, execDraft.position_id]);

  const activeBureaus = useMemo(
    () => master.orgUnits.filter((u) => u.is_active && u.level_no === 1).sort(compareOrgUnits),
    [master.orgUnits]
  );
  const activeOffices = useMemo(
    () =>
      master.orgUnits
        .filter((u) => u.is_active && u.level_no === 2 && (!execDraft.bureau_id || u.parent_id === execDraft.bureau_id))
        .sort(compareOrgUnits),
    [master.orgUnits, execDraft.bureau_id]
  );
  const execDepts = useMemo(
    () =>
      master.orgUnits
        .filter((u) => u.is_active && u.level_no === 3 && (!execDraft.office_id || u.parent_id === execDraft.office_id))
        .sort(compareOrgUnits),
    [master.orgUnits, execDraft.office_id]
  );
  const execDivs = useMemo(
    () =>
      master.orgUnits
        .filter(
          (u) => u.is_active && u.level_no === 4 && (!execDraft.department_id || u.parent_id === execDraft.department_id)
        )
        .sort(compareOrgUnits),
    [master.orgUnits, execDraft.department_id]
  );

  const posLivePreview = useMemo(() => {
    if (!posSelectedPosition) return '';
    const pt = master.positionTypes.find((t) => t.id === (posDraft.position_type_id || posSelectedPosition.position_type_id));
    const lvl = master.positionLevels.find((l) => l.id === posDraft.position_level_id);
    const anc = resolveOrgUnitAncestors(posDraft.org_unit_id, master.orgUnits);
    return formatCivilServantPosition(posSelectedPosition.name_th, lvl?.name_th, pt?.name_th, {
      positionTypeCode: pt?.code,
      bureauName: anc.bureauName,
      officeName: anc.officeName,
      departmentName: anc.departmentName,
      divisionName: anc.divisionName,
      fallbackBureauName: settings.bureau_name,
    });
  }, [posSelectedPosition, posDraft, master.positionTypes, master.positionLevels, master.orgUnits, settings.bureau_name]);

  const execLivePreview = useMemo(() => {
    if (!execSelectedPosition) return '';
    const pt = master.positionTypes.find((t) => t.id === execSelectedPosition.position_type_id);
    const lvl = master.positionLevels.find((l) => l.id === execDraft.position_level_id);
    const bureau = master.orgUnits.find((u) => u.id === execDraft.bureau_id);
    const office = master.orgUnits.find((u) => u.id === execDraft.office_id);
    const dept = master.orgUnits.find((u) => u.id === execDraft.department_id);
    const div = master.orgUnits.find((u) => u.id === execDraft.division_id);
    return formatCivilServantPosition(execSelectedPosition.name_th, lvl?.name_th, pt?.name_th, {
      positionTypeCode: pt?.code,
      bureauName: bureau?.name_th,
      officeName: office?.name_th,
      departmentName: dept?.name_th,
      divisionName: div?.name_th,
      fallbackBureauName: settings.bureau_name,
    });
  }, [execSelectedPosition, execDraft, master.positionTypes, master.positionLevels, master.orgUnits, settings.bureau_name]);

  const evalGrades = (master.itemsByCategoryCode['EVAL_GRADE'] ?? []).filter((i) => i.is_active).sort(compareLookupItems);
  const discTypes = (master.itemsByCategoryCode['DISCIPLINARY_TYPE'] ?? []).filter((i) => i.is_active).sort(compareLookupItems);
  const discPenalties = (master.itemsByCategoryCode['DISCIPLINARY_PENALTY'] ?? []).filter((i) => i.is_active).sort(compareLookupItems);
  const discStatuses = (master.itemsByCategoryCode['DISCIPLINARY_CASE_STATUS'] ?? []).filter((i) => i.is_active).sort(compareLookupItems);
  const interruptionTypes = (master.itemsByCategoryCode['SERVICE_INTERRUPTION_TYPE'] ?? []).filter((i) => i.is_active).sort(compareLookupItems);

  if (!request) return null;

  const meta = DOMAIN_META[request.domain];
  const isEditing = request.editIndex !== null;
  const hasOpenPositionConflict =
    request.domain === 'position' &&
    !String(posDraft.end_date || '').trim() &&
    existingOpenEndedPositionCount > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const invalidInput = focusInvalidThaiDateInput(formRef.current);
    if (invalidInput) {
      showToast('พบช่องวันที่ (พ.ศ.) ที่ไม่ถูกต้อง กรุณาแก้ไขให้ถูกต้องหรือล้างค่าก่อนบันทึกรายการ', 'error');
      return;
    }

    if (request.domain === 'name') {
      if (!nameDraft.old_first_name?.trim() || !nameDraft.old_last_name?.trim() || !nameDraft.changed_date) {
        showToast('กรุณาระบุชื่อเดิม นามสกุลเดิม และวันที่เปลี่ยน (พ.ศ.) ให้ครบถ้วน', 'error');
        return;
      }
      const pickedPrefix = prefixItems.find((p) => p.id === nameDraft.old_prefix_id);
      onSave('name', request.editIndex, {
        old_prefix_id: pickedPrefix?.id || null,
        old_prefix: pickedPrefix?.name_th || nameDraft.old_prefix?.trim() || null,
        old_first_name: nameDraft.old_first_name.trim(),
        old_last_name: nameDraft.old_last_name.trim(),
        changed_date: nameDraft.changed_date,
        document_ref: nameDraft.document_ref?.trim() || null,
      });
      return;
    }

    if (request.domain === 'position') {
      if (!posDraft.position_type_id || !posDraft.position_id) {
        showToast('กรุณาเลือกประเภทตำแหน่งและตำแหน่งในสายงานตามตั้งค่าระบบ', 'error');
        return;
      }
      if (posSelectedPosition?.requires_level && !posDraft.position_level_id) {
        showToast(`ตำแหน่ง "${posSelectedPosition.name_th}" จำเป็นต้องเลือกระดับตำแหน่ง`, 'warning');
        return;
      }
      if (!posDraft.effective_date) {
        showToast('กรุณาระบุวันที่มีผล (พ.ศ.)', 'error');
        return;
      }
      if (posDraft.end_date && posDraft.end_date < posDraft.effective_date) {
        showToast('วันสิ้นสุดต้องไม่ก่อนวันที่มีผล', 'error');
        return;
      }
      if (hasOpenPositionConflict && !autoClosePrevious) {
        showToast(
          'มีประวัติตำแหน่งปัจจุบันที่เว้นว่างวันสิ้นสุดอยู่แล้ว กรุณาเลือกปิดวันสิ้นสุดรายการเดิมอัตโนมัติ หรือระบุวันสิ้นสุดรายการนี้',
          'warning'
        );
        return;
      }
      let parsedBaseSalary: number | null = null;
      if (posSalaryInput.trim() !== '') {
        const sal = Number(posSalaryInput);
        if (Number.isNaN(sal) || sal < 0) {
          showToast('กรุณาระบุเงินเดือนเป็นตัวเลขที่ไม่ติดลบ', 'error');
          return;
        }
        parsedBaseSalary = sal;
      }
      let parsedAllowance = 0;
      if (posHasAllowance) {
        const alw = Number(posAllowanceInput);
        if (posAllowanceInput.trim() === '' || Number.isNaN(alw) || alw < 0) {
          showToast('กรุณาระบุเงินประจำตำแหน่งเป็นตัวเลขที่ไม่ติดลบ', 'error');
          return;
        }
        parsedAllowance = alw;
      }
      onSave(
        'position',
        request.editIndex,
        {
          position_type_id: posDraft.position_type_id || null,
          position_id: posDraft.position_id || null,
          position_level_id:
            posSelectedPosition && !posSelectedPosition.requires_level ? null : posDraft.position_level_id || null,
          position_number: posDraft.position_number?.trim() || null,
          position_title_snapshot: posSelectedPosition?.name_th || posDraft.position_title_snapshot || null,
          org_unit_id: posDraft.org_unit_id || null,
          effective_date: posDraft.effective_date,
          end_date: posDraft.end_date || null,
          base_salary: parsedBaseSalary,
          position_allowance: parsedAllowance,
          order_reference: posDraft.order_reference?.trim() || null,
          is_latest: Boolean(posDraft.is_latest),
          is_initial: Boolean(posDraft.is_initial),
        },
        {
          autoCloseOtherOpenPositions: hasOpenPositionConflict && autoClosePrevious,
          makeLatest: Boolean(posDraft.is_latest),
          makeInitial: Boolean(posDraft.is_initial),
        }
      );
      return;
    }

    if (request.domain === 'executiveDuty') {
      if (!execDraft.duty_type) {
        showToast('กรุณาเลือกประเภทการปฏิบัติหน้าที่ (ปฏิบัติราชการแทน หรือ รักษาการในตำแหน่ง)', 'error');
        return;
      }
      if (!execDraft.position_id || !execSelectedPosition) {
        showToast('กรุณาเลือกตำแหน่งประเภทบริหาร', 'error');
        return;
      }
      if (execSelectedPosition.requires_level && !execDraft.position_level_id) {
        showToast(`ตำแหน่ง "${execSelectedPosition.name_th}" จำเป็นต้องเลือกระดับตำแหน่ง`, 'warning');
        return;
      }
      if (execDraft.effective_date && execDraft.end_date && execDraft.end_date < execDraft.effective_date) {
        showToast('วันสิ้นสุดต้องไม่ก่อนวันที่มีผล', 'error');
        return;
      }
      const officeUnit = master.orgUnits.find((u) => u.id === execDraft.office_id);
      onSave('executiveDuty', request.editIndex, {
        duty_type: execDraft.duty_type,
        position_type_id: execSelectedPosition.position_type_id,
        position_id: execSelectedPosition.id,
        position_level_id:
          !execSelectedPosition.requires_level ? null : execDraft.position_level_id || null,
        bureau_id: officeUnit?.parent_id || execDraft.bureau_id || null,
        office_id: execDraft.office_id || null,
        department_id: execDraft.department_id || null,
        division_id: execDraft.division_id || null,
        effective_date: execDraft.effective_date || null,
        end_date: execDraft.end_date || null,
        order_reference: execDraft.order_reference?.trim() || null,
      });
      return;
    }

    if (request.domain === 'salary') {
      const base = Number(salDraft.base_salary);
      if (salDraft.base_salary.trim() === '' || Number.isNaN(base) || base < 0) {
        showToast('กรุณาระบุเงินเดือนเป็นตัวเลขที่ไม่ติดลบ', 'error');
        return;
      }
      if (!salDraft.effective_date) {
        showToast('กรุณาระบุวันที่มีผล (พ.ศ.)', 'error');
        return;
      }
      let posAllow = 0;
      if (salDraft.has_position_allowance) {
        posAllow = Number(salDraft.position_allowance);
        if (salDraft.position_allowance.trim() === '' || Number.isNaN(posAllow) || posAllow < 0) {
          showToast('กรุณาระบุเงินประจำตำแหน่งเป็นตัวเลขที่ไม่ติดลบ', 'error');
          return;
        }
      }
      onSave('salary', request.editIndex, {
        base_salary: base,
        position_allowance: posAllow,
        is_max_step: salDraft.is_max_step,
        effective_date: salDraft.effective_date,
        order_reference: salDraft.order_reference.trim() || null,
      });
      return;
    }

    if (request.domain === 'evaluation') {
      const fy = Number(evalDraft.fiscal_year_be);
      if (!Number.isInteger(fy) || fy < 2450 || fy > 2700) {
        showToast('ปีงบประมาณ พ.ศ. ต้องเป็นจำนวนเต็มระหว่าง 2450–2700', 'error');
        return;
      }
      if (!evalDraft.eval_grade_id) {
        showToast('กรุณาเลือกระดับผลการประเมิน', 'error');
        return;
      }
      let score: number | null = null;
      if (evalDraft.score_percent.trim() !== '') {
        const sc = Number(evalDraft.score_percent);
        if (Number.isNaN(sc) || sc < 0 || sc > 100) {
          showToast('คะแนน (%) ต้องอยู่ระหว่าง 0–100', 'error');
          return;
        }
        score = sc;
      }
      const duplicate = existingEvaluations.some(
        (ev, idx) =>
          idx !== request.editIndex &&
          Number(ev.fiscal_year_be) === fy &&
          (Number(ev.eval_round) === 2 ? 2 : 1) === evalDraft.eval_round
      );
      if (duplicate) {
        showToast(`มีข้อมูลผลประเมินปีงบฯ ${fy} รอบที่ ${evalDraft.eval_round} อยู่แล้ว`, 'error');
        return;
      }
      onSave('evaluation', request.editIndex, {
        fiscal_year_be: fy,
        eval_round: evalDraft.eval_round,
        eval_grade_id: evalDraft.eval_grade_id,
        score_percent: score,
        note: evalDraft.note.trim() || null,
      });
      return;
    }

    if (request.domain === 'disciplinary') {
      if (!discDraft.record_type_id || !discDraft.case_status_id || !discDraft.effective_date) {
        showToast('กรุณาระบุประเภทเรื่อง สถานะคดี และวันที่มีผล (พ.ศ.) ให้ครบถ้วน', 'error');
        return;
      }
      if (discDraft.resolved_date && discDraft.resolved_date < discDraft.effective_date) {
        showToast('วันที่ยุติต้องไม่ก่อนวันที่มีผล', 'error');
        return;
      }
      onSave('disciplinary', request.editIndex, {
        record_type_id: discDraft.record_type_id,
        penalty_level_id: discDraft.penalty_level_id || null,
        case_status_id: discDraft.case_status_id,
        effective_date: discDraft.effective_date,
        resolved_date: discDraft.resolved_date || null,
        document_ref: discDraft.document_ref?.trim() || null,
        remark: discDraft.remark?.trim() || null,
      });
      return;
    }

    if (request.domain === 'interruption') {
      if (!interDraft.interruption_type_id || !interDraft.start_date) {
        showToast('กรุณาระบุประเภทเหตุการณ์และวันเริ่มต้น (พ.ศ.) ให้ครบถ้วน', 'error');
        return;
      }
      if (interDraft.end_date && interDraft.end_date < interDraft.start_date) {
        showToast('วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น', 'error');
        return;
      }
      const days = Number(interDraft.deductible_days || '0');
      if (!Number.isInteger(days) || days < 0) {
        showToast('จำนวนวันที่หักต้องเป็นจำนวนเต็มที่ไม่ติดลบ', 'error');
        return;
      }
      onSave('interruption', request.editIndex, {
        interruption_type_id: interDraft.interruption_type_id,
        start_date: interDraft.start_date,
        end_date: interDraft.end_date || null,
        deductible_days: days,
        remark: interDraft.remark.trim() || null,
      });
      return;
    }

    if (request.domain === 'education') {
      if (!eduDraft.institution_name?.trim() || !eduDraft.degree_title?.trim()) {
        showToast('กรุณาระบุสถานศึกษาและวุฒิการศึกษาให้ครบถ้วน', 'error');
        return;
      }
      onSave('education', request.editIndex, {
        institution_name: eduDraft.institution_name.trim(),
        start_period: eduDraft.start_period?.trim() || null,
        end_period: eduDraft.end_period?.trim() || null,
        degree_title: eduDraft.degree_title.trim(),
        major_name: eduDraft.major_name?.trim() || null,
      });
      return;
    }

    if (request.domain === 'license') {
      if (!licDraft.license_name?.trim()) {
        showToast('กรุณาระบุชื่อใบอนุญาตประกอบวิชาชีพ', 'error');
        return;
      }
      onSave('license', request.editIndex, {
        license_name: licDraft.license_name.trim(),
        issuing_agency: licDraft.issuing_agency?.trim() || null,
        license_number: licDraft.license_number?.trim() || null,
        effective_date: licDraft.effective_date || null,
      });
      return;
    }

    if (request.domain === 'training') {
      if (!trainDraft.course_name?.trim()) {
        showToast('กรุณาระบุชื่อหลักสูตรฝึกอบรมหรือดูงาน', 'error');
        return;
      }
      if (trainDraft.start_date && trainDraft.end_date && trainDraft.end_date < trainDraft.start_date) {
        showToast('วันสิ้นสุดการอบรมต้องไม่ก่อนวันเริ่มต้น', 'error');
        return;
      }
      onSave('training', request.editIndex, {
        course_name: trainDraft.course_name.trim(),
        start_date: trainDraft.start_date || null,
        end_date: trainDraft.end_date || null,
        organizer_name: trainDraft.organizer_name?.trim() || null,
      });
    }
  };

  return (
    <ResponsiveModal
      open={Boolean(request)}
      onClose={onClose}
      title={isEditing ? meta.titleEdit : meta.titleAdd}
      subtitle={meta.subtitle}
      icon={meta.icon}
      maxWidthClass="max-w-xl"
      zIndexClass={zIndexClass}
      footer={
        <div className="w-full flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="bma-btn-outline">
            ยกเลิก
          </button>
          <button type="submit" form="personnelHistoryOverlayForm" className="bma-btn-primary">
            <i className="fa-solid fa-check mr-1.5" />
            {isEditing ? 'อัปเดตรายการ' : 'เพิ่มลงรายการ'}
          </button>
        </div>
      }
    >
      <form id="personnelHistoryOverlayForm" ref={formRef} noValidate onSubmit={handleSubmit} className="space-y-3.5">
        {request.domain === 'name' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="bma-label">คำนำหน้าเดิม</label>
              <select
                value={
                  nameDraft.old_prefix_id
                    ? nameDraft.old_prefix_id
                    : nameDraft.old_prefix
                      ? '__LEGACY__'
                      : ''
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__LEGACY__') return;
                  const picked = prefixItems.find((p) => p.id === val);
                  setNameDraft({
                    ...nameDraft,
                    old_prefix_id: picked?.id || '',
                    old_prefix: picked?.name_th || '',
                  });
                }}
                className="bma-input"
              >
                <option value="">เลือกคำนำหน้าเดิม</option>
                {nameDraft.old_prefix && !nameDraft.old_prefix_id && (
                  <option value="__LEGACY__">{nameDraft.old_prefix} (ข้อมูลเดิม)</option>
                )}
                {prefixItems.map((pItem) => (
                  <option key={pItem.id} value={pItem.id}>
                    {pItem.name_th}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="bma-label">วันที่เปลี่ยนชื่อ-สกุล (พ.ศ.) *</label>
              <ThaiDatePicker
                value={nameDraft.changed_date || ''}
                onChange={(iso) => setNameDraft({ ...nameDraft, changed_date: iso })}
              />
            </div>
            <div>
              <label className="bma-label">ชื่อเดิม *</label>
              <input
                type="text"
                value={nameDraft.old_first_name || ''}
                onChange={(e) => setNameDraft({ ...nameDraft, old_first_name: e.target.value })}
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">นามสกุลเดิม *</label>
              <input
                type="text"
                value={nameDraft.old_last_name || ''}
                onChange={(e) => setNameDraft({ ...nameDraft, old_last_name: e.target.value })}
                className="bma-input"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="bma-label">เลขที่เอกสารอ้างอิง (ถ้ามี)</label>
              <input
                type="text"
                value={nameDraft.document_ref || ''}
                onChange={(e) => setNameDraft({ ...nameDraft, document_ref: e.target.value })}
                placeholder="เช่น ช.3 เลขที่ 123/2565"
                className="bma-input"
              />
            </div>
          </div>
        )}

        {request.domain === 'position' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="bma-label">ประเภทตำแหน่ง *</label>
                <select
                  value={posDraft.position_type_id || ''}
                  onChange={(e) =>
                    setPosDraft({
                      ...posDraft,
                      position_type_id: e.target.value,
                      position_id: '',
                      position_level_id: '',
                    })
                  }
                  className="bma-input"
                >
                  <option value="">เลือกประเภทตำแหน่ง</option>
                  {activePositionTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name_th}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="bma-label">ตำแหน่งในสายงาน (ตามตั้งค่าระบบ) *</label>
                <select
                  value={posDraft.position_id || ''}
                  onChange={(e) => {
                    const picked = master.positions.find((x) => x.id === e.target.value);
                    setPosDraft({
                      ...posDraft,
                      position_type_id: picked?.position_type_id || posDraft.position_type_id || '',
                      position_id: e.target.value,
                      position_level_id: '',
                      position_title_snapshot: picked?.name_th || '',
                    });
                  }}
                  className="bma-input"
                >
                  <option value="">เลือกตำแหน่ง</option>
                  {posFilteredPositions.map((pos) => (
                    <option key={pos.id} value={pos.id}>
                      {pos.name_th}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="bma-label">
                  ระดับตำแหน่ง {posSelectedPosition?.requires_level ? '*' : ''}
                </label>
                <select
                  value={posDraft.position_level_id || ''}
                  disabled={Boolean(posSelectedPosition && !posSelectedPosition.requires_level)}
                  onChange={(e) => setPosDraft({ ...posDraft, position_level_id: e.target.value })}
                  className="bma-input"
                >
                  <option value="">
                    {posSelectedPosition && !posSelectedPosition.requires_level
                      ? 'ตำแหน่งนี้ไม่มีระดับ'
                      : 'เลือกระดับตำแหน่ง'}
                  </option>
                  {posAllowedLevels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name_th}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="bma-label">เลขที่ตำแหน่ง</label>
                <input
                  type="text"
                  value={posDraft.position_number || ''}
                  onChange={(e) => setPosDraft({ ...posDraft, position_number: e.target.value })}
                  placeholder="เช่น 1042"
                  className="bma-input font-mono"
                />
              </div>
              <div>
                <label className="bma-label">วันที่มีผล (พ.ศ.) *</label>
                <ThaiDatePicker
                  value={posDraft.effective_date || ''}
                  onChange={(iso) => setPosDraft({ ...posDraft, effective_date: iso })}
                />
              </div>
              <div>
                <label className="bma-label">วันสิ้นสุด (พ.ศ.) — เว้นว่าง = ตำแหน่งปัจจุบัน</label>
                <ThaiDatePicker
                  value={posDraft.end_date || ''}
                  onChange={(iso) => setPosDraft({ ...posDraft, end_date: iso })}
                  placeholder="เว้นว่างหากเป็นตำแหน่งปัจจุบัน"
                />
              </div>
              <div>
                <label className="bma-label">หน่วยงาน ณ ช่วงเวลานั้น (ถ้ามี)</label>
                <select
                  value={posDraft.org_unit_id || ''}
                  onChange={(e) => setPosDraft({ ...posDraft, org_unit_id: e.target.value })}
                  className="bma-input"
                >
                  <option value="">ไม่ระบุ</option>
                  {treeOrderedOrgUnits.map(({ unit: u, depth }) => (
                    <option key={u.id} value={u.id}>
                      {depth > 0 ? `${'\u00A0\u00A0'.repeat(depth)}↳ ` : ''}
                      {u.name_th}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="bma-label">เลขที่คำสั่งแต่งตั้ง / เอกสารอ้างอิง</label>
                <input
                  type="text"
                  value={posDraft.order_reference || ''}
                  onChange={(e) => setPosDraft({ ...posDraft, order_reference: e.target.value })}
                  placeholder="เช่น คำสั่ง กทม. ที่ 456/2568"
                  className="bma-input"
                />
              </div>
              <div>
                <label className="bma-label">เงินเดือน ณ ตำแหน่งนี้ (บาท) — สำหรับ ก.พ. ๗ ข้อ ๑๔</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={posSalaryInput}
                  onChange={(e) => setPosSalaryInput(e.target.value)}
                  placeholder="เช่น 18220"
                  className="bma-input font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={posHasAllowance}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setPosHasAllowance(checked);
                      if (!checked) setPosAllowanceInput('');
                    }}
                  />
                  <span>ได้รับเงินประจำตำแหน่ง</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={!posHasAllowance}
                  value={posHasAllowance ? posAllowanceInput : ''}
                  onChange={(e) => setPosAllowanceInput(e.target.value)}
                  placeholder={posHasAllowance ? 'ระบุจำนวนเงินประจำตำแหน่ง (บาท)' : 'ไม่มีเงินประจำตำแหน่ง (0)'}
                  className={`bma-input font-mono ${!posHasAllowance ? 'opacity-60 bg-slate-100 dark:bg-slate-800/60 cursor-not-allowed' : ''}`}
                />
              </div>
            </div>

            {posLivePreview && posLivePreview !== '-' && (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                <i className="fa-solid fa-eye text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="truncate">
                  ตัวอย่างการแสดงตำแหน่ง: <strong>{posLivePreview}</strong>
                </span>
              </div>
            )}

            {(() => {
              const isOnlyRow =
                request.editIndex === null ? totalExistingPositions === 0 : totalExistingPositions <= 1;
              return (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2">
                  <div className="text-[11px] font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-tags text-emerald-600 dark:text-emerald-400" />
                    <span>ระบุสถานะลำดับตำแหน่ง (ซิงก์อัตโนมัติกับแท็บ 2 และแท็บ 3)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label
                      className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
                        posDraft.is_latest
                          ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                      } ${isOnlyRow ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(posDraft.is_latest)}
                        disabled={isOnlyRow}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setPosDraft({
                            ...posDraft,
                            is_latest: checked,
                            is_initial: checked ? false : Boolean(posDraft.is_initial),
                          });
                        }}
                        className="mt-0.5"
                      />
                      <span>
                        <strong className="block">ตำแหน่งล่าสุด</strong>
                        <span className="text-[10px] opacity-80">ย้ายขึ้นบนสุดและซิงก์ไปแท็บ 2</span>
                      </span>
                    </label>
                    <label
                      className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
                        posDraft.is_initial
                          ? 'border-sky-300 dark:border-sky-700 bg-sky-50/80 dark:bg-sky-950/40 text-sky-900 dark:text-sky-200'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                      } ${isOnlyRow ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(posDraft.is_initial)}
                        disabled={isOnlyRow}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setPosDraft({
                            ...posDraft,
                            is_initial: checked,
                            is_latest: checked ? false : Boolean(posDraft.is_latest),
                          });
                        }}
                        className="mt-0.5"
                      />
                      <span>
                        <strong className="block">ตำแหน่งแรกบรรจุ</strong>
                        <span className="text-[10px] opacity-80">ย้ายลงล่างสุดและซิงก์ไปแท็บ 3</span>
                      </span>
                    </label>
                  </div>
                  {isOnlyRow && (
                    <p className="text-[10px] text-slate-500">
                      รายการแรกจะถูกกำหนดเป็นทั้งตำแหน่งล่าสุดและตำแหน่งแรกบรรจุโดยอัตโนมัติ
                    </p>
                  )}
                </div>
              );
            })()}

            {hasOpenPositionConflict && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <i className="fa-solid fa-triangle-exclamation text-amber-600" />
                  พบประวัติตำแหน่งปัจจุบันเดิมที่เว้นว่างวันสิ้นสุดอยู่แล้ว
                </div>
                <label className="inline-flex items-start gap-2 cursor-pointer font-semibold">
                  <input
                    type="checkbox"
                    checked={autoClosePrevious}
                    onChange={(e) => setAutoClosePrevious(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    ปิดวันสิ้นสุดของตำแหน่งปัจจุบันเดิมให้อัตโนมัติ (กำหนดเป็น 1 วันก่อนวันที่มีผลใหม่) และตั้งรายการนี้เป็นตำแหน่งปัจจุบัน
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        {request.domain === 'executiveDuty' && (
          <div className="space-y-3">
            {executivePositions.length === 0 && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200">
                <i className="fa-solid fa-circle-info mr-1.5" />
                ยังไม่มีตำแหน่งภายใต้ <strong>ประเภทบริหาร (EXECUTIVE)</strong> ในระบบตั้งค่า กรุณาเพิ่มตำแหน่งประเภทบริหารที่เมนู{' '}
                <code>ตั้งค่าระบบ → ตำแหน่ง & สายงาน</code> ก่อน
              </div>
            )}

            <div>
              <label className="bma-label">ประเภทการปฏิบัติหน้าที่ *</label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: 'DEPUTIZING', label: 'ปฏิบัติราชการแทน', icon: 'fa-user-check' },
                    { value: 'ACTING', label: 'รักษาการในตำแหน่ง', icon: 'fa-user-shield' },
                  ] as const
                ).map((opt) => {
                  const active = execDraft.duty_type === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setExecDraft({ ...execDraft, duty_type: opt.value })}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                        active
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                      }`}
                    >
                      <i className={`fa-solid ${opt.icon}`} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="bma-label">ตำแหน่ง (ประเภทบริหารเท่านั้น) *</label>
                <select
                  value={execDraft.position_id || ''}
                  onChange={(e) => {
                    const picked = executivePositions.find((x) => x.id === e.target.value);
                    setExecDraft({
                      ...execDraft,
                      position_type_id: picked?.position_type_id || '',
                      position_id: e.target.value,
                      position_level_id: '',
                    });
                  }}
                  className="bma-input"
                >
                  <option value="">เลือกตำแหน่งประเภทบริหาร</option>
                  {executivePositions.map((pos) => (
                    <option key={pos.id} value={pos.id}>
                      {pos.name_th}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="bma-label">
                  ระดับตำแหน่ง {execSelectedPosition?.requires_level ? '*' : ''}
                </label>
                <select
                  value={execDraft.position_level_id || ''}
                  disabled={Boolean(execSelectedPosition && !execSelectedPosition.requires_level)}
                  onChange={(e) => setExecDraft({ ...execDraft, position_level_id: e.target.value })}
                  className="bma-input"
                >
                  <option value="">
                    {execSelectedPosition && !execSelectedPosition.requires_level
                      ? 'ตำแหน่งนี้ไม่มีระดับ'
                      : 'เลือกระดับตำแหน่ง'}
                  </option>
                  {execAllowedLevels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name_th}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="bma-label">สำนัก</label>
                <select
                  value={execDraft.bureau_id || ''}
                  onChange={(e) =>
                    setExecDraft({
                      ...execDraft,
                      bureau_id: e.target.value,
                      office_id: '',
                      department_id: '',
                      division_id: '',
                    })
                  }
                  className="bma-input"
                >
                  <option value="">เลือกสำนัก</option>
                  {activeBureaus.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name_th}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="bma-label">สำนักงาน/กอง</label>
                <select
                  value={execDraft.office_id || ''}
                  onChange={(e) => {
                    const picked = activeOffices.find((u) => u.id === e.target.value);
                    setExecDraft({
                      ...execDraft,
                      bureau_id: picked?.parent_id || execDraft.bureau_id || '',
                      office_id: e.target.value,
                      department_id: '',
                      division_id: '',
                    });
                  }}
                  className="bma-input"
                >
                  <option value="">ไม่ระบุสำนักงาน/กอง</option>
                  {activeOffices.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name_th}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="bma-label">ส่วน/ฝ่าย</label>
                <select
                  value={execDraft.department_id || ''}
                  onChange={(e) =>
                    setExecDraft({ ...execDraft, department_id: e.target.value, division_id: '' })
                  }
                  className="bma-input"
                >
                  <option value="">ทุกส่วน/ฝ่าย หรือไม่ระบุ</option>
                  {execDepts.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name_th}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="bma-label">กลุ่มงาน</label>
                <select
                  value={execDraft.division_id || ''}
                  onChange={(e) => setExecDraft({ ...execDraft, division_id: e.target.value })}
                  className="bma-input"
                >
                  <option value="">ไม่ระบุกลุ่มงาน</option>
                  {execDivs.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name_th}
                    </option>
                  ))}
                </select>
              </div>

              {execLivePreview && execLivePreview !== '-' && (
                <div className="sm:col-span-2 rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                  <i className="fa-solid fa-eye text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="truncate">
                    ตัวอย่างชื่อตำแหน่ง:{' '}
                    <strong>
                      {execDraft.duty_type === 'ACTING' ? 'รักษาการในตำแหน่ง' : 'ปฏิบัติราชการแทน'} {execLivePreview}
                    </strong>
                  </span>
                </div>
              )}

              <div>
                <label className="bma-label">วันที่มีผล (พ.ศ.)</label>
                <ThaiDatePicker
                  value={execDraft.effective_date || ''}
                  onChange={(iso) => setExecDraft({ ...execDraft, effective_date: iso })}
                />
              </div>
              <div>
                <label className="bma-label">วันสิ้นสุด (พ.ศ.) — เว้นว่าง = ปัจจุบัน</label>
                <ThaiDatePicker
                  value={execDraft.end_date || ''}
                  onChange={(iso) => setExecDraft({ ...execDraft, end_date: iso })}
                  placeholder="เว้นว่างหากยังปฏิบัติหน้าที่อยู่"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="bma-label">เลขที่คำสั่ง (ถ้ามี)</label>
                <input
                  type="text"
                  value={execDraft.order_reference || ''}
                  onChange={(e) => setExecDraft({ ...execDraft, order_reference: e.target.value })}
                  placeholder="เช่น คำสั่งสำนักเทศกิจ ที่ 123/2569"
                  className="bma-input"
                />
              </div>
            </div>
          </div>
        )}

        {request.domain === 'salary' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="bma-label">เงินเดือน (บาท) *</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={salDraft.base_salary}
                  onChange={(e) => setSalDraft({ ...salDraft, base_salary: e.target.value })}
                  placeholder="เช่น 32500"
                  className="bma-input font-mono"
                />
              </div>
              <div>
                <label className="bma-label">วันที่มีผล (พ.ศ.) *</label>
                <ThaiDatePicker
                  value={salDraft.effective_date}
                  onChange={(iso) => setSalDraft({ ...salDraft, effective_date: iso })}
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2.5">
              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={salDraft.has_position_allowance}
                  onChange={(e) =>
                    setSalDraft({
                      ...salDraft,
                      has_position_allowance: e.target.checked,
                      position_allowance: e.target.checked ? salDraft.position_allowance : '',
                    })
                  }
                />
                <span>มีเงินประจำตำแหน่ง (ตัวเลือกเพิ่ม)</span>
              </label>

              {salDraft.has_position_allowance && (
                <div>
                  <label className="bma-label">เงินประจำตำแหน่ง (บาท) *</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={salDraft.position_allowance}
                    onChange={(e) => setSalDraft({ ...salDraft, position_allowance: e.target.value })}
                    placeholder="เช่น 3500, 5600, 10000"
                    className="bma-input font-mono"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <label className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={salDraft.is_max_step}
                  onChange={(e) => setSalDraft({ ...salDraft, is_max_step: e.target.checked })}
                />
                <span>เงินเดือนเต็มขั้นของระดับตำแหน่ง</span>
              </label>
              <div>
                <label className="bma-label">เลขที่คำสั่งเลื่อนขั้น (ถ้ามี)</label>
                <input
                  type="text"
                  value={salDraft.order_reference}
                  onChange={(e) => setSalDraft({ ...salDraft, order_reference: e.target.value })}
                  className="bma-input"
                />
              </div>
            </div>
          </div>
        )}

        {request.domain === 'evaluation' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="bma-label">ปีงบประมาณ พ.ศ. *</label>
              <input
                type="number"
                min={2450}
                max={2700}
                value={evalDraft.fiscal_year_be}
                onChange={(e) => setEvalDraft({ ...evalDraft, fiscal_year_be: e.target.value })}
                className="bma-input font-mono"
              />
            </div>
            <div>
              <label className="bma-label">รอบการประเมิน *</label>
              <select
                value={evalDraft.eval_round}
                onChange={(e) => setEvalDraft({ ...evalDraft, eval_round: Number(e.target.value) === 2 ? 2 : 1 })}
                className="bma-input"
              >
                <option value={1}>รอบที่ 1 (1 ต.ค. – 31 มี.ค.)</option>
                <option value={2}>รอบที่ 2 (1 เม.ย. – 30 ก.ย.)</option>
              </select>
            </div>
            <div>
              <label className="bma-label">ระดับผลการประเมิน *</label>
              <select
                value={evalDraft.eval_grade_id}
                onChange={(e) => setEvalDraft({ ...evalDraft, eval_grade_id: e.target.value })}
                className="bma-input"
              >
                <option value="">เลือกระดับผลประเมิน</option>
                {evalGrades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name_th}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="bma-label">คะแนนร้อยละ (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={evalDraft.score_percent}
                onChange={(e) => setEvalDraft({ ...evalDraft, score_percent: e.target.value })}
                placeholder="0 – 100"
                className="bma-input font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="bma-label">หมายเหตุ</label>
              <input
                type="text"
                value={evalDraft.note}
                onChange={(e) => setEvalDraft({ ...evalDraft, note: e.target.value })}
                className="bma-input"
              />
            </div>
          </div>
        )}

        {request.domain === 'disciplinary' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="bma-label">ประเภทเรื่อง *</label>
              <select
                value={discDraft.record_type_id || ''}
                onChange={(e) => setDiscDraft({ ...discDraft, record_type_id: e.target.value })}
                className="bma-input"
              >
                <option value="">เลือกประเภทเรื่อง</option>
                {discTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name_th}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="bma-label">สถานะคดี *</label>
              <select
                value={discDraft.case_status_id || ''}
                onChange={(e) => setDiscDraft({ ...discDraft, case_status_id: e.target.value })}
                className="bma-input"
              >
                <option value="">เลือกสถานะคดี</option>
                {discStatuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name_th}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="bma-label">ระดับโทษ (ถ้ามี)</label>
              <select
                value={discDraft.penalty_level_id || ''}
                onChange={(e) => setDiscDraft({ ...discDraft, penalty_level_id: e.target.value })}
                className="bma-input"
              >
                <option value="">ไม่ระบุ / ยังไม่ลงโทษ</option>
                {discPenalties.map((pen) => (
                  <option key={pen.id} value={pen.id}>
                    {pen.name_th}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="bma-label">วันที่มีผล / วันตั้งเรื่อง (พ.ศ.) *</label>
              <ThaiDatePicker
                value={discDraft.effective_date || ''}
                onChange={(iso) => setDiscDraft({ ...discDraft, effective_date: iso })}
              />
            </div>
            <div>
              <label className="bma-label">วันที่ยุติเรื่อง (พ.ศ.)</label>
              <ThaiDatePicker
                value={discDraft.resolved_date || ''}
                onChange={(iso) => setDiscDraft({ ...discDraft, resolved_date: iso })}
              />
            </div>
            <div>
              <label className="bma-label">เอกสารอ้างอิง / เลขที่คำสั่ง (ก.พ. ๗ ข้อ ๑๓)</label>
              <input
                type="text"
                value={discDraft.document_ref || ''}
                onChange={(e) => setDiscDraft({ ...discDraft, document_ref: e.target.value })}
                placeholder="เช่น คำสั่ง กทม. ที่ ๑๒๓/๒๕๖๘"
                className="bma-input"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="bma-label">รายละเอียด / หมายเหตุเพิ่มเติม</label>
              <textarea
                rows={2}
                value={discDraft.remark || ''}
                onChange={(e) => setDiscDraft({ ...discDraft, remark: e.target.value })}
                className="bma-input"
              />
            </div>
          </div>
        )}

        {request.domain === 'interruption' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="bma-label">ประเภทเหตุการณ์ *</label>
              <select
                value={interDraft.interruption_type_id}
                onChange={(e) => setInterDraft({ ...interDraft, interruption_type_id: e.target.value })}
                className="bma-input"
              >
                <option value="">เลือกประเภทเหตุการณ์</option>
                {interruptionTypes.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name_th}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="bma-label">วันเริ่มต้น (พ.ศ.) *</label>
              <ThaiDatePicker
                value={interDraft.start_date}
                onChange={(iso) => setInterDraft({ ...interDraft, start_date: iso })}
              />
            </div>
            <div>
              <label className="bma-label">วันสิ้นสุด (พ.ศ.)</label>
              <ThaiDatePicker
                value={interDraft.end_date}
                onChange={(iso) => setInterDraft({ ...interDraft, end_date: iso })}
              />
            </div>
            <div>
              <label className="bma-label">จำนวนวันที่หัก (วัน)</label>
              <input
                type="number"
                min={0}
                step={1}
                value={interDraft.deductible_days}
                onChange={(e) => setInterDraft({ ...interDraft, deductible_days: e.target.value })}
                className="bma-input font-mono"
              />
            </div>
            <div>
              <label className="bma-label">หมายเหตุ</label>
              <input
                type="text"
                value={interDraft.remark}
                onChange={(e) => setInterDraft({ ...interDraft, remark: e.target.value })}
                className="bma-input"
              />
            </div>
          </div>
        )}

        {request.domain === 'education' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="bma-label">สถานศึกษา *</label>
              <input
                type="text"
                value={eduDraft.institution_name || ''}
                onChange={(e) => setEduDraft({ ...eduDraft, institution_name: e.target.value })}
                placeholder="เช่น มหาวิทยาลัยรามคำแหง"
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">ตั้งแต่ (เดือน/ปี พ.ศ.)</label>
              <input
                type="text"
                value={eduDraft.start_period || ''}
                onChange={(e) => setEduDraft({ ...eduDraft, start_period: e.target.value })}
                placeholder="เช่น พ.ค. 2555 หรือ 2555"
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">ถึง (เดือน/ปี พ.ศ.)</label>
              <input
                type="text"
                value={eduDraft.end_period || ''}
                onChange={(e) => setEduDraft({ ...eduDraft, end_period: e.target.value })}
                placeholder="เช่น มี.ค. 2559 หรือ 2559"
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">วุฒิการศึกษาที่ได้รับ *</label>
              <input
                type="text"
                value={eduDraft.degree_title || ''}
                onChange={(e) => setEduDraft({ ...eduDraft, degree_title: e.target.value })}
                placeholder="เช่น รัฐศาสตรบัณฑิต (ร.บ.)"
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">สาขาวิชาเอก</label>
              <input
                type="text"
                value={eduDraft.major_name || ''}
                onChange={(e) => setEduDraft({ ...eduDraft, major_name: e.target.value })}
                placeholder="เช่น บริหารรัฐกิจ"
                className="bma-input"
              />
            </div>
          </div>
        )}

        {request.domain === 'license' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="bma-label">ชื่อใบอนุญาตประกอบวิชาชีพ *</label>
              <input
                type="text"
                value={licDraft.license_name || ''}
                onChange={(e) => setLicDraft({ ...licDraft, license_name: e.target.value })}
                placeholder="เช่น ใบอนุญาตประกอบวิชาชีพวิศวกรรมควบคุม"
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">หน่วยงานที่ออกใบอนุญาต</label>
              <input
                type="text"
                value={licDraft.issuing_agency || ''}
                onChange={(e) => setLicDraft({ ...licDraft, issuing_agency: e.target.value })}
                placeholder="เช่น สภาวิศวกร / สภาทนายความ"
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">เลขที่ใบอนุญาต</label>
              <input
                type="text"
                value={licDraft.license_number || ''}
                onChange={(e) => setLicDraft({ ...licDraft, license_number: e.target.value })}
                className="bma-input font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="bma-label">วันที่มีผล (พ.ศ.)</label>
              <ThaiDatePicker
                value={licDraft.effective_date || ''}
                onChange={(iso) => setLicDraft({ ...licDraft, effective_date: iso })}
              />
            </div>
          </div>
        )}

        {request.domain === 'training' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="bma-label">ชื่อหลักสูตร / โครงการฝึกอบรมและดูงาน *</label>
              <input
                type="text"
                value={trainDraft.course_name || ''}
                onChange={(e) => setTrainDraft({ ...trainDraft, course_name: e.target.value })}
                placeholder="เช่น หลักสูตรนักบริหารมหานครระดับต้น"
                className="bma-input"
              />
            </div>
            <div>
              <label className="bma-label">วันเริ่มต้น (พ.ศ.)</label>
              <ThaiDatePicker
                value={trainDraft.start_date || ''}
                onChange={(iso) => setTrainDraft({ ...trainDraft, start_date: iso })}
              />
            </div>
            <div>
              <label className="bma-label">วันสิ้นสุด (พ.ศ.)</label>
              <ThaiDatePicker
                value={trainDraft.end_date || ''}
                onChange={(iso) => setTrainDraft({ ...trainDraft, end_date: iso })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="bma-label">หน่วยงานที่จัด</label>
              <input
                type="text"
                value={trainDraft.organizer_name || ''}
                onChange={(e) => setTrainDraft({ ...trainDraft, organizer_name: e.target.value })}
                placeholder="เช่น สถาบันพัฒนาข้าราชการกรุงเทพมหานคร"
                className="bma-input"
              />
            </div>
          </div>
        )}
      </form>
    </ResponsiveModal>
  );
}

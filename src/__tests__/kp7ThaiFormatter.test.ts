import { describe, expect, it } from 'vitest';
import {
  buildKp7CareerRows,
  buildKp7Item1NameFields,
  calculateRetirementDateIso,
  expandAndPaginateCareerLines,
  formatCurrencyKp7,
  formatShortPositionType,
  formatThaiDateInWords,
  formatThaiNumberInWords,
  paginateKp7CareerRows,
  splitCid13Slots,
  toThaiDigits,
} from '@/features/kp7-canvas/kp7ThaiFormatter';
import { EMPTY_MASTER_DATA } from '@/services/masterDataService';
import type { PersonnelDirectoryItem, PersonnelTimelinesBundle } from '@/types/domain.types';

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

const SAMPLE_PERSON: PersonnelDirectoryItem = {
  id: 'p-1',
  cid: '1100100123456',
  prefix_id: null,
  prefix_name: 'นาย',
  noble_or_rank_title: null,
  first_name: 'สมชาย',
  last_name: 'ใจดี',
  full_name: 'นายสมชาย ใจดี',
  gender_id: null,
  gender_name: 'ชาย',
  birth_date: '1990-05-21',
  phone_number: '0812345678',
  email: 'somchai@bma.go.th',
  photo_path: null,
  signature_path: null,
  status_id: null,
  status_name: 'ปกติ',
  status_color: '#00744B',
  allows_account_provision: true,
  employment_type_id: null,
  employment_type_name: 'ข้าราชการกรุงเทพมหานครสามัญ',
  position_type_id: null,
  position_type_name: 'ประเภทวิชาการ',
  position_id: null,
  position_name: 'นักวิชาการคอมพิวเตอร์',
  position_level_id: null,
  position_level_name: 'ชำนาญการ',
  position_display: 'นักวิชาการคอมพิวเตอร์ชำนาญการ',
  position_number: '1042',
  secondary_position: null,
  acting_position: null,
  bureau_id: null,
  bureau_name: 'สำนักเทศกิจ',
  office_id: null,
  office_name: 'สำนักงานตรวจและบังคับการ',
  department_id: null,
  department_name: 'ฝ่ายเทคโนโลยี',
  division_id: null,
  division_name: null,
  approval_tier_id: null,
  approval_tier_name: null,
  start_service_date: '2015-10-01',
  start_service_year_be: 2558,
  initial_position: 'นักวิชาการคอมพิวเตอร์ปฏิบัติการ',
  initial_salary: 15000,
  current_salary: 32500,
  disciplinary_flag: false,
  disciplinary_note: null,
  has_user_account: true,
  user_id: 'u-1',
  user_role: 'USER',
  user_status: 'ACTIVE',
};

describe('kp7ThaiFormatter', () => {
  it('converts digits to Thai numerals when enabled and keeps Arabic when disabled', () => {
    expect(toThaiDigits('ก.พ. 7 หน้า 1/2 (2569)', true)).toBe('ก.พ. ๗ หน้า ๑/๒ (๒๕๖๙)');
    expect(toThaiDigits('ก.พ. 7 หน้า 1/2 (2569)', false)).toBe('ก.พ. 7 หน้า 1/2 (2569)');
  });

  it('spells Thai integers accurately including ยี่สิบ and เอ็ด grammar rules', () => {
    expect(formatThaiNumberInWords(1)).toBe('หนึ่ง');
    expect(formatThaiNumberInWords(11)).toBe('สิบเอ็ด');
    expect(formatThaiNumberInWords(20)).toBe('ยี่สิบ');
    expect(formatThaiNumberInWords(21)).toBe('ยี่สิบเอ็ด');
    expect(formatThaiNumberInWords(31)).toBe('สามสิบเอ็ด');
    expect(formatThaiNumberInWords(2533)).toBe('สองพันห้าร้อยสามสิบสาม');
    expect(formatThaiNumberInWords(2569)).toBe('สองพันห้าร้อยหกสิบเก้า');
  });

  it('formats Thai date with official no-space parenthetical Thai word spelling (นร ๑๐๐๖/ว ๒๓ p.6)', () => {
    const res = formatThaiDateInWords('1990-05-21', true);
    expect(res.numericText).toBe('๒๑ พฤษภาคม ๒๕๓๓');
    expect(res.wordsText).toBe('ยี่สิบเอ็ดพฤษภาคมสองพันห้าร้อยสามสิบสาม');

    const resArabic = formatThaiDateInWords('1990-05-21', false);
    expect(resArabic.numericText).toBe('21 พฤษภาคม 2533');
  });

  it('calculates Thai civil servant statutory retirement date across Oct 1 / Oct 2 boundary', () => {
    expect(calculateRetirementDateIso('1966-10-01')).toBe('2026-09-30');
    expect(calculateRetirementDateIso('1966-10-02')).toBe('2027-09-30');
    expect(calculateRetirementDateIso('1990-05-21')).toBe('2050-09-30');
  });

  it('splits CID into 13 individual numeral slots and formats currency', () => {
    const slots = splitCid13Slots('1-1001-00123-45-6', true);
    expect(slots).toHaveLength(13);
    expect(slots.join('')).toBe('๑๑๐๐๑๐๐๑๒๓๔๕๖');
    expect(formatCurrencyKp7(32500, true)).toBe('๓๒,๕๐๐');
  });

  it('formats Item 1 name fields with noble rank and parenthetical old names chronologically', () => {
    const fields = buildKp7Item1NameFields(
      {
        prefix_name: 'นาง',
        noble_or_rank_title: 'ว่าที่ร้อยตรีหญิง',
        first_name: 'สมหญิง',
        last_name: 'ใจดี',
      },
      [
        {
          id: 'nh-2',
          personnel_id: 'p-1',
          old_prefix: 'นางสาว',
          old_first_name: 'สมใจ',
          old_last_name: 'รักเรียน',
          changed_date: '2018-01-10',
          document_ref: null,
          created_at: '2018-01-10T00:00:00Z',
        },
        {
          id: 'nh-1',
          personnel_id: 'p-1',
          old_prefix: 'เด็กหญิง',
          old_first_name: 'สมใจ',
          old_last_name: 'รักเรียน',
          changed_date: '2005-05-01',
          document_ref: null,
          created_at: '2005-05-01T00:00:00Z',
        },
      ],
      true
    );
    expect(fields.prefixDisplay).toBe('ว่าที่ร้อยตรีหญิง นาง (เด็กหญิง, นางสาว)');
    expect(fields.firstNameDisplay).toBe('สมหญิง (สมใจ)');
    expect(fields.lastNameDisplay).toBe('ใจดี (รักเรียน)');
  });

  it('formats short official position type labels for Item 14', () => {
    expect(formatShortPositionType('ประเภททั่วไป', 'GENERAL')).toBe('ทั่วไป');
    expect(formatShortPositionType('ประเภทวิชาการ', 'KNOWLEDGE_WORKER')).toBe('วิชาการ');
    expect(formatShortPositionType('ประเภทอำนวยการ', 'MANAGERIAL')).toBe('อำนวยการ');
    expect(formatShortPositionType('ประเภทบริหาร', 'EXECUTIVE')).toBe('บริหาร');
  });

  it('builds Item 14 STRICTLY from positionHistory ONLY (C6-A) and ignores salaryHistory', () => {
    const timelines: PersonnelTimelinesBundle = {
      ...EMPTY_TIMELINES,
      positionHistory: [
        {
          id: 'ph-2',
          personnel_id: 'p-1',
          position_number: '1042',
          position_type_id: null,
          position_id: null,
          position_level_id: null,
          position_title_snapshot: 'นักวิชาการคอมพิวเตอร์',
          org_unit_id: null,
          effective_date: '2022-10-01',
          end_date: null,
          base_salary: 28000,
          position_allowance: 3500,
          order_reference: 'คำสั่ง 200/2565',
          sort_order: 1,
          created_at: '2022-10-01T00:00:00Z',
        },
        {
          id: 'ph-1',
          personnel_id: 'p-1',
          position_number: '1001',
          position_type_id: null,
          position_id: null,
          position_level_id: null,
          position_title_snapshot: 'นักวิชาการคอมพิวเตอร์',
          org_unit_id: null,
          effective_date: '2015-10-01',
          end_date: '2022-09-30',
          base_salary: 15000,
          position_allowance: 0,
          order_reference: 'คำสั่ง 10/2558',
          sort_order: 2,
          created_at: '2015-10-01T00:00:00Z',
        },
      ],
      salaryHistory: [
        {
          id: 'sh-1',
          personnel_id: 'p-1',
          base_salary: 99999,
          position_allowance: 5600,
          is_max_step: false,
          effective_date: '2024-04-01',
          order_reference: 'คำสั่งเลื่อนเงินเดือน 55/2567',
          created_at: '2024-04-01T00:00:00Z',
        },
      ],
    };

    const rows = buildKp7CareerRows(SAMPLE_PERSON, timelines, EMPTY_MASTER_DATA, true);
    // Strictly 2 rows from positionHistory ONLY — salaryHistory row (2024-04-01) is NOT merged!
    expect(rows).toHaveLength(2);
    expect(rows[0].effectiveDateIso).toBe('2015-10-01');
    expect(rows[0].salaryLabel).toBe('๑๕,๐๐๐');
    expect(rows[0].allowanceLabel).toBe('');
    expect(rows[1].effectiveDateIso).toBe('2022-10-01');
    expect(rows[1].salaryLabel).toBe('๒๘,๐๐๐');
    expect(rows[1].allowanceLabel).toBe('๓,๕๐๐');

    // Empty positionHistory -> returns [] by default (C3-A), or 1 row when allowCurrentPositionFallback = true
    expect(buildKp7CareerRows(SAMPLE_PERSON, EMPTY_TIMELINES, EMPTY_MASTER_DATA, true)).toHaveLength(0);
    const fallbackRows = buildKp7CareerRows(SAMPLE_PERSON, EMPTY_TIMELINES, EMPTY_MASTER_DATA, true, {
      allowCurrentPositionFallback: true,
    });
    expect(fallbackRows).toHaveLength(1);
    expect(fallbackRows[0].positionTypeLabel).toBe('วิชาการ');

    // Overflow pagination check
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...rows[0],
      effectiveDateIso: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
    }));
    const pages = paginateKp7CareerRows(many, 28);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(28);
    expect(pages[1]).toHaveLength(2);

    const visualPages = expandAndPaginateCareerLines(many, 15);
    expect(visualPages).toHaveLength(2);
  });
});

import type { ImportColumnKey } from '@/types/import.types';

export type ImportColumnKind =
  | 'text'
  | 'cid'
  | 'date'
  | 'phone'
  | 'email'
  | 'number'
  | 'year_be'
  | 'boolean'
  | 'lookup'
  | 'position_type'
  | 'position'
  | 'position_level'
  | 'bureau'
  | 'office'
  | 'department'
  | 'division';

export interface ImportColumnDef {
  key: ImportColumnKey;
  excelCol: string;
  labelTh: string;
  group: 'ข้อมูลบุคคล' | 'ตำแหน่งและสายงาน' | 'สังกัดหน่วยงาน' | 'ยานพาหนะ' | 'ประวัติรับราชการ';
  kind: ImportColumnKind;
  required?: boolean;
  lookupCategoryCode?: string;
  width: number;
  frozen?: boolean;
  synonyms: string[];
  example: string;
}

/**
 * 27 Standard Columns (A–AA) for Portal SSO Core HR Import
 */
export const IMPORT_COLUMNS: ImportColumnDef[] = [
  {
    key: 'cid',
    excelCol: 'A',
    labelTh: 'เลขบัตรประชาชน (13 หลัก)',
    group: 'ข้อมูลบุคคล',
    kind: 'cid',
    required: true,
    width: 175,
    frozen: true,
    synonyms: ['เลขบัตรประชาชน', 'เลขประจำตัวประชาชน', 'เลข ปชช', 'บัตรประชาชน', 'cid', 'id_card', 'national_id'],
    example: '1100701234561',
  },
  {
    key: 'prefix_id',
    excelCol: 'B',
    labelTh: 'คำนำหน้า',
    group: 'ข้อมูลบุคคล',
    kind: 'lookup',
    lookupCategoryCode: 'PREFIX',
    width: 115,
    synonyms: ['คำนำหน้า', 'คำนำหน้าชื่อ', 'prefix', 'prefix_id', 'title'],
    example: 'นาย',
  },
  {
    key: 'noble_or_rank_title',
    excelCol: 'C',
    labelTh: 'ยศ/บรรดาศักดิ์',
    group: 'ข้อมูลบุคคล',
    kind: 'text',
    width: 130,
    synonyms: ['ยศ', 'บรรดาศักดิ์', 'ยศ/บรรดาศักดิ์', 'ยศ/ฐานันดรศักดิ์', 'noble_or_rank_title', 'rank'],
    example: '',
  },
  {
    key: 'first_name',
    excelCol: 'D',
    labelTh: 'ชื่อ',
    group: 'ข้อมูลบุคคล',
    kind: 'text',
    required: true,
    width: 150,
    frozen: true,
    synonyms: ['ชื่อ', 'ชื่อจริง', 'first_name', 'firstname', 'fname'],
    example: 'สมชาย',
  },
  {
    key: 'last_name',
    excelCol: 'E',
    labelTh: 'นามสกุล',
    group: 'ข้อมูลบุคคล',
    kind: 'text',
    required: true,
    width: 150,
    frozen: true,
    synonyms: ['นามสกุล', 'ชื่อสกุล', 'สกุล', 'last_name', 'lastname', 'lname', 'surname'],
    example: 'ใจดี',
  },
  {
    key: 'gender_id',
    excelCol: 'F',
    labelTh: 'เพศ',
    group: 'ข้อมูลบุคคล',
    kind: 'lookup',
    lookupCategoryCode: 'GENDER',
    width: 95,
    synonyms: ['เพศ', 'gender', 'gender_id', 'sex'],
    example: 'ชาย',
  },
  {
    key: 'birth_date',
    excelCol: 'G',
    labelTh: 'วันเกิด (วว/ดด/พ.ศ.)',
    group: 'ข้อมูลบุคคล',
    kind: 'date',
    width: 140,
    synonyms: ['วันเกิด', 'วันเดือนปีเกิด', 'วดป เกิด', 'birth_date', 'birthdate', 'dob'],
    example: '15/05/2530',
  },
  {
    key: 'phone_number',
    excelCol: 'H',
    labelTh: 'เบอร์โทรศัพท์',
    group: 'ข้อมูลบุคคล',
    kind: 'phone',
    width: 135,
    synonyms: ['เบอร์โทร', 'เบอร์โทรศัพท์', 'โทรศัพท์', 'มือถือ', 'phone', 'phone_number', 'mobile', 'tel'],
    example: '0812345678',
  },
  {
    key: 'employment_type_id',
    excelCol: 'I',
    labelTh: 'ประเภทบุคลากร',
    group: 'ตำแหน่งและสายงาน',
    kind: 'lookup',
    lookupCategoryCode: 'EMPLOYMENT_TYPE',
    width: 170,
    synonyms: ['ประเภทบุคลากร', 'ประเภทการจ้าง', 'ประเภทพนักงาน', 'employment_type', 'employment_type_id'],
    example: 'ข้าราชการกรุงเทพมหานครสามัญ',
  },
  {
    key: 'position_type_id',
    excelCol: 'J',
    labelTh: 'ประเภทตำแหน่ง',
    group: 'ตำแหน่งและสายงาน',
    kind: 'position_type',
    width: 145,
    synonyms: ['ประเภทตำแหน่ง', 'สายงาน', 'position_type', 'position_type_id'],
    example: 'ประเภทวิชาการ',
  },
  {
    key: 'position_id',
    excelCol: 'K',
    labelTh: 'ตำแหน่ง',
    group: 'ตำแหน่งและสายงาน',
    kind: 'position',
    width: 185,
    synonyms: ['ตำแหน่ง', 'ชื่อตำแหน่ง', 'ตำแหน่งในสายงาน', 'position', 'position_id', 'position_name'],
    example: 'นักวิชาการคอมพิวเตอร์',
  },
  {
    key: 'position_level_id',
    excelCol: 'L',
    labelTh: 'ระดับตำแหน่ง',
    group: 'ตำแหน่งและสายงาน',
    kind: 'position_level',
    width: 135,
    synonyms: ['ระดับ', 'ระดับตำแหน่ง', 'position_level', 'position_level_id', 'level'],
    example: 'ชำนาญการ',
  },
  {
    key: 'position_number',
    excelCol: 'M',
    labelTh: 'เลขที่ตำแหน่ง',
    group: 'ตำแหน่งและสายงาน',
    kind: 'text',
    width: 125,
    synonyms: ['เลขที่ตำแหน่ง', 'เลขตำแหน่ง', 'position_number', 'pos_no'],
    example: '1042',
  },
  {
    key: 'secondary_position',
    excelCol: 'N',
    labelTh: 'ปฏิบัติราชการแทน',
    group: 'ตำแหน่งและสายงาน',
    kind: 'text',
    width: 175,
    synonyms: ['ปฏิบัติราชการแทน', 'ตำแหน่งเพิ่มเติม', 'หน้าที่พิเศษ', 'ตำแหน่งรอง', 'secondary_position'],
    example: '',
  },
  {
    key: 'acting_position',
    excelCol: 'O',
    labelTh: 'รักษาการในตำแหน่ง',
    group: 'ตำแหน่งและสายงาน',
    kind: 'text',
    width: 175,
    synonyms: ['รักษาการ', 'รักษาการในตำแหน่ง', 'รักษาราชการแทน', 'acting_position'],
    example: '',
  },
  {
    key: 'bureau_id',
    excelCol: 'P',
    labelTh: 'สำนัก',
    group: 'สังกัดหน่วยงาน',
    kind: 'bureau',
    width: 165,
    synonyms: ['สำนัก', 'สังกัดสำนัก', 'หน่วยงานระดับ 1', 'bureau', 'bureau_id', 'lv1'],
    example: 'สำนักเทศกิจ',
  },
  {
    key: 'office_id',
    excelCol: 'Q',
    labelTh: 'สำนักงาน/กอง',
    group: 'สังกัดหน่วยงาน',
    kind: 'office',
    width: 190,
    synonyms: ['สำนักงาน', 'กอง', 'สำนักงาน/กอง', 'หน่วยงานระดับ 2', 'office', 'office_id', 'lv2'],
    example: 'สำนักงานเลขานุการ',
  },
  {
    key: 'department_id',
    excelCol: 'R',
    labelTh: 'ส่วน/ฝ่าย',
    group: 'สังกัดหน่วยงาน',
    kind: 'department',
    width: 185,
    synonyms: ['ส่วน', 'ฝ่าย', 'ส่วน/ฝ่าย', 'หน่วยงานระดับ 3', 'department', 'department_id', 'lv3'],
    example: 'ฝ่ายบริหารงานทั่วไป',
  },
  {
    key: 'division_id',
    excelCol: 'S',
    labelTh: 'กลุ่มงาน',
    group: 'สังกัดหน่วยงาน',
    kind: 'division',
    width: 175,
    synonyms: ['กลุ่มงาน', 'งาน', 'หน่วยงานระดับ 4', 'division', 'division_id', 'lv4'],
    example: 'งานสารบรรณ',
  },
  {
    key: 'approval_tier_id',
    excelCol: 'T',
    labelTh: 'ระดับสายอนุมัติ',
    group: 'สังกัดหน่วยงาน',
    kind: 'lookup',
    lookupCategoryCode: 'APPROVAL_TIER',
    width: 160,
    synonyms: ['ระดับสายอนุมัติ', 'สายอนุมัติ', 'ระดับผู้อนุมัติ', 'approval_tier', 'approval_tier_id'],
    example: 'ไม่มีอำนาจลงนาม',
  },
  {
    key: 'start_service_date',
    excelCol: 'U',
    labelTh: 'วันบรรจุ (วว/ดด/พ.ศ.)',
    group: 'ประวัติรับราชการ',
    kind: 'date',
    width: 145,
    synonyms: ['วันบรรจุ', 'วันเริ่มรับราชการ', 'วันที่บรรจุ', 'start_service_date', 'hire_date'],
    example: '01/10/2558',
  },
  {
    key: 'start_service_year_be',
    excelCol: 'V',
    labelTh: 'ปี พ.ศ. บรรจุ',
    group: 'ประวัติรับราชการ',
    kind: 'year_be',
    width: 115,
    synonyms: ['ปี พ.ศ. บรรจุ', 'ปีบรรจุ', 'พ.ศ. บรรจุ', 'start_service_year_be'],
    example: '2558',
  },
  {
    key: 'initial_position',
    excelCol: 'W',
    labelTh: 'ตำแหน่งแรกบรรจุ',
    group: 'ประวัติรับราชการ',
    kind: 'text',
    width: 165,
    synonyms: ['ตำแหน่งแรกบรรจุ', 'ตำแหน่งบรรจุครั้งแรก', 'initial_position'],
    example: 'นักวิชาการคอมพิวเตอร์ปฏิบัติการ',
  },
  {
    key: 'initial_salary',
    excelCol: 'X',
    labelTh: 'เงินเดือนแรกบรรจุ',
    group: 'ประวัติรับราชการ',
    kind: 'number',
    width: 135,
    synonyms: ['เงินเดือนแรกบรรจุ', 'อัตราเงินเดือนแรกบรรจุ', 'initial_salary'],
    example: '15000',
  },
  {
    key: 'current_salary',
    excelCol: 'Y',
    labelTh: 'เงินเดือนปัจจุบัน',
    group: 'ประวัติรับราชการ',
    kind: 'number',
    width: 135,
    synonyms: ['เงินเดือนปัจจุบัน', 'เงินเดือน', 'อัตราเงินเดือน', 'current_salary', 'salary'],
    example: '28500',
  },
  {
    key: 'status_id',
    excelCol: 'Z',
    labelTh: 'สถานะบุคลากร',
    group: 'ประวัติรับราชการ',
    kind: 'lookup',
    lookupCategoryCode: 'PERSONNEL_STATUS',
    width: 140,
    synonyms: ['สถานะบุคลากร', 'สถานะปฏิบัติงาน', 'สถานะ', 'status', 'status_id'],
    example: 'ปฏิบัติราชการ',
  },
  {
    key: 'email',
    excelCol: 'AA',
    labelTh: 'อีเมล',
    group: 'ข้อมูลบุคคล',
    kind: 'email',
    width: 195,
    synonyms: ['อีเมล', 'email', 'e-mail', 'mail'],
    example: 'somchai@bangkok.go.th',
  },
];

export const IMPORT_COLUMN_MAP: Record<ImportColumnKey, ImportColumnDef> = IMPORT_COLUMNS.reduce(
  (acc, col) => {
    acc[col.key] = col;
    return acc;
  },
  {} as Record<ImportColumnKey, ImportColumnDef>
);

export function createEmptyCells(): Record<ImportColumnKey, string> {
  const cells = {} as Record<ImportColumnKey, string>;
  for (const col of IMPORT_COLUMNS) {
    cells[col.key] = '';
  }
  return cells;
}

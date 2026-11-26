import { cleanDisplaySegment } from '@/lib/positionFormatter';
import { resolveOrgUnitAncestors } from '@/lib/masterDataSort';
import type { PersonnelNameHistoryRow } from '@/types/database.types';
import type {
  MasterDataBundle,
  PersonnelDirectoryItem,
  PersonnelTimelinesBundle,
} from '@/types/domain.types';
import type {
  Kp7CareerTableRow,
  Kp7CareerWrapCol,
  Kp7Item1NameFields,
  Kp7VisualCareerLine,
} from './kp7Types';

const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];

export const THAI_FULL_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

export const THAI_SHORT_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

const THAI_DIGIT_WORDS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_POSITION_WORDS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

export function toThaiDigits(
  input: string | number | null | undefined,
  useThai = true
): string {
  const str = String(input ?? '');
  if (!useThai) return str;
  return str.replace(/[0-9]/g, (d) => THAI_DIGITS[Number(d)] ?? d);
}

/**
 * Converts a non-negative integer into formal Thai words.
 * Handles special Thai grammar: ยี่สิบ (20), เอ็ด (x1 where x >= 1), สิบ (10).
 */
export function formatThaiNumberInWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return THAI_DIGIT_WORDS[0];

  const convertUnderMillion = (num: number): string => {
    const digits = String(num).split('').map(Number);
    const len = digits.length;
    let out = '';

    for (let i = 0; i < len; i += 1) {
      const digit = digits[i];
      const pos = len - 1 - i;
      if (digit === 0) continue;

      if (pos === 0 && digit === 1 && len > 1) {
        out += 'เอ็ด';
      } else if (pos === 1 && digit === 2) {
        out += 'ยี่สิบ';
      } else if (pos === 1 && digit === 1) {
        out += 'สิบ';
      } else {
        out += `${THAI_DIGIT_WORDS[digit]}${THAI_POSITION_WORDS[pos]}`;
      }
    }
    return out;
  };

  if (n < 1_000_000) return convertUnderMillion(n);
  const millions = Math.floor(n / 1_000_000);
  const remainder = n % 1_000_000;
  return `${formatThaiNumberInWords(millions)}ล้าน${remainder > 0 ? convertUnderMillion(remainder) : ''}`;
}

export function parseIsoYmd(isoDate: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!isoDate) return null;
  const match = String(isoDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * Formats an ISO date into formal KP.7 Thai full date + parenthetical Thai word spelling
 * Per official KP.7 manual (นร ๑๐๐๖/ว ๒๓ p.6): parenthetical Thai words have NO spaces!
 */
export function formatThaiDateInWords(
  isoDate: string | null | undefined,
  useThai = true
): { numericText: string; wordsText: string } {
  const parts = parseIsoYmd(isoDate);
  if (!parts) return { numericText: '', wordsText: '' };

  const yearBe = parts.y >= 2400 ? parts.y : parts.y + 543;
  const monthName = THAI_FULL_MONTHS[parts.m - 1] ?? '';
  const numericRaw = `${parts.d} ${monthName} ${yearBe}`;
  const wordsText = `${formatThaiNumberInWords(parts.d)}${monthName}${formatThaiNumberInWords(yearBe)}`;

  return {
    numericText: toThaiDigits(numericRaw, useThai),
    wordsText,
  };
}

/**
 * Thai civil servant statutory retirement date (พ.ร.บ. บำเหน็จบำนาญข้าราชการ):
 * Born Oct 2 of year Y through Oct 1 of year Y+1 -> retires Sep 30 of (Y+1)+60 (fiscal year end).
 */
export function calculateRetirementDateIso(birthDateIso: string | null | undefined): string | null {
  const parts = parseIsoYmd(birthDateIso);
  if (!parts) return null;
  const ceYear = parts.y >= 2400 ? parts.y - 543 : parts.y;
  const retireYear = parts.m > 10 || (parts.m === 10 && parts.d >= 2) ? ceYear + 61 : ceYear + 60;
  return `${retireYear}-09-30`;
}

export function formatThaiShortDateKp7(
  isoDate: string | null | undefined,
  useThai = true
): string {
  const parts = parseIsoYmd(isoDate);
  if (!parts) return '';
  const yearBe = parts.y >= 2400 ? parts.y : parts.y + 543;
  const monthShort = THAI_SHORT_MONTHS[parts.m - 1] ?? '';
  return toThaiDigits(`${parts.d} ${monthShort} ${yearBe}`, useThai);
}

/**
 * W4.3: Numeric short date dd/mm/yy (2-digit BE year) for KP.7 Item 14 Column 1
 * Honors Checkpoint C2-A: respects `useThai` switch ("01/02/69" or "๐๑/๐๒/๖๙")
 */
export function formatShortNumericDateKp7(
  isoDate: string | null | undefined,
  useThai = true
): string {
  const parts = parseIsoYmd(isoDate);
  if (!parts) return '';
  const yearBe = parts.y >= 2400 ? parts.y : parts.y + 543;
  const dd = String(parts.d).padStart(2, '0');
  const mm = String(parts.m).padStart(2, '0');
  const yy = String(yearBe % 100).padStart(2, '0');
  return toThaiDigits(`${dd}/${mm}/${yy}`, useThai);
}

/**
 * W4.5: Slash-free signature date for Page 1 bottom (Owner & Head of Agency)
 * e.g. "1 พ.ย. 2569" / "๑ พ.ย. ๒๕๖๙", blank fallback without slashes
 */
export function formatSignatureDateKp7(
  isoDate: string | null | undefined,
  useThai = true
): string {
  const formatted = formatThaiShortDateKp7(isoDate, useThai);
  if (!formatted) return '.......... .............. ..........';
  return formatted;
}

export function formatThaiYearBeOnly(
  isoDate: string | null | undefined,
  useThai = true
): string {
  const parts = parseIsoYmd(isoDate);
  if (!parts) return '';
  const yearBe = parts.y >= 2400 ? parts.y : parts.y + 543;
  return toThaiDigits(yearBe, useThai);
}

/** @deprecated Prefer `formatSignatureDateKp7` (slash-free) for KP.7 Page 1 signatures */
export function formatSlashDateKp7(
  isoDate: string | null | undefined,
  useThai = true
): string {
  const parts = parseIsoYmd(isoDate);
  if (!parts) return '........ / ........ / ........';
  const yearBe = parts.y >= 2400 ? parts.y : parts.y + 543;
  const monthShort = THAI_SHORT_MONTHS[parts.m - 1] ?? '';
  return toThaiDigits(`${parts.d} / ${monthShort} / ${yearBe}`, useThai);
}

export function formatCurrencyKp7(
  amount: number | string | null | undefined,
  useThai = true
): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const num = Number(amount);
  if (!Number.isFinite(num)) return '';
  const formatted = num.toLocaleString('th-TH', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return toThaiDigits(formatted, useThai);
}

export function splitCid13Slots(
  cid: string | null | undefined,
  useThai = true
): string[] {
  const digits = String(cid ?? '').replace(/\D/g, '').slice(0, 13);
  const slots: string[] = [];
  for (let i = 0; i < 13; i += 1) {
    const ch = digits[i] ?? '';
    slots.push(ch ? toThaiDigits(ch, useThai) : '');
  }
  return slots;
}

/**
 * Formats official KP.7 Item 1 (คำนำหน้านาม, ๑. ชื่อ, นามสกุล) per นร ๑๐๐๖/ว ๒๓:
 *  - Includes `noble_or_rank_title` alongside current `prefix_name`
 *  - Appends distinct historical prefixes / first names / last names in parentheses
 *    ordered oldest -> newest
 */
export function buildKp7Item1NameFields(
  person: Pick<
    PersonnelDirectoryItem,
    'prefix_name' | 'noble_or_rank_title' | 'first_name' | 'last_name'
  >,
  nameHistory: PersonnelNameHistoryRow[] = [],
  useThai = true
): Kp7Item1NameFields {
  const currentRank = cleanDisplaySegment(person.noble_or_rank_title);
  const currentPrefix = cleanDisplaySegment(person.prefix_name);
  const currentPrefixCombined = [currentRank, currentPrefix].filter(Boolean).join(' ').trim();
  const currentFirst = cleanDisplaySegment(person.first_name);
  const currentLast = cleanDisplaySegment(person.last_name);

  const sorted = [...nameHistory].sort((a, b) => {
    const dCmp = String(a.changed_date || '').localeCompare(String(b.changed_date || ''));
    if (dCmp !== 0) return dCmp;
    return (b.sort_order ?? 0) - (a.sort_order ?? 0);
  });

  const oldPrefixes: string[] = [];
  const oldFirsts: string[] = [];
  const oldLasts: string[] = [];

  for (const nh of sorted) {
    const op = cleanDisplaySegment(nh.old_prefix);
    if (op && op !== currentPrefix && op !== currentPrefixCombined && !oldPrefixes.includes(op)) {
      oldPrefixes.push(op);
    }
    const of = cleanDisplaySegment(nh.old_first_name);
    if (of && of !== currentFirst && !oldFirsts.includes(of)) {
      oldFirsts.push(of);
    }
    const ol = cleanDisplaySegment(nh.old_last_name);
    if (ol && ol !== currentLast && !oldLasts.includes(ol)) {
      oldLasts.push(ol);
    }
  }

  const prefixDisplay = toThaiDigits(
    [currentPrefixCombined, oldPrefixes.length > 0 ? `(${oldPrefixes.join(', ')})` : '']
      .filter(Boolean)
      .join(' '),
    useThai
  );
  const firstNameDisplay = toThaiDigits(
    [currentFirst, oldFirsts.length > 0 ? `(${oldFirsts.join(', ')})` : '']
      .filter(Boolean)
      .join(' '),
    useThai
  );
  const lastNameDisplay = toThaiDigits(
    [currentLast, oldLasts.length > 0 ? `(${oldLasts.join(', ')})` : '']
      .filter(Boolean)
      .join(' '),
    useThai
  );

  return { prefixDisplay, firstNameDisplay, lastNameDisplay };
}

/**
 * Short official position type label for KP.7 Item 14 Column 4 (ตำแหน่งประเภท):
 * "ทั่วไป" | "วิชาการ" | "อำนวยการ" | "บริหาร"
 */
export function formatShortPositionType(
  name?: string | null,
  code?: string | null
): string {
  const upperCode = String(code ?? '').trim().toUpperCase();
  if (upperCode === 'GENERAL') return 'ทั่วไป';
  if (upperCode === 'KNOWLEDGE_WORKER' || upperCode === 'PROFESSIONAL' || upperCode === 'ACADEMIC') {
    return 'วิชาการ';
  }
  if (upperCode === 'MANAGERIAL' || upperCode === 'DIRECTOR') return 'อำนวยการ';
  if (upperCode === 'EXECUTIVE') return 'บริหาร';

  const clean = cleanDisplaySegment(name);
  if (!clean) return '';
  if (clean.includes('ทั่วไป')) return 'ทั่วไป';
  if (clean.includes('วิชาการ')) return 'วิชาการ';
  if (clean.includes('อำนวยการ')) return 'อำนวยการ';
  if (clean.includes('บริหาร')) return 'บริหาร';
  return clean.replace(/^ประเภท/, '').trim();
}

function splitLongLevelName(levelName: string): string[] {
  const clean = cleanDisplaySegment(levelName);
  if (!clean) return [''];
  if (clean === 'ชำนาญการพิเศษ') return ['ชำนาญการ', 'พิเศษ'];
  if (clean === 'เชี่ยวชาญพิเศษ') return ['เชี่ยวชาญ', 'พิเศษ'];
  if (clean === 'ทักษะพิเศษ') return ['ทักษะพิเศษ'];
  if (clean.length > 10 && clean.includes(' ')) {
    return clean.split(/\s+/).filter(Boolean);
  }
  return [clean];
}

function isMeaningfulOrgSegment(val?: string | null): string {
  const cleaned = cleanDisplaySegment(val);
  if (!cleaned) return '';
  if (cleaned === 'ไม่มี' || cleaned === '-' || cleaned === 'ไม่ระบุ') return '';
  return cleaned;
}

/**
 * Builds KP.7 Item 14 rows STRICTLY from `timelines.positionHistory` ONLY (C6-A confirmed).
 * Uses `formatShortNumericDateKp7` ("01/02/69" / "๐๑/๐๒/๖๙") for Column 1 dateLabel (W4.3).
 */
export function buildKp7CareerRows(
  person: PersonnelDirectoryItem,
  timelines: PersonnelTimelinesBundle,
  master: MasterDataBundle,
  useThai = true,
  options?: { allowCurrentPositionFallback?: boolean }
): Kp7CareerTableRow[] {
  const posTypeById = new Map(master.positionTypes.map((t) => [t.id, t]));
  const posById = new Map(master.positions.map((p) => [p.id, p]));
  const lvlById = new Map(master.positionLevels.map((l) => [l.id, l]));

  const sortedPositions = [...(timelines.positionHistory ?? [])].sort((a, b) => {
    const dCmp = String(a.effective_date || '').localeCompare(String(b.effective_date || ''));
    if (dCmp !== 0) return dCmp;
    const sa = Number(a.sort_order ?? 0);
    const sb = Number(b.sort_order ?? 0);
    if (sa !== sb) return sb - sa;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });

  if (sortedPositions.length === 0) {
    if (!options?.allowCurrentPositionFallback) {
      return [];
    }
    if (!person.position_name && !person.current_salary && !person.start_service_date) {
      return [];
    }
    const baseTitle = cleanDisplaySegment(person.position_name) || cleanDisplaySegment(person.position_display) || '-';
    const orgLines = [
      isMeaningfulOrgSegment(person.division_name),
      isMeaningfulOrgSegment(person.department_name),
      isMeaningfulOrgSegment(person.office_name),
      isMeaningfulOrgSegment(person.bureau_name),
    ].filter(Boolean);
    const positionLines = [baseTitle, ...orgLines].map((line) => toThaiDigits(line, useThai));
    const levelRaw = cleanDisplaySegment(person.position_level_name);
    return [
      {
        effectiveDateIso: person.current_position_date || person.start_service_date || '',
        dateLabel: formatShortNumericDateKp7(person.current_position_date || person.start_service_date, useThai),
        positionLabel: positionLines.join(' '),
        positionLines,
        positionNumber: toThaiDigits(cleanDisplaySegment(person.position_number), useThai),
        positionTypeLabel: toThaiDigits(
          formatShortPositionType(person.position_type_name, person.position_type_code),
          useThai
        ),
        positionLevelLabel: toThaiDigits(levelRaw, useThai),
        levelLines: splitLongLevelName(levelRaw).map((l) => toThaiDigits(l, useThai)),
        salaryLabel: formatCurrencyKp7(person.current_salary, useThai),
        allowanceLabel:
          Number(person.position_allowance ?? 0) > 0
            ? formatCurrencyKp7(person.position_allowance, useThai)
            : '',
        orderRef: '',
        orderRefLines: [],
      },
    ];
  }

  return sortedPositions.map((ph) => {
    const pt = ph.position_type_id ? posTypeById.get(ph.position_type_id) : undefined;
    const pos = ph.position_id ? posById.get(ph.position_id) : undefined;
    const lvl = ph.position_level_id ? lvlById.get(ph.position_level_id) : undefined;
    const ancestors = resolveOrgUnitAncestors(ph.org_unit_id, master.orgUnits);

    const basePosTitle = cleanDisplaySegment(pos?.name_th || ph.position_title_snapshot) || '-';
    const orgLines = [
      isMeaningfulOrgSegment(ancestors.divisionName),
      isMeaningfulOrgSegment(ancestors.departmentName),
      isMeaningfulOrgSegment(ancestors.officeName),
      isMeaningfulOrgSegment(ancestors.bureauName),
    ].filter(Boolean);

    const positionLines = [basePosTitle, ...orgLines].map((line) => toThaiDigits(line, useThai));
    const levelRaw = cleanDisplaySegment(lvl?.name_th);
    const levelLines = splitLongLevelName(levelRaw).map((l) => toThaiDigits(l, useThai));
    const orderRefRaw = toThaiDigits(cleanDisplaySegment(ph.order_reference), useThai);
    const orderRefLines = orderRefRaw ? [orderRefRaw] : [];

    const hasSalary = ph.base_salary !== null && ph.base_salary !== undefined && String(ph.base_salary) !== '';
    const allowNum = Number(ph.position_allowance ?? 0);

    return {
      effectiveDateIso: ph.effective_date || '',
      dateLabel: formatShortNumericDateKp7(ph.effective_date, useThai),
      positionLabel: positionLines.join(' '),
      positionLines,
      positionNumber: toThaiDigits(cleanDisplaySegment(ph.position_number), useThai),
      positionTypeLabel: toThaiDigits(formatShortPositionType(pt?.name_th, pt?.code), useThai),
      positionLevelLabel: toThaiDigits(levelRaw, useThai),
      levelLines,
      salaryLabel: hasSalary ? formatCurrencyKp7(ph.base_salary, useThai) : '',
      allowanceLabel: allowNum > 0 ? formatCurrencyKp7(allowNum, useThai) : '',
      orderRef: orderRefRaw,
      orderRefLines,
    };
  });
}

/**
 * Expands multi-line career entries into individual visual ruled lines across ALL 8 columns
 * (W4.4 no-shrink wrapping) and paginates cleanly across Page 2, Page 3, Page 4+.
 */
export function expandAndPaginateCareerLines(
  rows: Kp7CareerTableRow[],
  linesPerPage = 32,
  wrapHelper?: (text: string, col: Kp7CareerWrapCol) => string[]
): Kp7VisualCareerLine[][] {
  if (rows.length === 0) return [[]];

  const wrapSingle = (text: string, col: Kp7CareerWrapCol): string[] => {
    const clean = String(text ?? '').trim();
    if (!clean) return [];
    return wrapHelper ? wrapHelper(clean, col) : [clean];
  };

  const entries: Kp7VisualCareerLine[][] = rows.map((r) => {
    const dateLines = wrapSingle(r.dateLabel, 'date');
    const posLines = (r.positionLines.length > 0 ? r.positionLines : [r.positionLabel]).flatMap((seg) =>
      wrapSingle(seg, 'position')
    );
    const posNoLines = wrapSingle(r.positionNumber, 'posNo');
    const posTypeLines = wrapSingle(r.positionTypeLabel, 'posType');
    // When canvas wrapHelper is provided, measure actual full level label against widened Col 5 (245px)
    // so "ชำนาญการพิเศษ" stays on 1 line if it fits; keep splitLongLevelName only as non-DOM fallback
    const lvlLines = wrapHelper
      ? wrapSingle(r.positionLevelLabel, 'level')
      : r.levelLines.length > 0
        ? r.levelLines.filter(Boolean)
        : wrapSingle(r.positionLevelLabel, 'level');
    const salLines = wrapSingle(r.salaryLabel, 'salary');
    const alwLines = wrapSingle(r.allowanceLabel, 'allowance');
    const refLines = (r.orderRefLines.length > 0 ? r.orderRefLines : r.orderRef ? [r.orderRef] : []).flatMap(
      (seg) => wrapSingle(seg, 'orderRef')
    );

    const lineCount = Math.max(
      1,
      dateLines.length,
      posLines.length,
      posNoLines.length,
      posTypeLines.length,
      lvlLines.length,
      salLines.length,
      alwLines.length,
      refLines.length
    );

    const lines: Kp7VisualCareerLine[] = [];
    for (let i = 0; i < lineCount; i += 1) {
      lines.push({
        dateLabel: dateLines[i] ?? '',
        positionLine: posLines[i] ?? '',
        positionNumber: posNoLines[i] ?? '',
        positionTypeLabel: posTypeLines[i] ?? '',
        levelLine: lvlLines[i] ?? '',
        salaryLabel: salLines[i] ?? '',
        allowanceLabel: alwLines[i] ?? '',
        orderRefLine: refLines[i] ?? '',
        isEntryStart: i === 0,
      });
    }
    return lines;
  });

  const pages: Kp7VisualCareerLine[][] = [];
  let current: Kp7VisualCareerLine[] = [];

  for (const entry of entries) {
    if (current.length > 0 && current.length + entry.length > linesPerPage && entry.length <= linesPerPage) {
      pages.push(current);
      current = [];
    }
    for (const line of entry) {
      if (current.length >= linesPerPage) {
        pages.push(current);
        current = [];
      }
      current.push(line);
    }
  }
  if (current.length > 0 || pages.length === 0) {
    pages.push(current);
  }
  return pages;
}

export function paginateKp7CareerRows(
  rows: Kp7CareerTableRow[],
  rowsPerPage = 28
): Kp7CareerTableRow[][] {
  if (rows.length === 0) return [[]];
  const pages: Kp7CareerTableRow[][] = [];
  for (let i = 0; i < rows.length; i += rowsPerPage) {
    pages.push(rows.slice(i, i + rowsPerPage));
  }
  return pages;
}

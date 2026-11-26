/**
 * Civil Servant & BMA Executive Position & Org Display Formatter
 * (1:1 mirror of public.fn_clean_display_segment & public.fn_format_position_display)
 * - Suppresses meaningless placeholder values ("ไม่มี", "ไม่มีระดับ", "ไม่ระบุ", "-") everywhere except Import Grid.
 * - Standard civil servants: "<Position><Level>" (e.g., "นักวิชาการคอมพิวเตอร์ชำนาญการ")
 * - Executive / Managerial / 4-Tier Unit Heads: appends org name for matching tier (Lv1–Lv4)
 *   with Longest-Prefix-First deduplication (checking "สำนักงาน" BEFORE "สำนัก") and NO "ระดับ..." suffix.
 */

export interface PositionOrgContext {
  positionTypeCode?: string | null;
  bureauName?: string | null;
  officeName?: string | null;
  departmentName?: string | null;
  divisionName?: string | null;
  fallbackBureauName?: string | null;
}

const GENERIC_ORG_PREFIXES = ['สำนักงาน', 'กลุ่มงาน', 'สำนัก', 'กอง', 'ส่วน', 'ฝ่าย'] as const;
const MEANINGLESS_DISPLAY_VALUES = new Set(['', '-', 'ไม่มี', 'ไม่มีระดับ', 'ไม่ระบุ']);

export function isMeaninglessDisplayValue(val?: string | null): boolean {
  const clean = String(val ?? '').trim();
  return MEANINGLESS_DISPLAY_VALUES.has(clean);
}

export function cleanDisplaySegment(val?: string | null): string {
  const clean = String(val ?? '').trim();
  return MEANINGLESS_DISPLAY_VALUES.has(clean) ? '' : clean;
}

export function formatOrgDisplay(org: {
  bureauName?: string | null;
  officeName?: string | null;
  departmentName?: string | null;
  divisionName?: string | null;
  includeBureau?: boolean;
  separator?: string;
}): {
  primary: string;
  secondary: string;
  full: string;
  parts: string[];
} {
  const bureau = cleanDisplaySegment(org.bureauName);
  const office = cleanDisplaySegment(org.officeName);
  const dept = cleanDisplaySegment(org.departmentName);
  const div = cleanDisplaySegment(org.divisionName);
  const sep = org.separator ?? ' · ';

  const subParts = [dept, div].filter(Boolean);
  const parts = org.includeBureau
    ? [bureau, office, ...subParts].filter(Boolean)
    : [office, ...subParts].filter(Boolean);

  const primary = office || (org.includeBureau ? bureau : '') || subParts[0] || '';
  const secondary = office ? subParts.join(sep) : subParts.slice(1).join(sep);

  return {
    primary,
    secondary,
    full: parts.join(sep),
    parts,
  };
}

export function resolveExecutiveTargetOrgName(
  positionName: string,
  positionTypeCode?: string | null,
  positionTypeName?: string | null,
  orgContext?: PositionOrgContext
): { isExecutiveTier: boolean; targetOrg: string; matchedPrefix: string } {
  const pos = cleanDisplaySegment(positionName);
  const tCode = String(positionTypeCode || orgContext?.positionTypeCode || '').trim().toUpperCase();
  const tName = String(positionTypeName || '').trim();
  const bureau = cleanDisplaySegment(orgContext?.bureauName) || cleanDisplaySegment(orgContext?.fallbackBureauName);
  const office = cleanDisplaySegment(orgContext?.officeName);
  const department = cleanDisplaySegment(orgContext?.departmentName);
  const division = cleanDisplaySegment(orgContext?.divisionName);

  if (!pos) {
    return { isExecutiveTier: false, targetOrg: '', matchedPrefix: '' };
  }

  // Longest-Prefix-First tier detection (MUST check "สำนักงาน" BEFORE "สำนัก")
  if (pos.endsWith('สำนักงาน')) {
    return { isExecutiveTier: true, targetOrg: office, matchedPrefix: 'สำนักงาน' };
  }
  if (pos.endsWith('กอง')) {
    return { isExecutiveTier: true, targetOrg: office, matchedPrefix: 'กอง' };
  }
  if (pos.endsWith('สำนัก')) {
    return { isExecutiveTier: true, targetOrg: bureau, matchedPrefix: 'สำนัก' };
  }
  if (pos.endsWith('ส่วน')) {
    return { isExecutiveTier: true, targetOrg: department, matchedPrefix: 'ส่วน' };
  }
  if (pos.endsWith('ฝ่าย')) {
    return { isExecutiveTier: true, targetOrg: department, matchedPrefix: 'ฝ่าย' };
  }
  if (pos.endsWith('กลุ่มงาน')) {
    return { isExecutiveTier: true, targetOrg: division, matchedPrefix: 'กลุ่มงาน' };
  }

  if (tCode === 'EXECUTIVE' || tCode === 'MANAGERIAL' || /อำนวยการ|บริหาร/.test(tName)) {
    const deepestOrg = division || department || office || bureau;
    let matchedPrefix = '';
    if (deepestOrg) {
      for (const cand of GENERIC_ORG_PREFIXES) {
        if (pos.endsWith(cand) && deepestOrg.startsWith(cand)) {
          matchedPrefix = cand;
          break;
        }
      }
    }
    return { isExecutiveTier: true, targetOrg: deepestOrg, matchedPrefix };
  }

  return { isExecutiveTier: false, targetOrg: '', matchedPrefix: '' };
}

export function mergeExecutiveTitleWithOrg(
  positionName: string,
  targetOrg: string,
  matchedPrefix = ''
): string {
  const pos = cleanDisplaySegment(positionName);
  const org = cleanDisplaySegment(targetOrg);
  if (!pos) return '-';
  if (!org) return pos;

  // Idempotent guard: org name already appended
  if (pos.endsWith(org)) {
    return pos;
  }

  if (matchedPrefix && org.startsWith(matchedPrefix)) {
    const suffix = org.slice(matchedPrefix.length).trim();
    if (!suffix || pos.endsWith(suffix)) {
      return pos;
    }
    return `${pos}${suffix}`;
  }

  return `${pos}${org}`;
}

export function formatCivilServantPosition(
  positionName?: string | null,
  positionLevelName?: string | null,
  positionTypeName?: string | null,
  orgContext?: PositionOrgContext
): string {
  const pos = cleanDisplaySegment(positionName);
  const lvlRaw = String(positionLevelName || '').trim().replace(/^ระดับ\s*/i, '').trim();
  const lvl = cleanDisplaySegment(lvlRaw);
  const type = String(positionTypeName || '').trim();

  if (!pos) return '-';

  const { isExecutiveTier, targetOrg, matchedPrefix } = resolveExecutiveTargetOrgName(
    pos,
    orgContext?.positionTypeCode,
    type,
    orgContext
  );

  if (isExecutiveTier) {
    return mergeExecutiveTitleWithOrg(pos, targetOrg, matchedPrefix);
  }

  if (!lvl) {
    return pos;
  }

  // Avoid duplicating level if already suffixed in position name
  if (pos.endsWith(lvl)) {
    return pos;
  }

  return `${pos}${lvl}`;
}

export function formatThaiFullName(parts: {
  prefix?: string | null;
  nobleOrRank?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const prefix = cleanDisplaySegment(parts.prefix);
  const rank = cleanDisplaySegment(parts.nobleOrRank);
  const first = String(parts.firstName || '').trim();
  const last = String(parts.lastName || '').trim();

  const lead = rank ? `${rank} ${prefix}`.trim() : prefix;
  const firstFull = lead ? `${lead}${first}` : first;
  return [firstFull, last].filter(Boolean).join(' ').trim() || '-';
}

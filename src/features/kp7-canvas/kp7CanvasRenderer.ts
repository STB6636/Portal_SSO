import { cleanDisplaySegment } from '@/lib/positionFormatter';
import { sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import { fetchDriveImageAsDataUrl } from '@/services/driveStorageService';
import {
  buildKp7CareerRows,
  buildKp7Item1NameFields,
  calculateRetirementDateIso,
  expandAndPaginateCareerLines,
  formatSignatureDateKp7,
  formatThaiDateInWords,
  formatThaiShortDateKp7,
  formatThaiYearBeOnly,
  splitCid13Slots,
  toThaiDigits,
} from './kp7ThaiFormatter';
import type {
  Kp7CareerTableRow,
  Kp7CareerWrapCol,
  Kp7DataBundle,
  Kp7RenderOptions,
  Kp7VisualCareerLine,
} from './kp7Types';

// Official A4 @ 300 DPI canvas dimensions
export const KP7_A4_WIDTH = 2480;
export const KP7_A4_HEIGHT = 3508;
export const KP7_PAGE2_LINES_PER_PAGE = 32;

const FONT_FAMILY = "'Sarabun', 'TH Sarabun New', 'Tahoma', sans-serif";
const INK = '#000000';
const LINE_DARK = '#111111';
const LINE_LIGHT = '#333333';

// Margins & Table Geometry
const ML = 140;
const MR = 140;
const W = KP7_A4_WIDTH - ML - MR; // 2200 px

// W4.3 Rebalanced Page 2+ 8-column official widths (sum = 2200 px exactly!)
// Expanded Cols 3, 4, 5, 6, 7 (+50, +30, +40, +30, +30) & Col 8 (+10)
const P2_COLS: ReadonlyArray<{
  key: Kp7CareerWrapCol;
  label: string[];
  width: number;
  align: CanvasTextAlign;
}> = [
  { key: 'date', label: ['วัน เดือน ปี'], width: 195, align: 'center' },
  { key: 'position', label: ['ตำแหน่ง'], width: 485, align: 'left' },
  { key: 'posNo', label: ['เลขที่', 'ตำแหน่ง'], width: 225, align: 'center' },
  { key: 'posType', label: ['ตำแหน่ง', 'ประเภท'], width: 215, align: 'center' },
  { key: 'level', label: ['ระดับ'], width: 245, align: 'center' },
  { key: 'salary', label: ['เงินเดือน'], width: 225, align: 'right' },
  { key: 'allowance', label: ['เงินประจำ', 'ตำแหน่ง'], width: 225, align: 'right' },
  { key: 'orderRef', label: ['เอกสารอ้างอิง'], width: 385, align: 'left' },
];

const P2_COL_WIDTH_MAP: Record<Kp7CareerWrapCol, number> = {
  date: 195,
  position: 485,
  posNo: 225,
  posType: 215,
  level: 245,
  salary: 225,
  allowance: 225,
  orderRef: 385,
};

let cachedSegmenter: { segment: (s: string) => Iterable<{ segment: string }> } | null | undefined;
function getThaiSegmenter() {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  try {
    const IntlAny = Intl as unknown as {
      Segmenter?: new (
        locale: string,
        opts: { granularity: 'word' | 'grapheme' }
      ) => { segment: (s: string) => Iterable<{ segment: string }> };
    };
    cachedSegmenter = IntlAny.Segmenter ? new IntlAny.Segmenter('th', { granularity: 'word' }) : null;
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

export async function ensureSarabunFontLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    await Promise.all([
      document.fonts.load(`400 44px ${FONT_FAMILY}`),
      document.fonts.load(`700 44px ${FONT_FAMILY}`),
    ]);
    await document.fonts.ready;
  } catch {
    // Proceed gracefully with fallback system font
  }
}

function loadImageElement(src: string, crossOrigin?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.referrerPolicy = 'no-referrer';
    let settled = false;
    const done = (res: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    const timer = window.setTimeout(() => done(null), 6500);
    img.onload = () => {
      window.clearTimeout(timer);
      done(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    img.src = src;
  });
}

async function loadSignatureForCanvas(
  rawUrl: string | null | undefined,
  options: Kp7RenderOptions
): Promise<HTMLImageElement | null> {
  const cleanUrl = sanitizeImageUrl(rawUrl);
  if (!cleanUrl) return null;

  if (cleanUrl.startsWith('data:image/')) {
    return loadImageElement(cleanUrl);
  }

  if (options.settings?.google_drive_script_url) {
    const dataUrl = await fetchDriveImageAsDataUrl({
      fileUrlOrId: cleanUrl,
      category: 'signature',
      settings: options.settings,
    });
    if (dataUrl) {
      const img = await loadImageElement(dataUrl);
      if (img) return img;
    }
  }

  return loadImageElement(cleanUrl, 'anonymous');
}

function setFont(ctx: CanvasRenderingContext2D, sizePx: number, weight: '400' | '700' = '400') {
  ctx.font = `${weight} ${sizePx}px ${FONT_FAMILY}`;
}

function tokenizeThai(text: string): string[] {
  const seg = getThaiSegmenter();
  if (seg) {
    const out: string[] = [];
    for (const part of seg.segment(text)) {
      out.push(part.segment);
    }
    return out;
  }
  return text.split(/(\s+)/).filter(Boolean);
}

/**
 * Thai-word-aware text wrapper. Never shrinks font size; wraps long words cleanly to next line.
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const safeMax = Math.max(24, maxWidth);
  if (ctx.measureText(raw).width <= safeMax) return [raw];

  const paragraphs = raw.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const tokens = tokenizeThai(para);
    let current = '';

    for (const token of tokens) {
      const candidate = current ? current + token : token.trimStart();
      if (ctx.measureText(candidate).width <= safeMax) {
        current = candidate;
        continue;
      }

      if (current.trim()) {
        lines.push(current.trim());
        current = '';
      }

      const trimmedTok = token.trimStart();
      if (!trimmedTok) continue;
      if (ctx.measureText(trimmedTok).width <= safeMax) {
        current = trimmedTok;
      } else {
        // Hard grapheme-level wrap only if a single unspaced token exceeds column width
        let chunk = '';
        for (const ch of Array.from(trimmedTok)) {
          if (ctx.measureText(chunk + ch).width <= safeMax) {
            chunk += ch;
          } else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      }
    }

    if (current.trim()) lines.push(current.trim());
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * W4.4: Fixed-size text drawing WITHOUT font shrinking and WITHOUT ctx.fillText 4th-arg horizontal squishing.
 */
function drawFixedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  weight: '400' | '700' = '400',
  align: CanvasTextAlign = 'left',
  baseline: CanvasTextBaseline = 'middle'
) {
  const str = String(text ?? '').trim();
  if (!str) return;
  setFont(ctx, fontSize, weight);
  ctx.fillStyle = INK;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

/**
 * W4.4: Multi-line wrapped text drawing at FIXED fontSize (ZERO font shrinking, ZERO horizontal squishing).
 */
function drawWrappedTextNoShrink(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number,
  fontSize: number,
  weight: '400' | '700' = '400',
  align: CanvasTextAlign = 'left',
  padX = 14,
  customLineH?: number
): string[] {
  const str = String(text ?? '').trim();
  if (!str) return [];
  const usableW = Math.max(24, boxWidth - padX * 2);
  setFont(ctx, fontSize, weight);
  const lines = wrapText(ctx, str, usableW);
  const lineH = customLineH ?? Math.round(fontSize * 1.2);

  ctx.fillStyle = INK;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  const totalH = lines.length * lineH;
  const startY = y + (boxHeight - totalH) / 2 + lineH / 2;
  const anchorX =
    align === 'center' ? x + boxWidth / 2 : align === 'right' ? x + boxWidth - padX : x + padX;

  lines.forEach((line, i) => {
    ctx.fillText(line, anchorX, startY + i * lineH);
  });

  return lines;
}

function drawDottedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  lineWidth = 2
) {
  ctx.save();
  ctx.strokeStyle = '#444444';
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([4, 7]);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width = 2.4,
  color = LINE_DARK
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Measures how many lines a labeled dotted field needs at FIXED font size (never shrinking!).
 */
function measureLabeledDottedFieldLines(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  endX: number,
  labelSize = 42,
  valueSize = 42
): { lines: string[]; lineStart: number } {
  setFont(ctx, labelSize, '400');
  const labelW = ctx.measureText(label).width;
  const lineStart = x + labelW + 14;
  const cleanVal = String(value ?? '').trim();
  if (!cleanVal) return { lines: [''], lineStart };

  setFont(ctx, valueSize, '400');
  const firstLineW = Math.max(40, endX - lineStart - 16);
  const fullLineW = Math.max(40, endX - x - 16);

  if (ctx.measureText(cleanVal).width <= firstLineW) {
    return { lines: [cleanVal], lineStart };
  }

  // Wrap first segment to firstLineW, then wrap remainder to fullLineW
  const tokens = tokenizeThai(cleanVal);
  let line1 = '';
  let splitIdx = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const candidate = line1 ? line1 + tokens[i] : tokens[i].trimStart();
    if (ctx.measureText(candidate).width <= firstLineW) {
      line1 = candidate;
      splitIdx = i + 1;
    } else {
      break;
    }
  }

  if (!line1.trim()) {
    // Whole value starts on line 2 if line 1 space is too tight for first token
    return { lines: ['', ...wrapText(ctx, cleanVal, fullLineW)], lineStart };
  }

  const restText = tokens.slice(splitIdx).join('').trim();
  const restLines = restText ? wrapText(ctx, restText, fullLineW) : [];
  return { lines: [line1.trim(), ...restLines], lineStart };
}

/**
 * W4.4: Draws a labeled dotted field at FIXED font size (NO shrink, NO maxWidth squish!).
 * If value exceeds line 1, wraps cleanly onto dotted continuation lines below.
 */
function drawLabeledDottedFieldNoShrink(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  yBaseline: number,
  endX: number,
  labelSize = 42,
  valueSize = 42,
  lineStep = 54
): number {
  setFont(ctx, labelSize, '400');
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, x, yBaseline);

  const { lines, lineStart } = measureLabeledDottedFieldLines(
    ctx,
    label,
    value,
    x,
    endX,
    labelSize,
    valueSize
  );

  if (endX > lineStart + 10) {
    drawDottedLine(ctx, lineStart, endX, yBaseline + 6, 2);
    if (lines[0]) {
      setFont(ctx, valueSize, '400');
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(lines[0], lineStart + 10, yBaseline - 2);
    }
  }

  for (let i = 1; i < lines.length; i += 1) {
    const ly = yBaseline + i * lineStep;
    drawDottedLine(ctx, x + 20, endX, ly + 6, 2);
    if (lines[i]) {
      setFont(ctx, valueSize, '400');
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(lines[i], x + 28, ly - 2);
    }
  }

  return lines.length;
}

/**
 * Pre-calculates Page 2+ visual line pages using real Canvas measureText across ALL 8 columns
 * at fixed 40px Sarabun (W4.4 no-shrink wrapping).
 */
export function computeKp7CareerVisualPages(
  bundle: Kp7DataBundle,
  options: Kp7RenderOptions,
  linesPerPage = KP7_PAGE2_LINES_PER_PAGE
): { rows: Kp7CareerTableRow[]; pages: Kp7VisualCareerLine[][] } {
  const rows = buildKp7CareerRows(
    bundle.person,
    bundle.timelines,
    bundle.master,
    options.useThaiNumerals,
    { allowCurrentPositionFallback: Boolean(options.allowCurrentPositionFallback) }
  );

  if (typeof document === 'undefined') {
    return { rows, pages: expandAndPaginateCareerLines(rows, linesPerPage) };
  }

  const probe = document.createElement('canvas');
  const ctx = probe.getContext('2d');
  if (!ctx) {
    return { rows, pages: expandAndPaginateCareerLines(rows, linesPerPage) };
  }

  setFont(ctx, 40, '400');
  const padX = 12;

  const pages = expandAndPaginateCareerLines(rows, linesPerPage, (seg, col) => {
    const usableW = Math.max(40, P2_COL_WIDTH_MAP[col] - padX * 2);
    return wrapText(ctx, seg, usableW);
  });

  return { rows, pages };
}

/**
 * Renders Official KP.7 Page 1 at 300 DPI (2480 x 3508 px).
 * Implements W4.1 (Item 2 CID on line 2), W4.2 (Item 8 maiden surname on line 2),
 * W4.4 (No-shrink wrapping + variable row heights + vertical divider fix + overflow cascade),
 * W4.5 (Slash-free bottom signature dates), W4.6 (Widened Item 10 cols 2 & 3),
 * and User C3 Symmetry (Left Items 1,3,4 symmetrically aligned with expanded Right Items 2,5,6,7,8,9).
 */
export async function renderKp7Page1(
  canvas: HTMLCanvasElement,
  bundle: Kp7DataBundle,
  options: Kp7RenderOptions
): Promise<void> {
  await ensureSarabunFontLoaded();

  canvas.width = KP7_A4_WIDTH;
  canvas.height = KP7_A4_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { person, timelines, master } = bundle;
  const useThai = options.useThaiNumerals;

  // Pure white A4 background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, KP7_A4_WIDTH, KP7_A4_HEIGHT);

  // =========================================================================
  // TOP HEADER (Outside border: กระทรวง... กรม... ก.พ. ๗)
  // =========================================================================
  const headerY = 172;
  const ministryVal = toThaiDigits(cleanDisplaySegment(options.ministryName), useThai);
  const deptVal = toThaiDigits(
    cleanDisplaySegment(options.departmentName) || cleanDisplaySegment(person.bureau_name),
    useThai
  );

  // Top-right "ก.พ. ๗" (NO box)
  drawFixedText(ctx, toThaiDigits('ก.พ. 7', useThai), ML + W, headerY - 26, 60, '700', 'right', 'alphabetic');

  drawLabeledDottedFieldNoShrink(ctx, 'กระทรวง', ministryVal, ML, headerY, ML + 950, 44, 44);
  drawLabeledDottedFieldNoShrink(ctx, 'กรม', deptVal, ML + 975, headerY, ML + W - 210, 44, 44);

  // =========================================================================
  // ITEMS 1–9 OFFICIAL 2-COLUMN GRID (Symmetric Left/Right Row Heights per C3!)
  // =========================================================================
  const gridTop = 208;
  const midX = ML + 1090; // Left = 1090px, Right = 1110px
  const rightW = ML + W - midX;
  const padL = ML + 22;
  const leftEnd = midX - 24;
  const r56SplitX = midX + Math.round(rightW * 0.48);

  // Pre-measure fields so Left & Right cells expand symmetrically whenever content wraps
  const item1 = buildKp7Item1NameFields(person, timelines.nameHistory, useThai);
  const empTypeText = toThaiDigits(cleanDisplaySegment(person.employment_type_name), useThai);
  const birthInfo = formatThaiDateInWords(person.birth_date, useThai);
  const retireIso = calculateRetirementDateIso(person.birth_date);
  const retireInfo = formatThaiDateInWords(retireIso, useThai);
  const fatherName = toThaiDigits(cleanDisplaySegment(person.father_full_name), useThai);
  const motherName = toThaiDigits(cleanDisplaySegment(person.mother_full_name), useThai);
  const motherMaiden = toThaiDigits(cleanDisplaySegment(person.mother_maiden_name), useThai);
  const spouseName = toThaiDigits(cleanDisplaySegment(person.spouse_full_name), useThai);
  const spouseMaiden = toThaiDigits(cleanDisplaySegment(person.spouse_maiden_name), useThai);

  // Row 1 height calculation (Right: Item 2 [144px] + Items 5 & 6 [>=150px] vs Left: Item 1 [3 lines])
  const r1RightTopH = 144;
  setFont(ctx, 38, '400');
  const empLines = empTypeText ? wrapText(ctx, empTypeText, ML + W - r56SplitX - 28) : [];
  const r1RightBotH = Math.max(150, 74 + empLines.length * 46 + 18);
  const r1RightTotalH = r1RightTopH + r1RightBotH;

  const p1Lines = measureLabeledDottedFieldLines(ctx, 'คำนำหน้านาม', item1.prefixDisplay, padL, leftEnd, 42, 42).lines.length;
  const f1Lines = measureLabeledDottedFieldLines(ctx, `${toThaiDigits('1', useThai)}. ชื่อ`, item1.firstNameDisplay, padL, leftEnd, 42, 42).lines.length;
  const l1Lines = measureLabeledDottedFieldLines(ctx, 'นามสกุล', item1.lastNameDisplay, padL, leftEnd, 42, 42).lines.length;
  const r1LeftMinH = 38 + (p1Lines + f1Lines + l1Lines) * 56 + 44;
  const row1H = Math.max(294, r1RightTotalH, r1LeftMinH);

  // Row 2 height calculation (Right: Item 7 + Item 8 + Line 3 นามสกุลเดิม vs Left: Item 3 birth date + words)
  const f7Lines = measureLabeledDottedFieldLines(ctx, `${toThaiDigits('7', useThai)}. ชื่อ - นามสกุลบิดา`, fatherName, midX + 20, ML + W - 22, 40, 42).lines.length;
  const m8Lines = measureLabeledDottedFieldLines(ctx, `${toThaiDigits('8', useThai)}. ชื่อ - นามสกุลมารดา`, motherName, midX + 20, ML + W - 22, 40, 42).lines.length;
  const mm8Lines = measureLabeledDottedFieldLines(ctx, 'นามสกุลเดิม', motherMaiden, midX + 58, ML + W - 22, 40, 42).lines.length;
  const r2RightMinH = 34 + (f7Lines + m8Lines + mm8Lines) * 58 + 26;

  setFont(ctx, 38, '400');
  const birthWordLines = birthInfo.wordsText ? wrapText(ctx, `(${birthInfo.wordsText})`, leftEnd - padL - 20) : [];
  const r2LeftMinH = 104 + Math.max(1, birthWordLines.length) * 48 + 30;
  const row2H = Math.max(232, r2RightMinH, r2LeftMinH);

  // Row 3 height calculation (Right: Item 9 spouse + นามสกุลเดิม vs Left: Item 4 retirement + words)
  const s9Lines = measureLabeledDottedFieldLines(ctx, `${toThaiDigits('9', useThai)}. ชื่อ - นามสกุลคู่สมรส`, spouseName, midX + 20, ML + W - 22, 40, 42).lines.length;
  const sm9Lines = measureLabeledDottedFieldLines(ctx, 'นามสกุลเดิม', spouseMaiden, midX + 58, ML + W - 22, 40, 42).lines.length;
  const r3RightMinH = 34 + (s9Lines + sm9Lines) * 58 + 24;

  setFont(ctx, 38, '400');
  const retireWordLines = retireInfo.wordsText ? wrapText(ctx, `(${retireInfo.wordsText})`, leftEnd - padL - 20) : [];
  const r3LeftMinH = 96 + Math.max(1, retireWordLines.length) * 48 + 26;
  const row3H = Math.max(172, r3RightMinH, r3LeftMinH);

  const r1Bottom = gridTop + row1H;
  const r2Bottom = r1Bottom + row2H;
  const gridBottom = r2Bottom + row3H;

  // Outer border & symmetric dividers of Items 1–9
  ctx.strokeStyle = LINE_DARK;
  ctx.lineWidth = 3;
  ctx.strokeRect(ML, gridTop, W, gridBottom - gridTop);
  drawLine(ctx, midX, gridTop, midX, gridBottom, 2.5);
  drawLine(ctx, ML, r1Bottom, ML + W, r1Bottom, 2.5);
  drawLine(ctx, ML, r2Bottom, ML + W, r2Bottom, 2.5);

  const r1RightMidY = gridTop + r1RightTopH;
  drawLine(ctx, midX, r1RightMidY, ML + W, r1RightMidY, 2.2);
  drawLine(ctx, r56SplitX, r1RightMidY, r56SplitX, r1Bottom, 2.2);

  // --- Item 1 (Left Row 1): Symmetrically spaced across full row1H ---
  const item1TotalLines = p1Lines + f1Lines + l1Lines;
  const item1Step = Math.max(54, Math.floor((row1H - 68) / Math.max(3, item1TotalLines)));
  let y1Cursor = gridTop + Math.round((row1H - (item1TotalLines - 1) * item1Step) / 2) + 12;
  const usedP1 = drawLabeledDottedFieldNoShrink(ctx, 'คำนำหน้านาม', item1.prefixDisplay, padL, y1Cursor, leftEnd, 42, 42, 52);
  y1Cursor += usedP1 * item1Step;
  const usedF1 = drawLabeledDottedFieldNoShrink(ctx, `${toThaiDigits('1', useThai)}. ชื่อ`, item1.firstNameDisplay, padL, y1Cursor, leftEnd, 42, 44, 52);
  y1Cursor += usedF1 * item1Step;
  drawLabeledDottedFieldNoShrink(ctx, 'นามสกุล', item1.lastNameDisplay, padL, y1Cursor, leftEnd, 42, 44, 52);

  // --- Item 2 (Right Row 1 Top): W4.1 — Label on Line 1, 13 symmetric underscore slots on Line 2 ---
  drawFixedText(
    ctx,
    `${toThaiDigits('2', useThai)}. เลขประจำตัวประชาชน`,
    midX + 20,
    gridTop + 52,
    42,
    '400',
    'left',
    'alphabetic'
  );

  const cidSlots = splitCid13Slots(person.cid, useThai);
  const groups = [1, 4, 5, 2, 1];
  const slotW = 48;
  const innerGap = 10;
  const dashSlotW = 44;
  // Exact symmetric width: 13*48 + 8*10 + 4*44 = 624 + 80 + 176 = 880px -> margins = (1110 - 880)/2 = 115px each side!
  const totalCidW = 13 * slotW + 8 * innerGap + 4 * dashSlotW;
  let cx = midX + Math.round((rightW - totalCidW) / 2);
  const cidBaseY = gridTop + 118;
  let digitIdx = 0;

  groups.forEach((grpLen, gIdx) => {
    for (let k = 0; k < grpLen; k += 1) {
      const ch = cidSlots[digitIdx] ?? '';
      digitIdx += 1;
      drawLine(ctx, cx, cidBaseY + 6, cx + slotW, cidBaseY + 6, 2.2, '#222222');
      if (ch) {
        drawFixedText(ctx, ch, cx + slotW / 2, cidBaseY - 2, 44, '700', 'center', 'alphabetic');
      }
      cx += slotW;
      if (k < grpLen - 1) cx += innerGap;
    }
    if (gIdx < groups.length - 1) {
      drawFixedText(ctx, '-', cx + dashSlotW / 2, cidBaseY - 4, 42, '400', 'center', 'alphabetic');
      cx += dashSlotW;
    }
  });

  // --- Item 5 (Right Row 1 Bottom-Left): ๕. วันบรรจุ ---
  const startServiceInfo = formatThaiDateInWords(person.start_service_date, useThai);
  drawFixedText(ctx, `${toThaiDigits('5', useThai)}. วันบรรจุ`, midX + 20, r1RightMidY + 48, 40, '400', 'left', 'alphabetic');
  const item5BoxY = r1RightMidY + 62;
  const item5BoxH = r1Bottom - item5BoxY - 12;
  if (startServiceInfo.numericText) {
    drawWrappedTextNoShrink(
      ctx,
      startServiceInfo.numericText,
      midX + 10,
      item5BoxY,
      r56SplitX - midX - 20,
      item5BoxH,
      40,
      '400',
      'center',
      8,
      46
    );
  } else {
    drawDottedLine(ctx, midX + 20, r56SplitX - 20, r1Bottom - 28, 2);
  }

  // --- Item 6 (Right Row 1 Bottom-Right): ๖. ประเภทข้าราชการ (No-shrink wrap!) ---
  drawFixedText(ctx, `${toThaiDigits('6', useThai)}. ประเภทข้าราชการ`, r56SplitX + 18, r1RightMidY + 48, 40, '400', 'left', 'alphabetic');
  const item6BoxY = r1RightMidY + 62;
  const item6BoxH = r1Bottom - item6BoxY - 10;
  if (empTypeText) {
    drawWrappedTextNoShrink(
      ctx,
      empTypeText,
      r56SplitX + 8,
      item6BoxY,
      ML + W - r56SplitX - 16,
      item6BoxH,
      38,
      '400',
      'center',
      10,
      46
    );
  } else {
    drawDottedLine(ctx, r56SplitX + 20, ML + W - 20, r1Bottom - 28, 2);
  }

  // --- Item 3 (Left Row 2): Symmetrically balanced inside expanded row2H ---
  const r2LeftLine1Y = r1Bottom + Math.round(row2H * 0.33);
  drawLabeledDottedFieldNoShrink(
    ctx,
    `${toThaiDigits('3', useThai)}. วัน เดือน ปีเกิด`,
    birthInfo.numericText,
    padL,
    r2LeftLine1Y,
    leftEnd,
    42,
    42
  );
  const birthWordsBoxTop = r2LeftLine1Y + 20;
  const birthWordsBoxH = r2Bottom - birthWordsBoxTop - 16;
  if (birthInfo.wordsText) {
    drawWrappedTextNoShrink(
      ctx,
      `(${birthInfo.wordsText})`,
      padL + 10,
      birthWordsBoxTop,
      leftEnd - padL - 20,
      birthWordsBoxH,
      38,
      '400',
      'center',
      8,
      46
    );
  } else {
    drawDottedLine(ctx, padL + 20, leftEnd, r2Bottom - 36, 2);
  }

  // --- Items 7 & 8 (Right Row 2): W4.2 — Item 8 นามสกุลเดิม on Line 2 identical to Item 9 ---
  const r2RightTotalLines = f7Lines + m8Lines + mm8Lines;
  const r2RightStep = Math.max(54, Math.floor((row2H - 44) / Math.max(3, r2RightTotalLines)));
  let y2Cursor = r1Bottom + Math.round((row2H - (r2RightTotalLines - 1) * r2RightStep) / 2) + 12;
  const used7 = drawLabeledDottedFieldNoShrink(
    ctx,
    `${toThaiDigits('7', useThai)}. ชื่อ - นามสกุลบิดา`,
    fatherName,
    midX + 20,
    y2Cursor,
    ML + W - 22,
    40,
    42,
    52
  );
  y2Cursor += used7 * r2RightStep;
  const used8 = drawLabeledDottedFieldNoShrink(
    ctx,
    `${toThaiDigits('8', useThai)}. ชื่อ - นามสกุลมารดา`,
    motherName,
    midX + 20,
    y2Cursor,
    ML + W - 22,
    40,
    42,
    52
  );
  y2Cursor += used8 * r2RightStep;
  drawLabeledDottedFieldNoShrink(
    ctx,
    'นามสกุลเดิม',
    motherMaiden,
    midX + 58,
    y2Cursor,
    ML + W - 22,
    40,
    42,
    52
  );

  // --- Item 4 (Left Row 3): Symmetrically balanced inside row3H matching Item 9 ---
  const r3LeftLine1Y = r2Bottom + Math.round(row3H * 0.38);
  drawLabeledDottedFieldNoShrink(
    ctx,
    `${toThaiDigits('4', useThai)}. วันครบเกษียณอายุ`,
    retireInfo.numericText,
    padL,
    r3LeftLine1Y,
    leftEnd,
    42,
    42
  );
  const retireWordsTop = r3LeftLine1Y + 16;
  const retireWordsH = gridBottom - retireWordsTop - 12;
  if (retireInfo.wordsText) {
    drawWrappedTextNoShrink(
      ctx,
      `(${retireInfo.wordsText})`,
      padL + 10,
      retireWordsTop,
      leftEnd - padL - 20,
      retireWordsH,
      38,
      '400',
      'center',
      8,
      46
    );
  } else {
    drawDottedLine(ctx, padL + 20, leftEnd, gridBottom - 28, 2);
  }

  // --- Item 9 (Right Row 3): ๙. ชื่อ - นามสกุลคู่สมรส + นามสกุลเดิม ---
  const r3RightTotalLines = s9Lines + sm9Lines;
  const r3RightStep = Math.max(54, Math.floor((row3H - 42) / Math.max(2, r3RightTotalLines)));
  let y3Cursor = r2Bottom + Math.round((row3H - (r3RightTotalLines - 1) * r3RightStep) / 2) + 12;
  const used9 = drawLabeledDottedFieldNoShrink(
    ctx,
    `${toThaiDigits('9', useThai)}. ชื่อ - นามสกุลคู่สมรส`,
    spouseName,
    midX + 20,
    y3Cursor,
    ML + W - 22,
    40,
    42,
    52
  );
  y3Cursor += used9 * r3RightStep;
  drawLabeledDottedFieldNoShrink(
    ctx,
    'นามสกุลเดิม',
    spouseMaiden,
    midX + 58,
    y3Cursor,
    ML + W - 22,
    40,
    42,
    52
  );

  // =========================================================================
  // ITEMS 10–13: NO-SHRINK WRAPPING + VARIABLE ROW HEIGHTS + VERTICAL DIVIDER FIX
  // =========================================================================
  const lookupById = new Map(master.items.map((i) => [i.id, i]));

  const eduData = (timelines.educations ?? []).map((ed) => {
    const period = [cleanDisplaySegment(ed.start_period), cleanDisplaySegment(ed.end_period)]
      .filter(Boolean)
      .join(' - ');
    const deg = [
      cleanDisplaySegment(ed.degree_title),
      cleanDisplaySegment(ed.major_name) ? `(${cleanDisplaySegment(ed.major_name)})` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return [
      toThaiDigits(cleanDisplaySegment(ed.institution_name), useThai),
      toThaiDigits(period, useThai),
      toThaiDigits(deg, useThai),
    ];
  });

  const licData = (timelines.licenses ?? []).map((lc) => [
    toThaiDigits(cleanDisplaySegment(lc.license_name), useThai),
    toThaiDigits(cleanDisplaySegment(lc.issuing_agency), useThai),
    toThaiDigits(cleanDisplaySegment(lc.license_number), useThai),
    formatThaiShortDateKp7(lc.effective_date, useThai),
  ]);

  const trainData = (timelines.trainings ?? []).map((tr) => {
    const startTxt = formatThaiShortDateKp7(tr.start_date, useThai);
    const endTxt = formatThaiShortDateKp7(tr.end_date, useThai);
    const rangeTxt =
      startTxt && endTxt && startTxt !== endTxt ? `${startTxt} - ${endTxt}` : startTxt || endTxt;
    return [
      toThaiDigits(cleanDisplaySegment(tr.course_name), useThai),
      rangeTxt,
      toThaiDigits(cleanDisplaySegment(tr.organizer_name), useThai),
    ];
  });

  const discData = (timelines.disciplinaryRecords ?? []).map((dr) => {
    const recType = dr.record_type_id ? lookupById.get(dr.record_type_id)?.name_th : '';
    const penalty = dr.penalty_level_id ? lookupById.get(dr.penalty_level_id)?.name_th : '';
    const status = dr.case_status_id ? lookupById.get(dr.case_status_id)?.name_th : '';
    const detail = [recType, penalty, status, cleanDisplaySegment(dr.remark)]
      .filter(Boolean)
      .join(' — ');
    return [
      formatThaiYearBeOnly(dr.effective_date, useThai),
      toThaiDigits(detail, useThai),
      toThaiDigits(cleanDisplaySegment(dr.document_ref), useThai),
    ];
  });

  const sections = [
    {
      title: `${toThaiDigits('10', useThai)}. ประวัติการศึกษา`,
      // W4.6: Widened Col 2 (0.21->0.25) & Col 3 (0.35->0.43), Col 1 = 0.32 (sum = 1.00)
      cols: [
        { label: 'สถานศึกษา', ratio: 0.32, align: 'left' as const },
        { label: 'ตั้งแต่ - ถึง (เดือน ปี)', ratio: 0.25, align: 'center' as const },
        { label: 'วุฒิ (สาขาวิชาเอก)', ratio: 0.43, align: 'left' as const },
      ],
      baseRows: 8,
      rows: eduData,
    },
    {
      title: `${toThaiDigits('11', useThai)}. ใบอนุญาตประกอบวิชาชีพ`,
      cols: [
        { label: 'ชื่อใบอนุญาต', ratio: 0.30, align: 'left' as const },
        { label: 'หน่วยงาน', ratio: 0.26, align: 'left' as const },
        { label: 'เลขที่ใบอนุญาต', ratio: 0.20, align: 'center' as const },
        { label: 'วันที่มีผลบังคับใช้ (วัน เดือน ปี)', ratio: 0.24, align: 'center' as const },
      ],
      baseRows: 3,
      rows: licData,
    },
    {
      title: `${toThaiDigits('12', useThai)}. ประวัติการฝึกอบรม`,
      cols: [
        { label: 'หลักสูตรฝึกอบรม', ratio: 0.44, align: 'left' as const },
        { label: 'ตั้งแต่ - ถึง (วัน เดือน ปี)', ratio: 0.24, align: 'center' as const },
        { label: 'หน่วยงานที่จัดฝึกอบรม', ratio: 0.32, align: 'left' as const },
      ],
      baseRows: 3,
      rows: trainData,
    },
    {
      title: `${toThaiDigits('13', useThai)}. การได้รับโทษทางวินัยและการนิรโทษกรรม`,
      cols: [
        { label: 'พ.ศ.', ratio: 0.12, align: 'center' as const },
        { label: 'รายการ', ratio: 0.58, align: 'left' as const },
        { label: 'เอกสารอ้างอิง', ratio: 0.30, align: 'left' as const },
      ],
      baseRows: 3,
      rows: discData,
    },
  ];

  const tablesTop = gridBottom;
  const tablesTargetBottom = 2955;
  const titleBarH = 60;
  const colHeaderH = 74;
  const fixedChromeH = sections.length * (titleBarH + colHeaderH);
  const availableRowsH = Math.max(600, tablesTargetBottom - tablesTop - fixedChromeH);

  // Precompute exact column pixel widths for each section
  const sectionColWidths = sections.map((sec) => {
    const widths = sec.cols.map((c) => Math.round(W * c.ratio));
    const sumW = widths.reduce((a, b) => a + b, 0);
    widths[widths.length - 1] += W - sumW;
    return widths;
  });

  // Fixed cell font size = 38px (NEVER shrunk!)
  const cellFontSize = 38;
  const cellPadX = 14;
  let cellLineH = 46;
  let cellPadY = 12;

  setFont(ctx, cellFontSize, '400');
  // Compute required line count per actual data row
  const dataRowLineCounts = sections.map((sec, sIdx) =>
    sec.rows.map((rowVals) => {
      let maxLines = 1;
      sec.cols.forEach((_, cIdx) => {
        const val = rowVals[cIdx] ?? '';
        if (val) {
          const usableW = Math.max(24, sectionColWidths[sIdx][cIdx] - cellPadX * 2);
          const wrapped = wrapText(ctx, val, usableW);
          if (wrapped.length > maxLines) maxLines = wrapped.length;
        }
      });
      return maxLines;
    })
  );

  // Start with base row counts per section
  const rowCounts = sections.map((s) => Math.max(s.baseRows, s.rows.length));
  const minBlankRowH = 68;

  const computeTotalNeededH = (counts: number[], lineH: number, padY: number, blankH: number) => {
    let total = 0;
    counts.forEach((cnt, sIdx) => {
      const lineCounts = dataRowLineCounts[sIdx];
      for (let r = 0; r < cnt; r += 1) {
        const lines = lineCounts[r] ?? 1;
        total += Math.max(blankH, lines * lineH + padY * 2);
      }
    });
    return total;
  };

  // Overflow Cascade Step 1 & 2: trim blank rows if wrapped data rows exceed availableRowsH
  while (computeTotalNeededH(rowCounts, cellLineH, cellPadY, minBlankRowH) > availableRowsH) {
    let trimmed = false;
    // Trim blank rows from largest-padded sections first (Education -> Training -> License -> Disc)
    for (const sIdx of [0, 2, 1, 3]) {
      const minAllowed = Math.max(1, sections[sIdx].rows.length);
      if (rowCounts[sIdx] > minAllowed) {
        rowCounts[sIdx] -= 1;
        trimmed = true;
        break;
      }
    }
    if (!trimmed) break;
  }

  // Overflow Cascade Step 3: if actual data rows alone still exceed availableRowsH, tighten padding/lineH (keep 38px font!)
  if (computeTotalNeededH(rowCounts, cellLineH, cellPadY, minBlankRowH) > availableRowsH) {
    cellPadY = 6;
    cellLineH = 41;
  }

  // Expand spare space evenly into blank/single rows so bottom border aligns cleanly near tablesTargetBottom
  const baseBlankH = Math.min(
    78,
    Math.max(
      54,
      Math.floor(
        (availableRowsH -
          rowCounts.reduce((acc, cnt, sIdx) => {
            const lc = dataRowLineCounts[sIdx];
            let extra = 0;
            for (let r = 0; r < cnt; r += 1) {
              const lines = lc[r] ?? 1;
              if (lines > 1) extra += lines * cellLineH + cellPadY * 2;
            }
            return acc + extra;
          }, 0)) /
          Math.max(
            1,
            rowCounts.reduce((acc, cnt, sIdx) => {
              const lc = dataRowLineCounts[sIdx];
              let singles = 0;
              for (let r = 0; r < cnt; r += 1) {
                if ((lc[r] ?? 1) <= 1) singles += 1;
              }
              return acc + singles;
            }, 0)
          )
      )
    )
  );

  // Build exact per-row height arrays
  const sectionRowHeights = rowCounts.map((cnt, sIdx) => {
    const lc = dataRowLineCounts[sIdx];
    const heights: number[] = [];
    for (let r = 0; r < cnt; r += 1) {
      const lines = lc[r] ?? 1;
      heights.push(Math.max(baseBlankH, lines * cellLineH + cellPadY * 2));
    }
    return heights;
  });

  // Add extra blank rows only if significant bottom whitespace (> 76px) remains
  let usedH = sectionRowHeights.reduce((sum, arr) => sum + arr.reduce((a, b) => a + b, 0), 0);
  const extraOrder = [0, 2, 1, 3];
  let eoIdx = 0;
  while (availableRowsH - usedH >= baseBlankH) {
    const targetSec = extraOrder[eoIdx % extraOrder.length];
    sectionRowHeights[targetSec].push(baseBlankH);
    rowCounts[targetSec] += 1;
    usedH += baseBlankH;
    eoIdx += 1;
  }

  // Distribute tiny residual (< baseBlankH) proportionally across single-line rows so bottom ends cleanly
  const residual = availableRowsH - usedH;
  if (residual > 0 && residual < 160) {
    const totalRowsAll = sectionRowHeights.reduce((sum, arr) => sum + arr.length, 0);
    const delta = residual / Math.max(1, totalRowsAll);
    sectionRowHeights.forEach((arr) => {
      for (let i = 0; i < arr.length; i += 1) arr[i] += delta;
    });
  }

  let curY = tablesTop;

  sections.forEach((sec, sIdx) => {
    const heights = sectionRowHeights[sIdx];
    const colWidths = sectionColWidths[sIdx];
    const sectionBodyH = heights.reduce((a, b) => a + b, 0);

    // 1. Section Title Bar (White background)
    drawLine(ctx, ML, curY, ML + W, curY, 2.5);
    drawFixedText(ctx, sec.title, ML + 20, curY + titleBarH / 2 + 2, 42, '700', 'left', 'middle');
    curY += titleBarH;

    // 2. Column Header Row + Full Variable-Height Vertical Dividers (sectionBodyH fix!)
    drawLine(ctx, ML, curY, ML + W, curY, 2.2);
    let colX = ML;
    sec.cols.forEach((col, cIdx) => {
      const cw = colWidths[cIdx];
      if (cIdx > 0) {
        drawLine(ctx, colX, curY, colX, curY + colHeaderH + sectionBodyH, 2.0, LINE_LIGHT);
      }
      drawWrappedTextNoShrink(ctx, col.label, colX, curY, cw, colHeaderH, 36, '700', 'center', 8, 40);
      colX += cw;
    });
    curY += colHeaderH;

    // 3. Data & Blank Ruled Rows (exact variable heights)
    for (let r = 0; r < heights.length; r += 1) {
      const rh = heights[r];
      drawLine(ctx, ML, curY, ML + W, curY, 1.8, LINE_LIGHT);
      const rowVals = sec.rows[r];
      if (rowVals) {
        let cellX = ML;
        sec.cols.forEach((col, cIdx) => {
          const cw = colWidths[cIdx];
          const val = rowVals[cIdx] ?? '';
          if (val) {
            drawWrappedTextNoShrink(
              ctx,
              val,
              cellX,
              curY,
              cw,
              rh,
              cellFontSize,
              '400',
              col.align,
              cellPadX,
              cellLineH
            );
          }
          cellX += cw;
        });
      }
      curY += rh;
    }
  });

  // Outer left, right, and bottom crisp borders for Items 10–13
  drawLine(ctx, ML, tablesTop, ML, curY, 3);
  drawLine(ctx, ML + W, tablesTop, ML + W, curY, 3);
  drawLine(ctx, ML, curY, ML + W, curY, 3);

  // =========================================================================
  // BOTTOM SIGNATURE BLOCK (NO outer box — W4.5 Slash-Free Date "1 พ.ย. 2569")
  // =========================================================================
  const sigTop = curY + 52;
  const leftCenterX = ML + 540;
  const rightCenterX = ML + W - 540;

  drawFixedText(
    ctx,
    'ขอรับรองว่าข้อมูลที่ข้าพเจ้ากรอกเป็นความจริงทุกประการ',
    leftCenterX,
    sigTop + 18,
    40,
    '400',
    'center',
    'middle'
  );

  if (options.includeOwnerSignature && person.signature_path) {
    const sigImg = await loadSignatureForCanvas(person.signature_path, options);
    if (sigImg) {
      const maxSigW = 420;
      const maxSigH = 124;
      const scale = Math.min(maxSigW / sigImg.naturalWidth, maxSigH / sigImg.naturalHeight, 1);
      const drawW = sigImg.naturalWidth * scale;
      const drawH = sigImg.naturalHeight * scale;
      ctx.drawImage(sigImg, leftCenterX - drawW / 2 + 24, sigTop + 148 - drawH, drawW, drawH);
    }
  }

  drawFixedText(
    ctx,
    'ลงชื่อ .................................................................',
    leftCenterX,
    sigTop + 166,
    42,
    '400',
    'center',
    'middle'
  );
  drawFixedText(ctx, 'เจ้าของประวัติ', leftCenterX, sigTop + 234, 42, '400', 'center', 'middle');
  drawFixedText(
    ctx,
    formatSignatureDateKp7(options.ownerSignDateIso || options.certifyDateIso, useThai),
    leftCenterX,
    sigTop + 302,
    40,
    '400',
    'center',
    'middle'
  );

  // Right: Head of Agency / Authorized Certifier
  drawFixedText(
    ctx,
    'ลงชื่อ .................................................................',
    rightCenterX,
    sigTop + 114,
    42,
    '400',
    'center',
    'middle'
  );

  const certName = toThaiDigits(cleanDisplaySegment(options.certifierName), useThai);
  drawFixedText(
    ctx,
    certName ? `( ${certName} )` : '( ................................................................. )',
    rightCenterX,
    sigTop + 176,
    42,
    '400',
    'center',
    'middle'
  );

  const certPos = toThaiDigits(cleanDisplaySegment(options.certifierPosition), useThai);
  drawFixedText(
    ctx,
    certPos ? `ตำแหน่ง ${certPos}` : 'ตำแหน่ง .................................................................',
    rightCenterX,
    sigTop + 238,
    40,
    '400',
    'center',
    'middle'
  );

  drawFixedText(
    ctx,
    'หัวหน้าส่วนราชการหรือผู้ที่หัวหน้าส่วนราชการมอบหมาย',
    rightCenterX,
    sigTop + 300,
    38,
    '400',
    'center',
    'middle'
  );
  drawFixedText(
    ctx,
    formatSignatureDateKp7(options.certifyDateIso, useThai),
    rightCenterX,
    sigTop + 358,
    40,
    '400',
    'center',
    'middle'
  );
}

/**
 * Renders Official KP.7 Page 2+ (Item 14: ตำแหน่งและเงินเดือน) at 300 DPI (2480 x 3508 px).
 * Implements W4.3 (rebalanced P2_COLS + dd/mm/yy date) and W4.4 (fixed 40px font, wrapped across all 8 columns).
 */
export async function renderKp7Page2Plus(
  canvas: HTMLCanvasElement,
  bundle: Kp7DataBundle,
  options: Kp7RenderOptions,
  visualLines: Kp7VisualCareerLine[],
  linesPerPage = KP7_PAGE2_LINES_PER_PAGE
): Promise<void> {
  await ensureSarabunFontLoaded();

  canvas.width = KP7_A4_WIDTH;
  canvas.height = KP7_A4_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { person } = bundle;
  const useThai = options.useThaiNumerals;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, KP7_A4_WIDTH, KP7_A4_HEIGHT);

  // Top Header Line Outside Border: ชื่อ....... กระทรวง....... กรม.......
  const headerY = 160;
  const fullName = toThaiDigits(cleanDisplaySegment(person.full_name), useThai);
  const ministryVal = toThaiDigits(cleanDisplaySegment(options.ministryName), useThai);
  const deptVal = toThaiDigits(
    cleanDisplaySegment(options.departmentName) || cleanDisplaySegment(person.bureau_name),
    useThai
  );

  drawLabeledDottedFieldNoShrink(ctx, 'ชื่อ', fullName, ML, headerY, ML + 780, 42, 42);
  drawLabeledDottedFieldNoShrink(ctx, 'กระทรวง', ministryVal, ML + 805, headerY, ML + 1515, 42, 42);
  drawLabeledDottedFieldNoShrink(ctx, 'กรม', deptVal, ML + 1540, headerY, ML + W, 42, 42);

  // Item 14 Full-Page 8-Column Table
  const tableTop = 198;
  const tableBottom = 3380;
  const titleH = 74;
  const colHeadH = 104;
  const bodyTop = tableTop + titleH + colHeadH;
  const rowH = (tableBottom - bodyTop) / linesPerPage;

  ctx.strokeStyle = LINE_DARK;
  ctx.lineWidth = 3;
  ctx.strokeRect(ML, tableTop, W, tableBottom - tableTop);

  // Row 0: Centered bold title
  drawFixedText(
    ctx,
    `${toThaiDigits('14', useThai)}. ตำแหน่งและเงินเดือน`,
    ML + W / 2,
    tableTop + titleH / 2 + 2,
    48,
    '700',
    'center',
    'middle'
  );

  drawLine(ctx, ML, tableTop + titleH, ML + W, tableTop + titleH, 2.5);

  // Column headers & full-height vertical dividers (fixed 38px bold, wrapped, never shrunk!)
  let colX = ML;
  const colPositions: number[] = [];
  P2_COLS.forEach((col, idx) => {
    colPositions.push(colX);
    if (idx > 0) {
      drawLine(ctx, colX, tableTop + titleH, colX, tableBottom, 2.0, LINE_DARK);
    }

    const headY = tableTop + titleH;
    const headText = col.label.join('\n');
    drawWrappedTextNoShrink(ctx, headText, colX, headY, col.width, colHeadH, 38, '700', 'center', 8, 44);
    colX += col.width;
  });

  drawLine(ctx, ML, bodyTop, ML + W, bodyTop, 2.5);

  // Render ruled rows at FIXED 40px Sarabun (lines already wrapped to column widths!)
  const padX = 12;
  for (let i = 0; i < linesPerPage; i += 1) {
    const ry = bodyTop + i * rowH;
    if (i > 0) {
      drawLine(ctx, ML, ry, ML + W, ry, 1.6, LINE_LIGHT);
    }

    const line = visualLines[i];
    if (!line) continue;

    const midY = ry + rowH / 2 + 2;
    const cellValues = [
      line.dateLabel,
      line.positionLine,
      line.positionNumber,
      line.positionTypeLabel,
      line.levelLine,
      line.salaryLabel,
      line.allowanceLabel,
      line.orderRefLine,
    ];

    P2_COLS.forEach((col, cIdx) => {
      const val = cellValues[cIdx];
      if (!val) return;
      const cx = colPositions[cIdx];
      const anchorX =
        col.align === 'center'
          ? cx + col.width / 2
          : col.align === 'right'
            ? cx + col.width - padX
            : cx + padX;
      drawFixedText(ctx, val, anchorX, midY, 40, '400', col.align, 'middle');
    });
  }
}

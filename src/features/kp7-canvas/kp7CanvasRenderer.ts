import { cleanDisplaySegment } from '@/lib/positionFormatter';
import { sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import { fetchDriveImageAsDataUrl } from '@/services/driveStorageService';
import {
  buildKp7CareerRows,
  buildKp7Item1NameFields,
  calculateRetirementDateIso,
  expandAndPaginateCareerLines,
  formatSlashDateKp7,
  formatThaiDateInWords,
  formatThaiShortDateKp7,
  formatThaiYearBeOnly,
  splitCid13Slots,
  toThaiDigits,
} from './kp7ThaiFormatter';
import type {
  Kp7CareerTableRow,
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

// Page 2+ 8-column official widths (sum = 2200 px)
const P2_COLS = [
  { key: 'date', label: ['วัน เดือน ปี'], width: 230, align: 'center' as const },
  { key: 'position', label: ['ตำแหน่ง'], width: 640, align: 'left' as const },
  { key: 'posNo', label: ['เลขที่', 'ตำแหน่ง'], width: 175, align: 'center' as const },
  { key: 'posType', label: ['ตำแหน่ง', 'ประเภท'], width: 185, align: 'center' as const },
  { key: 'level', label: ['ระดับ'], width: 205, align: 'center' as const },
  { key: 'salary', label: ['เงินเดือน'], width: 195, align: 'right' as const },
  { key: 'allowance', label: ['เงินประจำ', 'ตำแหน่ง'], width: 195, align: 'right' as const },
  { key: 'orderRef', label: ['เอกสารอ้างอิง'], width: 375, align: 'left' as const },
] as const;

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
      document.fonts.load(`400 46px ${FONT_FAMILY}`),
      document.fonts.load(`700 46px ${FONT_FAMILY}`),
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

/**
 * Loads owner signature image CORS-safely so canvas.toDataURL() NEVER throws SecurityError:
 *  1. If settings + Google Drive URL: fetch Base64 Data URL via GAS `?action=getBase64` first!
 *  2. Fallback: crossOrigin="anonymous" direct image load.
 */
async function loadSignatureForCanvas(
  rawUrl: string | null | undefined,
  options: Kp7RenderOptions
): Promise<HTMLImageElement | null> {
  const cleanUrl = sanitizeImageUrl(rawUrl);
  if (!cleanUrl) return null;

  if (cleanUrl.startsWith('data:image/')) {
    return loadImageElement(cleanUrl);
  }

  // Tier 1: GAS getBase64 proxy (zero-CORS, works even on restricted Workspace Drives)
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

  // Tier 2: Direct CORS anonymous load
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
 * Word-aware Thai text wrapper that gracefully breaks extra-long unspaced tokens by grapheme.
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  if (ctx.measureText(raw).width <= maxWidth) return [raw];

  const paragraphs = raw.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const tokens = tokenizeThai(para);
    let current = '';

    for (const token of tokens) {
      const candidate = current ? current + token : token.trimStart();
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current.trim()) {
        lines.push(current.trim());
        current = '';
      }

      const trimmedTok = token.trimStart();
      if (!trimmedTok) continue;
      if (ctx.measureText(trimmedTok).width <= maxWidth) {
        current = trimmedTok;
      } else {
        // Hard character-level split only if a single token exceeds column width
        let chunk = '';
        for (const ch of Array.from(trimmedTok)) {
          if (ctx.measureText(chunk + ch).width <= maxWidth) {
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
 * Draws single-line text with automatic font-size shrink when needed to fit `maxWidth` cleanly.
 */
function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  baseSize: number,
  weight: '400' | '700' = '400',
  align: CanvasTextAlign = 'left',
  minSize = 28
) {
  const str = String(text ?? '').trim();
  if (!str) return;
  let size = baseSize;
  setFont(ctx, size, weight);
  while (size > minSize && ctx.measureText(str).width > maxWidth) {
    size -= 2;
    setFont(ctx, size, weight);
  }
  ctx.fillStyle = INK;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (ctx.measureText(str).width > maxWidth) {
    ctx.fillText(str, x, y, maxWidth);
  } else {
    ctx.fillText(str, x, y);
  }
}

/**
 * Draws wrapped multi-line text inside a bounding cell, auto-shrinking font size if total height overflows.
 */
function drawWrappedTextInBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number,
  baseSize: number,
  weight: '400' | '700' = '400',
  align: CanvasTextAlign = 'left',
  minSize = 28,
  padX = 14
) {
  const str = String(text ?? '').trim();
  if (!str) return;
  const usableW = Math.max(20, boxWidth - padX * 2);
  let size = baseSize;
  let lines: string[] = [];
  let lineH = size * 1.18;

  while (size >= minSize) {
    setFont(ctx, size, weight);
    lines = wrapText(ctx, str, usableW);
    lineH = size * 1.18;
    if (lines.length * lineH <= boxHeight - 8) break;
    size -= 2;
  }

  const maxLines = Math.max(1, Math.floor((boxHeight - 6) / lineH));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
  }

  ctx.fillStyle = INK;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  const totalH = lines.length * lineH;
  const startY = y + (boxHeight - totalH) / 2 + lineH / 2;
  const anchorX =
    align === 'center' ? x + boxWidth / 2 : align === 'right' ? x + boxWidth - padX : x + padX;

  lines.forEach((line, i) => {
    ctx.fillText(line, anchorX, startY + i * lineH, usableW);
  });
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

function drawLabeledDottedField(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  yBaseline: number,
  endX: number,
  labelSize = 44,
  valueSize = 44
) {
  setFont(ctx, labelSize, '400');
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, x, yBaseline);

  const labelW = ctx.measureText(label).width;
  const lineStart = x + labelW + 14;
  if (endX > lineStart + 10) {
    drawDottedLine(ctx, lineStart, endX, yBaseline + 6, 2);
    if (value.trim()) {
      const maxValW = endX - lineStart - 16;
      let sz = valueSize;
      setFont(ctx, sz, '400');
      while (sz > 28 && ctx.measureText(value).width > maxValW) {
        sz -= 2;
        setFont(ctx, sz, '400');
      }
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(value, lineStart + 10, yBaseline - 2, maxValW);
    }
  }
}

/**
 * Helper to pre-calculate Page 2+ visual line pages using real Canvas measureText so
 * `Kp7PrintPage` knows exact `totalPages` before rendering each page!
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

  setFont(ctx, 42, '400');
  const posMaxW = P2_COLS[1].width - 26;
  const lvlMaxW = P2_COLS[4].width - 20;
  const refMaxW = P2_COLS[7].width - 26;

  const pages = expandAndPaginateCareerLines(rows, linesPerPage, (seg, col) => {
    const w = col === 'position' ? posMaxW : col === 'level' ? lvlMaxW : refMaxW;
    return wrapText(ctx, seg, w);
  });

  return { rows, pages };
}

/**
 * Renders Official KP.7 Page 1 at 300 DPI (2480 x 3508 px) matching `แบบฟอร์ม กพ7.pdf` + `นร ๑๐๐๖/ว ๒๓`.
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
  // TOP HEADER (Outside border — exact official form: กระทรวง... กรม...  ก.พ. ๗)
  // =========================================================================
  const headerY = 175;
  const ministryVal = toThaiDigits(cleanDisplaySegment(options.ministryName), useThai);
  const deptVal = toThaiDigits(
    cleanDisplaySegment(options.departmentName) || cleanDisplaySegment(person.bureau_name),
    useThai
  );

  // Top-right "ก.พ. ๗" (NO rectangle box per official form!)
  setFont(ctx, 60, '700');
  ctx.fillStyle = INK;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(toThaiDigits('ก.พ. 7', useThai), ML + W, headerY - 26);

  // Ministry + Department dotted fields on single top line
  drawLabeledDottedField(ctx, 'กระทรวง', ministryVal, ML, headerY, ML + 960, 46, 46);
  drawLabeledDottedField(ctx, 'กรม', deptVal, ML + 985, headerY, ML + W - 210, 46, 46);

  // =========================================================================
  // ITEMS 1–9 OFFICIAL 2-COLUMN GRID
  // =========================================================================
  const gridTop = 212;
  const midX = ML + 1090; // Left col = 1090px, Right col = 1110px
  const rightW = ML + W - midX;

  const row1H = 278; // Item 1 (left) | Item 2 top + Items 5 & 6 bottom (right)
  const row2H = 186; // Item 3 (left) | Items 7 & 8 shared box without divider (right)
  const row3H = 166; // Item 4 (left) | Item 9 (right)
  const gridBottom = gridTop + row1H + row2H + row3H; // 842

  // Outer border of Items 1–9 (thick 3px crisp black border)
  ctx.strokeStyle = LINE_DARK;
  ctx.lineWidth = 3;
  ctx.strokeRect(ML, gridTop, W, gridBottom - gridTop);

  // Main vertical divider between Left (Items 1, 3, 4) & Right (Items 2, 5/6, 7/8, 9)
  drawLine(ctx, midX, gridTop, midX, gridBottom, 2.5);

  // Horizontal dividers
  const r1Bottom = gridTop + row1H;
  const r2Bottom = r1Bottom + row2H;
  drawLine(ctx, ML, r1Bottom, ML + W, r1Bottom, 2.5);
  drawLine(ctx, ML, r2Bottom, ML + W, r2Bottom, 2.5);

  // Right-side Row 1 internal split: top = Item 2 (126px), bottom = Items 5 & 6 (152px)
  const r1RightMidY = gridTop + 126;
  const r56SplitX = midX + Math.round(rightW * 0.48);
  drawLine(ctx, midX, r1RightMidY, ML + W, r1RightMidY, 2.2);
  drawLine(ctx, r56SplitX, r1RightMidY, r56SplitX, r1Bottom, 2.2);

  // --- Item 1 (Left Row 1): คำนำหน้านาม / ๑. ชื่อ / นามสกุล ---
  const item1 = buildKp7Item1NameFields(person, timelines.nameHistory, useThai);
  const padL = ML + 22;
  const leftEnd = midX - 24;
  drawLabeledDottedField(ctx, 'คำนำหน้านาม', item1.prefixDisplay, padL, gridTop + 72, leftEnd, 44, 44);
  drawLabeledDottedField(
    ctx,
    `${toThaiDigits('1', useThai)}. ชื่อ`,
    item1.firstNameDisplay,
    padL,
    gridTop + 158,
    leftEnd,
    44,
    46
  );
  drawLabeledDottedField(ctx, 'นามสกุล', item1.lastNameDisplay, padL, gridTop + 242, leftEnd, 44, 46);

  // --- Item 2 (Right Row 1 Top): ๒. เลขประจำตัวประชาชน (13 underscore slots, NO boxes!) ---
  const cidLabel = `${toThaiDigits('2', useThai)}. เลขประจำตัวประชาชน`;
  setFont(ctx, 42, '400');
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(cidLabel, midX + 20, gridTop + 76);

  const cidSlots = splitCid13Slots(person.cid, useThai);
  const groups = [1, 4, 5, 2, 1];
  const slotW = 36;
  const slotGap = 8;
  const dashW = 24;
  let cx = midX + 410;
  const cidBaseY = gridTop + 82;
  let digitIdx = 0;

  groups.forEach((grpLen, gIdx) => {
    for (let k = 0; k < grpLen; k += 1) {
      const ch = cidSlots[digitIdx] ?? '';
      digitIdx += 1;
      // Draw crisp underscore
      drawLine(ctx, cx, cidBaseY + 6, cx + slotW, cidBaseY + 6, 2.2, '#222222');
      if (ch) {
        setFont(ctx, 44, '700');
        ctx.fillStyle = INK;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(ch, cx + slotW / 2, cidBaseY - 2);
      }
      cx += slotW + slotGap;
    }
    if (gIdx < groups.length - 1) {
      setFont(ctx, 40, '400');
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('-', cx + dashW / 2 - 4, cidBaseY - 4);
      cx += dashW;
    }
  });

  // --- Item 5 (Right Row 1 Bottom-Left): ๕. วันบรรจุ ---
  const startServiceInfo = formatThaiDateInWords(person.start_service_date, useThai);
  setFont(ctx, 42, '400');
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${toThaiDigits('5', useThai)}. วันบรรจุ`, midX + 20, r1RightMidY + 56);
  drawDottedLine(ctx, midX + 20, r56SplitX - 20, r1Bottom - 26, 2);
  if (startServiceInfo.numericText) {
    drawFittedText(
      ctx,
      startServiceInfo.numericText,
      midX + (r56SplitX - midX) / 2,
      r1Bottom - 46,
      r56SplitX - midX - 44,
      44,
      '400',
      'center',
      30
    );
  }

  // --- Item 6 (Right Row 1 Bottom-Right): ๖. ประเภทข้าราชการ ---
  setFont(ctx, 42, '400');
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${toThaiDigits('6', useThai)}. ประเภทข้าราชการ`, r56SplitX + 18, r1RightMidY + 56);
  const empTypeText = toThaiDigits(cleanDisplaySegment(person.employment_type_name), useThai);
  if (empTypeText) {
    drawWrappedTextInBox(
      ctx,
      empTypeText,
      r56SplitX + 10,
      r1RightMidY + 66,
      ML + W - r56SplitX - 20,
      r1Bottom - r1RightMidY - 72,
      40,
      '400',
      'center',
      28,
      10
    );
  } else {
    drawDottedLine(ctx, r56SplitX + 20, ML + W - 20, r1Bottom - 26, 2);
  }

  // --- Item 3 (Left Row 2): ๓. วัน เดือน ปีเกิด + (คำอ่านไม่เว้นวรรค) ---
  const birthInfo = formatThaiDateInWords(person.birth_date, useThai);
  drawLabeledDottedField(
    ctx,
    `${toThaiDigits('3', useThai)}. วัน เดือน ปีเกิด`,
    birthInfo.numericText,
    padL,
    r1Bottom + 68,
    leftEnd,
    44,
    44
  );
  drawDottedLine(ctx, padL + 20, leftEnd, r1Bottom + 150, 2);
  if (birthInfo.wordsText) {
    drawFittedText(
      ctx,
      `(${birthInfo.wordsText})`,
      padL + (leftEnd - padL) / 2,
      r1Bottom + 128,
      leftEnd - padL - 24,
      42,
      '400',
      'center',
      26
    );
  }

  // --- Items 7 & 8 (Right Row 2 — shared box without horizontal line between 7 & 8) ---
  const fatherName = toThaiDigits(cleanDisplaySegment(person.father_full_name), useThai);
  const motherName = toThaiDigits(cleanDisplaySegment(person.mother_full_name), useThai);
  const motherMaiden = toThaiDigits(cleanDisplaySegment(person.mother_maiden_name), useThai);
  drawLabeledDottedField(
    ctx,
    `${toThaiDigits('7', useThai)}. ชื่อ - นามสกุลบิดา`,
    fatherName,
    midX + 20,
    r1Bottom + 66,
    ML + W - 22,
    42,
    44
  );
  // Item 8: split line for mother full name + maiden surname
  const motherSplitX = midX + Math.round(rightW * 0.62);
  drawLabeledDottedField(
    ctx,
    `${toThaiDigits('8', useThai)}. ชื่อ - นามสกุลมารดา`,
    motherName,
    midX + 20,
    r1Bottom + 148,
    motherSplitX - 10,
    40,
    42
  );
  drawLabeledDottedField(
    ctx,
    'นามสกุลเดิม',
    motherMaiden,
    motherSplitX + 4,
    r1Bottom + 148,
    ML + W - 22,
    38,
    40
  );

  // --- Item 4 (Left Row 3): ๔. วันครบเกษียณอายุ + (คำอ่านไม่เว้นวรรค) ---
  const retireIso = calculateRetirementDateIso(person.birth_date);
  const retireInfo = formatThaiDateInWords(retireIso, useThai);
  drawLabeledDottedField(
    ctx,
    `${toThaiDigits('4', useThai)}. วันครบเกษียณอายุ`,
    retireInfo.numericText,
    padL,
    r2Bottom + 64,
    leftEnd,
    44,
    44
  );
  drawDottedLine(ctx, padL + 20, leftEnd, r2Bottom + 140, 2);
  if (retireInfo.wordsText) {
    drawFittedText(
      ctx,
      `(${retireInfo.wordsText})`,
      padL + (leftEnd - padL) / 2,
      r2Bottom + 118,
      leftEnd - padL - 24,
      42,
      '400',
      'center',
      26
    );
  }

  // --- Item 9 (Right Row 3): ๙. ชื่อ - นามสกุลคู่สมรส + นามสกุลเดิม ---
  const spouseName = toThaiDigits(cleanDisplaySegment(person.spouse_full_name), useThai);
  const spouseMaiden = toThaiDigits(cleanDisplaySegment(person.spouse_maiden_name), useThai);
  drawLabeledDottedField(
    ctx,
    `${toThaiDigits('9', useThai)}. ชื่อ - นามสกุลคู่สมรส`,
    spouseName,
    midX + 20,
    r2Bottom + 64,
    ML + W - 22,
    42,
    44
  );
  drawLabeledDottedField(
    ctx,
    'นามสกุลเดิม',
    spouseMaiden,
    midX + 58,
    r2Bottom + 138,
    ML + W - 22,
    40,
    42
  );

  // =========================================================================
  // ITEMS 10–13: DYNAMIC FULL-A4 ROW-FILL ENGINE (Seamless Outer Border, White Headers)
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
      startTxt && endTxt && startTxt !== endTxt
        ? `${startTxt} - ${endTxt}`
        : startTxt || endTxt;
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
      // Official KP.7 Item 13 col 1: 4-digit BE year ONLY!
      formatThaiYearBeOnly(dr.effective_date, useThai),
      toThaiDigits(detail, useThai),
      toThaiDigits(cleanDisplaySegment(dr.document_ref), useThai),
    ];
  });

  const sections = [
    {
      title: `${toThaiDigits('10', useThai)}. ประวัติการศึกษา`,
      cols: [
        { label: 'สถานศึกษา', ratio: 0.44, align: 'left' as const },
        { label: 'ตั้งแต่ - ถึง (เดือน ปี)', ratio: 0.21, align: 'center' as const },
        { label: 'วุฒิ (สาขาวิชาเอก)', ratio: 0.35, align: 'left' as const },
      ],
      baseRows: 9,
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

  // Calculate dynamic row counts & row height to fill Page 1 down to Y = 2945 (eliminating dead whitespace!)
  const tablesTop = gridBottom; // seamless outer border directly joined below Items 1–9
  const tablesTargetBottom = 2945;
  const titleBarH = 64;
  const colHeaderH = 74;
  const fixedChromeH = sections.length * (titleBarH + colHeaderH); // 552
  const availableRowsH = tablesTargetBottom - tablesTop - fixedChromeH; // ~1551

  const rowCounts = sections.map((s) => Math.max(s.baseRows, s.rows.length));
  const totalBaseRows = rowCounts.reduce((a, b) => a + b, 0);

  // Target ideal row height ~76px for 16pt readability; expand blank rows proportionally if space allows
  const idealRowH = 76;
  const targetTotalRows = Math.max(totalBaseRows, Math.floor(availableRowsH / idealRowH));
  let extraRows = targetTotalRows - totalBaseRows;
  // Distribute extra blank rows primarily to Item 10 (Education) then Item 12 (Training)
  const extraOrder = [0, 2, 1, 3];
  let eoIdx = 0;
  while (extraRows > 0) {
    rowCounts[extraOrder[eoIdx % extraOrder.length]] += 1;
    extraRows -= 1;
    eoIdx += 1;
  }

  const finalTotalRows = rowCounts.reduce((a, b) => a + b, 0);
  const rowH = availableRowsH / finalTotalRows; // fills EXACTLY to tablesTargetBottom!

  let curY = tablesTop;

  sections.forEach((sec, sIdx) => {
    const count = rowCounts[sIdx];
    const colWidths = sec.cols.map((c) => Math.round(W * c.ratio));
    // Ensure exact sum === W
    const sumW = colWidths.reduce((a, b) => a + b, 0);
    colWidths[colWidths.length - 1] += W - sumW;

    // 1. Section Title Bar (White background — NO grey fill!)
    drawLine(ctx, ML, curY, ML + W, curY, 2.5);
    setFont(ctx, 44, '700');
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(sec.title, ML + 20, curY + titleBarH / 2 + 2);
    curY += titleBarH;

    // 2. Column Header Row (White background)
    drawLine(ctx, ML, curY, ML + W, curY, 2.2);
    let colX = ML;
    sec.cols.forEach((col, cIdx) => {
      const cw = colWidths[cIdx];
      if (cIdx > 0) {
        drawLine(ctx, colX, curY, colX, curY + colHeaderH + count * rowH, 2.0, LINE_LIGHT);
      }
      drawWrappedTextInBox(ctx, col.label, colX, curY, cw, colHeaderH, 40, '700', 'center', 30, 8);
      colX += cw;
    });
    curY += colHeaderH;

    // 3. Data & Blank Ruled Rows
    for (let r = 0; r < count; r += 1) {
      drawLine(ctx, ML, curY, ML + W, curY, 1.8, LINE_LIGHT);
      const rowVals = sec.rows[r];
      if (rowVals) {
        let cellX = ML;
        sec.cols.forEach((col, cIdx) => {
          const cw = colWidths[cIdx];
          const val = rowVals[cIdx] ?? '';
          if (val) {
            drawWrappedTextInBox(
              ctx,
              val,
              cellX,
              curY,
              cw,
              rowH,
              40,
              '400',
              col.align,
              26,
              14
            );
          }
          cellX += cw;
        });
      }
      curY += rowH;
    }
  });

  // Outer left, right, and bottom crisp borders for Items 10–13
  drawLine(ctx, ML, tablesTop, ML, curY, 3);
  drawLine(ctx, ML + W, tablesTop, ML + W, curY, 3);
  drawLine(ctx, ML, curY, ML + W, curY, 3);

  // =========================================================================
  // BOTTOM SIGNATURE BLOCK (NO outer rectangle box — exact official PDF!)
  // =========================================================================
  const sigTop = curY + 58;
  const leftCenterX = ML + 540;
  const rightCenterX = ML + W - 540;

  // Left: Owner attestation + signature image + เจ้าของประวัติ
  drawFittedText(
    ctx,
    'ขอรับรองว่าข้อมูลที่ข้าพเจ้ากรอกเป็นความจริงทุกประการ',
    leftCenterX,
    sigTop + 18,
    1040,
    40,
    '400',
    'center',
    30
  );

  // Owner signature image (CORS-safe via GAS getBase64 proxy first)
  if (options.includeOwnerSignature && person.signature_path) {
    const sigImg = await loadSignatureForCanvas(person.signature_path, options);
    if (sigImg) {
      const maxSigW = 420;
      const maxSigH = 128;
      const scale = Math.min(maxSigW / sigImg.naturalWidth, maxSigH / sigImg.naturalHeight, 1);
      const drawW = sigImg.naturalWidth * scale;
      const drawH = sigImg.naturalHeight * scale;
      ctx.drawImage(sigImg, leftCenterX - drawW / 2 + 24, sigTop + 150 - drawH, drawW, drawH);
    }
  }

  setFont(ctx, 42, '400');
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ลงชื่อ .................................................................', leftCenterX, sigTop + 168);
  ctx.fillText('เจ้าของประวัติ', leftCenterX, sigTop + 236);
  drawFittedText(
    ctx,
    formatSlashDateKp7(options.ownerSignDateIso || options.certifyDateIso, useThai),
    leftCenterX,
    sigTop + 306,
    680,
    40,
    '400',
    'center',
    30
  );

  // Right: Head of Agency / Authorized Certifier
  setFont(ctx, 42, '400');
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ลงชื่อ .................................................................', rightCenterX, sigTop + 116);

  const certName = toThaiDigits(cleanDisplaySegment(options.certifierName), useThai);
  if (certName) {
    drawFittedText(ctx, `( ${certName} )`, rightCenterX, sigTop + 178, 920, 42, '400', 'center', 30);
  } else {
    ctx.fillText('( ................................................................. )', rightCenterX, sigTop + 178);
  }

  const certPos = toThaiDigits(cleanDisplaySegment(options.certifierPosition), useThai);
  if (certPos) {
    drawFittedText(ctx, `ตำแหน่ง ${certPos}`, rightCenterX, sigTop + 240, 960, 40, '400', 'center', 28);
  } else {
    ctx.fillText('ตำแหน่ง .................................................................', rightCenterX, sigTop + 240);
  }

  drawFittedText(
    ctx,
    'หัวหน้าส่วนราชการหรือผู้ที่หัวหน้าส่วนราชการมอบหมาย',
    rightCenterX,
    sigTop + 302,
    1020,
    38,
    '400',
    'center',
    28
  );
  drawFittedText(
    ctx,
    formatSlashDateKp7(options.certifyDateIso, useThai),
    rightCenterX,
    sigTop + 362,
    680,
    40,
    '400',
    'center',
    30
  );
}

/**
 * Renders Official KP.7 Page 2+ (Item 14: ตำแหน่งและเงินเดือน) at 300 DPI (2480 x 3508 px).
 * Strictly honors `แบบฟอร์ม กพ7.pdf` Page 2+:
 *  - Single top line outside border: ชื่อ........ กระทรวง........ กรม........ (NO footer!)
 *  - Crisp full-page 8-column table with white headers & multi-line ruled rows
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

  // White A4 background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, KP7_A4_WIDTH, KP7_A4_HEIGHT);

  // =========================================================================
  // TOP HEADER LINE OUTSIDE BORDER: ชื่อ....... กระทรวง....... กรม.......
  // =========================================================================
  const headerY = 160;
  const fullName = toThaiDigits(cleanDisplaySegment(person.full_name), useThai);
  const ministryVal = toThaiDigits(cleanDisplaySegment(options.ministryName), useThai);
  const deptVal = toThaiDigits(
    cleanDisplaySegment(options.departmentName) || cleanDisplaySegment(person.bureau_name),
    useThai
  );

  drawLabeledDottedField(ctx, 'ชื่อ', fullName, ML, headerY, ML + 780, 44, 44);
  drawLabeledDottedField(ctx, 'กระทรวง', ministryVal, ML + 805, headerY, ML + 1515, 44, 44);
  drawLabeledDottedField(ctx, 'กรม', deptVal, ML + 1540, headerY, ML + W, 44, 44);

  // =========================================================================
  // ITEM 14 FULL-PAGE 8-COLUMN TABLE
  // =========================================================================
  const tableTop = 198;
  const tableBottom = 3380;
  const titleH = 74;
  const colHeadH = 104;
  const bodyTop = tableTop + titleH + colHeadH;
  const rowH = (tableBottom - bodyTop) / linesPerPage;

  // Outer border
  ctx.strokeStyle = LINE_DARK;
  ctx.lineWidth = 3;
  ctx.strokeRect(ML, tableTop, W, tableBottom - tableTop);

  // Row 0: Centered title "๑๔. ตำแหน่งและเงินเดือน"
  setFont(ctx, 48, '700');
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${toThaiDigits('14', useThai)}. ตำแหน่งและเงินเดือน`, ML + W / 2, tableTop + titleH / 2 + 2);

  // Divider below title
  drawLine(ctx, ML, tableTop + titleH, ML + W, tableTop + titleH, 2.5);

  // Column headers & full-height vertical dividers
  let colX = ML;
  const colPositions: number[] = [];
  P2_COLS.forEach((col, idx) => {
    colPositions.push(colX);
    if (idx > 0) {
      drawLine(ctx, colX, tableTop + titleH, colX, tableBottom, 2.0, LINE_DARK);
    }

    const headY = tableTop + titleH;
    if (col.label.length === 1) {
      drawFittedText(
        ctx,
        col.label[0],
        colX + col.width / 2,
        headY + colHeadH / 2,
        col.width - 14,
        42,
        '700',
        'center',
        30
      );
    } else {
      const lGap = 44;
      const startY = headY + colHeadH / 2 - ((col.label.length - 1) * lGap) / 2;
      col.label.forEach((lbl, li) => {
        drawFittedText(
          ctx,
          lbl,
          colX + col.width / 2,
          startY + li * lGap,
          col.width - 14,
          40,
          '700',
          'center',
          28
        );
      });
    }
    colX += col.width;
  });

  // Divider below column headers
  drawLine(ctx, ML, bodyTop, ML + W, bodyTop, 2.5);

  // Render ruled rows (linesPerPage rows filling full A4 page cleanly)
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
      const pad = 14;
      const anchorX =
        col.align === 'center'
          ? cx + col.width / 2
          : col.align === 'right'
            ? cx + col.width - pad
            : cx + pad;
      drawFittedText(
        ctx,
        val,
        anchorX,
        midY,
        col.width - pad * 2,
        42,
        '400',
        col.align,
        26
      );
    });
  }
}

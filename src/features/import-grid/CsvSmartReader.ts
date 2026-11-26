import Papa from 'papaparse';
import { loadExcelJS } from '@/lib/vendorBridge';
import { normalizeLookupText, similarityScore } from '@/lib/fuzzy-match';
import { IMPORT_COLUMNS } from './importColumnsConfig';
import type { ImportSourceFormat } from '@/types/database.types';
import type { ColumnMappingEntry, ImportColumnKey } from '@/types/import.types';

export type CsvEncodingMode = 'auto' | 'utf-8' | 'windows-874';

export interface ParsedImportTable {
  fileName: string;
  sourceFormat: ImportSourceFormat;
  detectedEncoding: 'utf-8-bom' | 'utf-8' | 'windows-874' | 'xlsx' | 'clipboard';
  headers: string[];
  rows: string[][];
  rawBuffer?: ArrayBuffer;
}

/**
 * Decode CSV bytes cleanly:
 * 1. Check UTF-8 BOM (EF BB BF)
 * 2. Strict TextDecoder('utf-8', { fatal: true })
 * 3. Fallback to Thai Windows-874 / TIS-620 (common Excel Save As CSV on Windows)
 */
export function decodeCsvArrayBuffer(
  buffer: ArrayBuffer,
  mode: CsvEncodingMode = 'auto'
): { text: string; detectedEncoding: 'utf-8-bom' | 'utf-8' | 'windows-874' } {
  const bytes = new Uint8Array(buffer);

  if (mode === 'windows-874') {
    const decoder = new TextDecoder('windows-874');
    return { text: decoder.decode(bytes), detectedEncoding: 'windows-874' };
  }

  const hasUtf8Bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (hasUtf8Bom) {
    const decoder = new TextDecoder('utf-8');
    return { text: decoder.decode(bytes.subarray(3)), detectedEncoding: 'utf-8-bom' };
  }

  if (mode === 'utf-8') {
    const decoder = new TextDecoder('utf-8');
    return { text: decoder.decode(bytes), detectedEncoding: 'utf-8' };
  }

  try {
    const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
    const text = strictUtf8.decode(bytes);
    return { text, detectedEncoding: 'utf-8' };
  } catch {
    const thaiDecoder = new TextDecoder('windows-874');
    return { text: thaiDecoder.decode(bytes), detectedEncoding: 'windows-874' };
  }
}

export function parseCsvText(
  text: string,
  fileName: string,
  detectedEncoding: 'utf-8-bom' | 'utf-8' | 'windows-874',
  rawBuffer?: ArrayBuffer
): ParsedImportTable {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });

  const matrix = (parsed.data || []).map((row) => row.map((cell) => String(cell ?? '').trim()));
  const nonEmpty = matrix.filter((r) => r.some((c) => c.length > 0));
  if (nonEmpty.length === 0) {
    return { fileName, sourceFormat: 'CSV', detectedEncoding, headers: [], rows: [], rawBuffer };
  }

  const [headerRow, ...dataRows] = nonEmpty;
  const headers = headerRow.map((h, idx) => h || `Column ${idx + 1}`);
  return {
    fileName,
    sourceFormat: 'CSV',
    detectedEncoding,
    headers,
    rows: dataRows,
    rawBuffer,
  };
}

export async function parseCsvFile(
  file: File,
  mode: CsvEncodingMode = 'auto'
): Promise<ParsedImportTable> {
  const buffer = await file.arrayBuffer();
  const { text, detectedEncoding } = decodeCsvArrayBuffer(buffer, mode);
  return parseCsvText(text, file.name, detectedEncoding, buffer);
}

export function redecodeCsvBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  mode: CsvEncodingMode
): ParsedImportTable {
  const { text, detectedEncoding } = decodeCsvArrayBuffer(buffer, mode);
  return parseCsvText(text, fileName, detectedEncoding, buffer);
}

function stringifyExcelCellValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    const dd = String(val.getDate()).padStart(2, '0');
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const yyyy = val.getFullYear();
    const beYear = yyyy < 2400 ? yyyy + 543 : yyyy;
    return `${dd}/${mm}/${beYear}`;
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if ('text' in obj && typeof obj.text === 'string') return obj.text.trim();
    if ('result' in obj && obj.result !== undefined) return stringifyExcelCellValue(obj.result);
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((r) => r.text || '').join('').trim();
    }
  }
  return String(val).trim();
}

export async function parseExcelFile(file: File): Promise<ParsedImportTable> {
  const ExcelJS = await loadExcelJS();
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // Prefer data sheet (ignore helper/reference sheets starting with _ or Master)
  const worksheet =
    workbook.worksheets.find((ws) => !ws.name.startsWith('_') && ws.name !== 'MasterData') ||
    workbook.worksheets[0];

  if (!worksheet) {
    return {
      fileName: file.name,
      sourceFormat: 'XLSX',
      detectedEncoding: 'xlsx',
      headers: [],
      rows: [],
    };
  }

  const matrix: string[][] = [];
  const colCount = worksheet.columnCount;

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c += 1) {
      cells.push(stringifyExcelCellValue(row.getCell(c).value));
    }
    if (cells.some((v) => v.length > 0)) {
      matrix.push(cells);
    }
  });

  if (matrix.length === 0) {
    return {
      fileName: file.name,
      sourceFormat: 'XLSX',
      detectedEncoding: 'xlsx',
      headers: [],
      rows: [],
    };
  }

  const [headerRow, ...dataRows] = matrix;
  const headers = headerRow.map((h, idx) => h || `Column ${idx + 1}`);
  return {
    fileName: file.name,
    sourceFormat: 'XLSX',
    detectedEncoding: 'xlsx',
    headers,
    rows: dataRows,
  };
}

/**
 * Parse TSV/CSV pasted directly from Google Sheets or Microsoft Excel
 */
export function parseClipboardTable(rawText: string): ParsedImportTable {
  const cleaned = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!cleaned) {
    return {
      fileName: 'clipboard-paste.tsv',
      sourceFormat: 'CLIPBOARD',
      detectedEncoding: 'clipboard',
      headers: [],
      rows: [],
    };
  }

  const hasTabs = cleaned.includes('\t');
  const parsed = Papa.parse<string[]>(cleaned, {
    delimiter: hasTabs ? '\t' : undefined,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });

  const matrix = (parsed.data || [])
    .map((row) => row.map((c) => String(c ?? '').trim()))
    .filter((row) => row.some((c) => c.length > 0));

  if (matrix.length === 0) {
    return {
      fileName: 'clipboard-paste.tsv',
      sourceFormat: 'CLIPBOARD',
      detectedEncoding: 'clipboard',
      headers: [],
      rows: [],
    };
  }

  const [firstRow, ...restRows] = matrix;

  // Heuristic: check if firstRow matches known headers; if not, treat all rows as data with generic headers
  const matchedHeadersCount = firstRow.filter((h) => Boolean(guessColumnKeyFromHeader(h))).length;
  const looksLikeHeader = matchedHeadersCount >= Math.min(2, firstRow.length) || restRows.length > 0 && matchedHeadersCount >= 1;

  if (looksLikeHeader) {
    return {
      fileName: 'clipboard-paste.tsv',
      sourceFormat: 'CLIPBOARD',
      detectedEncoding: 'clipboard',
      headers: firstRow.map((h, idx) => h || `Column ${idx + 1}`),
      rows: restRows,
    };
  }

  return {
    fileName: 'clipboard-paste.tsv',
    sourceFormat: 'CLIPBOARD',
    detectedEncoding: 'clipboard',
    headers: firstRow.map((_, idx) => IMPORT_COLUMNS[idx]?.labelTh || `Column ${idx + 1}`),
    rows: matrix,
  };
}

export function guessColumnKeyFromHeader(header: string): ImportColumnKey | null {
  const norm = normalizeLookupText(header);
  if (!norm) return null;

  // 1. Exact synonym / label / key match
  for (const col of IMPORT_COLUMNS) {
    if (normalizeLookupText(col.key) === norm || normalizeLookupText(col.labelTh) === norm) {
      return col.key;
    }
    for (const syn of col.synonyms) {
      if (normalizeLookupText(syn) === norm) return col.key;
    }
  }

  // 2. Contains / high similarity match
  let bestKey: ImportColumnKey | null = null;
  let bestScore = 0.72;
  for (const col of IMPORT_COLUMNS) {
    const candidates = [col.labelTh, col.key, ...col.synonyms];
    for (const cand of candidates) {
      const score = similarityScore(norm, cand);
      if (score > bestScore) {
        bestScore = score;
        bestKey = col.key;
      }
    }
  }
  return bestKey;
}

export function autoMapHeaders(headers: string[]): ColumnMappingEntry[] {
  const usedTargets = new Set<ImportColumnKey>();
  return headers.map((sourceHeader, sourceIndex) => {
    const guessed = guessColumnKeyFromHeader(sourceHeader);
    if (guessed && !usedTargets.has(guessed)) {
      usedTargets.add(guessed);
      return { sourceHeader, sourceIndex, targetKey: guessed };
    }
    return { sourceHeader, sourceIndex, targetKey: null };
  });
}

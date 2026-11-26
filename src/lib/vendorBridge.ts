import type ExcelJS from 'exceljs';

let cachedExcelJs: typeof ExcelJS | null = null;

/**
 * Lazy-load ExcelJS browser bundle on demand (zero initial bundle overhead)
 */
export async function loadExcelJS(): Promise<typeof ExcelJS> {
  if (cachedExcelJs) return cachedExcelJs;
  const mod = await import('exceljs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolved = ((mod as any).default || mod) as typeof ExcelJS;
  cachedExcelJs = resolved;
  return resolved;
}

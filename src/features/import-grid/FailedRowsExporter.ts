import { loadExcelJS } from '@/lib/vendorBridge';
import { getTodayBeFileTag } from '@/lib/thaiDate';
import { IMPORT_COLUMNS, IMPORT_COLUMN_MAP } from './importColumnsConfig';
import type { ImportBatchCommitResult, ImportColumnKey, StagingRow } from '@/types/import.types';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export ONLY red (ERROR) staging rows to .xlsx with appended error explanation column
 */
export async function exportFailedStagingRowsToExcel(rows: StagingRow[]): Promise<number> {
  const redRows = rows.filter((r) => r.errorCount > 0);
  if (redRows.length === 0) return 0;

  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Failed_Rows');

  ws.columns = [
    { header: 'แถวเดิม', key: '_sheetRowNo', width: 10 },
    ...IMPORT_COLUMNS.map((c) => ({
      header: c.labelTh,
      key: c.key,
      width: Math.max(15, Math.round(c.width / 8)),
    })),
    { header: 'สาเหตุข้อผิดพลาดทั้งหมด', key: '_errorReasons', width: 55 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Sarabun', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // Preserve CID & Phone as text
  ws.getColumn(3).numFmt = '@'; // cid
  ws.getColumn(10).numFmt = '@'; // phone_number

  for (const row of redRows) {
    const reasons: string[] = [];
    for (const [k, v] of Object.entries(row.validations)) {
      if (v?.status === 'ERROR') {
        const label = IMPORT_COLUMN_MAP[k as ImportColumnKey]?.labelTh || k;
        reasons.push(`[${label}] ${v.message || v.code}`);
      }
    }
    const obj: Record<string, string | number> = {
      _sheetRowNo: row.sheetRowNo,
      _errorReasons: reasons.join(' | '),
    };
    for (const col of IMPORT_COLUMNS) {
      obj[col.key] = row.cells[col.key] || '';
    }
    ws.addRow(obj);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `PortalSSO_Failed_Rows_${getTodayBeFileTag()}.xlsx`);
  return redRows.length;
}

/**
 * Export Step 4 Commit Summary Report (.xlsx)
 */
export async function exportCommitSummaryReport(result: ImportBatchCommitResult): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();

  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'รายการ', key: 'label', width: 32 },
    { header: 'ผลลัพธ์', key: 'value', width: 36 },
  ];
  summary.addRows([
    { label: 'รหัสงานนำเข้า (Job ID)', value: result.jobId },
    { label: 'รูปแบบต้นทาง', value: result.sourceFormat },
    { label: 'โหมดการนำเข้า', value: result.mode },
    { label: 'จำนวนแถวทั้งหมดที่ส่งบันทึก', value: result.totalRows },
    { label: 'เพิ่มใหม่สำเร็จ (Inserted)', value: result.inserted },
    { label: 'อัปเดตสำเร็จ (Updated)', value: result.updated },
    { label: 'ข้าม (Skipped)', value: result.skipped },
    { label: 'ล้มเหลว (Failed)', value: result.failed },
    { label: 'สร้างบัญชีผู้ใช้อัตโนมัติ (Accounts)', value: result.accountsCreated },
  ]);

  if (result.errors.length > 0) {
    const errSheet = wb.addWorksheet('Server_Errors');
    errSheet.columns = [
      { header: 'แถว', key: 'sheetRowNo', width: 10 },
      { header: 'เลขบัตร (PDPA Masked)', key: 'cidMasked', width: 24 },
      { header: 'คอลัมน์', key: 'columnKey', width: 22 },
      { header: 'รหัสผิดพลาด', key: 'errorCode', width: 24 },
      { header: 'รายละเอียด', key: 'errorMessage', width: 50 },
    ];
    errSheet.addRows(result.errors);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `PortalSSO_Import_Summary_${result.jobId.slice(0, 8)}.xlsx`);
}

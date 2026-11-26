import { loadExcelJS } from '@/lib/vendorBridge';
import { getTodayBeFileTag } from '@/lib/thaiDate';
import {
  compareLookupItems,
  compareOrgUnits,
  comparePositionLevels,
  comparePositions,
  comparePositionTypes,
  flattenOrgUnitsInTreeOrder,
} from '@/lib/masterDataSort';
import { IMPORT_COLUMN_MAP, IMPORT_COLUMNS } from './importColumnsConfig';
import type { AdminScopeInfo, MasterDataBundle } from '@/types/domain.types';

function triggerDownload(blob: Blob, filename: string) {
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
 * Builds a live, Zero-Hardcode example row directly from active MasterDataBundle + Admin Scope
 * so uploading the downloaded template back passes validation with 0 red errors.
 */
export function buildLiveExampleRow(
  master: MasterDataBundle,
  adminScope: AdminScopeInfo | null,
  isSuperAdmin: boolean
): Record<string, string> {
  const exampleRowObj: Record<string, string> = {};
  for (const col of IMPORT_COLUMNS) {
    exampleRowObj[col.key] = col.example;
  }

  const pickLookup = (cat: string) => {
    const list = (master.itemsByCategoryCode[cat] || []).filter((i) => i.is_active);
    return (list.find((i) => i.is_default) || list[0])?.name_th || '';
  };

  exampleRowObj.prefix_id = pickLookup('PREFIX') || exampleRowObj.prefix_id;
  exampleRowObj.gender_id = pickLookup('GENDER') || exampleRowObj.gender_id;
  exampleRowObj.employment_type_id = pickLookup('EMPLOYMENT_TYPE') || exampleRowObj.employment_type_id;
  exampleRowObj.approval_tier_id = pickLookup('APPROVAL_TIER') || exampleRowObj.approval_tier_id;
  exampleRowObj.status_id = pickLookup('PERSONNEL_STATUS') || exampleRowObj.status_id;

  // Live position cascade
  const activePositions = master.positions.filter((p) => p.is_active);
  const samplePos = activePositions[0];
  if (samplePos) {
    const sampleType = master.positionTypes.find((t) => t.id === samplePos.position_type_id);
    exampleRowObj.position_type_id = sampleType?.name_th || '';
    exampleRowObj.position_id = samplePos.name_th;
    if (samplePos.requires_level) {
      const allowedIds = new Set(
        master.positionAllowedLevels
          .filter((a) => a.position_id === samplePos.id)
          .map((a) => a.position_level_id)
      );
      const lvl =
        master.positionLevels.find((l) => l.is_active && (allowedIds.size === 0 || allowedIds.has(l.id))) ||
        master.positionLevels[0];
      exampleRowObj.position_level_id = lvl?.name_th || '';
    } else {
      exampleRowObj.position_level_id = '';
    }
  } else {
    exampleRowObj.position_type_id = master.positionTypes.find((t) => t.is_active)?.name_th || '';
    exampleRowObj.position_id = '';
    exampleRowObj.position_level_id = '';
  }

  // Live 4-level org cascade scoped to admin
  const bureaus = master.orgUnits.filter((u) => u.is_active && u.level_no === 1);
  const offices = master.orgUnits.filter((u) => u.is_active && u.level_no === 2);
  const depts = master.orgUnits.filter((u) => u.is_active && u.level_no === 3);
  const divs = master.orgUnits.filter((u) => u.is_active && u.level_no === 4);

  const scopedOffice =
    !isSuperAdmin && adminScope?.scope_level_no === 2
      ? offices.find((o) => o.id === adminScope.org_unit_id)
      : !isSuperAdmin && adminScope?.scope_level_no === 3
        ? offices.find((o) => o.id === adminScope.parent_office_id)
        : offices[0];

  const scopedBureau =
    (scopedOffice?.parent_id && bureaus.find((b) => b.id === scopedOffice.parent_id)) || bureaus[0];

  const scopedDept =
    !isSuperAdmin && adminScope?.scope_level_no === 3
      ? depts.find((d) => d.id === adminScope.org_unit_id)
      : depts.find((d) => scopedOffice && d.parent_id === scopedOffice.id);

  const scopedDiv = divs.find((dv) => scopedDept && dv.parent_id === scopedDept.id);

  exampleRowObj.bureau_id = scopedBureau?.name_th || '';
  exampleRowObj.office_id = scopedOffice?.name_th || '';
  exampleRowObj.department_id = scopedDept?.name_th || '';
  exampleRowObj.division_id = scopedDiv?.name_th || '';

  return exampleRowObj;
}

/**
 * Dynamically builds an .xlsx template with:
 * - Live Master Data dropdown lists (all 4 Org levels including Lv4 col T, scoped to Admin if Lv2/Lv3)
 * - Text format '@' forced on CID (Col B) & Phone (Col I)
 * - DataValidation extended to row 2001 (matching Import_Max_Rows=2000)
 */
export async function downloadDynamicExcelTemplate(
  master: MasterDataBundle,
  adminScope: AdminScopeInfo | null,
  isSuperAdmin: boolean
): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Portal SSO v2.5.0 (STB-APP)';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Personnel_Import', {
    views: [{ state: 'frozen', xSplit: 5, ySplit: 1 }],
  });

  sheet.columns = IMPORT_COLUMNS.map((col) => ({
    header: col.labelTh,
    key: col.key,
    width: Math.max(16, Math.round(col.width / 7)),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell, colNumber) => {
    const def = IMPORT_COLUMNS[colNumber - 1];
    cell.font = { name: 'Sarabun', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: def?.required ? 'FF005C3B' : 'FF00744B' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1FAE5' } },
      bottom: { style: 'medium', color: { argb: 'FF00351B' } },
      left: { style: 'thin', color: { argb: 'FFD1FAE5' } },
      right: { style: 'thin', color: { argb: 'FFD1FAE5' } },
    };
  });

  const exampleRowObj = buildLiveExampleRow(master, adminScope, isSuperAdmin);
  const sampleRow = sheet.addRow(exampleRowObj);
  sampleRow.font = { name: 'Sarabun', size: 11, color: { argb: 'FF475569' } };

  // Force Text format '@' on CID (Col A=1), Phone (Col H=8), Position Number (Col M=13)
  for (const cIdx of [1, 8, 13]) {
    sheet.getColumn(cIdx).numFmt = '@';
  }

  const treeUnits = flattenOrgUnitsInTreeOrder(master.orgUnits, { activeOnly: true }).map((n) => n.unit);
  const bureaus = treeUnits.filter((u) => u.level_no === 1);
  const offices = treeUnits.filter((u) => u.level_no === 2);
  const depts = treeUnits.filter((u) => u.level_no === 3);
  const divs = treeUnits.filter((u) => u.level_no === 4);

  const scopedOffice =
    !isSuperAdmin && adminScope?.scope_level_no === 2
      ? offices.find((o) => o.id === adminScope.org_unit_id)
      : !isSuperAdmin && adminScope?.scope_level_no === 3
        ? offices.find((o) => o.id === adminScope.parent_office_id)
        : undefined;
  const scopedDept =
    !isSuperAdmin && adminScope?.scope_level_no === 3
      ? depts.find((d) => d.id === adminScope.org_unit_id)
      : undefined;

  const sortedLookups = (code: string) =>
    (master.itemsByCategoryCode[code] || [])
      .filter((i) => i.is_active)
      .sort(compareLookupItems)
      .map((i) => i.name_th);

  const refSheet = wb.addWorksheet('MasterData', { state: 'veryHidden' });
  const listColumns: Array<{ targetExcelCol: string; header: string; values: string[] }> = [
    { targetExcelCol: IMPORT_COLUMN_MAP.prefix_id.excelCol, header: 'PREFIX', values: sortedLookups('PREFIX') },
    { targetExcelCol: IMPORT_COLUMN_MAP.gender_id.excelCol, header: 'GENDER', values: sortedLookups('GENDER') },
    { targetExcelCol: IMPORT_COLUMN_MAP.employment_type_id.excelCol, header: 'EMPLOYMENT_TYPE', values: sortedLookups('EMPLOYMENT_TYPE') },
    {
      targetExcelCol: IMPORT_COLUMN_MAP.position_type_id.excelCol,
      header: 'POSITION_TYPE',
      values: master.positionTypes.filter((t) => t.is_active).sort(comparePositionTypes).map((t) => t.name_th),
    },
    {
      targetExcelCol: IMPORT_COLUMN_MAP.position_id.excelCol,
      header: 'POSITION',
      values: master.positions.filter((p) => p.is_active).sort(comparePositions).map((p) => p.name_th),
    },
    {
      targetExcelCol: IMPORT_COLUMN_MAP.position_level_id.excelCol,
      header: 'POSITION_LEVEL',
      values: master.positionLevels.filter((l) => l.is_active).sort(comparePositionLevels).map((l) => l.name_th),
    },
    { targetExcelCol: IMPORT_COLUMN_MAP.bureau_id.excelCol, header: 'BUREAU', values: bureaus.map((b) => b.name_th) },
    {
      targetExcelCol: IMPORT_COLUMN_MAP.office_id.excelCol,
      header: 'OFFICE',
      values: scopedOffice ? [scopedOffice.name_th] : offices.map((o) => o.name_th),
    },
    {
      targetExcelCol: IMPORT_COLUMN_MAP.department_id.excelCol,
      header: 'DEPARTMENT',
      values: scopedDept
        ? [scopedDept.name_th]
        : scopedOffice
          ? depts.filter((d) => d.parent_id === scopedOffice.id).sort(compareOrgUnits).map((d) => d.name_th)
          : depts.map((d) => d.name_th),
    },
    {
      targetExcelCol: IMPORT_COLUMN_MAP.division_id.excelCol,
      header: 'DIVISION',
      values: scopedDept
        ? divs.filter((dv) => dv.parent_id === scopedDept.id).sort(compareOrgUnits).map((dv) => dv.name_th)
        : divs.map((dv) => dv.name_th),
    },
    { targetExcelCol: IMPORT_COLUMN_MAP.approval_tier_id.excelCol, header: 'APPROVAL_TIER', values: sortedLookups('APPROVAL_TIER') },
    { targetExcelCol: IMPORT_COLUMN_MAP.status_id.excelCol, header: 'PERSONNEL_STATUS', values: sortedLookups('PERSONNEL_STATUS') },
  ];

  listColumns.forEach((entry, idx) => {
    const colIdx = idx + 1;
    const colLetter = refSheet.getColumn(colIdx).letter;
    refSheet.getCell(1, colIdx).value = entry.header;
    const uniqueVals = Array.from(new Set(entry.values)).filter(Boolean);
    uniqueVals.forEach((val, rowOffset) => {
      refSheet.getCell(rowOffset + 2, colIdx).value = val;
    });
    if (uniqueVals.length > 0) {
      const rangeFormula = `MasterData!$${colLetter}$2:$${colLetter}$${uniqueVals.length + 1}`;
      for (let r = 2; r <= 2001; r += 1) {
        sheet.getCell(`${entry.targetExcelCol}${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [rangeFormula],
          showErrorMessage: false,
        };
      }
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const dateTag = getTodayBeFileTag();
  triggerDownload(blob, `PortalSSO_Personnel_Template_${dateTag}.xlsx`);
}

/**
 * Export UTF-8 with BOM CSV Template using live MasterDataBundle (NO broken leading apostrophes)
 */
export function downloadCsvUtf8BomTemplate(
  master?: MasterDataBundle,
  adminScope: AdminScopeInfo | null = null,
  isSuperAdmin = true
): void {
  const headers = IMPORT_COLUMNS.map((c) => `"${c.labelTh.replace(/"/g, '""')}"`).join(',');
  const liveExample = master ? buildLiveExampleRow(master, adminScope, isSuperAdmin) : null;
  const example = IMPORT_COLUMNS.map((c) => {
    const val = liveExample ? liveExample[c.key] ?? '' : c.example;
    return `"${val.replace(/"/g, '""')}"`;
  }).join(',');
  const csvContent = `\uFEFF${headers}\r\n${example}\r\n`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const dateTag = getTodayBeFileTag();
  triggerDownload(blob, `PortalSSO_Personnel_Template_${dateTag}.csv`);
}

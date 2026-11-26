import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { useMasterData } from '@/hooks/useMasterData';
import { useScopedPermissions } from '@/hooks/useScopedPermissions';
import { useSettings } from '@/contexts/SettingsContext';
import { useUiStore } from '@/stores/useUiStore';
import { useImportSheetStore } from '@/stores/useImportSheetStore';
import { importService } from '@/services/importService';
import { confirmAction, showAlert } from '@/lib/swalHelpers';
import { validateCid } from '@/lib/cidValidator';
import {
  autoMapHeaders,
  parseClipboardTable,
  parseCsvFile,
  parseExcelFile,
  redecodeCsvBuffer,
  type CsvEncodingMode,
} from '@/features/import-grid/CsvSmartReader';
import {
  downloadCsvUtf8BomTemplate,
  downloadDynamicExcelTemplate,
} from '@/features/import-grid/DynamicExcelTemplateBuilder';
import { IMPORT_COLUMNS } from '@/features/import-grid/importColumnsConfig';
import { RelationalHierarchyIndex } from '@/features/import-grid/RelationalHierarchyIndex';
import { ColumnMappingStep } from '@/features/import-grid/ColumnMappingStep';
import { SpreadsheetStagingGrid } from '@/features/import-grid/SpreadsheetStagingGrid';
import { BulkValueMappingDrawer } from '@/features/import-grid/BulkValueMappingDrawer';
import { UpsertDiffModal } from '@/features/import-grid/UpsertDiffModal';
import {
  exportCommitSummaryReport,
  exportFailedStagingRowsToExcel,
} from '@/features/import-grid/FailedRowsExporter';
import type { ImportCommitMode } from '@/types/database.types';

const STEPS = [
  { no: 1, title: 'นำเข้าไฟล์ / วางข้อมูล', icon: 'fa-file-arrow-up' },
  { no: 2, title: 'จับคู่คอลัมน์อัจฉริยะ', icon: 'fa-table-columns' },
  { no: 3, title: 'ตรวจสอบและแก้ไขในตาราง', icon: 'fa-table-cells' },
  { no: 4, title: 'ยืนยันบันทึกและสรุปผล', icon: 'fa-circle-check' },
] as const;

export default function PersonnelImportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: master } = useMasterData();
  const { isSuperAdmin, adminScope, scopeLabel } = useScopedPermissions();
  const { settings } = useSettings();
  const showToast = useUiStore((s) => s.showToast);

  const store = useImportSheetStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [pasteText, setPasteText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isCheckingCids, setIsCheckingCids] = useState(false);
  const [isDownloadingTpl, setIsDownloadingTpl] = useState(false);
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');

  // High-speed relational index (< 50ms for 2,000 rows)
  const hierarchyIndex = useMemo(() => new RelationalHierarchyIndex(master), [master]);
  const validationCtx = useMemo(
    () => ({ index: hierarchyIndex, isSuperAdmin, adminScope }),
    [hierarchyIndex, isSuperAdmin, adminScope]
  );

  // PDPA Safety: warn before closing/refreshing tab while sensitive staged rows live in RAM
  useEffect(() => {
    const hasUnsavedRamRows = store.step === 3 && store.rows.length > 0 && !store.commitResult;
    if (!hasUnsavedRamRows) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [store.step, store.rows.length, store.commitResult]);

  const handleFileSelected = async (file: File) => {
    setIsParsing(true);
    try {
      const lower = file.name.toLowerCase();
      const parsed = lower.endsWith('.csv')
        ? await parseCsvFile(file, 'auto')
        : lower.endsWith('.xlsx') || lower.endsWith('.xls')
          ? await parseExcelFile(file)
          : null;

      if (!parsed) {
        await showAlert('ไฟล์ไม่รองรับ', 'กรุณาเลือกไฟล์ .xlsx หรือ .csv เท่านั้น', 'warning');
        return;
      }
      if (parsed.rows.length === 0) {
        await showAlert('ไม่พบข้อมูลในไฟล์', 'ไฟล์ที่เลือกไม่มีแถวข้อมูลสำหรับนำเข้า', 'warning');
        return;
      }
      if (parsed.rows.length > settings.import_max_rows) {
        await showAlert(
          'จำนวนแถวเกินขีดจำกัด',
          `ไฟล์นี้มี ${parsed.rows.length.toLocaleString()} แถว เกินขีดจำกัดที่ระบบตั้งไว้ (${settings.import_max_rows.toLocaleString()} แถวต่อครั้ง)`,
          'warning'
        );
        return;
      }

      const mappings = autoMapHeaders(parsed.headers);
      store.setParsedTable({
        fileName: parsed.fileName,
        sourceFormat: parsed.sourceFormat,
        detectedEncoding: parsed.detectedEncoding,
        headers: parsed.headers,
        rows: parsed.rows,
        mappings,
        rawBuffer: parsed.rawBuffer ?? null,
        encodingOverride: 'auto',
      });
      showToast(`อ่านไฟล์สำเร็จ (${parsed.rows.length.toLocaleString()} แถว)`, 'success');
    } catch (err) {
      await showAlert(
        'ไม่สามารถอ่านไฟล์ได้',
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างอ่านไฟล์',
        'error'
      );
    } finally {
      setIsParsing(false);
    }
  };

  const handleClipboardImport = () => {
    const parsed = parseClipboardTable(pasteText);
    if (parsed.rows.length === 0) {
      showToast('กรุณาวางข้อมูลตารางอย่างน้อย 1 แถว', 'warning');
      return;
    }
    if (parsed.rows.length > settings.import_max_rows) {
      showToast(`จำนวนแถวเกินขีดจำกัด ${settings.import_max_rows.toLocaleString()} แถว`, 'error');
      return;
    }
    const mappings = autoMapHeaders(parsed.headers);
    store.setParsedTable({
      fileName: parsed.fileName,
      sourceFormat: 'CLIPBOARD',
      detectedEncoding: 'clipboard',
      headers: parsed.headers,
      rows: parsed.rows,
      mappings,
    });
    showToast(`อ่านข้อมูลจากคลิปบอร์ดสำเร็จ (${parsed.rows.length.toLocaleString()} แถว)`, 'success');
  };

  const handleEncodingChange = (mode: CsvEncodingMode) => {
    if (!store.rawBuffer) return;
    const reparsed = redecodeCsvBuffer(store.rawBuffer, store.fileName, mode);
    const mappings = autoMapHeaders(reparsed.headers);
    store.setParsedTable({
      fileName: reparsed.fileName,
      sourceFormat: 'CSV',
      detectedEncoding: reparsed.detectedEncoding,
      headers: reparsed.headers,
      rows: reparsed.rows,
      mappings,
      rawBuffer: store.rawBuffer,
      encodingOverride: mode,
    });
  };

  const handleProceedToGrid = async () => {
    setIsCheckingCids(true);
    try {
      const cidMapping = store.columnMappings.find((m) => m.targetKey === 'cid');
      const candidateCids: string[] = [];
      if (cidMapping) {
        for (const r of store.rawRows) {
          const check = validateCid(r[cidMapping.sourceIndex] || '');
          if (check.valid) candidateCids.push(check.normalized);
        }
      }
      const existingMap = await importService
        .checkExistingCids(candidateCids)
        .catch(() => new Map());
      store.buildAndValidateStaging(validationCtx, existingMap);
    } finally {
      setIsCheckingCids(false);
    }
  };

  const selectedRows = useMemo(() => store.rows.filter((r) => r.selected), [store.rows]);
  const selectedRedRows = useMemo(() => selectedRows.filter((r) => r.errorCount > 0), [selectedRows]);
  const readyRowsToCommit = useMemo(
    () => (store.skipRedRows ? selectedRows.filter((r) => r.errorCount === 0) : selectedRows),
    [selectedRows, store.skipRedRows]
  );
  const updateRowsToCommit = useMemo(
    () => readyRowsToCommit.filter((r) => r.rowStatus === 'UPDATE' && r.existingSnapshot),
    [readyRowsToCommit]
  );

  const canCommit =
    readyRowsToCommit.length > 0 && (store.skipRedRows || selectedRedRows.length === 0);

  const executeCommit = async () => {
    if (readyRowsToCommit.length === 0) return;
    setIsCommitting(true);
    store.setStep(4);
    setProgressPct(5);
    setProgressLabel('กำลังเริ่มต้นงานนำเข้าข้อมูลบุคลากร...');

    try {
      const res = await importService.commitStagingRows({
        fileName: store.fileName || 'manual-import',
        sourceFormat: store.sourceFormat,
        mode: store.mode,
        rows: readyRowsToCommit,
        chunkSize: settings.import_chunk_size || 200,
        autoProvisionAccounts: store.autoProvision,
        onProgress: (pct, label) => {
          setProgressPct(pct);
          setProgressLabel(label);
        },
      });
      store.setCommitResult(res);
      await qc.invalidateQueries({ queryKey: ['personnel'] });
      await qc.invalidateQueries({ queryKey: ['users'] });
      showToast('ดำเนินการนำเข้าข้อมูลบุคลากรเสร็จสิ้น', 'success');
    } catch (err) {
      await showAlert(
        'เกิดข้อผิดพลาดระหว่างบันทึกข้อมูล',
        err instanceof Error ? err.message : 'ไม่สามารถบันทึกข้อมูลเข้าฐานข้อมูลได้',
        'error'
      );
      store.setStep(3);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleRequestCommit = async () => {
    if (!canCommit) {
      await showAlert(
        'ยังมีจุดแดงที่ต้องแก้ไข',
        `พบแถวสีแดงจำนวน ${selectedRedRows.length} แถว กรุณาแก้ไขให้ครบหรือเปิดตัวเลือก "ข้ามแถวสีแดงและนำเข้าเฉพาะแถวที่ผ่าน"`,
        'warning'
      );
      return;
    }

    if (store.mode === 'UPSERT' && updateRowsToCommit.length > 0) {
      setDiffModalOpen(true);
      return;
    }

    const ok = await confirmAction(
      'ยืนยันนำเข้าข้อมูลบุคลากร',
      `ต้องการนำเข้าข้อมูลจำนวน ${readyRowsToCommit.length.toLocaleString()} รายการ (${
        store.mode === 'UPSERT' ? 'เพิ่มใหม่และอัปเดตข้อมูลเดิม' : 'เพิ่มใหม่เท่านั้น'
      })${store.autoProvision ? ' พร้อมสร้างบัญชีผู้ใช้ SSO อัตโนมัติ' : ''} ใช่หรือไม่?`,
      'ยืนยันนำเข้าข้อมูล',
      'question'
    );
    if (ok) await executeCommit();
  };

  const totalImportCols = IMPORT_COLUMNS.length;
  const lastImportColLetter = IMPORT_COLUMNS[IMPORT_COLUMNS.length - 1]?.excelCol || 'AA';

  return (
    <AdminLayout
      title="นำเข้าบุคลากร (CSV / Excel)"
      subtitle={`ตารางพักข้อมูลเสมือน Google Sheets ตรวจสายแม่-ลูก ${totalImportCols} คอลัมน์พร้อมไฮไลท์จุดผิดทันที`}
      activePage="personnel"
    >
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#005C3B] to-[#00A368] text-white flex items-center justify-center shadow">
              <i className="fa-solid fa-file-import text-base" />
            </span>
            นำเข้าข้อมูลบุคลากรแบบตารางอัจฉริยะ (Bulk Import)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            รองรับ Excel (.xlsx), CSV (UTF-8 / Windows-874) และวางจาก Google Sheets · ขอบเขตสิทธิ์:{' '}
            <strong className="text-[#00744B] dark:text-emerald-400">{scopeLabel}</strong>
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/admin/personnel')}
          className="bma-btn-outline text-xs"
        >
          <i className="fa-solid fa-arrow-left mr-1.5" />
          กลับหน้าทะเบียนบุคลากร
        </button>
      </div>

      {/* 4-Step Wizard Indicator */}
      <div className="bma-card p-3 sm:p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STEPS.map((st) => {
            const active = store.step === st.no;
            const done = store.step > st.no;
            return (
              <div
                key={st.no}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs transition ${
                  active
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-[#00744B] text-[#005C3B] dark:text-emerald-300 font-bold shadow-xs'
                    : done
                      ? 'bg-slate-50 dark:bg-slate-800/50 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400'
                      : 'border-slate-200 dark:border-slate-800 text-slate-400'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                    active
                      ? 'bg-[#00744B] text-white'
                      : done
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                  }`}
                >
                  {done ? <i className="fa-solid fa-check" /> : st.no}
                </span>
                <span className="truncate">{st.title}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* STEP 1: Upload / Template / Clipboard Paste */}
      {store.step === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Template Download Card */}
          <div className="bma-card p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                <i className="fa-solid fa-file-excel" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 dark:text-slate-100">ดาวน์โหลดเทมเพลตมาตรฐาน</h2>
                <p className="text-xs text-slate-500">
                  {totalImportCols} คอลัมน์ (A–{lastImportColLetter}) พร้อม Dropdown สดจากระบบ
                </p>
              </div>
            </div>

            <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 list-disc pl-4">
              <li>ล็อกคอลัมน์เลขบัตรประชาชนและเบอร์โทรเป็นข้อความ (`@`) ป้องกันเลขยกกำลัง</li>
              <li>ฝัง Dropdown ข้อมูลอ้างอิงและสังกัดตามขอบเขตสิทธิ์ของคุณอัตโนมัติ</li>
              <li>รองรับสูงสุด {settings.import_max_rows.toLocaleString()} แถวต่อการนำเข้า 1 ครั้ง</li>
            </ul>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={isDownloadingTpl}
                onClick={async () => {
                  setIsDownloadingTpl(true);
                  try {
                    await downloadDynamicExcelTemplate(master, adminScope, isSuperAdmin);
                    showToast('ดาวน์โหลดเทมเพลต Excel สำเร็จ', 'success');
                  } finally {
                    setIsDownloadingTpl(false);
                  }
                }}
                className="bma-btn-primary w-full justify-center"
              >
                <i className={`fa-solid ${isDownloadingTpl ? 'fa-spinner fa-spin' : 'fa-download'} mr-1.5`} />
                ดาวน์โหลด Excel Template (.xlsx)
              </button>

              <button
                type="button"
                onClick={() => {
                  downloadCsvUtf8BomTemplate(master, adminScope, isSuperAdmin);
                  showToast('ดาวน์โหลดเทมเพลต CSV (UTF-8 BOM) สำเร็จ', 'success');
                }}
                className="bma-btn-outline w-full justify-center text-xs"
              >
                <i className="fa-solid fa-file-csv mr-1.5 text-emerald-600" />
                ดาวน์โหลด CSV Template (UTF-8 BOM)
              </button>
            </div>

            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-[11px] text-amber-800 dark:text-amber-200">
              <i className="fa-solid fa-shield-halved mr-1.5" />
              <strong>PDPA RAM-Only:</strong> ข้อมูลบุคลากรในตารางพักจะเก็บไว้เฉพาะหน่วยความจำชั่วคราว (RAM) เท่านั้น ไม่บันทึกลง LocalStorage หรือ IndexedDB
            </div>
          </div>

          {/* Drag & Drop File Upload */}
          <div className="bma-card p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center">
                <i className="fa-solid fa-cloud-arrow-up" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 dark:text-slate-100">อัปโหลดไฟล์ .xlsx / .csv</h2>
                <p className="text-xs text-slate-500">ตรวจสอบ Encoding ภาษาไทย (UTF-8 / Windows-874) อัตโนมัติ</p>
              </div>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFileSelected(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition ${
                isDragging
                  ? 'border-[#00744B] bg-emerald-50/70 dark:bg-emerald-950/30'
                  : 'border-slate-300 dark:border-slate-700 hover:border-[#00744B] hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFileSelected(f);
                  e.target.value = '';
                }}
              />
              <i
                className={`fa-solid ${
                  isParsing ? 'fa-spinner fa-spin text-[#00744B]' : 'fa-file-arrow-up text-slate-400'
                } text-3xl mb-2.5 block`}
              />
              <p className="font-bold text-sm text-slate-700 dark:text-slate-200">
                {isParsing ? 'กำลังประมวลผลไฟล์...' : 'ลากไฟล์มาวางที่นี่ หรือคลิกเลือกไฟล์'}
              </p>
              <p className="text-xs text-slate-400 mt-1">รองรับ .xlsx และ .csv</p>
            </div>
          </div>

          {/* Paste from Google Sheets / Excel */}
          <div className="bma-card p-5 space-y-3 flex flex-col">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 flex items-center justify-center">
                <i className="fa-solid fa-paste" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 dark:text-slate-100">คัดลอกวางจาก Google Sheets / Excel</h2>
                <p className="text-xs text-slate-500">กด Ctrl+C จากตารางแล้ว Ctrl+V ในช่องด้านล่าง</p>
              </div>
            </div>

            <textarea
              rows={6}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="วางตารางข้อมูล (TSV/CSV) ที่นี่..."
              className="bma-input text-xs font-mono flex-1 resize-none"
            />

            <button
              type="button"
              disabled={!pasteText.trim()}
              onClick={handleClipboardImport}
              className="bma-btn-primary w-full justify-center"
            >
              <i className="fa-solid fa-table-columns mr-1.5" />
              อ่านข้อมูลที่วางและไปขั้นตอนจับคู่คอลัมน์
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Smart Column Mapping */}
      {store.step === 2 && (
        <ColumnMappingStep
          fileName={store.fileName}
          sourceFormat={store.sourceFormat}
          detectedEncoding={store.detectedEncoding}
          encodingOverride={store.encodingOverride}
          onChangeEncoding={handleEncodingChange}
          rawRows={store.rawRows}
          mappings={store.columnMappings}
          onChangeMapping={(idx, target) => store.updateColumnMapping(idx, target)}
          onBack={() => store.setStep(1)}
          onNext={() => void handleProceedToGrid()}
          isPreparing={isCheckingCids}
        />
      )}

      {/* STEP 3: Interactive Virtualized Staging Grid */}
      {store.step === 3 && (
        <div className="space-y-4">
          <SpreadsheetStagingGrid
            rows={store.rows}
            index={hierarchyIndex}
            activeCell={store.activeCell}
            showErrorsOnly={store.showErrorsOnly}
            searchQuery={store.searchQuery}
            canUndo={store.past.length > 0}
            canRedo={store.future.length > 0}
            onSetActiveCell={store.setActiveCell}
            onSetShowErrorsOnly={store.setShowErrorsOnly}
            onSetSearchQuery={store.setSearchQuery}
            onUpdateCell={(rowId, colKey, value) => store.setCellValue(rowId, colKey, value, validationCtx)}
            onUpdateRowBatch={(rowId, patch) => store.setRowCellsBatch(rowId, patch, validationCtx)}
            onFillDown={(rowId, colKey, count) => store.fillDownColumn(rowId, colKey, count, validationCtx)}
            onDeleteRow={(rowId) => store.deleteRow(rowId, validationCtx)}
            onToggleRowSelection={store.toggleRowSelection}
            onToggleAllSelection={store.toggleAllSelection}
            onUndo={store.undo}
            onRedo={store.redo}
            onApplyAllAutoFixes={() => {
              const count = store.applyAllAutoFixes(validationCtx);
              showToast(`ปรับปรุงค่าอัตโนมัติสำเร็จ ${count} ช่อง`, 'success');
            }}
            onOpenBulkMapper={() => setBulkDrawerOpen(true)}
            onExportRedRows={async () => {
              const n = await exportFailedStagingRowsToExcel(store.rows);
              if (n > 0) showToast(`ส่งออกแถวสีแดง ${n} แถวเป็นไฟล์ .xlsx แล้ว`, 'info');
            }}
          />

          {/* Commit Options & Sticky Action Bar */}
          <div className="bma-card p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-700 dark:text-slate-200">โหมดบันทึก:</span>
                <select
                  className="bma-input text-xs py-1.5 w-auto"
                  value={store.mode}
                  onChange={(e) => store.setMode(e.target.value as ImportCommitMode, validationCtx)}
                >
                  <option value="UPSERT">UPSERT (เพิ่มใหม่ + อัปเดตบุคลากรเดิมตาม CID)</option>
                  <option value="INSERT_ONLY">INSERT ONLY (เพิ่มใหม่เท่านั้น ข้ามเลขบัตรที่มีแล้ว)</option>
                </select>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={store.autoProvision}
                  onChange={(e) => store.setAutoProvision(e.target.checked)}
                />
                สร้างบัญชีผู้ใช้งาน SSO อัตโนมัติ (ตามสถานะที่อนุญาต)
              </label>

              {selectedRedRows.length > 0 && (
                <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-amber-700 dark:text-amber-300">
                  <input
                    type="checkbox"
                    checked={store.skipRedRows}
                    onChange={(e) => store.setSkipRedRows(e.target.checked)}
                  />
                  ข้ามแถวสีแดง ({selectedRedRows.length} แถว) และนำเข้าเฉพาะแถวที่ผ่าน
                </label>
              )}
            </div>

            <div className="flex items-center gap-2.5 w-full lg:w-auto justify-end">
              <button
                type="button"
                onClick={() => store.setStep(2)}
                className="bma-btn-outline text-xs"
              >
                <i className="fa-solid fa-arrow-left mr-1.5" />
                ย้อนกลับ Step 2
              </button>
              <button
                type="button"
                disabled={!canCommit}
                onClick={() => void handleRequestCommit()}
                className="bma-btn-primary"
              >
                <i className="fa-solid fa-cloud-arrow-up mr-1.5" />
                นำเข้าข้อมูล ({readyRowsToCommit.length.toLocaleString()} แถว)
              </button>
            </div>
          </div>

          <BulkValueMappingDrawer
            open={bulkDrawerOpen}
            onClose={() => setBulkDrawerOpen(false)}
            rows={store.rows}
            index={hierarchyIndex}
            onBulkReplace={(colKey, fromVal, toVal) => {
              const count = store.bulkReplaceColumnValue(colKey, fromVal, toVal, validationCtx);
              if (count > 0) {
                showToast(`แทนที่ "${fromVal}" → "${toVal}" สำเร็จ ${count} แถว`, 'success');
              }
              return count;
            }}
          />

          <UpsertDiffModal
            open={diffModalOpen}
            onClose={() => setDiffModalOpen(false)}
            updateRows={updateRowsToCommit}
            onConfirmProceed={() => void executeCommit()}
          />
        </div>
      )}

      {/* STEP 4: Commit Progress & Final Summary */}
      {store.step === 4 && (
        <div className="bma-card p-6 space-y-5">
          {isCommitting || !store.commitResult ? (
            <div className="max-w-lg mx-auto py-10 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 text-[#00744B] dark:text-emerald-300 flex items-center justify-center text-2xl">
                <i className="fa-solid fa-spinner fa-spin" />
              </div>
              <h2 className="font-bold text-lg text-slate-800 dark:text-slate-100">
                กำลังบันทึกข้อมูลบุคลากรแบบแบ่งชุด (Chunked Import)
              </h2>
              <p className="text-sm text-slate-500">{progressLabel}</p>
              <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#005C3B] to-[#00A368] transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="text-xs font-mono font-bold text-[#00744B] dark:text-emerald-400">
                {progressPct}%
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-2xl">
                    <i className="fa-solid fa-circle-check" />
                  </div>
                  <div>
                    <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                      ดำเนินการนำเข้าข้อมูลเสร็จสมบูรณ์
                    </h2>
                    <p className="text-xs text-slate-500 font-mono">
                      Job ID: {store.commitResult.jobId} · โหมด {store.commitResult.mode}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void exportCommitSummaryReport(store.commitResult!)}
                    className="bma-btn-outline text-xs"
                  >
                    <i className="fa-solid fa-file-excel text-emerald-600 mr-1.5" />
                    ดาวน์โหลดรายงานสรุปผล (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      store.resetAll();
                      setPasteText('');
                    }}
                    className="bma-btn-outline text-xs"
                  >
                    <i className="fa-solid fa-plus mr-1.5" />
                    นำเข้าไฟล์ใหม่
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      store.resetAll();
                      navigate('/admin/personnel');
                    }}
                    className="bma-btn-primary text-xs"
                  >
                    <i className="fa-solid fa-users mr-1.5" />
                    ไปหน้าทะเบียนบุคลากร
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
                  <div className="text-xs text-emerald-700 dark:text-emerald-300">เพิ่มใหม่สำเร็จ</div>
                  <div className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">
                    {store.commitResult.inserted.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4">
                  <div className="text-xs text-blue-700 dark:text-blue-300">อัปเดตสำเร็จ</div>
                  <div className="text-2xl font-extrabold text-blue-700 dark:text-blue-300">
                    {store.commitResult.updated.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-4">
                  <div className="text-xs text-slate-600 dark:text-slate-300">ข้าม</div>
                  <div className="text-2xl font-extrabold text-slate-700 dark:text-slate-200">
                    {store.commitResult.skipped.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20 p-4">
                  <div className="text-xs text-rose-700 dark:text-rose-300">ล้มเหลว</div>
                  <div className="text-2xl font-extrabold text-rose-600 dark:text-rose-400">
                    {store.commitResult.failed.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 p-4 col-span-2 sm:col-span-1">
                  <div className="text-xs text-purple-700 dark:text-purple-300">สร้างบัญชี SSO</div>
                  <div className="text-2xl font-extrabold text-purple-700 dark:text-purple-300">
                    {store.commitResult.accountsCreated.toLocaleString()}
                  </div>
                </div>
              </div>

              {store.commitResult.errors.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-bold text-sm text-rose-600 dark:text-rose-400">
                    รายการที่พบข้อผิดพลาดฝั่งฐานข้อมูล ({store.commitResult.errors.length} รายการ)
                  </h3>
                  <div className="overflow-x-auto rounded-xl border border-rose-200 dark:border-rose-800">
                    <table className="w-full text-xs">
                      <thead className="bg-rose-50 dark:bg-rose-950/40 text-left">
                        <tr>
                          <th className="px-3 py-2">แถว</th>
                          <th className="px-3 py-2">เลขบัตร (PDPA)</th>
                          <th className="px-3 py-2">คอลัมน์</th>
                          <th className="px-3 py-2">รายละเอียด</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rose-100 dark:divide-rose-900/40">
                        {store.commitResult.errors.map((err, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 font-mono">{err.sheetRowNo}</td>
                            <td className="px-3 py-2 font-mono">{err.cidMasked}</td>
                            <td className="px-3 py-2">{err.columnKey}</td>
                            <td className="px-3 py-2 text-rose-700 dark:text-rose-300">{err.errorMessage}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
    </AdminLayout>
  );
}

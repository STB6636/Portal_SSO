import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { useUiStore } from '@/stores/useUiStore';
import { getTodayIsoBangkok } from '@/lib/thaiDate';
import { cleanDisplaySegment } from '@/lib/positionFormatter';
import { toThaiDigits } from './kp7ThaiFormatter';
import {
  KP7_A4_HEIGHT,
  KP7_A4_WIDTH,
  KP7_PAGE2_LINES_PER_PAGE,
  computeKp7CareerVisualPages,
  renderKp7Page1,
  renderKp7Page2Plus,
} from './kp7CanvasRenderer';
import type { Kp7DataBundle, Kp7RenderOptions } from './kp7Types';

interface Kp7CanvasPreviewModalProps {
  open: boolean;
  onClose: () => void;
  bundle: Kp7DataBundle | null;
  zIndexClass?: string;
}

const ROWS_PER_PAGE = KP7_PAGE2_LINES_PER_PAGE;

export function Kp7CanvasPreviewModal({
  open,
  onClose,
  bundle,
  zIndexClass = 'z-[9995]',
}: Kp7CanvasPreviewModalProps) {
  const { settings } = useSettings();
  const showToast = useUiStore((s) => s.showToast);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activePage, setActivePage] = useState(1);
  const [zoom, setZoom] = useState<'fit' | 60 | 80 | 100>('fit');
  const [rendering, setRendering] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [showOptions, setShowOptions] = useState(true);

  const [options, setOptions] = useState<Kp7RenderOptions>(() => ({
    useThaiNumerals: true,
    includeOwnerSignature: true,
    ministryName: settings.organization_name || 'กรุงเทพมหานคร',
    departmentName: settings.bureau_name || '',
    certifierName: '',
    certifierPosition: '',
    certifyDateIso: getTodayIsoBangkok(),
    ownerSignDateIso: getTodayIsoBangkok(),
  }));

  // Sync defaults when opening for a new person
  useEffect(() => {
    if (!open || !bundle) return;
    setActivePage(1);
    setOptions((prev) => ({
      ...prev,
      ministryName: prev.ministryName || settings.organization_name || 'กรุงเทพมหานคร',
      departmentName:
        cleanDisplaySegment(bundle.person.bureau_name) ||
        settings.bureau_name ||
        prev.departmentName,
      certifyDateIso: prev.certifyDateIso || getTodayIsoBangkok(),
      ownerSignDateIso: prev.ownerSignDateIso || getTodayIsoBangkok(),
    }));
  }, [open, bundle?.person.id, settings.organization_name, settings.bureau_name]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const careerPages = useMemo(() => {
    if (!bundle) return [[]];
    return computeKp7CareerVisualPages(bundle, { ...options, settings }, ROWS_PER_PAGE).pages;
  }, [bundle, options, settings]);

  const totalPages = 1 + careerPages.length;

  useEffect(() => {
    if (activePage > totalPages) setActivePage(1);
  }, [activePage, totalPages]);

  // Re-render active page on canvas whenever options / page / bundle changes
  useEffect(() => {
    if (!open || !bundle || !canvasRef.current) return;
    let cancelled = false;
    setRendering(true);

    const draw = async () => {
      try {
        if (!canvasRef.current || cancelled) return;
        const optsWithSettings = { ...options, settings };
        if (activePage === 1) {
          await renderKp7Page1(canvasRef.current, bundle, optsWithSettings);
        } else {
          const slice = careerPages[activePage - 2] ?? [];
          await renderKp7Page2Plus(
            canvasRef.current,
            bundle,
            optsWithSettings,
            slice,
            ROWS_PER_PAGE
          );
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    void draw();
    return () => {
      cancelled = true;
    };
  }, [open, bundle, options, settings, activePage, totalPages, careerPages]);

  if (!open || !bundle) return null;

  const renderAllPageDataUrls = async (): Promise<string[]> => {
    const offscreen = document.createElement('canvas');
    offscreen.width = KP7_A4_WIDTH;
    offscreen.height = KP7_A4_HEIGHT;
    const urls: string[] = [];
    const optsWithSettings = { ...options, settings };

    await renderKp7Page1(offscreen, bundle, optsWithSettings);
    urls.push(offscreen.toDataURL('image/png'));

    for (let p = 2; p <= totalPages; p += 1) {
      const slice = careerPages[p - 2] ?? [];
      await renderKp7Page2Plus(offscreen, bundle, optsWithSettings, slice, ROWS_PER_PAGE);
      urls.push(offscreen.toDataURL('image/png'));
    }
    return urls;
  };

  const handlePrintA4 = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      const dataUrls = await renderAllPageDataUrls();
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        document.body.removeChild(iframe);
        showToast('ไม่สามารถเปิดหน้าต่างพิมพ์เอกสารได้', 'error');
        return;
      }

      const imgsHtml = dataUrls
        .map(
          (src, idx) =>
            `<div class="kp7-page"><img src="${src}" alt="KP7 Page ${idx + 1}" /></div>`
        )
        .join('');

      doc.open();
      doc.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>ก.พ. ๗ - ${bundle.person.full_name}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .kp7-page { width: 210mm; height: 297mm; page-break-after: always; overflow: hidden; }
  .kp7-page:last-child { page-break-after: auto; }
  .kp7-page img { width: 100%; height: 100%; display: block; object-fit: contain; }
</style>
</head>
<body>${imgsHtml}</body>
</html>`);
      doc.close();

      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 2000);
      }, 350);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดขณะเตรียมพิมพ์เอกสาร ก.พ. ๗', 'error');
    } finally {
      setPrinting(false);
    }
  };

  const handleDownloadCurrentPng = () => {
    if (!canvasRef.current) return;
    try {
      const url = canvasRef.current.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      const safeName = (bundle.person.full_name || 'personnel').replace(/[^\u0E00-\u0E7Fa-zA-Z0-9_-]+/g, '_');
      a.download = `KP7_${safeName}_Page${activePage}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`ดาวน์โหลด ก.พ. ๗ หน้า ${activePage} (PNG 300 DPI) สำเร็จ`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ดาวน์โหลด PNG ไม่สำเร็จ', 'error');
    }
  };

  const canvasWidthStyle =
    zoom === 'fit'
      ? { width: 'min(100%, 794px)', height: 'auto' }
      : { width: `${Math.round((794 * zoom) / 100)}px`, height: 'auto' };

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} bg-slate-950/75 backdrop-blur-xs flex flex-col`}
      role="dialog"
      aria-modal="true"
      aria-label="ตัวอย่างและพิมพ์แบบฟอร์ม ก.พ. ๗"
    >
      {/* Top Action Bar */}
      <div className="bg-[#00351B] text-white px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-emerald-800/70 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
            <i className="fa-solid fa-file-lines text-emerald-300" />
          </span>
          <div className="min-w-0">
            <h2 className="font-extrabold text-sm sm:text-base truncate">
              แบบฟอร์ม ก.พ. ๗ — {bundle.person.full_name}
            </h2>
            <p className="text-[11px] text-emerald-200 truncate">
              HTML5 Canvas ความละเอียดสูง A4 300 DPI ({toThaiDigits(totalPages, options.useThaiNumerals)} หน้า)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Page Switcher */}
          <div className="inline-flex items-center bg-white/10 rounded-xl p-0.5 text-xs">
            {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setActivePage(p)}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  activePage === p
                    ? 'bg-white text-[#005C3B] shadow-xs'
                    : 'text-emerald-100 hover:bg-white/10'
                }`}
              >
                หน้า {p}
              </button>
            ))}
          </div>

          {/* Zoom Selector */}
          <select
            value={zoom}
            onChange={(e) =>
              setZoom(e.target.value === 'fit' ? 'fit' : (Number(e.target.value) as 60 | 80 | 100))
            }
            className="rounded-xl bg-white/10 border border-white/20 text-white text-xs font-bold px-2.5 py-1.5"
          >
            <option value="fit" className="text-slate-900">พอดีหน้าจอ</option>
            <option value={60} className="text-slate-900">ซูม 60%</option>
            <option value={80} className="text-slate-900">ซูม 80%</option>
            <option value={100} className="text-slate-900">ซูม 100%</option>
          </select>

          <button
            type="button"
            onClick={() => setShowOptions((v) => !v)}
            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition"
          >
            <i className="fa-solid fa-sliders mr-1" />
            ตั้งค่าแบบฟอร์ม
          </button>

          <button
            type="button"
            onClick={handleDownloadCurrentPng}
            disabled={rendering}
            className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-extrabold transition disabled:opacity-50"
          >
            <i className="fa-solid fa-download mr-1" />
            ดาวน์โหลด PNG
          </button>

          <button
            type="button"
            onClick={() => void handlePrintA4()}
            disabled={printing || rendering}
            className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 text-xs font-extrabold shadow-xs transition disabled:opacity-50"
          >
            <i className={`fa-solid ${printing ? 'fa-spinner fa-spin' : 'fa-print'} mr-1`} />
            พิมพ์ A4 ({totalPages} หน้า)
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="w-8 h-8 rounded-xl bg-white/10 hover:bg-rose-600 text-white flex items-center justify-center transition"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      </div>

      {/* Options Ribbon */}
      {showOptions && (
        <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 shrink-0">
          <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end text-xs">
            <label className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2 cursor-pointer border border-slate-200 dark:border-slate-700">
              <input
                type="checkbox"
                checked={options.useThaiNumerals}
                onChange={(e) => setOptions((o) => ({ ...o, useThaiNumerals: e.target.checked }))}
              />
              <span>ตัวเลขไทย (๑๒๓)</span>
            </label>

            <label className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2 cursor-pointer border border-slate-200 dark:border-slate-700">
              <input
                type="checkbox"
                checked={options.includeOwnerSignature}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, includeOwnerSignature: e.target.checked }))
                }
              />
              <span>ลายเซ็นเจ้าของประวัติ</span>
            </label>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">กระทรวง / อปท.</label>
              <input
                type="text"
                value={options.ministryName}
                onChange={(e) => setOptions((o) => ({ ...o, ministryName: e.target.value }))}
                className="bma-input text-xs py-1.5"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">กรม / สำนัก</label>
              <input
                type="text"
                value={options.departmentName}
                onChange={(e) => setOptions((o) => ({ ...o, departmentName: e.target.value }))}
                className="bma-input text-xs py-1.5"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">ผู้รับรองประวัติ (ถ้ามี)</label>
              <input
                type="text"
                value={options.certifierName}
                onChange={(e) => setOptions((o) => ({ ...o, certifierName: e.target.value }))}
                placeholder="ชื่อ-สกุล ผู้รับรอง"
                className="bma-input text-xs py-1.5"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">ตำแหน่งผู้รับรอง</label>
              <input
                type="text"
                value={options.certifierPosition}
                onChange={(e) => setOptions((o) => ({ ...o, certifierPosition: e.target.value }))}
                placeholder="เช่น ผู้อำนวยการ..."
                className="bma-input text-xs py-1.5"
              />
            </div>
          </div>
        </div>
      )}

      {/* A4 Canvas Viewport */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 flex justify-center items-start bg-slate-800/80">
        <div className="relative bg-white shadow-2xl rounded-sm overflow-hidden">
          {rendering && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
              <div className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-2">
                <i className="fa-solid fa-spinner fa-spin" />
                กำลังเรนเดอร์แบบฟอร์ม ก.พ. ๗ (300 DPI)...
              </div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={KP7_A4_WIDTH}
            height={KP7_A4_HEIGHT}
            style={canvasWidthStyle}
            className="block"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

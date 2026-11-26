import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSettings } from '@/contexts/SettingsContext';
import { useMasterData } from '@/hooks/useMasterData';
import { personnelService } from '@/services/personnelService';
import { useUiStore } from '@/stores/useUiStore';
import { cleanDisplaySegment } from '@/lib/positionFormatter';
import { getTodayIsoBangkok } from '@/lib/thaiDate';
import { QUERY_KEYS } from '@/lib/queryClient';
import { ThaiDatePicker } from '@/components/common/ThaiDatePicker';
import {
  KP7_A4_HEIGHT,
  KP7_A4_WIDTH,
  KP7_PAGE2_LINES_PER_PAGE,
  computeKp7CareerVisualPages,
  ensureSarabunFontLoaded,
  renderKp7Page1,
  renderKp7Page2Plus,
} from '@/features/kp7-canvas/kp7CanvasRenderer';
import { toThaiDigits } from '@/features/kp7-canvas/kp7ThaiFormatter';
import type { Kp7DataBundle, Kp7RenderOptions } from '@/features/kp7-canvas/kp7Types';

export default function Kp7PrintPage() {
  const { personnelId } = useParams<{ personnelId: string }>();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { data: master } = useMasterData();
  const showToast = useUiStore((s) => s.showToast);

  const [zoom, setZoom] = useState<'fit' | 75 | 100>('fit');
  const [viewMode, setViewMode] = useState<'all' | number>('all');
  const [showOptions, setShowOptions] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [pageDataUrls, setPageDataUrls] = useState<string[]>([]);
  const renderSeqRef = useRef(0);

  const {
    data: person,
    isLoading: loadingPerson,
    error: personError,
  } = useQuery({
    queryKey: QUERY_KEYS.personnelById(personnelId || ''),
    queryFn: () => personnelService.getPersonnelById(personnelId!),
    enabled: Boolean(personnelId),
  });

  const { data: timelines, isLoading: loadingTimelines } = useQuery({
    queryKey: QUERY_KEYS.personnelTimelines(personnelId || ''),
    queryFn: () => personnelService.getPersonnelTimelines(personnelId!),
    enabled: Boolean(personnelId),
  });

  const [options, setOptions] = useState<Kp7RenderOptions>(() => ({
    useThaiNumerals: true,
    includeOwnerSignature: true,
    allowCurrentPositionFallback: false,
    ministryName: settings.organization_name || 'กรุงเทพมหานคร',
    departmentName: settings.bureau_name || '',
    certifierName: '',
    certifierPosition: '',
    certifyDateIso: getTodayIsoBangkok(),
    ownerSignDateIso: getTodayIsoBangkok(),
    settings,
  }));

  // Keep settings + person's bureau_name synchronized once loaded
  useEffect(() => {
    setOptions((prev) => ({
      ...prev,
      ministryName: prev.ministryName || settings.organization_name || 'กรุงเทพมหานคร',
      departmentName:
        prev.departmentName ||
        cleanDisplaySegment(person?.bureau_name) ||
        settings.bureau_name ||
        '',
      settings,
    }));
  }, [person?.bureau_name, settings]);

  useEffect(() => {
    if (person?.full_name) {
      document.title = `ก.พ. ๗ — ${person.full_name}`;
    } else {
      document.title = 'พิมพ์แบบฟอร์ม ก.พ. ๗';
    }
  }, [person?.full_name]);

  const bundle = useMemo<Kp7DataBundle | null>(() => {
    if (!person || !timelines) return null;
    return { person, timelines, master };
  }, [person, timelines, master]);

  const hasPositionHistory = (timelines?.positionHistory?.length ?? 0) > 0;

  // Render ALL A4 pages (300 DPI) whenever bundle or options change
  useEffect(() => {
    if (!bundle) return;
    const seq = ++renderSeqRef.current;
    setRendering(true);

    const run = async () => {
      try {
        await ensureSarabunFontLoaded();
        if (renderSeqRef.current !== seq) return;

        const { pages: careerVisualPages } = computeKp7CareerVisualPages(
          bundle,
          options,
          KP7_PAGE2_LINES_PER_PAGE
        );

        const offscreen = document.createElement('canvas');
        offscreen.width = KP7_A4_WIDTH;
        offscreen.height = KP7_A4_HEIGHT;

        const urls: string[] = [];

        await renderKp7Page1(offscreen, bundle, options);
        if (renderSeqRef.current !== seq) return;
        urls.push(offscreen.toDataURL('image/png'));

        for (let i = 0; i < careerVisualPages.length; i += 1) {
          await renderKp7Page2Plus(
            offscreen,
            bundle,
            options,
            careerVisualPages[i],
            KP7_PAGE2_LINES_PER_PAGE
          );
          if (renderSeqRef.current !== seq) return;
          urls.push(offscreen.toDataURL('image/png'));
        }

        setPageDataUrls(urls);
      } catch (err) {
        if (renderSeqRef.current === seq) {
          showToast(
            err instanceof Error ? err.message : 'ไม่สามารถสร้างภาพแบบฟอร์ม ก.พ. ๗ ได้',
            'error'
          );
        }
      } finally {
        if (renderSeqRef.current === seq) setRendering(false);
      }
    };

    void run();
  }, [bundle, options, showToast]);

  const totalPages = Math.max(1, pageDataUrls.length);

  useEffect(() => {
    if (typeof viewMode === 'number' && viewMode > totalPages) {
      setViewMode('all');
    }
  }, [viewMode, totalPages]);

  const handlePrint = () => {
    if (rendering || pageDataUrls.length === 0) {
      showToast('กรุณารอระบบสร้างภาพเอกสาร ก.พ. ๗ ให้เสร็จก่อนพิมพ์', 'warning');
      return;
    }
    window.print();
  };

  const handleDownloadPng = (pageIndex: number) => {
    const url = pageDataUrls[pageIndex];
    if (!url || !person) return;
    const safeName = (person.full_name || 'personnel').replace(/[^\u0E00-\u0E7Fa-zA-Z0-9_-]+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `KP7_${safeName}_Page${pageIndex + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`ดาวน์โหลด ก.พ. ๗ หน้า ${pageIndex + 1} (300 DPI PNG) สำเร็จ`, 'success');
  };

  const handleDownloadAllPng = () => {
    pageDataUrls.forEach((_, idx) => {
      window.setTimeout(() => handleDownloadPng(idx), idx * 250);
    });
  };

  const handleCloseOrBack = () => {
    if (window.opener) {
      window.close();
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/apps');
    }
  };

  const previewWidthStyle =
    zoom === 'fit'
      ? { width: 'min(100%, 820px)' }
      : { width: `${Math.round((820 * zoom) / 100)}px` };

  const visibleIndices =
    viewMode === 'all'
      ? pageDataUrls.map((_, idx) => idx)
      : pageDataUrls[viewMode - 1]
        ? [viewMode - 1]
        : [];

  return (
    <div className="kp7-print-root min-h-screen bg-[#E7ECE9] dark:bg-[#0B132B] text-slate-800 dark:text-slate-100 flex flex-col">
      {/* Top Action Toolbar (Hidden completely in @media print) */}
      <header className="kp7-no-print sticky top-0 z-30 bg-[#00351B] text-white border-b border-emerald-800/80 shadow-lg">
        <div className="max-w-7xl mx-auto px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={handleCloseOrBack}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition shrink-0"
              title="ปิดแท็บ / ย้อนกลับ"
            >
              <i className="fa-solid fa-arrow-left" />
            </button>
            <div className="min-w-0">
              <h1 className="font-extrabold text-sm sm:text-base truncate flex items-center gap-2">
                <i className="fa-solid fa-file-lines text-[#F6DE51]" />
                <span>
                  แบบฟอร์ม {toThaiDigits('ก.พ. 7', options.useThaiNumerals)} —{' '}
                  {person?.full_name || 'กำลังโหลดข้อมูล...'}
                </span>
              </h1>
              <p className="text-[11px] text-emerald-200/90 truncate">
                A4 300 DPI มาตรฐานสำนักงาน ก.พ. (นร ๑๐๐๖/ว ๒๓) · ทั้งหมด{' '}
                {toThaiDigits(totalPages, options.useThaiNumerals)} หน้า · กด Ctrl+P เพื่อพิมพ์ได้ทันที
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Page Filter */}
            <div className="inline-flex items-center rounded-xl bg-white/10 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('all')}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  viewMode === 'all' ? 'bg-white text-[#00351B]' : 'text-emerald-100 hover:bg-white/10'
                }`}
              >
                ทุกหน้า ({totalPages})
              </button>
              {Array.from({ length: totalPages }, (_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setViewMode(idx + 1)}
                  className={`px-2 py-1 rounded-lg font-bold transition ${
                    viewMode === idx + 1 ? 'bg-white text-[#00351B]' : 'text-emerald-100 hover:bg-white/10'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>

            {/* Zoom */}
            <div className="hidden md:inline-flex items-center rounded-xl bg-white/10 p-0.5 text-xs">
              {(['fit', 75, 100] as const).map((z) => (
                <button
                  key={String(z)}
                  type="button"
                  onClick={() => setZoom(z)}
                  className={`px-2 py-1 rounded-lg font-bold transition ${
                    zoom === z ? 'bg-white text-[#00351B]' : 'text-emerald-100 hover:bg-white/10'
                  }`}
                >
                  {z === 'fit' ? 'พอดีจอ' : `${z}%`}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 border ${
                showOptions
                  ? 'bg-emerald-500/30 border-emerald-300/60 text-white'
                  : 'bg-white/10 border-white/15 text-emerald-100 hover:bg-white/20'
              }`}
            >
              <i className="fa-solid fa-sliders" />
              <span className="hidden sm:inline">ตัวเลือกเอกสาร</span>
            </button>

            <button
              type="button"
              disabled={rendering || pageDataUrls.length === 0}
              onClick={handleDownloadAllPng}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition inline-flex items-center gap-1.5 disabled:opacity-50"
              title="ดาวน์โหลดไฟล์ PNG ความละเอียด 300 DPI ทุกหน้า"
            >
              <i className="fa-solid fa-download" />
              <span className="hidden sm:inline">บันทึก PNG</span>
            </button>

            <button
              type="button"
              disabled={rendering || pageDataUrls.length === 0}
              onClick={handlePrint}
              className="px-4 py-1.5 rounded-xl bg-[#F6DE51] hover:bg-amber-300 text-slate-950 text-xs font-extrabold shadow-md transition inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <i className="fa-solid fa-print" />
              <span>พิมพ์เอกสาร A4</span>
            </button>
          </div>
        </div>

        {/* Collapsible Options Drawer */}
        {showOptions && (
          <div className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border-t border-slate-200 dark:border-slate-800">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.useThaiNumerals}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, useThaiNumerals: e.target.checked }))
                    }
                  />
                  <span>ใช้ตัวเลขไทย (๑ ๒ ๓) ทั้งฉบับ</span>
                </label>
                <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.includeOwnerSignature}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, includeOwnerSignature: e.target.checked }))
                    }
                  />
                  <span>แสดงลายเซ็นเจ้าของประวัติ</span>
                </label>
                {!hasPositionHistory && (
                  <label className="inline-flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(options.allowCurrentPositionFallback)}
                      onChange={(e) =>
                        setOptions((prev) => ({
                          ...prev,
                          allowCurrentPositionFallback: e.target.checked,
                        }))
                      }
                    />
                    <span>ดึงตำแหน่งปัจจุบันมาแสดงในข้อ ๑๔ (เนื่องจากยังไม่มีประวัติการดำรงตำแหน่ง)</span>
                  </label>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="bma-label">กระทรวง / องค์กร</label>
                  <input
                    type="text"
                    value={options.ministryName}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, ministryName: e.target.value }))
                    }
                    className="bma-input text-xs"
                  />
                </div>
                <div>
                  <label className="bma-label">กรม / สำนัก</label>
                  <input
                    type="text"
                    value={options.departmentName}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, departmentName: e.target.value }))
                    }
                    className="bma-input text-xs"
                  />
                </div>
                <div>
                  <label className="bma-label">ชื่อผู้รับรอง (หัวหน้าส่วนราชการฯ)</label>
                  <input
                    type="text"
                    value={options.certifierName}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, certifierName: e.target.value }))
                    }
                    placeholder="เว้นว่างเพื่อพิมพ์เส้นประ"
                    className="bma-input text-xs"
                  />
                </div>
                <div>
                  <label className="bma-label">ตำแหน่งผู้รับรอง</label>
                  <input
                    type="text"
                    value={options.certifierPosition}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, certifierPosition: e.target.value }))
                    }
                    placeholder="เว้นว่างเพื่อพิมพ์เส้นประ"
                    className="bma-input text-xs"
                  />
                </div>
                <div>
                  <label className="bma-label">วันที่ลงนามเจ้าของประวัติ (พ.ศ.)</label>
                  <ThaiDatePicker
                    compact
                    value={options.ownerSignDateIso || ''}
                    onChange={(iso) =>
                      setOptions((prev) => ({ ...prev, ownerSignDateIso: iso }))
                    }
                  />
                </div>
                <div>
                  <label className="bma-label">วันที่รับรอง (พ.ศ.)</label>
                  <ThaiDatePicker
                    compact
                    value={options.certifyDateIso || ''}
                    onChange={(iso) =>
                      setOptions((prev) => ({ ...prev, certifyDateIso: iso }))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Screen Preview Area */}
      <main className="kp7-no-print flex-1 overflow-auto py-6 px-3 sm:px-6">
        {loadingPerson || loadingTimelines ? (
          <div className="max-w-lg mx-auto my-20 bma-card p-8 text-center space-y-3">
            <i className="fa-solid fa-spinner fa-spin text-3xl text-[#00744B]" />
            <p className="font-bold text-sm">กำลังดึงข้อมูลทะเบียนประวัติบุคลากรสำหรับสร้าง ก.พ. ๗...</p>
          </div>
        ) : personError || !person ? (
          <div className="max-w-lg mx-auto my-20 bma-card p-8 text-center space-y-3">
            <i className="fa-solid fa-triangle-exclamation text-3xl text-rose-500" />
            <p className="font-bold text-sm text-rose-600 dark:text-rose-400">
              ไม่พบข้อมูลบุคลากร หรือคุณไม่มีสิทธิ์เข้าถึงข้อมูลบุคลากรรายการนี้
            </p>
            <button type="button" onClick={handleCloseOrBack} className="bma-btn-outline text-xs">
              กลับหน้าหลัก
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            {rendering && (
              <div className="px-4 py-2 rounded-full bg-[#00744B] text-white text-xs font-bold shadow flex items-center gap-2">
                <i className="fa-solid fa-spinner fa-spin" />
                <span>กำลังวาดแบบฟอร์ม ก.พ. ๗ ความละเอียด 300 DPI...</span>
              </div>
            )}

            {visibleIndices.map((idx) => (
              <div key={idx} className="flex flex-col items-center gap-2 w-full">
                <div className="flex items-center justify-between w-full" style={previewWidthStyle}>
                  <span className="text-xs font-extrabold text-slate-600 dark:text-slate-300">
                    หน้า {toThaiDigits(idx + 1, options.useThaiNumerals)} /{' '}
                    {toThaiDigits(totalPages, options.useThaiNumerals)}
                    {idx === 0 ? ' — ข้อมูลบุคคล ข้อ ๑–๑๓ และลายมือชื่อ' : ' — ข้อ ๑๔ ตำแหน่งและเงินเดือน'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDownloadPng(idx)}
                    className="text-xs font-bold text-[#00744B] dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                  >
                    <i className="fa-solid fa-image" />
                    บันทึกเฉพาะหน้านี้
                  </button>
                </div>

                <div
                  style={previewWidthStyle}
                  className="bg-white rounded-sm shadow-2xl border border-slate-300/80 overflow-hidden"
                >
                  <img
                    src={pageDataUrls[idx]}
                    alt={`ก.พ. ๗ หน้า ${idx + 1}`}
                    className="w-full h-auto block select-none"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Dedicated Native Print Sheets (Hidden on Screen, Exact 210mm x 297mm A4 on Print / Ctrl+P) */}
      <div className="kp7-print-only" aria-hidden="true">
        {pageDataUrls.map((src, idx) => (
          <div key={idx} className="kp7-print-sheet">
            <img src={src} alt={`KP7 Page ${idx + 1}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

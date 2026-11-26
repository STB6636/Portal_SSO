import { useEffect } from 'react';
import type { PublicSystemSettings } from '@/types/domain.types';
import type { AppVersionInfo } from '@/hooks/useSystemUpdateCheck';
import { DriveImage } from '@/components/common/DriveImage';

const CARD_STYLES = [
  { bg: 'bg-emerald-50 dark:bg-slate-800/80', border: 'border-emerald-100 dark:border-slate-700', iconBg: 'bg-emerald-600', text: 'text-emerald-950 dark:text-slate-100' },
  { bg: 'bg-teal-50 dark:bg-slate-800/80', border: 'border-teal-100 dark:border-slate-700', iconBg: 'bg-teal-600', text: 'text-teal-950 dark:text-slate-100' },
  { bg: 'bg-indigo-50 dark:bg-slate-800/80', border: 'border-indigo-100 dark:border-slate-700', iconBg: 'bg-indigo-600', text: 'text-indigo-950 dark:text-slate-100' },
  { bg: 'bg-amber-50 dark:bg-slate-800/80', border: 'border-amber-100 dark:border-slate-700', iconBg: 'bg-amber-600', text: 'text-amber-950 dark:text-slate-100' },
];

export function sanitizeImageUrl(rawUrl?: string | null): string {
  const cleanUrl = String(rawUrl || '').trim();
  if (!cleanUrl) return '';
  const isSafe = /^(?:https?:\/\/[^\s'"()<>]+|data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+)$/i.test(cleanUrl);
  if (!isSafe) return '';
  if (/(?:drive\.google\.com|docs\.google\.com)/i.test(cleanUrl)) {
    const match = cleanUrl.match(/(?:\/d\/|[?&]id=|\/file\/d\/)([-\w]{20,})/);
    if (match && match[1]) {
      return `https://lh3.googleusercontent.com/d/${match[1]}`;
    }
  }
  return cleanUrl;
}

export function SystemUpdateModal({
  open,
  onClose,
  settings,
  versionInfo,
  previewMode = false,
}: {
  open: boolean;
  onClose?: () => void;
  settings: PublicSystemSettings;
  versionInfo: AppVersionInfo;
  previewMode?: boolean;
}) {
  useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('bma-modal-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('bma-modal-open');
    };
  }, [open, onClose]);

  if (!open) return null;

  const isAnnouncement = Boolean(
    previewMode ||
      (settings.announcement_enabled &&
        (settings.announcement_title || settings.announcement_body || settings.announcement_image_url))
  );
  const isImageMode = isAnnouncement && settings.announcement_mode === 'image';
  const sanitizedImg = sanitizeImageUrl(settings.announcement_image_url);
  const highlights = Array.isArray(versionInfo.releaseNotes?.highlights)
    ? versionInfo.releaseNotes.highlights
    : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9995] bg-black/65 backdrop-blur-sm overflow-y-auto flex justify-center p-2.5 sm:p-4"
      style={{ height: '100dvh' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="relative my-auto w-full max-w-md max-h-[calc(100dvh-1.25rem)] sm:max-h-[92dvh] flex flex-col rounded-2xl sm:rounded-3xl bg-white dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
        <div className="shrink-0 bg-gradient-to-r from-[#00351B] to-[#00744B] text-white p-4 sm:p-5 text-center relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="absolute right-3.5 top-3.5 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition"
          >
            <i className="fa-solid fa-xmark text-sm" />
          </button>

          <div className="w-11 h-11 mx-auto rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center mb-2 shadow-md text-[#F6DE51]">
            <i className={`fa-solid ${isAnnouncement ? 'fa-bullhorn' : 'fa-rocket'} text-lg`} />
          </div>

          <h3 className="font-black text-base sm:text-lg leading-snug px-4 text-white">
            {isAnnouncement
              ? settings.announcement_title || 'ประกาศจากระบบ'
              : versionInfo.releaseNotes?.title || `Portal SSO ${versionInfo.appVersion}`}
          </h3>

          {!isAnnouncement && (
            <p className="text-xs text-emerald-100/90 mt-0.5 font-mono">
              {versionInfo.appVersion}
              {versionInfo.buildId ? ` · Build ${versionInfo.buildId}` : ''}
            </p>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-3">
          {isAnnouncement ? (
            isImageMode ? (
              sanitizedImg ? (
                <DriveImage
                  src={sanitizedImg}
                  alt={settings.announcement_title || 'ประกาศจากระบบ'}
                  category="image"
                  settingsOverride={settings}
                  className="max-h-[70dvh] w-auto max-w-full mx-auto object-contain rounded-2xl shadow-md"
                  fallback={
                    <div className="text-center py-8 text-xs text-rose-500">
                      <i className="fa-regular fa-image text-3xl mb-2 block" />
                      ไม่สามารถโหลดรูปภาพประกาศได้ กรุณาตรวจสอบลิงก์ Google Drive
                    </div>
                  }
                />
              ) : (
                <div className="text-center py-8 text-xs text-rose-500">
                  <i className="fa-regular fa-image text-3xl mb-2 block" />
                  ไม่สามารถโหลดรูปภาพประกาศได้ กรุณาตรวจสอบลิงก์ Google Drive
                </div>
              )
            ) : (
              <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-line leading-relaxed">
                {settings.announcement_body || 'ไม่มีรายละเอียดเพิ่มเติม'}
              </p>
            )
          ) : (
            <div className="space-y-2.5">
              {highlights.map((item, idx) => {
                const st = CARD_STYLES[idx % CARD_STYLES.length];
                const title = typeof item === 'string' ? item : item.title || item.text || '';
                const desc = typeof item === 'string' ? '' : item.desc || '';
                const icon = typeof item === 'string' ? 'fa-check' : item.icon || 'fa-check';
                return (
                  <div key={idx} className={`p-3 rounded-2xl border ${st.bg} ${st.border} flex items-start gap-3`}>
                    <span className={`w-7 h-7 rounded-xl ${st.iconBg} text-white flex items-center justify-center shrink-0 text-xs mt-0.5`}>
                      <i className={`fa-solid ${icon}`} />
                    </span>
                    <div className="min-w-0">
                      <p className={`text-xs sm:text-[13px] ${st.text} font-bold leading-snug`}>{title}</p>
                      {desc && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 p-3.5 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center">
          <button
            type="button"
            onClick={onClose}
            className="w-full max-w-[260px] py-2.5 px-6 rounded-full font-bold text-xs sm:text-sm text-white bg-gradient-to-r from-[#00351B] to-[#00744B] hover:brightness-110 transition shadow-md"
          >
            {previewMode ? 'ปิดตัวอย่างประกาศ' : 'รับทราบ'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { getAppRouterConfig } from '@/lib/routerMode';

/**
 * Builds the dedicated print URL for KP.7 supporting BOTH BrowserRouter (Cloudflare Pages)
 * and HashRouter (GitHub Pages `/Portal_SSO/`).
 */
export function buildKp7PrintUrl(personnelId: string): string {
  const cleanId = encodeURIComponent(personnelId.trim());
  const { mode, basename } = getAppRouterConfig();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const normalizedBase = basename === '/' ? '' : basename.replace(/\/+$/, '');

  if (mode === 'hash') {
    const basePrefix = normalizedBase ? `${normalizedBase}/` : '/';
    return `${origin}${basePrefix}#/kp7/print/${cleanId}`;
  }
  return `${origin}${normalizedBase}/kp7/print/${cleanId}`;
}

/**
 * Opens the KP.7 A4 print preview page in a new dedicated browser tab.
 */
export function openKp7PrintTab(personnelId: string): void {
  if (!personnelId || typeof window === 'undefined') return;
  const url = buildKp7PrintUrl(personnelId);
  window.open(url, '_blank', 'noopener,noreferrer');
}

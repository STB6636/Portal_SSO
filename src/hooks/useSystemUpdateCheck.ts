import { useState, useEffect, useCallback } from 'react';
import { getTodayIsoBangkok } from '@/lib/thaiDate';
import type { PublicSystemSettings } from '@/types/domain.types';

export interface VersionReleaseNotes {
  releaseDate?: string;
  title?: string;
  highlights?: Array<string | { icon?: string; color?: string; title?: string; desc?: string; text?: string }>;
}

export interface AppVersionInfo {
  appVersion: string;
  buildId: string;
  updatedAt: string;
  releaseNotes: VersionReleaseNotes | null;
}

const LAST_SEEN_ANN_KEY = 'portal_sso_last_seen_announcement';
const LAST_SEEN_BUILD_KEY = 'portal_sso_last_seen_update_build';

export function useSystemUpdateCheck(settings: PublicSystemSettings) {
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo>({
    appVersion: 'v2.4.0',
    buildId: '',
    updatedAt: '',
    releaseNotes: null,
  });
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const checkAnnouncementActive = useCallback((cfg: PublicSystemSettings) => {
    if (!cfg || !cfg.announcement_enabled) return false;
    const today = getTodayIsoBangkok();
    if (cfg.announcement_start_date && today < cfg.announcement_start_date) return false;
    if (cfg.announcement_end_date && today > cfg.announcement_end_date) return false;
    return cfg.announcement_mode === 'image'
      ? Boolean(cfg.announcement_image_url)
      : Boolean(cfg.announcement_title || cfg.announcement_body);
  }, []);

  useEffect(() => {
    let alive = true;
    const versionUrl = new URL('./version.json?_t=' + Date.now(), window.location.href).href;
    fetch(versionUrl, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        setVersionInfo({
          appVersion: data.appVersion || 'v2.4.0',
          buildId: data.buildId || '',
          updatedAt: data.updatedAt || '',
          releaseNotes: data.releaseNotes || null,
        });
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const active = checkAnnouncementActive(settings);
    if (active && settings.announcement_updated_at) {
      try {
        const lastSeen = localStorage.getItem(LAST_SEEN_ANN_KEY);
        if (lastSeen !== settings.announcement_updated_at) {
          setShowUpdateModal(true);
        }
      } catch {
        // ignore storage errors
      }
    }
  }, [settings, checkAnnouncementActive]);

  const dismissModal = useCallback(() => {
    setShowUpdateModal(false);
    try {
      if (settings.announcement_updated_at) {
        localStorage.setItem(LAST_SEEN_ANN_KEY, settings.announcement_updated_at);
      }
      if (versionInfo.buildId) {
        localStorage.setItem(LAST_SEEN_BUILD_KEY, versionInfo.buildId);
      }
    } catch {
      // ignore storage errors
    }
  }, [settings.announcement_updated_at, versionInfo.buildId]);

  return {
    versionInfo,
    showUpdateModal,
    openUpdateModal: () => setShowUpdateModal(true),
    dismissModal,
  };
}

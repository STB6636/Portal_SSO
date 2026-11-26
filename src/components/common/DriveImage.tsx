import React, { useEffect, useMemo, useState } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import {
  buildDriveThumbnailUrl,
  extractGoogleDriveFileId,
  fetchDriveImageAsDataUrl,
  type DriveFileCategory,
} from '@/services/driveStorageService';
import type { PublicSystemSettings } from '@/types/domain.types';

export interface DriveImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  alt: string;
  category?: DriveFileCategory;
  fallback?: React.ReactNode;
  settingsOverride?: PublicSystemSettings;
  thumbnailSize?: number;
}

function sanitizeSrc(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(trimmed)) return trimmed;
  if (/^blob:/i.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
    return '';
  } catch {
    return '';
  }
}

/**
 * 3-Tier Resilient Google Drive Image Component:
 *  - Tier 1: Direct URL (`lh3.googleusercontent.com/d/<id>` or non-Drive URL) with `referrerPolicy="no-referrer"`
 *  - Tier 2: `https://drive.google.com/thumbnail?id=<id>&sz=w1000` (if Google Drive file)
 *  - Tier 3: GAS Bridge `?action=getBase64` Proxy (works even on restricted Google Workspace / Shared Drives)
 *  - Tier 4: Renders `fallback` node cleanly
 */
export function DriveImage({
  src,
  alt,
  category = 'image',
  fallback = null,
  settingsOverride,
  thumbnailSize = 1000,
  className,
  onError,
  ...rest
}: DriveImageProps) {
  const { settings: ctxSettings } = useSettings();
  const activeSettings = settingsOverride ?? ctxSettings;

  const cleanSrc = useMemo(() => sanitizeSrc(src), [src]);
  const driveFileId = useMemo(() => extractGoogleDriveFileId(cleanSrc), [cleanSrc]);

  const [tier, setTier] = useState<1 | 2 | 3 | 4>(1);
  const [proxyDataUrl, setProxyDataUrl] = useState<string | null>(null);

  useEffect(() => {
    setTier(1);
    setProxyDataUrl(null);
  }, [cleanSrc, category]);

  useEffect(() => {
    if (tier !== 3 || !driveFileId) return;
    let cancelled = false;
    void fetchDriveImageAsDataUrl({
      fileUrlOrId: driveFileId,
      category,
      settings: activeSettings,
    }).then((dataUrl) => {
      if (cancelled) return;
      if (dataUrl) {
        setProxyDataUrl(dataUrl);
      } else {
        setTier(4);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tier, driveFileId, category, activeSettings]);

  if (!cleanSrc || tier === 4) {
    return <>{fallback}</>;
  }

  let currentSrc = cleanSrc;
  if (tier === 2 && driveFileId) {
    currentSrc = buildDriveThumbnailUrl(driveFileId, thumbnailSize);
  } else if (tier === 3) {
    if (!proxyDataUrl) {
      return <>{fallback}</>;
    }
    currentSrc = proxyDataUrl;
  }

  const handleImgError: React.ReactEventHandler<HTMLImageElement> = (e) => {
    onError?.(e);
    if (tier === 1) {
      if (driveFileId) {
        setTier(2);
      } else {
        setTier(4);
      }
    } else if (tier === 2) {
      if (driveFileId && activeSettings.google_drive_script_url) {
        setTier(3);
      } else {
        setTier(4);
      }
    } else {
      setTier(4);
    }
  };

  return (
    <img
      {...rest}
      src={currentSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      className={className}
      onError={handleImgError}
    />
  );
}

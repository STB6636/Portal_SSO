import type { PublicSystemSettings } from '@/types/domain.types';
import type {
  GasDriveBase64Response,
  GasDriveDeleteResponse,
  GasDriveQuotaResponse,
  GasDriveUploadResponse,
  GasDriveVerifyResponse,
} from '@/types/api.types';

export type DriveFileCategory = 'image' | 'signature' | 'document' | 'logo';

export class DriveNotConfiguredError extends Error {
  missingLabel: string;
  constructor(missingLabel: string, message?: string) {
    super(
      message ||
        `ยังไม่ได้ตั้งค่า ${missingLabel} — กรุณาตั้งค่าที่เมนู ตั้งค่าระบบ > 2. Google Drive`
    );
    this.name = 'DriveNotConfiguredError';
    this.missingLabel = missingLabel;
  }
}

const MAX_SIZE_MAP: Record<DriveFileCategory, number> = {
  image: 5 * 1024 * 1024, // 5 MB
  signature: 3 * 1024 * 1024, // 3 MB
  document: 20 * 1024 * 1024, // 20 MB
  logo: 5 * 1024 * 1024, // 5 MB
};

const FOLDER_LABEL_MAP: Record<DriveFileCategory, string> = {
  image: 'โฟลเดอร์รูปภาพ (Google Drive)',
  signature: 'โฟลเดอร์ลายเซ็น (Google Drive)',
  document: 'โฟลเดอร์เอกสาร (Google Drive)',
  logo: 'โฟลเดอร์โลโก้ระบบ (Google Drive)',
};

// Session-scoped cache & in-flight deduplication for GAS getBase64 proxy
const driveBase64Cache = new Map<string, string>();
const driveBase64InFlight = new Map<string, Promise<string | null>>();

export function extractGoogleDriveFileId(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const mLh3 = s.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/);
  if (mLh3?.[1]) return mLh3[1];

  const mFile = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (mFile?.[1]) return mFile[1];

  const mQuery = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (mQuery?.[1]) return mQuery[1];

  if (/^[a-zA-Z0-9_-]{15,}$/.test(s)) return s;
  return null;
}

export function extractGoogleDriveFolderId(raw?: string | null): string {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const mFolder = s.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (mFolder?.[1]) return mFolder[1];
  const mQuery = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (mQuery?.[1]) return mQuery[1];
  return s;
}

export function buildDriveThumbnailUrl(fileId: string, size = 1000): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size}`;
}

export function sanitizeDriveSubFolderName(raw?: string | null): string {
  if (!raw) return '';
  return String(raw)
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
}

/**
 * C1-A Confirmed Format:
 *   {คำนำหน้า}{ชื่อ} {นามสกุล}_{CID 4 หลักท้าย}
 *   เช่น "นายสมชาย ใจดี_0123"
 */
export function buildPersonnelSubFolderName(input: {
  prefixName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  cid?: string | null;
  cidMasked?: string | null;
}): string {
  const prefix = String(input.prefixName ?? '').trim();
  const first = String(input.firstName ?? '').trim();
  const last = String(input.lastName ?? '').trim();

  let displayName = '';
  if (first || last) {
    const firstWithPrefix = `${prefix}${first}`.trim();
    displayName = [firstWithPrefix, last].filter(Boolean).join(' ').trim();
  } else if (input.fullName) {
    displayName = String(input.fullName).trim();
  }

  const cleanName = sanitizeDriveSubFolderName(displayName) || 'บุคลากร';
  // Only append trailing 4 digits when unmasked trailing 4 consecutive digits exist
  // (avoids merging leading '1' + trailing '012' from masked CIDs like '1-xxxx-xxxxx-01-2')
  const rawCompact = String(input.cid ?? input.cidMasked ?? '').replace(/[\s-]/g, '');
  const trailing4Match = rawCompact.match(/(\d{4})$/);
  const last4 = trailing4Match ? trailing4Match[1] : '';

  return sanitizeDriveSubFolderName(last4 ? `${cleanName}_${last4}` : cleanName);
}

export function getDriveFolderIdForCategory(
  settings: PublicSystemSettings,
  category: DriveFileCategory
): string {
  switch (category) {
    case 'image':
      return extractGoogleDriveFolderId(settings.google_drive_image_folder_id);
    case 'signature':
      return extractGoogleDriveFolderId(settings.google_drive_signature_folder_id);
    case 'document':
      return extractGoogleDriveFolderId(settings.google_drive_document_folder_id);
    case 'logo':
      return (
        extractGoogleDriveFolderId(settings.google_drive_logo_folder_id) ||
        extractGoogleDriveFolderId(settings.google_drive_image_folder_id)
      );
  }
}

export function isDriveStorageReady(
  settings: PublicSystemSettings,
  category: DriveFileCategory
): boolean {
  return Boolean(
    settings.google_drive_script_url?.trim() &&
      getDriveFolderIdForCategory(settings, category)
  );
}

export function readFileAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
    reader.readAsDataURL(file);
  });
}

export async function verifyGoogleDriveFolder(
  scriptUrl: string,
  folderId: string,
  strictFolder = true
): Promise<GasDriveVerifyResponse> {
  const cleanUrl = scriptUrl.trim();
  const cleanFolder = extractGoogleDriveFolderId(folderId);

  if (!cleanUrl) {
    return { success: false, message: 'กรุณาระบุ Google Apps Script Web App URL' };
  }
  if (strictFolder && !cleanFolder) {
    return { success: false, message: 'กรุณาระบุ Google Drive Folder ID' };
  }

  const sep = cleanUrl.includes('?') ? '&' : '?';
  const target = cleanFolder
    ? `${cleanUrl}${sep}action=verify&folderId=${encodeURIComponent(cleanFolder)}`
    : `${cleanUrl}${sep}action=verify&mode=ping`;

  try {
    const res = await fetch(target, { method: 'GET' });
    const text = await res.text();
    const parsed = JSON.parse(text) as GasDriveVerifyResponse;
    // Backward compatibility with GAS v2.5.0 when verifying script URL without folderId
    if (!strictFolder && !cleanFolder && !parsed.success && /folderId/i.test(parsed.message || '')) {
      return {
        success: true,
        version: parsed.version,
        message: 'เชื่อมต่อ Google Apps Script Web App สำเร็จ (แนะนำอัปเดตเป็น Bridge v2.7.0)',
      };
    }
    return parsed;
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof SyntaxError
          ? 'GAS ตอบกลับไม่ใช่ JSON — กรุณาตรวจสอบสิทธิ์ Deploy Web App เป็น "Anyone"'
          : err instanceof Error
            ? `ไม่สามารถเชื่อมต่อ Google Apps Script ได้: ${err.message}`
            : 'ไม่สามารถเชื่อมต่อ Google Apps Script ได้',
    };
  }
}

export const verifyDriveFolder = verifyGoogleDriveFolder;

export async function fetchDriveStorageQuota(
  settings: PublicSystemSettings
): Promise<GasDriveQuotaResponse> {
  const cleanUrl = (settings.google_drive_script_url || '').trim();
  if (!cleanUrl) {
    return {
      success: false,
      totalLimitBytes: 0,
      totalUsedBytes: 0,
      availableBytes: 0,
      isUnlimited: false,
      usedPercent: 0,
      folders: [],
      message: 'ยังไม่ได้ตั้งค่า Google Apps Script Web App URL',
    };
  }

  const qs = new URLSearchParams({
    action: 'quota',
    imageFolderId: extractGoogleDriveFolderId(settings.google_drive_image_folder_id),
    signatureFolderId: extractGoogleDriveFolderId(settings.google_drive_signature_folder_id),
    documentFolderId: extractGoogleDriveFolderId(settings.google_drive_document_folder_id),
    logoFolderId: extractGoogleDriveFolderId(settings.google_drive_logo_folder_id),
  });

  const sep = cleanUrl.includes('?') ? '&' : '?';
  try {
    const res = await fetch(`${cleanUrl}${sep}${qs.toString()}`, { method: 'GET' });
    const text = await res.text();
    const parsed = JSON.parse(text) as GasDriveQuotaResponse;
    if (typeof parsed.success !== 'boolean') {
      throw new Error('Invalid quota payload');
    }
    return parsed;
  } catch {
    return {
      success: false,
      totalLimitBytes: 0,
      totalUsedBytes: 0,
      availableBytes: 0,
      isUnlimited: false,
      usedPercent: 0,
      folders: [],
      message: 'GAS ตอบกลับไม่ใช่ข้อมูล Quota — กรุณาอัปเดต gas/DriveStorageBridge.gs เป็นเวอร์ชัน 2.7.0',
    };
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 100 || idx === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[idx]}`;
}

export interface UploadToGoogleDriveOptions {
  file?: File | Blob;
  filename?: string;
  base64DataUrl?: string;
  fileName?: string;
  mimeType?: string;
  category: DriveFileCategory;
  settings: PublicSystemSettings;
  subFolderName?: string;
  replaceFileUrl?: string | null;
}

export async function uploadToGoogleDrive(options: UploadToGoogleDriveOptions): Promise<{
  url: string;
  fileId: string;
  subFolderName?: string;
  sharingMode?: GasDriveUploadResponse['sharingMode'];
  sharingWarning?: string;
  deletedOldFileId?: string;
}> {
  const {
    file,
    filename,
    base64DataUrl,
    fileName,
    mimeType: explicitMime,
    category,
    settings,
    subFolderName,
    replaceFileUrl,
  } = options;

  const scriptUrl = (settings.google_drive_script_url || '').trim();
  const folderId = getDriveFolderIdForCategory(settings, category);

  if (!scriptUrl) {
    throw new DriveNotConfiguredError('ลิงก์ Google Apps Script Web App');
  }
  if (!folderId) {
    throw new DriveNotConfiguredError(FOLDER_LABEL_MAP[category]);
  }

  const maxBytes = MAX_SIZE_MAP[category];
  let cleanBase64 = '';
  let mimeType = explicitMime || 'application/octet-stream';

  if (file) {
    if (file.size > maxBytes) {
      throw new Error(`ไฟล์มีขนาดเกิน ${(maxBytes / (1024 * 1024)).toFixed(0)} MB`);
    }
    const dataUrl = await readFileAsDataUrl(file);
    const idx = dataUrl.indexOf(',');
    cleanBase64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
    if (!explicitMime && file.type) mimeType = file.type;
  } else if (base64DataUrl) {
    const idx = base64DataUrl.indexOf(',');
    cleanBase64 = idx >= 0 ? base64DataUrl.slice(idx + 1) : base64DataUrl;
    const approxBytes = Math.floor((cleanBase64.length * 3) / 4);
    if (approxBytes > maxBytes) {
      throw new Error(`ไฟล์มีขนาดเกิน ${(maxBytes / (1024 * 1024)).toFixed(0)} MB`);
    }
  } else {
    throw new Error('ไม่พบข้อมูลไฟล์สำหรับอัปโหลด');
  }

  const resolvedFilename = (filename || fileName || `portal_upload_${Date.now()}`).trim();
  const cleanSubFolder = sanitizeDriveSubFolderName(subFolderName);
  const cleanReplaceUrl = (replaceFileUrl || '').trim();

  // Use text/plain to avoid CORS preflight OPTIONS on Google Apps Script Web App
  const res = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'upload',
      folderId,
      filename: resolvedFilename,
      mimeType,
      base64: cleanBase64,
      ...(cleanSubFolder ? { subFolderName: cleanSubFolder } : {}),
      ...(cleanReplaceUrl ? { replaceFileUrl: cleanReplaceUrl } : {}),
    }),
  });

  const rawText = await res.text();
  let parsed: GasDriveUploadResponse;
  try {
    parsed = JSON.parse(rawText) as GasDriveUploadResponse;
  } catch {
    throw new Error(
      `ไม่สามารถอ่านคำตอบจาก Google Drive Bridge (HTTP ${res.status}) กรุณาตรวจสอบการ Deploy GAS`
    );
  }

  if (!parsed.success || !parsed.url || !parsed.fileId) {
    throw new Error(parsed.message || 'อัปโหลดไฟล์ไปยัง Google Drive ไม่สำเร็จ');
  }

  return {
    url: parsed.url,
    fileId: parsed.fileId,
    subFolderName: parsed.subFolderName,
    sharingMode: parsed.sharingMode,
    sharingWarning: parsed.sharingWarning,
    deletedOldFileId: parsed.deletedOldFileId,
  };
}

/**
 * ลบไฟล์เดิมลงถังขยะ Google Drive (Best-Effort, Non-Throwing)
 * ฝั่ง GAS จะตรวจสอบว่าไฟล์อยู่ภายใน rootFolderId (Depth 1 หรือ 2) เท่านั้นจึงจะย้ายลงถังขยะ
 */
export async function deleteFromGoogleDrive(options: {
  fileUrlOrId?: string | null;
  category: DriveFileCategory;
  settings: PublicSystemSettings;
}): Promise<GasDriveDeleteResponse> {
  const { fileUrlOrId, category, settings } = options;
  const fileId = extractGoogleDriveFileId(fileUrlOrId);
  if (!fileId) {
    return { success: false, deleted: false, reason: 'not_a_drive_file' };
  }

  const scriptUrl = (settings.google_drive_script_url || '').trim();
  const folderId = getDriveFolderIdForCategory(settings, category);
  if (!scriptUrl || !folderId) {
    return { success: false, deleted: false, fileId, reason: 'drive_not_configured' };
  }

  try {
    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'delete',
        folderId,
        fileId,
      }),
    });
    const rawText = await res.text();
    const parsed = JSON.parse(rawText) as GasDriveDeleteResponse;
    if (parsed.deleted) {
      driveBase64Cache.delete(`${folderId}:${fileId}`);
    }
    return parsed;
  } catch (err) {
    return {
      success: false,
      deleted: false,
      fileId,
      reason: err instanceof Error ? err.message : 'network_error',
    };
  }
}

/**
 * โหลดรูปภาพจาก Google Drive เป็น Base64 Data URL ผ่าน GAS Proxy (Zero-CORS)
 * มี Session Cache + In-Flight Deduplication ในตัว
 */
export async function fetchDriveImageAsDataUrl(options: {
  fileUrlOrId?: string | null;
  category: DriveFileCategory;
  settings: PublicSystemSettings;
}): Promise<string | null> {
  const { fileUrlOrId, category, settings } = options;
  const fileId = extractGoogleDriveFileId(fileUrlOrId);
  if (!fileId) return null;

  const scriptUrl = (settings.google_drive_script_url || '').trim();
  const folderId = getDriveFolderIdForCategory(settings, category);
  if (!scriptUrl || !folderId) return null;

  const cacheKey = `${folderId}:${fileId}`;
  const cached = driveBase64Cache.get(cacheKey);
  if (cached) return cached;

  const existingPromise = driveBase64InFlight.get(cacheKey);
  if (existingPromise) return existingPromise;

  const promise = (async (): Promise<string | null> => {
    try {
      const sep = scriptUrl.includes('?') ? '&' : '?';
      const target = `${scriptUrl}${sep}action=getBase64&fileId=${encodeURIComponent(fileId)}&folderId=${encodeURIComponent(folderId)}`;
      const res = await fetch(target, { method: 'GET' });
      const text = await res.text();
      const parsed = JSON.parse(text) as GasDriveBase64Response;
      if (parsed.success && parsed.dataUrl && parsed.dataUrl.startsWith('data:image/')) {
        driveBase64Cache.set(cacheKey, parsed.dataUrl);
        return parsed.dataUrl;
      }
      return null;
    } catch {
      return null;
    } finally {
      driveBase64InFlight.delete(cacheKey);
    }
  })();

  driveBase64InFlight.set(cacheKey, promise);
  return promise;
}

export function clearDriveBase64Cache(): void {
  driveBase64Cache.clear();
  driveBase64InFlight.clear();
}

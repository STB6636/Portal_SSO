import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDriveThumbnailUrl,
  buildPersonnelSubFolderName,
  deleteFromGoogleDrive,
  extractGoogleDriveFileId,
  sanitizeDriveSubFolderName,
  uploadToGoogleDrive,
} from '@/services/driveStorageService';
import type { PublicSystemSettings } from '@/types/domain.types';

const MOCK_SETTINGS: PublicSystemSettings = {
  organization_name: 'กรุงเทพมหานคร',
  bureau_name: 'สำนักเทศกิจ',
  system_title: 'Portal SSO',
  logo_url: '',
  footer_description: '',
  allow_self_register: false,
  google_drive_script_url: 'https://script.google.com/macros/s/MOCK_SCRIPT/exec',
  google_drive_image_folder_id: 'IMG_ROOT_FOLDER_12345',
  google_drive_signature_folder_id: 'SIG_ROOT_FOLDER_12345',
  google_drive_document_folder_id: 'DOC_ROOT_FOLDER_12345',
  google_drive_logo_folder_id: 'LOGO_ROOT_FOLDER_12345',
  announcement_enabled: false,
  announcement_mode: 'text',
  announcement_title: '',
  announcement_body: '',
  announcement_image_url: '',
  announcement_start_date: '',
  announcement_end_date: '',
  announcement_updated_at: '',
  import_max_rows: 2000,
  import_chunk_size: 200,
};

describe('driveStorageService v2.7.0', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts Google Drive file IDs from lh3, file/d, thumbnail, query, and raw IDs', () => {
    expect(extractGoogleDriveFileId('https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUv')).toBe(
      '1AbCdEfGhIjKlMnOpQrStUv'
    );
    expect(
      extractGoogleDriveFileId('https://drive.google.com/file/d/1XyZ9876543210_abcDEF/view?usp=sharing')
    ).toBe('1XyZ9876543210_abcDEF');
    expect(
      extractGoogleDriveFileId('https://drive.google.com/thumbnail?id=1ThumbFileId98765432&sz=w1000')
    ).toBe('1ThumbFileId98765432');
    expect(extractGoogleDriveFileId('1RawDriveFileId12345')).toBe('1RawDriveFileId12345');
    expect(extractGoogleDriveFileId('https://example.com/static/logo.png')).toBeNull();
  });

  it('sanitizes folder names and builds C1-A personnel sub-folder format', () => {
    expect(sanitizeDriveSubFolderName('  นายสมชาย/ใจดี:*?"<>|  ')).toBe('นายสมชาย ใจดี');
    expect(
      buildPersonnelSubFolderName({
        prefixName: 'นาย',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        cid: '1-1001-00123-45-6',
      })
    ).toBe('นายสมชาย ใจดี_3456');
    expect(
      buildPersonnelSubFolderName({
        fullName: 'นางสาวสุดา รักดี',
        cidMasked: '1-xxxx-xxxxx-01-2',
      })
    ).toBe('นางสาวสุดา รักดี');
  });

  it('builds Google Drive thumbnail fallback URL', () => {
    expect(buildDriveThumbnailUrl('1AbCdEfGhIjKlMnOp')).toBe(
      'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOp&sz=w1000'
    );
  });

  it('sends subFolderName and replaceFileUrl during uploadToGoogleDrive', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          url: 'https://lh3.googleusercontent.com/d/NEW_FILE_ID_123456',
          fileId: 'NEW_FILE_ID_123456',
          subFolderName: 'นายสมชาย ใจดี_3456',
          sharingMode: 'anyone',
          deletedOldFileId: 'OLD_FILE_ID_123456',
        }),
        { status: 200 }
      )
    );

    const res = await uploadToGoogleDrive({
      base64DataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      mimeType: 'image/png',
      fileName: 'profile.png',
      category: 'image',
      subFolderName: 'นายสมชาย ใจดี_3456',
      replaceFileUrl: 'https://lh3.googleusercontent.com/d/OLD_FILE_ID_123456',
      settings: MOCK_SETTINGS,
    });

    expect(res.fileId).toBe('NEW_FILE_ID_123456');
    expect(res.deletedOldFileId).toBe('OLD_FILE_ID_123456');

    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sentBody.action).toBe('upload');
    expect(sentBody.folderId).toBe('IMG_ROOT_FOLDER_12345');
    expect(sentBody.subFolderName).toBe('นายสมชาย ใจดี_3456');
    expect(sentBody.replaceFileUrl).toBe('https://lh3.googleusercontent.com/d/OLD_FILE_ID_123456');
  });

  it('calls POST action=delete in deleteFromGoogleDrive and handles non-Drive URLs gracefully', async () => {
    const nonDrive = await deleteFromGoogleDrive({
      fileUrlOrId: 'https://example.com/not-drive.png',
      category: 'image',
      settings: MOCK_SETTINGS,
    });
    expect(nonDrive.deleted).toBe(false);
    expect(nonDrive.reason).toBe('not_a_drive_file');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          deleted: true,
          fileId: 'OLD_FILE_ID_123456',
          reason: 'trashed',
        }),
        { status: 200 }
      )
    );

    const res = await deleteFromGoogleDrive({
      fileUrlOrId: 'https://lh3.googleusercontent.com/d/OLD_FILE_ID_123456',
      category: 'signature',
      settings: MOCK_SETTINGS,
    });
    expect(res.deleted).toBe(true);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sentBody.action).toBe('delete');
    expect(sentBody.folderId).toBe('SIG_ROOT_FOLDER_12345');
    expect(sentBody.fileId).toBe('OLD_FILE_ID_123456');
  });
});

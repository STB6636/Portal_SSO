/**
 * =============================================================================
 * Google Apps Script — Drive Storage Bridge v2.7.0
 * Portal SSO (BMA Municipal Police / สำนักเทศกิจ กรุงเทพมหานคร)
 * =============================================================================
 *
 * ความสามารถหลักในเวอร์ชัน 2.7.0:
 *   1. Safe Multi-Tier Sharing (trySetFilePublic_): แก้ปัญหา
 *      "Exception: Access denied: DriveApp." บน Google Workspace / Shared Drive
 *      โดยรองรับลำดับชั้น: ANYONE_WITH_LINK -> Inherited Folder -> DOMAIN_WITH_LINK -> Restricted (Proxy)
 *   2. Sub-Folder Separation (getOrCreateSubFolder_): แยกโฟลเดอร์ย่อยตามชื่อบุคลากร
 *      เช่น {คำนำหน้า}{ชื่อ} {นามสกุล}_{CID 4 หลักท้าย} หรือ Webapp_Icons / System_Announcements
 *   3. Atomic Replace & Safe Trash (replaceFileUrl + POST action="delete"):
 *      ลบไฟล์เก่าลงถังขยะเฉพาะไฟล์ที่อยู่ภายใน rootFolderId (Depth 1 หรือ Depth 2 เท่านั้น)
 *   4. Zero-CORS Image Proxy (GET ?action=getBase64&fileId=...&folderId=...):
 *      ส่งภาพ Base64 Data URL สำหรับ <DriveImage /> Fallback ชั้นที่ 3 และลายเซ็นบน Canvas ก.พ. ๗
 *   5. Enhanced Verify & Quota (GET ?action=verify / ?action=quota):
 *      รายงาน version, sharingAccess และนับไฟล์รวมโฟลเดอร์ย่อย 1 ชั้น (subFolderCount)
 *
 * วิธีอัปเดต Deploy (Deploy -> Manage deployments -> Edit -> New version):
 *   - Execute as: Me
 *   - Who has access: Anyone
 * =============================================================================
 */

var BRIDGE_VERSION = '2.7.0';
var MAX_BASE64_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * แยก Google Drive File ID จาก URL ทุกรูปแบบ หรือคืนค่า ID ดิบถ้าส่งมาตรงๆ
 */
function extractDriveFileId_(raw) {
  if (!raw) return '';
  var s = String(raw).trim();
  if (!s) return '';

  // lh3.googleusercontent.com/d/<ID>
  var mLh3 = s.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/);
  if (mLh3 && mLh3[1]) return mLh3[1];

  // drive.google.com/file/d/<ID>
  var mFile = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (mFile && mFile[1]) return mFile[1];

  // ?id=<ID> or &id=<ID>
  var mQuery = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (mQuery && mQuery[1]) return mQuery[1];

  // Raw Drive File ID
  if (/^[a-zA-Z0-9_-]{15,}$/.test(s)) return s;

  return '';
}

/**
 * ทำความสะอาดชื่อโฟลเดอร์ย่อยให้ปลอดภัยสำหรับ Google Drive
 */
function sanitizeSubFolderName_(raw) {
  if (!raw) return '';
  var cleaned = String(raw)
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length > 100) {
    cleaned = cleaned.substring(0, 100).trim();
  }
  return cleaned;
}

/**
 * หาโฟลเดอร์ย่อยที่ยังไม่ถูกลบภายใต้ rootFolder หรือสร้างใหม่หากยังไม่มี
 */
function getOrCreateSubFolder_(rootFolder, rawSubFolderName) {
  var cleanName = sanitizeSubFolderName_(rawSubFolderName);
  if (!cleanName) {
    return { folder: rootFolder, subFolderName: '' };
  }

  var iter = rootFolder.getFoldersByName(cleanName);
  while (iter.hasNext()) {
    var existing = iter.next();
    if (!existing.isTrashed()) {
      return { folder: existing, subFolderName: cleanName };
    }
  }

  var created = rootFolder.createFolder(cleanName);
  return { folder: created, subFolderName: cleanName };
}

/**
 * ตรวจสอบว่าไฟล์อยู่ภายใน rootFolderId (ระดับ 1 หรือโฟลเดอร์ย่อยระดับ 2 เท่านั้น)
 */
function isFileWithinRootFolder_(file, rootFolderId) {
  if (!file || !rootFolderId) return false;
  var targetId = String(rootFolderId).trim();
  if (!targetId) return false;

  try {
    var parents = file.getParents();
    while (parents.hasNext()) {
      var parent = parents.next();
      if (parent.getId() === targetId) return true;

      var grandParents = parent.getParents();
      while (grandParents.hasNext()) {
        var gp = grandParents.next();
        if (gp.getId() === targetId) return true;
      }
    }
  } catch (_) {
    return false;
  }
  return false;
}

/**
 * ย้ายไฟล์ลงถังขยะอย่างปลอดภัย เฉพาะกรณีที่ไฟล์อยู่ภายใน rootFolderId เท่านั้น
 */
function trashFileWithinRoot_(rawFileUrlOrId, rootFolderId) {
  var fileId = extractDriveFileId_(rawFileUrlOrId);
  if (!fileId) {
    return { deleted: false, fileId: '', reason: 'invalid_file_id' };
  }
  if (!rootFolderId) {
    return { deleted: false, fileId: fileId, reason: 'missing_root_folder_id' };
  }

  try {
    var file = DriveApp.getFileById(fileId);
    if (file.isTrashed()) {
      return { deleted: false, fileId: fileId, reason: 'already_trashed' };
    }
    if (!isFileWithinRootFolder_(file, rootFolderId)) {
      return { deleted: false, fileId: fileId, reason: 'outside_root_folder' };
    }
    file.setTrashed(true);
    return { deleted: true, fileId: fileId, reason: 'trashed' };
  } catch (err) {
    return {
      deleted: false,
      fileId: fileId,
      reason: 'trash_error: ' + (err && err.message ? err.message : String(err)),
    };
  }
}

/**
 * ตั้งสิทธิ์การอ่านไฟล์แบบ 4 ระดับ (Safe Multi-Tier Sharing) — ไม่ Throw Error
 * แก้ปัญหา Exception: Access denied: DriveApp. บน Workspace / Shared Drive
 */
function trySetFilePublic_(file) {
  // Tier 1: Anyone with link can view
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { sharingMode: 'anyone', sharingWarning: '' };
  } catch (_) {
    // Fall through to Tier 2
  }

  // Tier 2: Check inherited folder sharing access
  try {
    var access = file.getSharingAccess();
    if (access === DriveApp.Access.ANYONE || access === DriveApp.Access.ANYONE_WITH_LINK) {
      return { sharingMode: 'inherited', sharingWarning: '' };
    }
  } catch (_) {
    // Fall through to Tier 3
  }

  // Tier 3: Domain with link (Google Workspace orgs that block external sharing)
  try {
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    return {
      sharingMode: 'domain',
      sharingWarning:
        'บัญชี Google Workspace จำกัดการแชร์สาธารณะ ระบบตั้งสิทธิ์เป็นภายในองค์กรและแสดงผลผ่านโหมด Proxy อัตโนมัติ',
    };
  } catch (_) {
    // Fall through to Tier 4
  }

  // Tier 4: Keep folder default permissions; client falls back to GAS getBase64
  return {
    sharingMode: 'restricted',
    sharingWarning:
      'อัปโหลดไฟล์สำเร็จ (นโยบาย Drive จำกัดการเปลี่ยนสิทธิ์แชร์ ระบบจะแสดงภาพผ่านโหมด Proxy อัตโนมัติ)',
  };
}

/**
 * GET Requests:
 *  - ?action=verify&folderId=...
 *  - ?action=quota&imageFolderId=...&signatureFolderId=...&documentFolderId=...&logoFolderId=...
 *  - ?action=getBase64&fileId=...&folderId=...
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = params.action || 'verify';

    if (action === 'quota') {
      return handleQuotaRequest_(params);
    }

    if (action === 'getBase64') {
      return handleGetBase64Request_(params);
    }

    // Default: verify script endpoint or single folder
    var folderId = params.folderId || '';
    if (!folderId) {
      if (params.mode === 'ping') {
        return jsonResponse_({
          success: true,
          version: BRIDGE_VERSION,
          message: 'เชื่อมต่อ Google Apps Script Web App สำเร็จ (Bridge v' + BRIDGE_VERSION + ')',
        });
      }
      return jsonResponse_({
        success: false,
        version: BRIDGE_VERSION,
        message: 'ไม่พบพารามิเตอร์ folderId กรุณาระบุ Google Drive Folder ID',
      });
    }

    var folder = DriveApp.getFolderById(folderId);
    var sharingAccess = 'UNKNOWN';
    try {
      sharingAccess = String(folder.getSharingAccess());
    } catch (_) {
      sharingAccess = 'UNKNOWN';
    }

    return jsonResponse_({
      success: true,
      version: BRIDGE_VERSION,
      folderId: folder.getId(),
      folderName: folder.getName(),
      folderUrl: folder.getUrl(),
      sharingAccess: sharingAccess,
      message: 'เชื่อมต่อโฟลเดอร์ "' + folder.getName() + '" สำเร็จ (Bridge v' + BRIDGE_VERSION + ')',
    });
  } catch (err) {
    return jsonResponse_({
      success: false,
      version: BRIDGE_VERSION,
      message: 'ไม่สามารถเข้าถึงโฟลเดอร์ได้: ' + (err && err.message ? err.message : String(err)),
    });
  }
}

/**
 * ส่งภาพเป็น Base64 Data URL อย่างปลอดภัย (ตรวจ rootFolderId Containment + เฉพาะ image/* + <= 5MB)
 */
function handleGetBase64Request_(params) {
  var rawFileRef = params.fileId || params.fileUrl || '';
  var folderId = params.folderId || '';
  var fileId = extractDriveFileId_(rawFileRef);

  if (!fileId || !folderId) {
    return jsonResponse_({
      success: false,
      message: 'กรุณาระบุ fileId และ folderId ให้ครบถ้วน',
    });
  }

  try {
    var file = DriveApp.getFileById(fileId);
    if (file.isTrashed()) {
      return jsonResponse_({
        success: false,
        fileId: fileId,
        message: 'ไฟล์ถูกย้ายไปยังถังขยะแล้ว',
      });
    }

    if (!isFileWithinRootFolder_(file, folderId)) {
      return jsonResponse_({
        success: false,
        fileId: fileId,
        message: 'ไม่อนุญาตให้อ่านไฟล์ที่อยู่นอกโฟลเดอร์ที่กำหนด',
      });
    }

    var mimeType = file.getMimeType() || 'image/png';
    if (mimeType.indexOf('image/') !== 0) {
      return jsonResponse_({
        success: false,
        fileId: fileId,
        message: 'รองรับการดึงภาพ Base64 เฉพาะไฟล์รูปภาพ (image/*) เท่านั้น',
      });
    }

    var sizeBytes = file.getSize();
    if (sizeBytes > MAX_BASE64_IMAGE_BYTES) {
      return jsonResponse_({
        success: false,
        fileId: fileId,
        message: 'ไฟล์รูปภาพมีขนาดเกิน 5 MB ไม่สามารถแปลงเป็น Base64 Proxy ได้',
      });
    }

    var bytes = file.getBlob().getBytes();
    var encoded = Utilities.base64Encode(bytes);
    return jsonResponse_({
      success: true,
      fileId: fileId,
      mimeType: mimeType,
      sizeBytes: sizeBytes,
      dataUrl: 'data:' + mimeType + ';base64,' + encoded,
    });
  } catch (err) {
    return jsonResponse_({
      success: false,
      fileId: fileId,
      message: 'ไม่สามารถโหลดภาพจาก Google Drive ได้: ' + (err && err.message ? err.message : String(err)),
    });
  }
}

/**
 * อ่านโควตาพื้นที่รวมของ Google Drive และนับไฟล์/ขนาดรวมของ 4 โฟลเดอร์ (รวมโฟลเดอร์ย่อย 1 ชั้น)
 */
function handleQuotaRequest_(params) {
  var startedAt = Date.now();
  var deadlineMs = startedAt + 20000;

  var totalLimitBytes = 0;
  var totalUsedBytes = 0;
  var isUnlimited = false;

  try {
    totalLimitBytes = DriveApp.getStorageLimit();
    totalUsedBytes = DriveApp.getStorageUsed();
    if (!totalLimitBytes || totalLimitBytes <= 0) {
      isUnlimited = true;
    }
  } catch (_) {
    isUnlimited = true;
  }

  var availableBytes = isUnlimited ? -1 : Math.max(0, totalLimitBytes - totalUsedBytes);
  var usedPercent =
    !isUnlimited && totalLimitBytes > 0
      ? Math.round((totalUsedBytes / totalLimitBytes) * 1000) / 10
      : 0;

  var defs = [
    { key: 'image', label: 'โฟลเดอร์รูปภาพ', id: params.imageFolderId || '' },
    { key: 'signature', label: 'โฟลเดอร์ลายเซ็น', id: params.signatureFolderId || '' },
    { key: 'document', label: 'โฟลเดอร์เอกสาร', id: params.documentFolderId || '' },
    { key: 'logo', label: 'โฟลเดอร์โลโก้ระบบ', id: params.logoFolderId || '' },
  ];

  var folders = [];
  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    if (!def.id) {
      folders.push({
        key: def.key,
        label: def.label,
        configured: false,
        accessible: false,
        folderId: '',
        folderName: '',
        fileCount: 0,
        subFolderCount: 0,
        sizeBytes: 0,
        truncated: false,
      });
      continue;
    }

    var stat = scanFolderStats_(def.id, deadlineMs);
    folders.push({
      key: def.key,
      label: def.label,
      configured: true,
      accessible: stat.accessible,
      folderId: def.id,
      folderName: stat.folderName,
      fileCount: stat.fileCount,
      subFolderCount: stat.subFolderCount,
      sizeBytes: stat.sizeBytes,
      truncated: stat.truncated,
      error: stat.error || undefined,
    });
  }

  return jsonResponse_({
    success: true,
    version: BRIDGE_VERSION,
    totalLimitBytes: totalLimitBytes,
    totalUsedBytes: totalUsedBytes,
    availableBytes: availableBytes,
    isUnlimited: isUnlimited,
    usedPercent: usedPercent,
    folders: folders,
    checkedAt: new Date().toISOString(),
    message: 'ดึงข้อมูลพื้นที่จัดเก็บ Google Drive สำเร็จ',
  });
}

/**
 * นับจำนวนไฟล์ โฟลเดอร์ย่อย 1 ชั้น และขนาดรวมในโฟลเดอร์ (มี Guard ป้องกัน Timeout)
 */
function scanFolderStats_(folderId, deadlineMs) {
  var MAX_FILES = 2000;
  try {
    var folder = DriveApp.getFolderById(folderId);
    var fileCount = 0;
    var subFolderCount = 0;
    var sizeBytes = 0;
    var truncated = false;

    // 1. Scan root files
    var rootFiles = folder.getFiles();
    while (rootFiles.hasNext()) {
      if (fileCount >= MAX_FILES || Date.now() >= deadlineMs) {
        truncated = true;
        break;
      }
      var f = rootFiles.next();
      if (f.isTrashed()) continue;
      fileCount++;
      try {
        sizeBytes += f.getSize();
      } catch (_) {}
    }

    // 2. Scan 1-level child sub-folders
    if (!truncated) {
      var subFolders = folder.getFolders();
      while (subFolders.hasNext()) {
        if (fileCount >= MAX_FILES || Date.now() >= deadlineMs) {
          truncated = true;
          break;
        }
        var sub = subFolders.next();
        if (sub.isTrashed()) continue;
        subFolderCount++;
        var subFiles = sub.getFiles();
        while (subFiles.hasNext()) {
          if (fileCount >= MAX_FILES || Date.now() >= deadlineMs) {
            truncated = true;
            break;
          }
          var sf = subFiles.next();
          if (sf.isTrashed()) continue;
          fileCount++;
          try {
            sizeBytes += sf.getSize();
          } catch (_) {}
        }
      }
    }

    return {
      accessible: true,
      folderName: folder.getName(),
      fileCount: fileCount,
      subFolderCount: subFolderCount,
      sizeBytes: sizeBytes,
      truncated: truncated,
      error: '',
    };
  } catch (err) {
    return {
      accessible: false,
      folderName: '',
      fileCount: 0,
      subFolderCount: 0,
      sizeBytes: 0,
      truncated: false,
      error: err && err.message ? err.message : String(err),
    };
  }
}

/**
 * POST Requests:
 *  - action="delete": ย้ายไฟล์ลงถังขยะ (ตรวจ rootFolderId containment)
 *  - action="upload" (ค่าเริ่มต้น): อัปโหลดไฟล์เข้า rootFolder หรือ subFolderName + Safe Multi-Tier Sharing + Atomic Replace
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ success: false, message: 'ไม่พบข้อมูลคำขอ (Empty POST body)' });
    }

    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || 'upload';

    // Action: Delete existing file safely within root folder
    if (action === 'delete') {
      var delFolderId = payload.folderId || '';
      var delFileRef = payload.fileUrl || payload.fileId || '';
      if (!delFolderId || !delFileRef) {
        return jsonResponse_({
          success: false,
          deleted: false,
          message: 'กรุณาระบุ folderId และ fileUrl หรือ fileId ที่ต้องการลบ',
        });
      }
      var delRes = trashFileWithinRoot_(delFileRef, delFolderId);
      return jsonResponse_({
        success: true,
        deleted: delRes.deleted,
        fileId: delRes.fileId,
        reason: delRes.reason,
        message: delRes.deleted
          ? 'ย้ายไฟล์เก่าลงถังขยะ Google Drive เรียบร้อยแล้ว'
          : 'ไม่สามารถย้ายไฟล์ได้ (' + delRes.reason + ')',
      });
    }

    // Action: Upload file
    var folderId = payload.folderId || '';
    var base64Data = payload.base64 || '';
    var filename = payload.filename || ('portal_upload_' + Date.now());
    var mimeType = payload.mimeType || 'application/octet-stream';
    var rawSubFolderName = payload.subFolderName || '';
    var replaceFileRef = payload.replaceFileUrl || payload.replaceFileId || '';

    if (!folderId || !base64Data) {
      return jsonResponse_({
        success: false,
        message: 'ข้อมูลไม่ครบถ้วน (ต้องระบุ folderId และ base64)',
      });
    }

    var cleanBase64 = base64Data.indexOf(',') !== -1 ? base64Data.split(',')[1] : base64Data;
    var decoded = Utilities.base64Decode(cleanBase64);

    if (decoded.length > 25 * 1024 * 1024) {
      return jsonResponse_({
        success: false,
        message: 'ไฟล์มีขนาดใหญ่เกิน 25 MB',
      });
    }

    var rootFolder = DriveApp.getFolderById(folderId);
    var subTarget = getOrCreateSubFolder_(rootFolder, rawSubFolderName);
    var targetFolder = subTarget.folder;

    var blob = Utilities.newBlob(decoded, mimeType, filename);
    var file = targetFolder.createFile(blob);
    var newFileId = file.getId();

    // Safe Multi-Tier Sharing (never throws)
    var shareResult = trySetFilePublic_(file);

    // Atomic Replace: trash old file ONLY after new file succeeded
    var deletedOldFileId = '';
    if (replaceFileRef) {
      var oldId = extractDriveFileId_(replaceFileRef);
      if (oldId && oldId !== newFileId) {
        var trashRes = trashFileWithinRoot_(oldId, folderId);
        if (trashRes.deleted) {
          deletedOldFileId = trashRes.fileId;
        }
      }
    }

    var publicUrl =
      mimeType.indexOf('image/') === 0
        ? 'https://lh3.googleusercontent.com/d/' + newFileId
        : 'https://drive.google.com/file/d/' + newFileId + '/view?usp=sharing';

    return jsonResponse_({
      success: true,
      url: publicUrl,
      fileId: newFileId,
      folderName: rootFolder.getName(),
      subFolderName: subTarget.subFolderName || undefined,
      mimeType: mimeType,
      sizeBytes: decoded.length,
      sharingMode: shareResult.sharingMode,
      sharingWarning: shareResult.sharingWarning || undefined,
      deletedOldFileId: deletedOldFileId || undefined,
    });
  } catch (err) {
    return jsonResponse_({
      success: false,
      message: 'อัปโหลดไฟล์ล้มเหลว: ' + (err && err.message ? err.message : String(err)),
    });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

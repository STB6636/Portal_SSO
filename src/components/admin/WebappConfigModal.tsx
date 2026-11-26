import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { DriveImage } from '@/components/common/DriveImage';
import { useSettings } from '@/contexts/SettingsContext';
import {
  DriveNotConfiguredError,
  deleteFromGoogleDrive,
  readFileAsDataUrl,
  uploadToGoogleDrive,
} from '@/services/driveStorageService';
import { settingsService } from '@/services/settingsService';
import { webappService } from '@/services/webappService';
import { useUiStore } from '@/stores/useUiStore';
import { confirmAction, showDriveNotConfiguredAlert } from '@/lib/swalHelpers';
import { QUERY_KEYS } from '@/lib/queryClient';
import type { WebappRoleRow, WebappStatus } from '@/types/database.types';
import type { WebappWithRoles } from '@/types/domain.types';

interface WebappConfigModalProps {
  open: boolean;
  webapp: WebappWithRoles | null;
  onClose: () => void;
  onSaved: () => void;
}

type RoleDraft = {
  id?: string;
  role_code: string;
  role_name_th: string;
  description: string;
  hierarchy_level: number;
  color_hex: string;
  is_default_on_grant: boolean;
  is_app_admin: boolean;
  allow_scoped_admin_grant: boolean;
  sort_order: number;
  is_active: boolean;
};

const DEFAULT_ROLES: RoleDraft[] = [
  {
    role_code: 'USER',
    role_name_th: 'ผู้ใช้งานทั่วไป',
    description: 'สิทธิ์เริ่มต้นเมื่อเปิดใช้งานระบบย่อย',
    hierarchy_level: 1,
    color_hex: '#00744B',
    is_default_on_grant: true,
    is_app_admin: false,
    allow_scoped_admin_grant: true,
    sort_order: 1,
    is_active: true,
  },
  {
    role_code: 'APP_ADMIN',
    role_name_th: 'ผู้ดูแลระบบย่อย',
    description: 'สิทธิ์จัดการตั้งค่าทั้งหมดของเว็บแอปย่อยนี้',
    hierarchy_level: 99,
    color_hex: '#BE123C',
    is_default_on_grant: false,
    is_app_admin: true,
    allow_scoped_admin_grant: false,
    sort_order: 99,
    is_active: true,
  },
];

export function WebappConfigModal({ open, webapp, onClose, onSaved }: WebappConfigModalProps) {
  const showToast = useUiStore((s) => s.showToast);
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [tab, setTab] = useState<1 | 2 | 3 | 4>(1);
  const [saving, setSaving] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState('');
  const iconFileRef = useRef<HTMLInputElement | null>(null);
  const initialIconUrlRef = useRef<string>('');
  const pendingIconUploadsRef = useRef<string[]>([]);

  // Form states
  const [appCode, setAppCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [icon, setIcon] = useState('fa-window-maximize');
  const [iconUrl, setIconUrl] = useState('');
  const [color, setColor] = useState('#00744B');
  const [status, setStatus] = useState<WebappStatus>('ACTIVE');
  const [autoGrant, setAutoGrant] = useState(false);
  const [sortOrder, setSortOrder] = useState(0);
  const [roles, setRoles] = useState<RoleDraft[]>(DEFAULT_ROLES);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [originsText, setOriginsText] = useState('');

  const { data: catalog } = useQuery({
    queryKey: QUERY_KEYS.apiCatalog,
    queryFn: () => settingsService.listApiCatalog(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setTab(1);
    setNewlyGeneratedKey('');
    pendingIconUploadsRef.current = [];
    if (webapp) {
      initialIconUrlRef.current = (webapp.icon_url || '').trim();
      setAppCode(webapp.app_code);
      setName(webapp.name);
      setDescription(webapp.description || '');
      setUrl(webapp.url);
      setIcon(webapp.icon || 'fa-window-maximize');
      setIconUrl(webapp.icon_url || '');
      setColor(webapp.color || '#00744B');
      setStatus(webapp.status);
      setAutoGrant(Boolean(webapp.auto_grant_on_provision));
      setSortOrder(webapp.sort_order ?? 0);
      setRoles(
        (webapp.roles && webapp.roles.length > 0 ? webapp.roles : DEFAULT_ROLES).map((r, idx) => ({
          id: 'id' in r ? r.id : undefined,
          role_code: r.role_code,
          role_name_th: r.role_name_th,
          description: r.description || '',
          hierarchy_level: r.hierarchy_level ?? idx + 1,
          color_hex: r.color_hex || '#00744B',
          is_default_on_grant: Boolean(r.is_default_on_grant),
          is_app_admin: Boolean(r.is_app_admin),
          allow_scoped_admin_grant: r.allow_scoped_admin_grant !== false,
          sort_order: r.sort_order ?? idx + 1,
          is_active: r.is_active !== false,
        }))
      );
      setSelectedScopes(webapp.scopes || []);
      setOriginsText((webapp.allowed_origins || []).join('\n'));
    } else {
      initialIconUrlRef.current = '';
      setAppCode('');
      setName('');
      setDescription('');
      setUrl('https://');
      setIcon('fa-window-maximize');
      setIconUrl('');
      setColor('#00744B');
      setStatus('ACTIVE');
      setAutoGrant(false);
      setSortOrder(0);
      setRoles(DEFAULT_ROLES);
      setSelectedScopes(['permission:read', 'personnel:read']);
      setOriginsText('');
    }
  }, [open, webapp]);

  const handleSave = async () => {
    if (!appCode.trim() || !name.trim() || !url.trim()) {
      showToast('กรุณากรอก App Code, ชื่อเว็บแอป และ URL ให้ครบถ้วน', 'warning');
      setTab(1);
      return;
    }
    if (!/^https?:\/\/.+/i.test(url.trim())) {
      showToast('URL ปลายทางต้องขึ้นต้นด้วย http:// หรือ https://', 'warning');
      setTab(1);
      return;
    }
    if (roles.length === 0 || roles.some((r) => !r.role_code.trim() || !r.role_name_th.trim())) {
      showToast('กรุณากำหนดระดับสิทธิ์อย่างน้อย 1 รายการ (ต้องมี Role Code และชื่อภาษาไทย)', 'warning');
      setTab(2);
      return;
    }
    const normalizedRoleCodes = roles.map((r) => r.role_code.trim().toUpperCase());
    if (new Set(normalizedRoleCodes).size !== normalizedRoleCodes.length) {
      showToast('พบ Role Code ซ้ำกันภายในเว็บแอปนี้ กรุณาตรวจสอบแท็บที่ 2', 'warning');
      setTab(2);
      return;
    }

    const validScopeSet = new Set((catalog?.scopes ?? []).map((s) => s.code));
    const safeScopes =
      validScopeSet.size > 0
        ? selectedScopes.filter((code) => validScopeSet.has(code))
        : selectedScopes;

    setSaving(true);
    try {
      const allowedOrigins = originsText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      await webappService.saveWithRoles({
        id: webapp?.id,
        app_code: appCode.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim(),
        url: url.trim(),
        icon: icon.trim() || 'fa-window-maximize',
        icon_url: iconUrl.trim(),
        color: color.trim() || '#00744B',
        status,
        auto_grant_on_provision: autoGrant,
        sort_order: Number(sortOrder) || 0,
        roles: roles.map((r, i) => ({
          id: r.id,
          role_code: r.role_code.trim().toUpperCase(),
          role_name_th: r.role_name_th.trim(),
          description: r.description.trim() || null,
          hierarchy_level: Number(r.hierarchy_level) || i + 1,
          color_hex: r.color_hex || '#00744B',
          is_default_on_grant: r.is_default_on_grant,
          is_app_admin: r.is_app_admin,
          allow_scoped_admin_grant: r.allow_scoped_admin_grant,
          sort_order: Number(r.sort_order) || i + 1,
          is_active: r.is_active,
        })) as Array<Partial<WebappRoleRow>>,
        scopes: safeScopes,
        allowed_origins: allowedOrigins,
      });

      const finalIconUrl = iconUrl.trim();
      const toDelete = new Set<string>();
      if (initialIconUrlRef.current && initialIconUrlRef.current !== finalIconUrl) {
        toDelete.add(initialIconUrlRef.current);
      }
      for (const u of pendingIconUploadsRef.current) {
        if (u && u !== finalIconUrl) toDelete.add(u);
      }
      for (const u of toDelete) {
        void deleteFromGoogleDrive({ fileUrlOrId: u, category: 'image', settings });
      }
      initialIconUrlRef.current = finalIconUrl;
      pendingIconUploadsRef.current = [];

      showToast(webapp ? 'อัปเดตข้อมูลเว็บแอปย่อยเรียบร้อย' : 'ลงทะเบียนเว็บแอปย่อยใหม่เรียบร้อย', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถบันทึกข้อมูลเว็บแอปได้', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelClose = () => {
    // Deferred Delete on Cancel: clean up only newly uploaded orphan icons, preserve initialIconUrlRef!
    for (const u of pendingIconUploadsRef.current) {
      if (u && u !== initialIconUrlRef.current) {
        void deleteFromGoogleDrive({ fileUrlOrId: u, category: 'image', settings });
      }
    }
    pendingIconUploadsRef.current = [];
    onClose();
  };

  const handleUploadIcon = async (file: File) => {
    setUploadingIcon(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const safeCode = (appCode || name || 'webapp').replace(/[^a-zA-Z0-9_-]/g, '_');
      const res = await uploadToGoogleDrive({
        base64DataUrl: dataUrl,
        mimeType: file.type || 'image/png',
        fileName: `webapp_icon_${safeCode}_${Date.now()}_${file.name}`,
        category: 'image',
        subFolderName: 'Webapp_Icons',
        settings,
      });
      pendingIconUploadsRef.current.push(res.url);
      setIconUrl(res.url);
      if (res.sharingWarning) {
        showToast(res.sharingWarning, 'warning');
      } else {
        showToast('อัปโหลดรูปไอคอนเว็บแอปขึ้น Google Drive สำเร็จ (กดบันทึกเพื่อยืนยัน)', 'success');
      }
    } catch (err) {
      if (err instanceof DriveNotConfiguredError) {
        await showDriveNotConfiguredAlert(err.missingLabel, true, () => {
          handleCancelClose();
          navigate('/settings/system?tab=gdrive');
        });
      } else {
        showToast(err instanceof Error ? err.message : 'อัปโหลดรูปไอคอนไม่สำเร็จ', 'error');
      }
    } finally {
      setUploadingIcon(false);
    }
  };

  const handleRotateKey = async () => {
    if (!webapp?.id) return;
    const ok = await confirmAction(
      'สร้าง / เปลี่ยน API Key ใหม่',
      'API Key เดิมจะใช้งานไม่ได้ทันที และระบบจะแสดงคีย์ใหม่เพียงครั้งเดียว กรุณาคัดลอกไปเก็บในระบบย่อยทันที ยืนยันหรือไม่?',
      'สร้าง API Key ใหม่',
      'warning'
    );
    if (!ok) return;
    setRotatingKey(true);
    try {
      const res = await webappService.rotateApiKey(webapp.id);
      setNewlyGeneratedKey(res.api_key);
      showToast('สร้าง API Key ใหม่สำเร็จ (กรุณาคัดลอกเก็บไว้ทันที)', 'success');
      onSaved();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถสร้าง API Key ได้', 'error');
    } finally {
      setRotatingKey(false);
    }
  };

  const toggleScope = (code: string) => {
    setSelectedScopes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  return (
    <ResponsiveModal
      open={open}
      onClose={handleCancelClose}
      title={webapp ? `ตั้งค่าเว็บแอป: ${webapp.name}` : 'ลงทะเบียนเว็บแอปย่อยใหม่'}
      subtitle="นิยามข้อมูลแอป ระดับสิทธิ์ไม่จำกัดขั้น API Scopes และ Allowed Origins"
      icon="fa-window-restore"
      maxWidthClass="max-w-4xl"
      footer={
        <>
          <button type="button" onClick={handleCancelClose} className="bma-btn-outline">
            ยกเลิก
          </button>
          <button type="button" disabled={saving} onClick={() => void handleSave()} className="bma-btn-primary">
            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'} mr-1.5`} />
            บันทึกการตั้งค่าเว็บแอป
          </button>
        </>
      }
    >
      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 pb-4 mb-4 border-b border-slate-200 dark:border-slate-700">
        {[
          { id: 1 as const, label: '1. ข้อมูลทั่วไป & Auto-Grant', icon: 'fa-circle-info' },
          { id: 2 as const, label: `2. ระดับสิทธิ์รายแอป (${roles.length})`, icon: 'fa-user-shield' },
          { id: 3 as const, label: '3. API Key, Scopes & Origins', icon: 'fa-key' },
          { id: 4 as const, label: '4. สรุปสิทธิ์ใช้งาน', icon: 'fa-chart-pie' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition ${
              tab === t.id
                ? 'bg-[#00744B] text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <i className={`fa-solid ${t.icon} mr-1.5`} />
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: Basic Info */}
      {tab === 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <label className="bma-label">รหัสแอป (App Code) *</label>
            <input
              className="bma-input font-mono uppercase"
              value={appCode}
              onChange={(e) => setAppCode(e.target.value)}
              placeholder="เช่น ROYAL_DEC, CAR_REQUEST"
            />
          </div>
          <div>
            <label className="bma-label">ชื่อเว็บแอปย่อย *</label>
            <input
              className="bma-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น ระบบขอพระราชทานเครื่องราชอิสริยาภรณ์"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="bma-label">URL ปลายทางสำหรับ SSO Launch *</label>
            <input
              className="bma-input font-mono"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.pages.dev/sso-callback"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="bma-label">คำอธิบายระบบ</label>
            <textarea
              rows={2}
              className="bma-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="อธิบายหน้าที่ของเว็บแอปย่อยนี้สั้นๆ..."
            />
          </div>
          <div>
            <label className="bma-label">ไอคอน Font Awesome</label>
            <div className="flex items-center gap-2">
              <span
                className="w-10 h-10 rounded-xl text-white flex items-center justify-center shrink-0"
                style={{ backgroundColor: color }}
              >
                <i className={`fa-solid ${icon || 'fa-window-maximize'}`} />
              </span>
              <input
                className="bma-input font-mono"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="fa-car-side"
              />
            </div>
          </div>
          <div>
            <label className="bma-label">สีประจำแอป (Hex)</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-12 rounded-lg border border-slate-300 cursor-pointer"
              />
              <input className="bma-input font-mono" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="bma-label">รูปไอคอนเว็บแอปเสริม (อัปโหลดขึ้น Google Drive โฟลเดอร์ Webapp_Icons หรือวาง URL)</label>
            <div className="flex flex-wrap items-center gap-3">
              <div
                className="w-14 h-14 rounded-2xl text-white flex items-center justify-center text-xl shadow shrink-0 overflow-hidden border border-slate-200 dark:border-slate-700"
                style={{ backgroundColor: iconUrl.trim() ? 'transparent' : color }}
              >
                {iconUrl.trim() ? (
                  <DriveImage
                    src={iconUrl.trim()}
                    alt={name || 'ไอคอนเว็บแอป'}
                    category="image"
                    className="w-full h-full object-cover"
                    fallback={
                      <span
                        className="w-full h-full flex items-center justify-center text-white"
                        style={{ backgroundColor: color }}
                      >
                        <i className={`fa-solid ${icon || 'fa-window-maximize'}`} />
                      </span>
                    }
                  />
                ) : (
                  <i className={`fa-solid ${icon || 'fa-window-maximize'}`} />
                )}
              </div>
              <div className="flex-1 min-w-[220px] space-y-2">
                <input
                  className="bma-input font-mono text-xs"
                  value={iconUrl}
                  onChange={(e) => setIconUrl(e.target.value)}
                  placeholder="https://lh3.googleusercontent.com/d/..."
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={iconFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadIcon(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploadingIcon}
                    onClick={() => iconFileRef.current?.click()}
                    className="bma-btn-outline text-xs py-1.5"
                  >
                    <i className={`fa-solid ${uploadingIcon ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'} text-emerald-600`} />
                    {uploadingIcon ? 'กำลังอัปโหลด...' : 'อัปโหลดรูปไอคอนขึ้น Google Drive'}
                  </button>
                  {iconUrl.trim() && (
                    <button
                      type="button"
                      onClick={() => setIconUrl('')}
                      className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      <i className="fa-solid fa-trash-can mr-1" />
                      ลบรูปไอคอน
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="bma-label">สถานะระบบ</label>
              <select
                className="bma-input"
                value={status}
                onChange={(e) => setStatus(e.target.value as WebappStatus)}
              >
                <option value="ACTIVE">เปิดใช้งาน (ACTIVE)</option>
                <option value="MAINTENANCE">ปรับปรุงระบบ (MAINTENANCE)</option>
                <option value="DISABLED">ปิดใช้งาน (DISABLED)</option>
              </select>
            </div>
            <div>
              <label className="bma-label">ลำดับแสดงผล</label>
              <input
                type="number"
                className="bma-input"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="sm:col-span-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5">
            <label className="inline-flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={autoGrant}
                onChange={(e) => setAutoGrant(e.target.checked)}
              />
              <span>
                <strong className="block text-slate-800 dark:text-slate-100">
                  มอบสิทธิ์อัตโนมัติเมื่อสร้างบัญชีผู้ใช้ใหม่ (auto_grant_on_provision)
                </strong>
                <span className="text-xs text-slate-500">
                  เมื่อเปิดใช้งาน บุคลากรที่ถูกสร้างบัญชีผ่าน Auto-Provision จะได้รับสิทธิ์ระดับเริ่มต้น (is_default_on_grant) ของแอปนี้ทันที
                </span>
              </span>
            </label>
          </div>
        </div>
      )}

      {/* TAB 2: Unlimited Custom Roles */}
      {tab === 2 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              แต่ละเว็บแอปสามารถมีจำนวนขั้นและชื่อสิทธิ์แตกต่างกันได้อย่างอิสระ (เช่น 2 ขั้น, 4 ขั้น หรือ 6 ขั้น)
            </p>
            <button
              type="button"
              onClick={() =>
                setRoles((prev) => [
                  ...prev,
                  {
                    role_code: `ROLE_${prev.length + 1}`,
                    role_name_th: `ระดับสิทธิ์ที่ ${prev.length + 1}`,
                    description: '',
                    hierarchy_level: prev.length + 1,
                    color_hex: '#0284C7',
                    is_default_on_grant: false,
                    is_app_admin: false,
                    allow_scoped_admin_grant: true,
                    sort_order: prev.length + 1,
                    is_active: true,
                  },
                ])
              }
              className="bma-btn-primary text-xs py-1.5"
            >
              <i className="fa-solid fa-plus mr-1.5" />
              เพิ่มระดับสิทธิ์ใหม่
            </button>
          </div>

          <div className="space-y-2.5">
            {roles.map((r, idx) => (
              <div
                key={r.id || idx}
                className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-slate-50/70 dark:bg-slate-800/40 space-y-2.5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-3">
                    <label className="text-[11px] font-bold text-slate-500">Role Code *</label>
                    <input
                      className="bma-input text-xs font-mono uppercase py-1.5"
                      value={r.role_code}
                      onChange={(e) =>
                        setRoles((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, role_code: e.target.value } : x))
                        )
                      }
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="text-[11px] font-bold text-slate-500">ชื่อภาษาไทย *</label>
                    <input
                      className="bma-input text-xs py-1.5"
                      value={r.role_name_th}
                      onChange={(e) =>
                        setRoles((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, role_name_th: e.target.value } : x))
                        )
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-bold text-slate-500">ลำดับขั้น</label>
                    <input
                      type="number"
                      className="bma-input text-xs py-1.5"
                      value={r.hierarchy_level}
                      onChange={(e) =>
                        setRoles((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, hierarchy_level: Number(e.target.value) } : x
                          )
                        )
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-bold text-slate-500">สีป้าย</label>
                    <input
                      type="color"
                      className="h-8 w-full rounded border border-slate-300 cursor-pointer"
                      value={r.color_hex}
                      onChange={(e) =>
                        setRoles((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, color_hex: e.target.value } : x))
                        )
                      }
                    />
                  </div>
                  <div className="sm:col-span-1 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => setRoles((prev) => prev.filter((_, i) => i !== idx))}
                      className="w-8 h-8 rounded-lg text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-950 flex items-center justify-center"
                      title="ลบระดับสิทธิ์นี้"
                    >
                      <i className="fa-solid fa-trash-can text-xs" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-500">คำอธิบายบทบาท (ไม่บังคับ)</label>
                  <input
                    className="bma-input text-xs py-1.5"
                    value={r.description}
                    placeholder="อธิบายขอบเขตหน้าที่ของระดับสิทธิ์นี้..."
                    onChange={(e) =>
                      setRoles((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x))
                      )
                    }
                  />
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.is_default_on_grant}
                      onChange={(e) =>
                        setRoles((prev) =>
                          prev.map((x, i) => ({
                            ...x,
                            is_default_on_grant: i === idx ? e.target.checked : false,
                          }))
                        )
                      }
                    />
                    ค่าเริ่มต้น (Default)
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.is_app_admin}
                      onChange={(e) =>
                        setRoles((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, is_app_admin: e.target.checked } : x))
                        )
                      }
                    />
                    ผู้ดูแลแอป (App Admin)
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.allow_scoped_admin_grant}
                      onChange={(e) =>
                        setRoles((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, allow_scoped_admin_grant: e.target.checked } : x
                          )
                        )
                      }
                    />
                    อนุญาตให้ Scoped Admin มอบสิทธิ์นี้ได้
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: API Key, Scopes & Allowed Origins */}
      {tab === 3 && (
        <div className="space-y-5 text-sm">
          {/* API Key Box */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-100">
                  <i className="fa-solid fa-key text-amber-500 mr-1.5" />
                  API Key สำหรับเรียก Central REST API (`portal-api`)
                </h4>
                <p className="text-xs text-slate-500">
                  Prefix ปัจจุบัน:{' '}
                  <code className="font-mono font-bold text-slate-700 dark:text-slate-200">
                    {webapp?.api_key_prefix ? `${webapp.api_key_prefix}••••••••` : 'ยังไม่ได้สร้างคีย์'}
                  </code>
                </p>
              </div>
              {webapp?.id ? (
                <button
                  type="button"
                  disabled={rotatingKey}
                  onClick={() => void handleRotateKey()}
                  className="bma-btn-outline text-xs"
                >
                  <i className={`fa-solid ${rotatingKey ? 'fa-spinner fa-spin' : 'fa-rotate'} mr-1.5`} />
                  สร้าง / เปลี่ยน API Key ใหม่
                </button>
              ) : (
                <span className="text-xs text-slate-400 italic">กรุณาบันทึกเว็บแอปก่อนสร้าง API Key</span>
              )}
            </div>

            {newlyGeneratedKey && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 p-3 space-y-1.5">
                <div className="text-xs font-bold text-amber-800 dark:text-amber-200">
                  คัดลอก API Key นี้เก็บไว้ทันที (ระบบจะไม่แสดงคีย์เต็มอีกครั้ง):
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-2.5 py-1.5 rounded bg-white dark:bg-slate-900 border font-mono text-xs break-all">
                    {newlyGeneratedKey}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(newlyGeneratedKey);
                      showToast('คัดลอก API Key ลงคลิปบอร์ดแล้ว', 'success');
                    }}
                    className="bma-btn-primary text-xs py-1.5 shrink-0"
                  >
                    <i className="fa-solid fa-copy mr-1" />
                    คัดลอก
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Scopes Checklist */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
              API Scopes ที่อนุญาตให้เว็บแอปนี้เรียกใช้ ({selectedScopes.length} รายการ):
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(catalog?.scopes ?? []).map((sc) => {
                const checked = selectedScopes.includes(sc.code);
                return (
                  <label
                    key={sc.code}
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                      checked
                        ? 'border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30 dark:border-emerald-700'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => toggleScope(sc.code)}
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        <code className="font-mono text-[11px]">{sc.code}</code>
                        {sc.is_sensitive && (
                          <span className="px-1.5 py-0.2 rounded bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 text-[10px]">
                            PDPA
                          </span>
                        )}
                      </div>
                      <div className="text-slate-500">{sc.name_th}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Allowed Origins */}
          <div>
            <label className="bma-label">Allowed Origins (สำหรับ CORS ของ `portal-api` — 1 URL ต่อ 1 บรรทัด)</label>
            <textarea
              rows={3}
              className="bma-input font-mono text-xs"
              value={originsText}
              onChange={(e) => setOriginsText(e.target.value)}
              placeholder={'https://app1.pages.dev\nhttps://stb6636.github.io'}
            />
          </div>
        </div>
      )}

      {/* TAB 4: Summary */}
      {tab === 4 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="text-xs text-slate-500">ผู้ใช้งานที่ได้รับอนุญาต</div>
              <div className="text-2xl font-extrabold text-[#00744B] dark:text-emerald-400">
                {(webapp?.authorized_count ?? 0).toLocaleString()} คน
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="text-xs text-slate-500">จำนวนระดับสิทธิ์ที่นิยามไว้</div>
              <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">
                {roles.length} ระดับ
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="text-xs text-slate-500">API Scopes ที่เปิดใช้งาน</div>
              <div className="text-2xl font-extrabold text-blue-600 dark:text-blue-400">
                {selectedScopes.length} Scopes
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-xs space-y-2">
            <div className="font-bold text-slate-700 dark:text-slate-200">
              ตัวอย่างการเชื่อมต่อเว็บแอปย่อยด้วย SDK:
            </div>
            <pre className="p-3 rounded-lg bg-slate-900 text-emerald-300 overflow-x-auto font-mono text-[11px]">
{`import { PortalSsoClient } from './sdk/portal-sso-sdk';

const sso = new PortalSsoClient({
  portalApiUrl: 'https://<project-ref>.supabase.co/functions/v1/portal-api',
  apiKey: '<API_KEY_FROM_TAB_3>',
});

// ตรวจสอบ sso_token จาก URL เมื่อเปิดมาจาก Portal SSO
const verified = await sso.verifySsoTokenFromUrl();`}
            </pre>
          </div>
        </div>
      )}
    </ResponsiveModal>
  );
}

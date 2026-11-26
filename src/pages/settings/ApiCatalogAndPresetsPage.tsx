import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { settingsService } from '@/services/settingsService';
import { QUERY_KEYS } from '@/lib/queryClient';
import { useUiStore } from '@/stores/useUiStore';
import { confirmAction } from '@/lib/swalHelpers';
import type { ApiScopeCatalogRow } from '@/types/database.types';

const ENDPOINT_SUMMARY: Array<{ method: string; path: string; scope: string; desc: string }> = [
  { method: 'GET', path: '/health', scope: 'Public', desc: 'ตรวจสถานะ Edge Function และเวอร์ชันระบบ' },
  { method: 'POST', path: '/sso/verify', scope: 'API Key', desc: 'ตรวจสอบ sso_token จาก URL แล้วคืนข้อมูลผู้ใช้ + สิทธิ์แอป' },
  { method: 'POST', path: '/sso/exchange', scope: 'API Key', desc: 'แลก sso_token เป็น Session Context สำหรับเว็บแอปย่อย' },
  { method: 'GET', path: '/me', scope: 'Bearer + Key', desc: 'ดึงโปรไฟล์และสิทธิ์ของผู้ใช้ที่ล็อกอินอยู่' },
  { method: 'GET', path: '/personnel', scope: 'personnel:read', desc: 'รายชื่อบุคลากรตามขอบเขต พร้อมค้นหาและแบ่งหน้า' },
  { method: 'GET', path: '/personnel/{id}', scope: 'personnel:read', desc: 'รายละเอียดบุคลากรรายบุคคล (กรองฟิลด์ตาม Scope)' },
  { method: 'POST', path: '/personnel/batch', scope: 'personnel:read', desc: 'ดึงข้อมูลบุคลากรหลายคนพร้อมกันด้วยอาเรย์ของ ID' },
  { method: 'GET', path: '/personnel/drivers', scope: 'personnel:read', desc: 'รายชื่อพนักงานขับรถและผู้ปฏิบัติงานยานพาหนะ' },
  { method: 'GET', path: '/personnel/approvers', scope: 'personnel:read', desc: 'รายชื่อผู้มีอำนาจลงนามตามสายบังคับบัญชา' },
  { method: 'GET', path: '/personnel/decoration-source', scope: 'personnel:career', desc: 'ข้อมูลรับราชการและประวัติ 7 ตารางสำหรับงานเครื่องราชฯ' },
  { method: 'GET', path: '/master/org-units', scope: 'master:read', desc: 'โครงสร้างหน่วยงาน 4 ระดับตามลำดับตั้งค่าระบบ' },
  { method: 'GET', path: '/master/lookups', scope: 'master:read', desc: 'ตัวเลือก Dropdown ทุกหมวดหมู่ของระบบ' },
  { method: 'GET', path: '/master/positions', scope: 'master:read', desc: 'ประเภทตำแหน่ง ตำแหน่งในสายงาน และระดับตำแหน่ง' },
  { method: 'POST', path: '/audit/log', scope: 'audit:write', desc: 'บันทึก Audit Log จากเว็บแอปย่อยเข้าศูนย์กลาง' },
];

const CODE_SNIPPETS: Record<'ts' | 'curl', string> = {
  ts: `// 1. ตรวจสอบ sso_token เมื่อผู้ใช้กดเปิดจาก Portal SSO
const BASE = 'https://<PROJECT_REF>.supabase.co/functions/v1/portal-api';

export async function verifySsoLogin(ssoToken: string) {
  const res = await fetch(\`\${BASE}/sso/verify\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_PORTAL_API_KEY,
    },
    body: JSON.stringify({ sso_token: ssoToken }),
  });
  if (!res.ok) throw new Error('SSO verification failed');
  return res.json(); // { user, app_role, scopes, ... }
}

// 2. เรียกข้อมูลบุคลากร (ส่ง API Key + สิทธิ์ Scope ตามที่เปิดในหน้าตั้งค่าเว็บแอป)
export async function fetchPersonnelList(page = 1) {
  const res = await fetch(\`\${BASE}/personnel?page=\${page}&limit=50\`, {
    headers: { 'x-api-key': import.meta.env.VITE_PORTAL_API_KEY },
  });
  return res.json();
}`,
  curl: `# ทดสอบสถานะ portal-api
curl -s "https://<PROJECT_REF>.supabase.co/functions/v1/portal-api/health"

# ตรวจสอบ sso_token (Server-to-Server หรือ Backend Proxy)
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/portal-api/sso/verify" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_WEBAPP_API_KEY" \\
  -d '{"sso_token":"<TOKEN_FROM_URL>"}'

# ดึงรายชื่อบุคลากร (ต้องเปิด Scope: personnel:read)
curl "https://<PROJECT_REF>.supabase.co/functions/v1/portal-api/personnel?limit=20" \\
  -H "x-api-key: YOUR_WEBAPP_API_KEY"`,
};

export default function ApiCatalogAndPresetsPage() {
  const qc = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);

  const { data } = useQuery({
    queryKey: QUERY_KEYS.apiCatalog,
    queryFn: () => settingsService.listApiCatalog(),
  });

  const scopes = data?.scopes ?? [];
  const [saving, setSaving] = useState(false);
  const [snippetTab, setSnippetTab] = useState<'ts' | 'curl'>('ts');

  // Scope CRUD Modal
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const [isEditingScope, setIsEditingScope] = useState(false);
  const [scopeDraft, setScopeDraft] = useState<ApiScopeCatalogRow>({
    code: '',
    name_th: '',
    description: '',
    is_sensitive: false,
    sort_order: 1,
    is_active: true,
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: QUERY_KEYS.apiCatalog });
  };

  const openAddScope = () => {
    setIsEditingScope(false);
    setScopeDraft({
      code: '',
      name_th: '',
      description: '',
      is_sensitive: false,
      sort_order: scopes.length + 1,
      is_active: true,
    });
    setScopeModalOpen(true);
  };

  const openEditScope = (sc: ApiScopeCatalogRow) => {
    setIsEditingScope(true);
    setScopeDraft({ ...sc, description: sc.description || '' });
    setScopeModalOpen(true);
  };

  const handleSaveScope = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scopeDraft.code.trim() || !scopeDraft.name_th.trim()) {
      showToast('กรุณาระบุรหัสสิทธิ์และชื่อภาษาไทย', 'warning');
      return;
    }
    setSaving(true);
    try {
      await settingsService.saveApiScope(scopeDraft);
      await refresh();
      setScopeModalOpen(false);
      showToast('บันทึก API Scope เรียบร้อยแล้ว', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteScope = async (sc: ApiScopeCatalogRow) => {
    const ok = await confirmAction('ลบ API Scope', `ต้องการลบ "${sc.code}" ใช่หรือไม่?`, 'ลบ', 'warning');
    if (!ok) return;
    try {
      await settingsService.deleteApiScope(sc.code);
      await refresh();
      showToast('ลบ API Scope เรียบร้อย', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถลบได้ (อาจมีเว็บแอปใช้งานอยู่)', 'error');
    }
  };

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(CODE_SNIPPETS[snippetTab]);
      showToast('คัดลอกโค้ดตัวอย่างลงคลิปบอร์ดแล้ว', 'success');
    } catch {
      showToast('ไม่สามารถคัดลอกได้ กรุณาคัดลอกด้วยตนเอง', 'warning');
    }
  };

  return (
    <AdminLayout
      title="แค็ตตาล็อก API & คู่มือการเชื่อมต่อ"
      subtitle="จัดการ API Scopes และแนวทางการเชื่อมต่อ Central REST API (portal-api) สำหรับเว็บแอปย่อย"
      activePage="settings-api-catalog"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: API Scope Catalog */}
        <div className="lg:col-span-5 bma-card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-extrabold text-base text-slate-800 dark:text-white">
                รายการสิทธิ์ API ({scopes.length})
              </h2>
              <p className="text-[11px] text-slate-500">
                ใช้ควบคุมขอบเขตข้อมูลและกรองฟิลด์อ่อนไหว PDPA รายเว็บแอป
              </p>
            </div>
            <button type="button" onClick={openAddScope} className="bma-btn-primary text-xs py-1.5 shrink-0">
              <i className="fa-solid fa-plus" />
              เพิ่ม Scope
            </button>
          </div>

          <div className="space-y-2">
            {scopes.map((sc) => (
              <div
                key={sc.code}
                className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono font-bold text-xs text-[#00744B] dark:text-emerald-400">
                      {sc.code}
                    </p>
                    {sc.is_sensitive && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                        PDPA
                      </span>
                    )}
                    {!sc.is_active && (
                      <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold">
                        ปิดใช้งาน
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-sm mt-0.5 text-slate-800 dark:text-slate-100">{sc.name_th}</p>
                  {sc.description && <p className="text-xs text-slate-500 mt-0.5">{sc.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditScope(sc)}
                    className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                    title="แก้ไข"
                  >
                    <i className="fa-solid fa-pen" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteScope(sc)}
                    className="px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-xs"
                    title="ลบ"
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Sub-App API Integration Guide */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bma-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-[#00744B] dark:text-emerald-300 flex items-center justify-center">
                  <i className="fa-solid fa-book-open text-sm" />
                </span>
                <div>
                  <h2 className="font-extrabold text-base text-slate-800 dark:text-white">
                    คู่มือการนำ API ไปใช้งานในเว็บแอปย่อย
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    เอกสารฉบับสมบูรณ์อยู่ที่ <code className="font-mono">docs/PORTAL_API_GUIDE.md</code> ในโค้ดโปรเจกต์
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                14 Active Endpoints
              </span>
            </div>

            {/* Auth Modes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                <div className="font-extrabold text-emerald-700 dark:text-emerald-300">
                  <i className="fa-solid fa-user-check mr-1.5" />
                  โหมด A — SSO Handshake & User Session
                </div>
                <p className="text-slate-600 dark:text-slate-300">
                  รับ <code className="font-mono">sso_token</code> จาก URL แล้วเรียก{' '}
                  <code className="font-mono">POST /sso/verify</code> พร้อม Header{' '}
                  <code className="font-mono">x-api-key</code> และระบุ Allowed Origins ที่เมนูจัดการเว็บแอปย่อย
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                <div className="font-extrabold text-sky-700 dark:text-sky-300">
                  <i className="fa-solid fa-server mr-1.5" />
                  โหมด B — Server-to-Server REST API
                </div>
                <p className="text-slate-600 dark:text-slate-300">
                  เรียกจาก Backend ของเว็บแอปย่อยโดยส่ง <code className="font-mono">x-api-key</code> และกำหนด API Scopes ตามความจำเป็น ระบบจะกรองฟิลด์ PDPA ให้อัตโนมัติ
                </p>
              </div>
            </div>

            {/* Code Snippets */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setSnippetTab('ts')}
                    className={`px-3 py-1 rounded-lg transition ${
                      snippetTab === 'ts' ? 'bg-[#00744B] text-white' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    TypeScript / React
                  </button>
                  <button
                    type="button"
                    onClick={() => setSnippetTab('curl')}
                    className={`px-3 py-1 rounded-lg transition ${
                      snippetTab === 'curl' ? 'bg-[#00744B] text-white' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    cURL / REST
                  </button>
                </div>
                <button type="button" onClick={() => void handleCopySnippet()} className="bma-btn-outline text-xs py-1">
                  <i className="fa-solid fa-copy text-emerald-600" />
                  คัดลอกโค้ด
                </button>
              </div>
              <pre className="p-3.5 rounded-xl bg-slate-900 text-emerald-300 overflow-x-auto font-mono text-[11px] leading-relaxed">
                {CODE_SNIPPETS[snippetTab]}
              </pre>
            </div>

            {/* 14 Endpoints Table */}
            <div className="space-y-2">
              <h3 className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                สรุป Endpoints ทั้ง 14 เส้นทางของ <code className="font-mono">portal-api</code>
              </h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 text-left">
                      <th className="py-2 px-2.5">Method</th>
                      <th className="py-2 px-2.5">Endpoint</th>
                      <th className="py-2 px-2.5">สิทธิ์ที่ต้องใช้</th>
                      <th className="py-2 px-2.5">รายละเอียด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {ENDPOINT_SUMMARY.map((ep) => (
                      <tr key={`${ep.method}-${ep.path}`}>
                        <td className="py-1.5 px-2.5">
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] ${
                              ep.method === 'POST'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            }`}
                          >
                            {ep.method}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 font-mono font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                          {ep.path}
                        </td>
                        <td className="py-1.5 px-2.5 font-mono text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {ep.scope}
                        </td>
                        <td className="py-1.5 px-2.5 text-slate-600 dark:text-slate-300">{ep.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API Scope Modal */}
      <ResponsiveModal
        open={scopeModalOpen}
        onClose={() => setScopeModalOpen(false)}
        title={isEditingScope ? `แก้ไข API Scope: ${scopeDraft.code}` : 'เพิ่ม API Scope ใหม่'}
        icon="fa-plug"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={(e) => void handleSaveScope(e)} className="space-y-3 text-sm">
          <div>
            <label className="bma-label">รหัสสิทธิ์ *</label>
            <input
              required
              disabled={isEditingScope}
              value={scopeDraft.code}
              onChange={(e) => setScopeDraft({ ...scopeDraft, code: e.target.value.toLowerCase() })}
              placeholder="เช่น personnel:read"
              className="bma-input font-mono"
            />
          </div>
          <div>
            <label className="bma-label">ชื่อภาษาไทย *</label>
            <input
              required
              value={scopeDraft.name_th}
              onChange={(e) => setScopeDraft({ ...scopeDraft, name_th: e.target.value })}
              className="bma-input"
            />
          </div>
          <div>
            <label className="bma-label">คำอธิบาย</label>
            <textarea
              rows={2}
              value={scopeDraft.description || ''}
              onChange={(e) => setScopeDraft({ ...scopeDraft, description: e.target.value })}
              className="bma-input"
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs font-bold">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={scopeDraft.is_sensitive}
                onChange={(e) => setScopeDraft({ ...scopeDraft, is_sensitive: e.target.checked })}
              />
              ข้อมูลอ่อนไหว (PDPA)
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={scopeDraft.is_active}
                onChange={(e) => setScopeDraft({ ...scopeDraft, is_active: e.target.checked })}
              />
              เปิดใช้งาน
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button type="button" onClick={() => setScopeModalOpen(false)} className="bma-btn-outline">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving} className="bma-btn-primary">
              บันทึก API Scope
            </button>
          </div>
        </form>
      </ResponsiveModal>
    </AdminLayout>
  );
}

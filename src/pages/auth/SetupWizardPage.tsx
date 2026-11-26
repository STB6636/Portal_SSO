import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupService } from '@/services/setupService';
import { validateCid } from '@/lib/cidValidator';
import { useUiStore } from '@/stores/useUiStore';

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    bureau_name: 'สำนักเทศกิจ',
    cid: '',
    username: '',
    email: '',
    first_name: '',
    last_name: '',
    password: '',
    confirm_password: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cidCheck = validateCid(form.cid);
    if (!cidCheck.valid) {
      showToast(cidCheck.message || 'เลขประจำตัวประชาชนไม่ถูกต้อง', 'error');
      return;
    }
    if (form.password.length < 8) {
      showToast('รหัสเข้าใช้ต้องมีอย่างน้อย 8 ตัวอักษร', 'error');
      return;
    }
    if (form.password !== form.confirm_password) {
      showToast('รหัสเข้าใช้ทั้งสองช่องไม่ตรงกัน', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await setupService.initSuperAdmin({
        cid: cidCheck.normalized,
        username: form.username.trim() || cidCheck.normalized,
        email: form.email.trim() || undefined,
        password: form.password,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        bureau_name: form.bureau_name.trim(),
      });
      showToast('ติดตั้งบัญชีผู้ดูแลสูงสุด (SUPERADMIN) สำเร็จ กรุณาเข้าสู่ระบบ', 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ติดตั้งไม่สำเร็จ', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-vertical-gradient min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-white/20 overflow-hidden">
        <div className="login-card-header-gradient px-6 py-5 text-white text-center">
          <div className="w-12 h-12 rounded-2xl bg-white/15 mx-auto flex items-center justify-center mb-2">
            <i className="fa-solid fa-wand-magic-sparkles text-xl text-[#F6DE51]" />
          </div>
          <h1 className="text-xl font-extrabold">ติดตั้งระบบครั้งแรก (First-Run Setup)</h1>
          <p className="text-xs text-emerald-100 mt-1">สร้างบัญชีผู้ดูแลสูงสุด (SUPERADMIN) คนแรกของ Portal SSO</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-3.5">
          <div>
            <label className="block text-xs font-bold mb-1">ชื่อหน่วยงาน</label>
            <input
              type="text"
              required
              value={form.bureau_name}
              onChange={(e) => setForm({ ...form, bureau_name: e.target.value })}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">เลขประจำตัวประชาชน 13 หลัก *</label>
              <input
                type="text"
                required
                maxLength={13}
                value={form.cid}
                onChange={(e) => setForm({ ...form, cid: e.target.value.replace(/\D/g, '') })}
                placeholder="ตัวเลข 13 หลัก"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">ชื่อผู้ใช้งาน (Username)</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="เว้นว่างเพื่อใช้ CID"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">ชื่อ *</label>
              <input
                type="text"
                required
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">นามสกุล *</label>
              <input
                type="text"
                required
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold mb-1">อีเมล (สำหรับกู้คืนรหัสผ่าน PKCE)</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">รหัสเข้าใช้ (อย่างน้อย 8 ตัวอักษร) *</label>
              <input
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">ยืนยันรหัสเข้าใช้ *</label>
              <input
                type="password"
                required
                minLength={8}
                value={form.confirm_password}
                onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00351B] via-[#00744B] to-[#00A368] text-white font-extrabold text-sm shadow-lg hover:brightness-110 transition disabled:opacity-60"
          >
            <i className={`fa-solid ${submitting ? 'fa-spinner fa-spin' : 'fa-rocket'} mr-2`} />
            เริ่มต้นใช้งานและสร้าง SUPERADMIN
          </button>
        </form>
      </div>
    </div>
  );
}

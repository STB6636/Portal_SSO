import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '@/services/authService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUiStore } from '@/stores/useUiStore';

export default function ForceChangeCredentialPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const showToast = useUiStore((s) => s.showToast);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      showToast('รหัสเข้าใช้ใหม่ต้องมีอย่างน้อย 8 ตัวอักษร', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('รหัสเข้าใช้ใหม่ทั้งสองช่องไม่ตรงกัน', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await authService.changeCredential(newPassword);
      if (user) {
        setUser({ ...user, must_change_credential: false });
      }
      showToast('เปลี่ยนรหัสเข้าใช้ใหม่เรียบร้อยแล้ว', 'success');
      navigate('/main-app', { replace: true });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'เปลี่ยนรหัสเข้าใช้ไม่สำเร็จ', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-vertical-gradient min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-white/25 overflow-hidden">
        <div className="login-card-header-gradient px-6 py-6 text-center text-white">
          <div className="w-12 h-12 rounded-2xl bg-amber-400/20 border border-amber-300/40 mx-auto flex items-center justify-center mb-2">
            <i className="fa-solid fa-shield-keyhole text-xl text-[#F6DE51]" />
          </div>
          <h1 className="text-lg font-extrabold">กรุณาเปลี่ยนรหัสเริ่มต้นก่อนใช้งาน</h1>
          <p className="text-xs text-emerald-100 mt-1">เพื่อความปลอดภัย ระบบไม่อนุญาตให้เข้าเว็บแอปย่อยด้วยรหัสเริ่มต้น (CID 6 หลักท้าย)</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold mb-1">รหัสเข้าใช้ใหม่ (อย่างน้อย 8 ตัวอักษร)</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1">ยืนยันรหัสเข้าใช้ใหม่</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00351B] to-[#00744B] text-white font-extrabold text-sm shadow-lg hover:brightness-110 transition disabled:opacity-60"
          >
            <i className={`fa-solid ${submitting ? 'fa-spinner fa-spin' : 'fa-check-double'} mr-2`} />
            บันทึกรหัสเข้าใช้ใหม่และเข้าสู่ระบบ
          </button>
        </form>
      </div>
    </div>
  );
}

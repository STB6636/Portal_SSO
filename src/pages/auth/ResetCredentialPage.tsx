import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useUiStore } from '@/stores/useUiStore';

export default function ResetCredentialPage() {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8 || password !== confirm) {
      showToast('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษรและตรงกันทั้งสองช่อง', 'error');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      showToast('ตั้งรหัสเข้าใช้ใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบ', 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถตั้งรหัสผ่านใหม่ได้', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login-vertical-gradient min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="login-card-header-gradient px-6 py-5 text-center text-white">
          <h1 className="text-lg font-extrabold">ตั้งรหัสเข้าใช้ใหม่ (PKCE Reset)</h1>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold mb-1">รหัสเข้าใช้ใหม่</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1">ยืนยันรหัสเข้าใช้ใหม่</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-xl bg-[#00744B] text-white font-bold text-sm"
          >
            {saving ? 'กำลังบันทึก...' : 'ยืนยันตั้งรหัสเข้าใช้ใหม่'}
          </button>
        </form>
      </div>
    </div>
  );
}

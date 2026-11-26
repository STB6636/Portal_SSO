import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '@/services/authService';
import { useUiStore } from '@/stores/useUiStore';

export default function ForgotCredentialPage() {
  const showToast = useUiStore((s) => s.showToast);
  const [channel, setChannel] = useState<'admin' | 'email'>('admin');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (channel === 'email') {
        await authService.sendEmailResetLink(email.trim());
        showToast('ส่งลิงก์ตั้งรหัสเข้าใช้ใหม่ไปยังอีเมลของคุณแล้ว', 'success');
      } else {
        await authService.submitForgotResetRequest(identifier.trim(), reason.trim());
        showToast('ส่งคำขอรีเซ็ตรหัสถึงผู้ดูแลในขอบเขตสังกัดเรียบร้อยแล้ว', 'success');
      }
      setIdentifier('');
      setEmail('');
      setReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ไม่สามารถส่งคำขอได้', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-vertical-gradient min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-white/25 overflow-hidden">
        <div className="login-card-header-gradient px-6 py-5 text-center text-white">
          <i className="fa-solid fa-key text-2xl text-[#F6DE51] mb-2" />
          <h1 className="text-lg font-extrabold">ลืมรหัสเข้าใช้ (กู้คืน 2 ช่องทาง)</h1>
          <p className="text-xs text-emerald-100 mt-1">เลือกส่งคำขอให้ผู้ดูแลสังกัดอนุมัติ หรือส่งลิงก์ทางอีเมล PKCE</p>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setChannel('admin')}
              className={`py-2 rounded-lg text-xs font-bold transition ${
                channel === 'admin' ? 'bg-[#00744B] text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <i className="fa-solid fa-user-shield mr-1" />
              แจ้งผู้ดูแลสังกัด
            </button>
            <button
              type="button"
              onClick={() => setChannel('email')}
              className={`py-2 rounded-lg text-xs font-bold transition ${
                channel === 'email' ? 'bg-[#00744B] text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <i className="fa-solid fa-envelope mr-1" />
              ส่งลิงก์ทางอีเมล
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {channel === 'admin' ? (
              <>
                <div>
                  <label className="block text-xs font-bold mb-1">เลขประจำตัวประชาชน 13 หลัก หรือ ชื่อผู้ใช้ *</label>
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">เหตุผล / ข้อมูลติดต่อเพิ่มเติม</label>
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="เช่น จำรหัสผ่านไม่ได้ ขอรีเซ็ตเป็น 6 หลักท้าย CID"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs font-bold mb-1">อีเมลที่ผูกกับบัญชีผู้ใช้งาน *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-xl bg-[#00744B] hover:bg-[#005B2E] text-white font-bold text-sm transition disabled:opacity-60"
            >
              <i className={`fa-solid ${submitting ? 'fa-spinner fa-spin' : 'fa-paper-plane'} mr-1.5`} />
              {channel === 'admin' ? 'ส่งคำขอถึงผู้ดูแลสังกัด' : 'ส่งลิงก์รีเซ็ตทางอีเมล'}
            </button>
          </form>

          <div className="text-center pt-1">
            <Link to="/login" className="text-xs font-bold text-slate-500 hover:text-[#00744B]">
              <i className="fa-solid fa-arrow-left mr-1" />
              กลับไปหน้าเข้าสู่ระบบ
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

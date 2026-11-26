import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '@/services/authService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useSettings } from '@/contexts/SettingsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useUiStore } from '@/stores/useUiStore';
import { isSupabaseConfigured } from '@/lib/supabaseClient';
import { sanitizeImageUrl } from '@/components/layout/SystemUpdateModal';
import { DriveImage } from '@/components/common/DriveImage';

export default function LoginPage() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const { settings } = useSettings();
  const { isDark, toggleTheme } = useTheme();
  const showToast = useUiStore((s) => s.showToast);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      showToast('กรุณากรอกเลขประจำตัวประชาชน/ชื่อผู้ใช้ และรหัสเข้าใช้', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const profile = await authService.loginWithIdentifier(identifier.trim(), password);
      setUser(profile);
      showToast(`ยินดีต้อนรับ ${profile.full_name}`, 'success');
      if (profile.must_change_credential) {
        navigate('/force-change-credential', { replace: true });
      } else {
        navigate('/apps', { replace: true });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const logoUrl = sanitizeImageUrl(settings.logo_url);

  return (
    <div className="login-vertical-gradient min-h-screen flex flex-col items-center justify-center p-4 relative">
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-4 right-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/15 hover:bg-white/25 text-white border border-white/25 backdrop-blur-md text-xs font-bold transition"
      >
        <i className={`fa-solid ${isDark ? 'fa-sun text-amber-300' : 'fa-moon'}`} />
        <span>{isDark ? 'โหมดสว่าง' : 'โหมดถนอมสายตา'}</span>
      </button>

      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-white/25 overflow-hidden">
        <div className="login-card-header-gradient px-6 py-7 text-center text-white">
          {logoUrl ? (
            <DriveImage
              src={logoUrl}
              alt="Logo"
              category="logo"
              className="w-16 h-16 mx-auto rounded-2xl object-contain bg-white/15 p-2 mb-3 border border-white/25"
              fallback={
                <div className="w-16 h-16 mx-auto rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center mb-3 shadow-lg">
                  <i className="fa-solid fa-shield-halved text-3xl text-[#F6DE51]" />
                </div>
              }
            />
          ) : (
            <div className="w-16 h-16 mx-auto rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center mb-3 shadow-lg">
              <i className="fa-solid fa-shield-halved text-3xl text-[#F6DE51]" />
            </div>
          )}
          <p className="text-xs font-bold text-emerald-200 tracking-wide">{settings.organization_name}</p>
          <h1 className="text-xl font-black mt-0.5">{settings.bureau_name}</h1>
          <p className="text-xs text-emerald-100/90 mt-1">{settings.system_title}</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!isSupabaseConfigured && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
              <i className="fa-solid fa-triangle-exclamation mr-1.5" />
              ยังไม่ได้ตั้งค่า <code>VITE_SUPABASE_URL</code> และ <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> ใน <code>.env.local</code>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              เลขประจำตัวประชาชน (CID) / ชื่อผู้ใช้งาน / อีเมล
            </label>
            <div className="relative">
              <i className="fa-solid fa-id-card absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="กรอก CID 13 หลัก หรือ Username"
                autoComplete="username"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 focus:ring-[#00744B]/30 focus:border-[#00744B] outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              รหัสเข้าใช้ (เข้าครั้งแรกใช้เลข 6 หลักท้าย CID)
            </label>
            <div className="relative">
              <i className="fa-solid fa-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="กรอกรหัสเข้าใช้"
                autoComplete="current-password"
                className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 focus:ring-[#00744B]/30 focus:border-[#00744B] outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label="แสดง/ซ่อนรหัสผ่าน"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00351B] via-[#00744B] to-[#00A368] text-white font-extrabold text-sm shadow-lg hover:brightness-110 transition disabled:opacity-60"
          >
            <i className={`fa-solid ${submitting ? 'fa-spinner fa-spin' : 'fa-right-to-bracket'} mr-2`} />
            เข้าสู่ระบบ Portal SSO
          </button>

          <div className="flex items-center justify-between pt-2 text-xs">
            <Link to="/forgot-credential" className="font-bold text-[#00744B] dark:text-emerald-400 hover:underline">
              <i className="fa-solid fa-key mr-1" />
              ลืมรหัสเข้าใช้?
            </Link>
            {settings.allow_self_register && (
              <Link to="/register" className="font-bold text-slate-500 hover:text-[#00744B] hover:underline">
                ลงทะเบียนบัญชีใหม่
              </Link>
            )}
          </div>
        </form>
      </div>

      <p className="text-[11px] text-white/80 mt-5 text-center">
        {settings.footer_description}
      </p>
    </div>
  );
}

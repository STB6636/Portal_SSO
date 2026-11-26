import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { authService } from '@/services/authService';
import { useAuthStore } from '@/stores/useAuthStore';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    let active = true;
    async function handleCallback() {
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get('code');
      if (code) {
        await supabase.auth.exchangeCodeForSession(code).catch(() => {});
      }
      const profile = await authService.getMyProfile().catch(() => null);
      if (!active) return;
      if (profile) {
        setUser(profile);
        navigate(profile.must_change_credential ? '/force-change-credential' : '/main-app', { replace: true });
      } else {
        navigate('/login', { replace: true });
      }
    }
    handleCallback();
    return () => {
      active = false;
    };
  }, [navigate, setUser]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#E7ECE9] dark:bg-[#0B132B] gap-3">
      <i className="fa-solid fa-circle-notch fa-spin text-3xl text-[#00744B]" />
      <p className="text-sm font-bold text-slate-600 dark:text-slate-300">กำลังยืนยันตัวตน PKCE Callback...</p>
    </div>
  );
}

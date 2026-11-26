import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/useAuthStore';
import type { CoreRole } from '@/types/database.types';

export function RouteGuard({
  allowedRoles,
  allowMustChangeCredential = false,
  children,
}: {
  allowedRoles?: CoreRole[];
  allowMustChangeCredential?: boolean;
  children: React.ReactNode;
}) {
  const { initialized, systemHasUsers, loading, user } = useAuthStore();
  const location = useLocation();

  if (loading || !initialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#E7ECE9] dark:bg-[#0B132B] text-slate-600 dark:text-slate-300 gap-3">
        <div className="w-12 h-12 rounded-2xl bg-[#00744B]/15 flex items-center justify-center">
          <i className="fa-solid fa-circle-notch fa-spin text-2xl text-[#00744B] dark:text-emerald-400" />
        </div>
        <p className="text-sm font-bold">กำลังตรวจสอบสถานะระบบและสิทธิ์ผู้ใช้งาน...</p>
      </div>
    );
  }

  if (systemHasUsers === false && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (user.must_change_credential && !allowMustChangeCredential) {
    return <Navigate to="/force-change-credential" replace />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'USER' ? '/apps' : '/dashboard'} replace />;
  }

  return <>{children}</>;
}

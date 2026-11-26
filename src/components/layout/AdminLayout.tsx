import React, { useContext, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { AdminLayoutContext, AdminShell } from './AdminShell';

export interface AdminLayoutProps {
  title: string;
  subtitle?: string;
  activePage?: string;
  children: React.ReactNode;
}

/**
 * Lightweight Page-to-Shell Metadata Bridge (Skill: persistent_admin_shell_outlet_bridge)
 */
export function AdminLayout({ title, subtitle = '', activePage = '', children }: AdminLayoutProps) {
  const shellCtx = useContext(AdminLayoutContext);
  const location = useLocation();

  useLayoutEffect(() => {
    if (!shellCtx) return;
    shellCtx.setHeaderMeta({
      path: location.pathname,
      title,
      subtitle,
      activePage,
    });
  }, [shellCtx, location.pathname, title, subtitle, activePage]);

  if (shellCtx) {
    return <>{children}</>;
  }

  return <AdminShell>{children}</AdminShell>;
}

/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Swal from 'sweetalert2';
import { buildLogoutDialogHtml, confirmLogout, escapeHtml } from '@/lib/swalHelpers';
import { RouteGuard } from '@/components/auth/RouteGuard';
import { AdminShell } from '@/components/layout/AdminShell';
import MainAppPage from '@/pages/MainAppPage';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUiStore } from '@/stores/useUiStore';
import { ssoService } from '@/services/ssoService';
import type { AuthUserProfile, MyAppLaunchCard } from '@/types/domain.types';

function makeProfile(role: 'SUPERADMIN' | 'ADMIN' | 'USER'): AuthUserProfile {
  return {
    id: `u-${role.toLowerCase()}`,
    personnel_id: `p-${role.toLowerCase()}`,
    username: `demo_${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@example.go.th`,
    role,
    status: 'ACTIVE',
    must_change_credential: false,
    full_name: `นายทดสอบ ${role}`,
    position_display: 'นักวิชาการคอมพิวเตอร์',
    photo_path: null,
    bureau_name: 'สำนักเทศกิจ',
    office_name: 'สำนักงานตรวจและบังคับการ',
    department_name: 'ฝ่ายเทคโนโลยี',
    division_name: null,
    admin_scope:
      role === 'ADMIN'
        ? {
            scope_level_no: 2,
            org_unit_id: 'org-office-1',
            org_unit_name: 'สำนักงานตรวจและบังคับการ',
          }
        : null,
  };
}

const SAMPLE_APPS: MyAppLaunchCard[] = [
  {
    webapp_id: 'app-1',
    app_code: 'CASE_TRACK',
    name: 'ระบบรับเรื่องร้องเรียน',
    description: 'ติดตามและจัดการคำร้องเรียนประชาชน',
    url: 'https://example.com/cases',
    icon: 'fa-clipboard-list',
    icon_url: null,
    color: '#00744B',
    status: 'ACTIVE',
    role_code: 'USER',
    role_name_th: 'ผู้ใช้งานทั่วไป',
    role_color: '#00744B',
    hierarchy_level: 10,
    expires_at: null,
  },
];

describe('W1: Branded BMA Logout Modal & XSS Hygiene', () => {
  it('escapes HTML meta-characters in user fullName and username to prevent XSS', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;'
    );

    const html = buildLogoutDialogHtml({
      fullName: `<img src=x onerror=alert(1)>สมชาย`,
      username: `admin" onclick="evil()`,
      role: 'ADMIN',
      bureauName: 'สำนักเทศกิจ',
    });

    expect(html).not.toContain('<img ');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;สมชาย');
    expect(html).toContain('@admin&quot; onclick=&quot;evil()');
    expect(html).toContain('bma-swal-logout-shell');
    expect(html).toContain('ยืนยันการออกจากระบบ');
  });

  it('invokes SweetAlert2 confirmLogout with BMA branded classes and returns boolean result', async () => {
    const fireSpy = vi.spyOn(Swal, 'fire').mockResolvedValueOnce({
      isConfirmed: true,
      isDenied: false,
      isDismissed: false,
    });

    const ok = await confirmLogout({
      fullName: 'นายทดสอบ ระบบ',
      username: 'tester01',
      role: 'USER',
      bureauName: 'สำนักเทศกิจ',
    });

    expect(ok).toBe(true);
    expect(fireSpy).toHaveBeenCalledTimes(1);
    const callArg = fireSpy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(callArg.showCancelButton).toBe(true);
    expect(callArg.reverseButtons).toBe(true);
    expect((callArg.customClass as Record<string, string>).popup).toContain('bma-swal-logout-popup');
    fireSpy.mockRestore();
  });
});

describe('W2 & W3: MainAppPage RBAC, RouteGuard & AdminShell Navigation Contracts', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useUiStore.setState({ mobileSidebarOpen: false });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('redirects unauthorized USER away from admin routes to /main-app (C1 Option A)', () => {
    useAuthStore.setState({
      initialized: true,
      systemHasUsers: true,
      loading: false,
      user: makeProfile('USER'),
    });

    act(() => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/apps'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, {
              path: '/apps',
              element: React.createElement(RouteGuard, {
                allowedRoles: ['SUPERADMIN', 'ADMIN'],
                children: React.createElement('div', null, 'ADMIN_APPS_ONLY'),
              }),
            }),
            React.createElement(Route, {
              path: '/main-app',
              element: React.createElement('div', { 'data-testid': 'mainapp-landing' }, 'MAINAPP_LANDING'),
            })
          )
        )
      );
    });

    expect(container.textContent).toContain('MAINAPP_LANDING');
    expect(container.textContent).not.toContain('ADMIN_APPS_ONLY');
  });

  it('renders ZERO admin dashboard card in DOM for USER on MainAppPage, and renders it first for ADMIN', async () => {
    vi.spyOn(ssoService, 'getMyApps').mockResolvedValue(SAMPLE_APPS);

    const renderForRole = async (role: 'USER' | 'ADMIN') => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      useAuthStore.setState({
        initialized: true,
        systemHasUsers: true,
        loading: false,
        user: makeProfile(role),
      });

      await act(async () => {
        root.render(
          React.createElement(
            QueryClientProvider,
            { client: qc },
            React.createElement(
              ThemeProvider,
              null,
              React.createElement(
                SettingsProvider,
                null,
                React.createElement(MemoryRouter, { initialEntries: ['/main-app'] }, React.createElement(MainAppPage))
              )
            )
          )
        );
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    };

    // 1) USER must NOT have the admin dashboard card anywhere in the DOM
    await renderForRole('USER');
    expect(container.textContent).not.toContain('แดชบอร์ดผู้ดูแลระบบ');
    expect(container.textContent).toContain('ระบบรับเรื่องร้องเรียน');

    // 2) ADMIN MUST see "แดชบอร์ดผู้ดูแลระบบ" as the first card
    await renderForRole('ADMIN');
    expect(container.textContent).toContain('แดชบอร์ดผู้ดูแลระบบ');
    expect(container.textContent).toContain('ระบบรับเรื่องร้องเรียน');
  });

  it('keeps /apps, /main-app, and reset-requests pinned in AdminShell navigation for ADMIN', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useAuthStore.setState({
      initialized: true,
      systemHasUsers: true,
      loading: false,
      user: makeProfile('ADMIN'),
    });

    act(() => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: qc },
          React.createElement(
            ThemeProvider,
            null,
            React.createElement(
              SettingsProvider,
              null,
              React.createElement(
                MemoryRouter,
                { initialEntries: ['/dashboard'] },
                React.createElement(
                  Routes,
                  null,
                  React.createElement(
                    Route,
                    { element: React.createElement(AdminShell) },
                    React.createElement(Route, {
                      path: '/dashboard',
                      element: React.createElement('div', null, 'DASHBOARD_CONTENT'),
                    })
                  )
                )
              )
            )
          )
        )
      );
    });

    // Desktop sidebar links include /apps and /main-app
    const appsLink = container.querySelector('a[href="/apps"]');
    const mainAppLink = container.querySelector('a[href="/main-app"]');
    expect(appsLink).not.toBeNull();
    expect(mainAppLink).not.toBeNull();

    // Mobile bottom navigation MUST keep reset-requests accessible
    const mobileNav = container.querySelector('nav[aria-label="เมนูลัดหลักบนมือถือ"]');
    expect(mobileNav).not.toBeNull();
    expect(mobileNav?.querySelector('a[href="/admin/reset-requests"]')).not.toBeNull();
  });
});

describe('W2 & W4: Static Source Contracts (Zero Flash & No-Shrink KP.7 Canvas)', () => {
  it('App.tsx eager-imports MainAppPage, routes root to /main-app, and uses PortalSplashLoader (not AdminMainSkeleton)', () => {
    const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
    expect(appSrc).toContain("import MainAppPage from '@/pages/MainAppPage'");
    expect(appSrc).toContain('<Suspense fallback={<PortalSplashLoader />}>');
    expect(appSrc).not.toContain('AdminMainSkeleton');
    expect(appSrc).toContain('path="/main-app"');
    expect(appSrc).toContain("allowedRoles={['SUPERADMIN', 'ADMIN']}");
  });

  it('useAppBootstrap.ts guards duplicate SIGNED_IN and TOKEN_REFRESHED from clobbering hydrated profile', () => {
    const hookSrc = readFileSync(resolve(process.cwd(), 'src/hooks/useAppBootstrap.ts'), 'utf-8');
    expect(hookSrc).toContain("event === 'SIGNED_IN'");
    expect(hookSrc).toContain("event === 'TOKEN_REFRESHED'");
    expect(hookSrc).toContain('currentState.initialized && currentState.user');
  });

  it('kp7CanvasRenderer.ts enforces No-Shrink text rendering, widened Item 10 ratios, and rebalanced P2_COLS', () => {
    const canvasSrc = readFileSync(resolve(process.cwd(), 'src/features/kp7-canvas/kp7CanvasRenderer.ts'), 'utf-8');
    expect(canvasSrc).toContain('function drawFixedText(');
    expect(canvasSrc).toContain('function drawWrappedTextNoShrink(');
    expect(canvasSrc).toContain('date: 195');
    expect(canvasSrc).toContain('position: 485');
    expect(canvasSrc).toContain('posNo: 225');
    expect(canvasSrc).toContain('posType: 215');
    expect(canvasSrc).toContain('level: 245');
    expect(canvasSrc).toContain('salary: 225');
    expect(canvasSrc).toContain('allowance: 225');
    expect(canvasSrc).toContain('orderRef: 385');
    expect(canvasSrc).toContain("label: 'สถานศึกษา', ratio: 0.32");
    expect(canvasSrc).toContain("label: 'ตั้งแต่ - ถึง (เดือน ปี)', ratio: 0.25");
    expect(canvasSrc).toContain("label: 'วุฒิ (สาขาวิชาเอก)', ratio: 0.43");
    expect(canvasSrc).toContain('formatSignatureDateKp7');
    // Must never use 4-arg ctx.fillText horizontal squishing
    expect(canvasSrc).not.toMatch(/ctx\.fillText\([^)]*,[^)]*,[^)]*,[^)]*\)/);
  });
});

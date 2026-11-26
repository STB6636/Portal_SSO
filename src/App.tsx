import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getAppRouterConfig } from '@/lib/routerMode';
import { useAppBootstrap } from '@/hooks/useAppBootstrap';
import { useAuthStore } from '@/stores/useAuthStore';
import { ToastContainer } from '@/components/common/ToastContainer';
import { RouteGuard } from '@/components/auth/RouteGuard';
import { AdminShell } from '@/components/layout/AdminShell';
import MainAppPage from '@/pages/MainAppPage';

// Lazy-loaded Auth Pages (7 routes)
const SetupWizardPage = lazy(() => import('@/pages/auth/SetupWizardPage'));
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const ForceChangeCredentialPage = lazy(() => import('@/pages/auth/ForceChangeCredentialPage'));
const ForgotCredentialPage = lazy(() => import('@/pages/auth/ForgotCredentialPage'));
const ResetCredentialPage = lazy(() => import('@/pages/auth/ResetCredentialPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const AuthCallbackPage = lazy(() => import('@/pages/auth/AuthCallbackPage'));

// Lazy-loaded Main Portal & Admin Pages
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const AppsLauncherPage = lazy(() => import('@/pages/AppsLauncherPage'));
const Kp7PrintPage = lazy(() => import('@/pages/Kp7PrintPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const PersonnelPage = lazy(() => import('@/pages/admin/PersonnelPage'));
const PersonnelImportPage = lazy(() => import('@/pages/admin/PersonnelImportPage'));
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'));
const ResetRequestsPage = lazy(() => import('@/pages/admin/ResetRequestsPage'));
const AppAccessPage = lazy(() => import('@/pages/admin/AppAccessPage'));
const WebappsPage = lazy(() => import('@/pages/admin/WebappsPage'));

// Lazy-loaded Settings Pages (Lookups/Org/Positions/Decorations consolidated into /settings/system?tab=...)
const ApiCatalogAndPresetsPage = lazy(() => import('@/pages/settings/ApiCatalogAndPresetsPage'));
const SystemSettingsPage = lazy(() => import('@/pages/settings/SystemSettingsPage'));
const SchemaHealthPage = lazy(() => import('@/pages/settings/SchemaHealthPage'));
const AuditLogPage = lazy(() => import('@/pages/settings/AuditLogPage'));

function RootIndexRedirect() {
  const { initialized, systemHasUsers, user } = useAuthStore();
  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#E7ECE9] dark:bg-[#0B132B]">
        <i className="fa-solid fa-circle-notch fa-spin text-2xl text-[#00744B]" />
      </div>
    );
  }
  if (systemHasUsers === false) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_credential) return <Navigate to="/force-change-credential" replace />;
  return <Navigate to="/main-app" replace />;
}

function PortalSplashLoader() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#021910] text-emerald-100 gap-3">
      <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shadow-lg">
        <i className="fa-solid fa-shield-halved text-2xl text-[#F6DE51] animate-pulse" />
      </div>
      <p className="text-xs font-bold tracking-wide text-emerald-200/90">กำลังเข้าสู่ระบบ Portal SSO...</p>
    </div>
  );
}

function AppRoutes() {
  useAppBootstrap();

  return (
    <>
      <Suspense fallback={<PortalSplashLoader />}>
        <Routes>
          {/* Root smart redirect */}
          <Route path="/" element={<RootIndexRedirect />} />

          {/* 7 Public / Auth Routes */}
          <Route path="/setup" element={<SetupWizardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-credential" element={<ForgotCredentialPage />} />
          <Route path="/reset-credential" element={<ResetCredentialPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route
            path="/force-change-credential"
            element={
              <RouteGuard allowMustChangeCredential>
                <ForceChangeCredentialPage />
              </RouteGuard>
            }
          />

          {/* Standalone Full-Screen Protected Routes (Outside AdminShell) */}
          <Route
            path="/main-app"
            element={
              <RouteGuard>
                <MainAppPage />
              </RouteGuard>
            }
          />
          <Route
            path="/kp7/print/:personnelId"
            element={
              <RouteGuard>
                <Kp7PrintPage />
              </RouteGuard>
            }
          />

          {/* Authenticated Routes inside persistent AdminShell */}
          <Route
            element={
              <RouteGuard>
                <AdminShell />
              </RouteGuard>
            }
          >
            {/* Group 1: Main */}
            <Route
              path="/dashboard"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN', 'ADMIN']}>
                  <DashboardPage />
                </RouteGuard>
              }
            />
            <Route
              path="/apps"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN', 'ADMIN']}>
                  <AppsLauncherPage />
                </RouteGuard>
              }
            />

            {/* Group 2: Personnel & Accounts */}
            <Route
              path="/admin/personnel"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN', 'ADMIN']}>
                  <PersonnelPage />
                </RouteGuard>
              }
            />
            <Route
              path="/admin/personnel/import"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN', 'ADMIN']}>
                  <PersonnelImportPage />
                </RouteGuard>
              }
            />
            <Route
              path="/admin/users"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN', 'ADMIN']}>
                  <UsersPage />
                </RouteGuard>
              }
            />
            <Route
              path="/admin/reset-requests"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN', 'ADMIN']}>
                  <ResetRequestsPage />
                </RouteGuard>
              }
            />

            {/* Group 3: Sub-Webapps */}
            <Route
              path="/admin/app-access"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN', 'ADMIN']}>
                  <AppAccessPage />
                </RouteGuard>
              }
            />
            <Route
              path="/admin/webapps"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN']}>
                  <WebappsPage />
                </RouteGuard>
              }
            />

            {/* Legacy Settings Routes -> Redirect cleanly into Unified 6-Tab System Settings */}
            <Route path="/settings/lookups" element={<Navigate to="/settings/system?tab=lookups" replace />} />
            <Route path="/settings/org-units" element={<Navigate to="/settings/system?tab=org-units" replace />} />
            <Route path="/settings/positions" element={<Navigate to="/settings/system?tab=positions" replace />} />
            <Route path="/settings/decorations" element={<Navigate to="/settings/system?tab=general" replace />} />

            {/* Group 5: Technical Settings */}
            <Route
              path="/settings/api-catalog"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN']}>
                  <ApiCatalogAndPresetsPage />
                </RouteGuard>
              }
            />
            <Route
              path="/settings/system"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN']}>
                  <SystemSettingsPage />
                </RouteGuard>
              }
            />
            <Route
              path="/settings/schema"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN']}>
                  <SchemaHealthPage />
                </RouteGuard>
              }
            />
            <Route
              path="/settings/audit"
              element={
                <RouteGuard allowedRoles={['SUPERADMIN', 'ADMIN']}>
                  <AuditLogPage />
                </RouteGuard>
              }
            />

            {/* Group 6: My Account */}
            <Route path="/profile" element={<ProfilePage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastContainer />
    </>
  );
}

/**
 * Dynamic Dual-Hosting Router (Q2 Decision):
 * - Cloudflare Pages: VITE_ROUTER_MODE=browser + basename="/"
 * - GitHub Pages:     VITE_ROUTER_MODE=hash
 */
export default function App() {
  const { mode, basename } = getAppRouterConfig();
  if (mode === 'browser') {
    return (
      <BrowserRouter basename={basename === '/' ? undefined : basename}>
        <AppRoutes />
      </BrowserRouter>
    );
  }
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}

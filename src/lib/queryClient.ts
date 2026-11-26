import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const QUERY_KEYS = {
  publicSettings: ['public-settings'] as const,
  masterData: ['master-data'] as const,
  myApps: ['my-apps'] as const,
  dashboardStats: ['dashboard-stats'] as const,
  personnel: (filters?: Record<string, unknown>) => ['personnel', filters ?? {}] as const,
  personnelById: (id: string) => ['personnel-by-id', id] as const,
  personnelTimelines: (id: string) => ['personnel-timelines', id] as const,
  users: (filters?: Record<string, unknown>) => ['users', filters ?? {}] as const,
  resetRequests: (status?: string) => ['reset-requests', status ?? 'ALL'] as const,
  webapps: ['webapps'] as const,
  appAccess: (webappId?: string) => ['app-access', webappId ?? 'ALL'] as const,
  apiCatalog: ['api-catalog'] as const,
  systemSettings: ['system-settings'] as const,
  schemaHealth: ['schema-health'] as const,
  auditLogs: (filters?: Record<string, unknown>) => ['audit-logs', filters ?? {}] as const,
};

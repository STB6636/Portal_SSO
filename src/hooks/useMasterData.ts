import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/queryClient';
import { useAuthStore } from '@/stores/useAuthStore';
import { EMPTY_MASTER_DATA, masterDataService } from '@/services/masterDataService';

/**
 * Fetches all 9 master-data tables from Supabase.
 * Uses `placeholderData` (NEVER `initialData` with `staleTime`) so React Query v5
 * always executes the initial fetch immediately once authenticated.
 */
export function useMasterData() {
  const user = useAuthStore((s) => s.user);
  const query = useQuery({
    queryKey: QUERY_KEYS.masterData,
    queryFn: () => masterDataService.fetchAll(),
    enabled: Boolean(user),
    placeholderData: EMPTY_MASTER_DATA,
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...query,
    data: query.data ?? EMPTY_MASTER_DATA,
  };
}

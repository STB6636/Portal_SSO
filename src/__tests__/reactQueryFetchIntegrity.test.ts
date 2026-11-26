import { describe, expect, it } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { EMPTY_MASTER_DATA } from '@/services/masterDataService';
import { DEFAULT_PUBLIC_SETTINGS } from '@/contexts/SettingsContext';

describe('React Query v5 placeholderData fetch integrity (no initialData + staleTime skip)', () => {
  it('immediately triggers fetch on mount when using placeholderData with 5-minute staleTime', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { staleTime: 2 * 60 * 1000, retry: false } },
    });

    let masterFetchCount = 0;
    const masterObs = new QueryObserver(qc, {
      queryKey: ['master-data-test'],
      queryFn: async () => {
        masterFetchCount += 1;
        return { ...EMPTY_MASTER_DATA, categories: [{ id: '1' }] };
      },
      placeholderData: EMPTY_MASTER_DATA,
      staleTime: 5 * 60 * 1000,
    });

    let settingsFetchCount = 0;
    const settingsObs = new QueryObserver(qc, {
      queryKey: ['public-settings-test'],
      queryFn: async () => {
        settingsFetchCount += 1;
        return { ...DEFAULT_PUBLIC_SETTINGS, bureau_name: 'Loaded Live' };
      },
      placeholderData: DEFAULT_PUBLIC_SETTINGS,
    });

    const unsub1 = masterObs.subscribe(() => {});
    const unsub2 = settingsObs.subscribe(() => {});

    await new Promise((r) => setTimeout(r, 30));

    expect(masterFetchCount).toBe(1);
    expect(settingsFetchCount).toBe(1);
    expect(settingsObs.getCurrentResult().data?.bureau_name).toBe('Loaded Live');

    unsub1();
    unsub2();
    qc.clear();
  });
});

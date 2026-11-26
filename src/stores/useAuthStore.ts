import { create } from 'zustand';
import type { AuthUserProfile } from '@/types/domain.types';

interface AuthState {
  initialized: boolean;
  systemHasUsers: boolean | null;
  loading: boolean;
  user: AuthUserProfile | null;
  setBootstrapState: (payload: {
    initialized: boolean;
    systemHasUsers: boolean;
    user: AuthUserProfile | null;
  }) => void;
  setUser: (user: AuthUserProfile | null) => void;
  setLoading: (loading: boolean) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  initialized: false,
  systemHasUsers: null,
  loading: true,
  user: null,
  setBootstrapState: ({ initialized, systemHasUsers, user }) =>
    set({ initialized, systemHasUsers, user, loading: false }),
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  clearAuth: () => set({ user: null, loading: false }),
}));

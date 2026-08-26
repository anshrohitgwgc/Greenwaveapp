/**
 * Auth state. Kept deliberately small: tokens + current user + status.
 * Everything else lives in React Query.
 */

import { create } from 'zustand';
import { configureClient } from '@/api/client';
import { api } from '@/api/service';
import { tokenStorage } from './token-storage';
import type { Role, User } from '@/api/types';

type Status = 'loading' | 'signed-out' | 'signed-in';

interface AuthState {
  status: Status;
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;

  restore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  refreshToken: null,

  async restore() {
    const stored = await tokenStorage.load();
    if (!stored) {
      set({ status: 'signed-out', user: null, accessToken: null, refreshToken: null });
      return;
    }

    set({ accessToken: stored.accessToken, refreshToken: stored.refreshToken });
    api.restoreMockSession(stored.accessToken);

    try {
      const user = await api.me();
      set({ status: 'signed-in', user });
    } catch {
      await tokenStorage.clear();
      set({ status: 'signed-out', user: null, accessToken: null, refreshToken: null });
    }
  },

  async signIn(email, password) {
    const result = await api.login(email, password);
    await tokenStorage.save({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    set({
      status: 'signed-in',
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  },

  async signOut() {
    await api.logout();
    await tokenStorage.clear();
    set({ status: 'signed-out', user: null, accessToken: null, refreshToken: null });
  },

  setUser(user) {
    set({ user });
  },
}));

// Wire the HTTP client to this store (no import cycle: client knows nothing
// about zustand, the store knows nothing about fetch internals).
configureClient({
  getAccessToken: () => useAuth.getState().accessToken,
  getRefreshToken: () => useAuth.getState().refreshToken,
  onTokensRefreshed: (accessToken, refreshToken) => {
    useAuth.setState({ accessToken, refreshToken });
    void tokenStorage.save({ accessToken, refreshToken });
  },
  onAuthExpired: () => {
    void tokenStorage.clear();
    useAuth.setState({
      status: 'signed-out',
      user: null,
      accessToken: null,
      refreshToken: null,
    });
  },
});

// --- role helpers -----------------------------------------------------------

export function useCurrentUser(): User | null {
  return useAuth((state) => state.user);
}

export function useRole(): Role | null {
  return useAuth((state) => state.user?.role ?? null);
}

/** Managers and admins can see everyone's work; drivers see their own. */
export function useCanManage(): boolean {
  return useAuth((state) => state.user?.role === 'admin' || state.user?.role === 'manager');
}

export function useIsAdmin(): boolean {
  return useAuth((state) => state.user?.role === 'admin');
}

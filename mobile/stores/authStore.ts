import { create } from 'zustand';
import { User } from '../types';
import { setTokens, clearTokens, api, setOnAuthExpired } from '../services/api';
import { fetchMe, invalidateMe } from '../services/me';
import { reconnectTimerSocket, disconnectTimerSocket } from '../services/socket';
import { clearSessionHistory } from '../store/sync';
import { useGamificationStore } from './gamificationStore';
import { useTimerStore } from './timerStore';
import { log } from '../lib/log';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  isNewUser: boolean;
  /**
   * True when we hold tokens but could not reach the server to validate them.
   * Distinct from "logged out": the session may well be fine. The auth guard
   * uses this to avoid bouncing a valid user to the login screen during a
   * backend restart, where logging in again would fail for the same reason.
   */
  sessionUnavailable: boolean;

  login: (email: string, password: string) => Promise<boolean>;
  register: (
    email: string,
    username: string,
    password: string,
    acceptedTerms: boolean,
  ) => Promise<boolean>;
  /**
   * Record acceptance of the current Terms for the signed-in user.
   *
   * Resolves false on any failure so the caller can show a retry rather than
   * assuming it landed. See app/(auth)/terms-gate.tsx.
   */
  acceptTerms: () => Promise<boolean>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
  setIsNewUser: (value: boolean) => void;
}

// Failures that mean "no answer from the server" rather than "the server
// rejected you". Only the latter should ever end a session.
const TRANSPORT_FAILURES: ReadonlySet<string> = new Set(['offline', 'timeout', 'server']);

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  isNewUser: false,
  sessionUnavailable: false,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post<{
        user: User;
        accessToken: string;
        refreshToken: string;
      }>('/auth/login', { email, password });

      if (response.success && response.data) {
        setTokens(response.data.accessToken, response.data.refreshToken);
        reconnectTimerSocket();
        set({
          user: response.data.user,
          isAuthenticated: true,
          isLoading: false,
          isNewUser: false,
        });
        // Hydrate timer stats for the newly logged-in user.
        // Their keys will be empty on a new device or after logout — that is correct.
        await useTimerStore.getState().hydrate(response.data.user.id);
        return true;
      }
      set({ error: response.error || 'Login failed', isLoading: false });
      return false;
    } catch {
      set({ error: 'Network error', isLoading: false });
      return false;
    }
  },

  register: async (
    email: string,
    username: string,
    password: string,
    acceptedTerms: boolean,
  ) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post<{
        user: User;
        accessToken: string;
        refreshToken: string;
      }>('/auth/register', { email, username, password, acceptedTerms });

      if (response.success && response.data) {
        setTokens(response.data.accessToken, response.data.refreshToken);
        reconnectTimerSocket();
        set({
          user: response.data.user,
          isAuthenticated: true,
          isLoading: false,
          isNewUser: true,
        });
        // New account — user-scoped keys don't exist yet, hydrate correctly reads zeros.
        await useTimerStore.getState().hydrate(response.data.user.id);
        return true;
      }
      set({ error: response.error || 'Registration failed', isLoading: false });
      return false;
    } catch {
      set({ error: 'Network error', isLoading: false });
      return false;
    }
  },

  acceptTerms: async () => {
    try {
      const response = await api.post<{ termsAcceptedAt: string; termsVersion: string }>(
        '/auth/accept-terms',
        {},
      );
      if (!response.success || !response.data) return false;

      // Update the cached user in place. The auth guard reads termsAcceptedAt
      // off this object to decide whether to route to the gate, so leaving it
      // stale would bounce the user straight back to the screen they just
      // cleared. invalidateMe drops the /auth/me cache for the same reason.
      const current = get().user;
      if (current) {
        set({
          user: {
            ...current,
            termsAcceptedAt: response.data.termsAcceptedAt,
            termsVersion: response.data.termsVersion,
          },
        });
      }
      invalidateMe();
      return true;
    } catch {
      return false;
    }
  },

  logout: async () => {
    // Read userId before clearing — clearUserData needs it, and user is nulled below.
    const userId = get().user?.id;
    set({ isLoading: true });
    try {
      await api.post('/auth/logout', {});
    } catch {
    } finally {
      disconnectTimerSocket();
      clearTokens();
      invalidateMe();
      await clearSessionHistory();
      if (userId) {
        await useTimerStore.getState().clearUserData(userId);
      }
      useGamificationStore.getState().reset();
      // Calendar caches are per-user range blobs; clear them so the next account
      // can't briefly paint the previous one's schedule. Lazy import keeps this
      // out of the auth store's static dependency graph.
      if (userId) {
        const { useCalendarStore } = await import('./calendarStore');
        useCalendarStore.getState().clearCalendar(userId);
      }
      // Task store self-cleans via its useAuthStore.subscribe in taskStore.ts.
      // Setting user: null here triggers that subscription synchronously.
      // Navigation is handled by the auth guard in _layout.tsx.
      set({ user: null, isAuthenticated: false, isLoading: false, error: null, isNewUser: false, sessionUnavailable: false });
    }
  },

  loadUser: async () => {
    const response = await fetchMe<User>();

    if (response.success && response.data) {
      set({ user: response.data, isAuthenticated: true, sessionUnavailable: false });
      return;
    }

    // The api layer already retried transient failures. Reaching here with a
    // transport error means the server is genuinely unreachable — hold the
    // session rather than silently signing the user out.
    // A definitively rejected session arrives via setOnAuthExpired instead.
    set({ sessionUnavailable: TRANSPORT_FAILURES.has(response.errorKind ?? '') });
  },

  clearError: () => set({ error: null }),
  setIsNewUser: (value: boolean) => set({ isNewUser: value }),
}));

// When the refresh token is rejected for good, the session is over. Clear auth
// state so the guard in _layout.tsx routes to login — otherwise the user sits on
// a screen whose requests all silently fail. Tokens are already cleared by the
// api layer before this runs.
setOnAuthExpired(() => {
  if (!useAuthStore.getState().isAuthenticated) return;
  log('[auth] session expired — signing out');
  disconnectTimerSocket();
  useGamificationStore.getState().reset();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isNewUser: false,
    sessionUnavailable: false,
    error: 'Your session expired. Please sign in again.',
  });
});

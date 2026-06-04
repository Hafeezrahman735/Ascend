import { create } from 'zustand';
import { User } from '../types';
import { setTokens, clearTokens, api } from '../services/api';
import { reconnectTimerSocket, disconnectTimerSocket, disconnectSocialSocket } from '../services/socket';
import { clearSessionHistory } from '../store/sync';
import { useGamificationStore } from './gamificationStore';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  isNewUser: boolean;

  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
  setIsNewUser: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  isNewUser: false,

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
        return true;
      }
      set({ error: response.error || 'Login failed', isLoading: false });
      return false;
    } catch {
      set({ error: 'Network error', isLoading: false });
      return false;
    }
  },

  register: async (email: string, username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post<{
        user: User;
        accessToken: string;
        refreshToken: string;
      }>('/auth/register', { email, username, password });

      if (response.success && response.data) {
        setTokens(response.data.accessToken, response.data.refreshToken);
        reconnectTimerSocket();
        set({
          user: response.data.user,
          isAuthenticated: true,
          isLoading: false,
          isNewUser: true,
        });
        return true;
      }
      set({ error: response.error || 'Registration failed', isLoading: false });
      return false;
    } catch {
      set({ error: 'Network error', isLoading: false });
      return false;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await api.post('/auth/logout', {});
    } catch {
    } finally {
      disconnectTimerSocket();
      disconnectSocialSocket();
      clearTokens();
      await clearSessionHistory();
      useGamificationStore.getState().reset();
      // Task store self-cleans via its useAuthStore.subscribe in taskStore.ts.
      // Setting user: null here triggers that subscription synchronously.
      // Navigation is handled by the auth guard in _layout.tsx.
      set({ user: null, isAuthenticated: false, isLoading: false, error: null, isNewUser: false });
    }
  },

  loadUser: async () => {
    try {
      const response = await api.get<User>('/auth/me');
      if (response.success && response.data) {
        set({ user: response.data, isAuthenticated: true });
      }
    } catch {
      set({ user: null, isAuthenticated: false });
    }
  },

  clearError: () => set({ error: null }),
  setIsNewUser: (value: boolean) => set({ isNewUser: value }),
}));

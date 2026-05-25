import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../types';
import { setTokens, clearTokens, api } from '../services/api';
import { reconnectTimerSocket } from '../services/socket';
import { clearSessionHistory } from '../store/sync';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

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
    const userId = get().user?.id;
    try {
      await api.post('/auth/logout', {});
    } catch {
    } finally {
      clearTokens();
      await clearSessionHistory();
      if (userId) {
        AsyncStorage.removeItem(`tasks:cache:${userId}`).catch(() => {});
      }
      set({ user: null, isAuthenticated: false, isLoading: false, error: null });
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
}));

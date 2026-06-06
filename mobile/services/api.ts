import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../constants/Config';

let accessToken: string | null = null;
let refreshToken: string | null = null;

const STORAGE_KEYS = {
  access: 'auth:access_token',
  refresh: 'auth:refresh_token',
};

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshToken = refresh;
  AsyncStorage.setItem(STORAGE_KEYS.access, access).catch((err) => console.warn('[api] persist access token failed:', err));
  AsyncStorage.setItem(STORAGE_KEYS.refresh, refresh).catch((err) => console.warn('[api] persist refresh token failed:', err));
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  AsyncStorage.removeItem(STORAGE_KEYS.access).catch((err) => console.warn('[api] clear access token failed:', err));
  AsyncStorage.removeItem(STORAGE_KEYS.refresh).catch((err) => console.warn('[api] clear refresh token failed:', err));
}

export async function loadTokensFromStorage(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const [access, refresh] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.access),
    AsyncStorage.getItem(STORAGE_KEYS.refresh),
  ]);
  accessToken = access;
  refreshToken = refresh;
  return { accessToken: access, refreshToken: refresh };
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${Config.API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    accessToken = data.data.accessToken;
    refreshToken = data.data.refreshToken;
    AsyncStorage.setItem(STORAGE_KEYS.access, data.data.accessToken).catch((err) => console.warn('[api] persist refreshed access token failed:', err));
    AsyncStorage.setItem(STORAGE_KEYS.refresh, data.data.refreshToken).catch((err) => console.warn('[api] persist refreshed refresh token failed:', err));
    return true;
  } catch {
    return false;
  }
}

const TIMEOUT_MS = 10000;

function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Request timed out')), TIMEOUT_MS);
    fetch(url, options).then(
      (response) => { clearTimeout(timeoutId); resolve(response); },
      (err) => { clearTimeout(timeoutId); reject(err); },
    );
  });
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<{ success: boolean; data?: T; error?: string }> {
  const url = `${Config.API_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response = await fetchWithTimeout(url, { ...options, headers });

  if (response.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      response = await fetchWithTimeout(url, { ...options, headers });
    }
  }

  try {
    return await response.json();
  } catch {
    return { success: false, error: 'Server returned an invalid response' };
  }
}

export const api = {
  get: <T>(endpoint: string) => apiRequest<T>(endpoint),
  post: <T>(endpoint: string, body: unknown) =>
    apiRequest<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(endpoint: string, body: unknown) =>
    apiRequest<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(endpoint: string, body: unknown) =>
    apiRequest<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: 'DELETE' }),
};

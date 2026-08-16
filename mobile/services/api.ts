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

// Called when the refresh token is definitively rejected, so the app can send
// the user back to login instead of leaving them on a silently broken screen.
// Set by the auth store to avoid a circular import.
let onAuthExpired: (() => void) | null = null;

export function setOnAuthExpired(handler: (() => void) | null): void {
  onAuthExpired = handler;
}

// In-flight refresh, shared by every caller.
//
// The server ROTATES the refresh token: using it deletes it and issues a new
// one. The app fires many requests in parallel on boot, so without this a single
// expired access token produces N simultaneous refreshes — the first succeeds
// and the rest present a token that no longer exists, get rejected, and fail
// their requests. Everyone now awaits the same promise and sees the same result.
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${Config.API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // Only 401/403 mean this token will never work again (expired, revoked, or
      // already rotated away) — clear it and hand off to the app. Everything else,
      // including 429 from the rate limiter and any 5xx, is transient: keep the
      // token so the next attempt can succeed. Treating 429 as fatal would sign
      // users out whenever a shared carrier IP hit the limit.
      if (response.status === 401 || response.status === 403) {
        clearTokens();
        onAuthExpired?.();
      }
      return false;
    }

    const data = await response.json();
    const newAccess = data?.data?.accessToken;
    const newRefresh = data?.data?.refreshToken;
    if (!newAccess || !newRefresh) return false;

    setTokens(newAccess, newRefresh);
    return true;
  } catch {
    // Network error — transient, keep the token for the next attempt.
    return false;
  }
}

/**
 * Force a token refresh outside the request path. Used by the socket layer,
 * whose handshake fails on an expired access token but never sees an HTTP 401
 * to trigger the normal refresh. Shares the same in-flight promise, so calling
 * it alongside live requests costs nothing extra.
 */
export function ensureFreshAccessToken(): Promise<boolean> {
  return refreshAccessToken();
}

function refreshAccessToken(): Promise<boolean> {
  // Coalesce concurrent callers onto one request.
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
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

  // Remember which token this attempt used, so a 401 can tell "my token expired"
  // apart from "another request already refreshed while I was in flight".
  const tokenUsed = accessToken;
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { ...options, headers });
  } catch {
    return { success: false, error: 'Network error: Could not reach the server. Check your connection.' };
  }

  if (response.status === 401 && refreshToken) {
    // If the token already changed underneath us, a refresh has just landed —
    // retry with it rather than rotating the refresh token a second time.
    const refreshed = accessToken !== tokenUsed ? true : await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      try {
        response = await fetchWithTimeout(url, { ...options, headers });
      } catch {
        return { success: false, error: 'Network error: Could not reach the server. Check your connection.' };
      }
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

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Config } from '../constants/Config';

let accessToken: string | null = null;
let refreshToken: string | null = null;

/**
 * Tokens live in the Keychain (iOS) / Keystore-backed store (Android), not in
 * AsyncStorage.
 *
 * AsyncStorage is app-sandboxed but not encrypted: on a jailbroken or rooted
 * device, in an unencrypted device backup, or through any path that can read the
 * app container, the refresh token sat there in plaintext — and it is valid for
 * seven days and mints access tokens for the whole of that window.
 *
 * SecureStore keys cannot contain a colon, so these are not the AsyncStorage
 * key names. The old names are still read once, below, to migrate.
 */
const SECURE_KEYS = {
  access: 'auth_access_token',
  refresh: 'auth_refresh_token',
};

/** What AsyncStorage used to hold. Read once at startup, then deleted. */
const LEGACY_KEYS = {
  access: 'auth:access_token',
  refresh: 'auth:refresh_token',
};

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshToken = refresh;
  SecureStore.setItemAsync(SECURE_KEYS.access, access).catch((err) => console.warn('[api] persist access token failed:', err));
  SecureStore.setItemAsync(SECURE_KEYS.refresh, refresh).catch((err) => console.warn('[api] persist refresh token failed:', err));
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  SecureStore.deleteItemAsync(SECURE_KEYS.access).catch((err) => console.warn('[api] clear access token failed:', err));
  SecureStore.deleteItemAsync(SECURE_KEYS.refresh).catch((err) => console.warn('[api] clear refresh token failed:', err));
  // Belt and braces: if a legacy pair somehow survived the migration below, a
  // sign-out must not leave it behind.
  AsyncStorage.multiRemove([LEGACY_KEYS.access, LEGACY_KEYS.refresh]).catch(() => {});
}

/**
 * Reads the secure store, falling back once to the old AsyncStorage pair and
 * migrating it across.
 *
 * Without the migration every existing user would be silently signed out by the
 * update — the tokens would still be on the device, just not where the app now
 * looks. The plaintext copy is deleted as soon as the secure copy is written,
 * which is the whole point of the exercise.
 */
export async function loadTokensFromStorage(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  let access: string | null = null;
  let refresh: string | null = null;

  try {
    [access, refresh] = await Promise.all([
      SecureStore.getItemAsync(SECURE_KEYS.access),
      SecureStore.getItemAsync(SECURE_KEYS.refresh),
    ]);
  } catch (err) {
    // A SecureStore read can fail on a device with no passcode set, or if the
    // keychain item was written under a different accessibility class. Treat it
    // as "no tokens" and let the legacy path or the login screen take over,
    // rather than crashing the whole bootstrap.
    console.warn('[api] secure token read failed:', err);
  }

  if (!access && !refresh) {
    try {
      const [legacyAccess, legacyRefresh] = await Promise.all([
        AsyncStorage.getItem(LEGACY_KEYS.access),
        AsyncStorage.getItem(LEGACY_KEYS.refresh),
      ]);
      if (legacyAccess && legacyRefresh) {
        access = legacyAccess;
        refresh = legacyRefresh;
        setTokens(legacyAccess, legacyRefresh);
      }
      // Removed whether or not the pair was complete: a half-written legacy
      // entry is unusable, and leaving either half is leaving a token on disk.
      await AsyncStorage.multiRemove([LEGACY_KEYS.access, LEGACY_KEYS.refresh]);
    } catch (err) {
      console.warn('[api] legacy token migration failed:', err);
    }
  }

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
    // Uses the timeout wrapper for the same reason every other call does: a bare
    // fetch here could hang indefinitely, and because refreshes are coalesced,
    // one stuck refresh blocks every request waiting behind it.
    const response = await fetchWithTimeout(`${Config.API_URL}/auth/refresh`, {
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

/**
 * Why a request can fail, kept separate from the human-readable message.
 *
 * Callers need this to tell "the server did not answer" apart from "the server
 * said no". Treating those the same is what signs a valid user out when the
 * backend is merely restarting — see authStore.loadUser.
 */
export type ApiErrorKind = 'offline' | 'timeout' | 'server' | 'unauthorized' | 'invalid-response';

// A type alias rather than an interface: some endpoints (e.g. /social/posts) put
// extra fields like nextCursor alongside `data`, and callers read them via a
// Record cast. Interfaces have no implicit index signature, so that cast would
// stop compiling.
export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  errorKind?: ApiErrorKind;
};

const ERROR_MESSAGES: Record<ApiErrorKind, string> = {
  offline: 'Network error: Could not reach the server. Check your connection.',
  timeout: 'The server took too long to respond. Please try again.',
  server: 'The server is temporarily unavailable. Please try again.',
  unauthorized: 'Your session has expired.',
  'invalid-response': 'Server returned an invalid response',
};

// Per attempt, not per call. The backend answers in well under a second when
// warm; this budget exists for the window after a container restart.
const ATTEMPT_TIMEOUT_MS = 12000;
const MAX_ATTEMPTS = 3;
// Ceiling across all attempts, so a user is never left waiting three full
// timeouts back to back.
const TOTAL_DEADLINE_MS = 30000;
const BASE_BACKOFF_MS = 400;

// Gateway codes Railway's edge returns while a container is coming up. Unlike a
// 4xx these carry no useful body — retrying is strictly better than surfacing
// the HTML error page as "invalid response".
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isAbortError = (err: unknown): boolean =>
  err instanceof Error && err.name === 'AbortError';

function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = ATTEMPT_TIMEOUT_MS,
): Promise<Response> {
  // AbortController rather than a Promise.race: the previous version resolved
  // the caller but left the request running, so a timed-out call kept consuming
  // a socket and could still deliver a response nobody was listening for.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId),
  );
}

type SendResult = { response: Response } | { failure: ApiErrorKind };

/**
 * One HTTP attempt, retried with exponential backoff and jitter on failures
 * that are plausibly transient. Deliberately does NOT retry 4xx or 5xx other
 * than the gateway codes: those are answers, not absences of one, and retrying
 * a rejected write is worse than reporting it.
 */
async function sendWithRetry(url: string, options: RequestInit): Promise<SendResult> {
  const startedAt = Date.now();
  let lastFailure: ApiErrorKind = 'offline';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (!RETRYABLE_STATUS.has(response.status)) return { response };
      lastFailure = 'server';
    } catch (err) {
      lastFailure = isAbortError(err) ? 'timeout' : 'offline';
    }

    if (attempt === MAX_ATTEMPTS) break;

    const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 250;
    if (Date.now() - startedAt + backoff > TOTAL_DEADLINE_MS) break;
    await sleep(backoff);
  }

  return { failure: lastFailure };
}

const transportFailure = <T>(kind: ApiErrorKind): ApiResponse<T> => ({
  success: false,
  error: ERROR_MESSAGES[kind],
  errorKind: kind,
});

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
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

  const first = await sendWithRetry(url, { ...options, headers });
  if ('failure' in first) return transportFailure<T>(first.failure);
  let response = first.response;

  if (response.status === 401 && refreshToken) {
    // If the token already changed underneath us, a refresh has just landed —
    // retry with it rather than rotating the refresh token a second time.
    const refreshed = accessToken !== tokenUsed ? true : await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      const retried = await sendWithRetry(url, { ...options, headers });
      if ('failure' in retried) return transportFailure<T>(retried.failure);
      response = retried.response;
    }
  }

  let body: ApiResponse<T>;
  try {
    body = await response.json();
  } catch {
    return transportFailure<T>('invalid-response');
  }

  // The body is the source of truth for the message — it is the server's own
  // wording. errorKind is added alongside it so callers can branch on the cause
  // without string-matching.
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return { ...body, success: false, errorKind: 'unauthorized' };
    }
    if (response.status >= 500) {
      return { ...body, success: false, errorKind: 'server' };
    }
  }

  return body;
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

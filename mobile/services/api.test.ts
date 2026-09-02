import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// api.ts reaches for AsyncStorage, SecureStore and Config at import time; all
// three are native / env-dependent, so they are stubbed to keep this runnable
// under plain Node (see the note in vitest.config.mts). expo-secure-store in
// particular pulls react-native, whose Flow syntax the Node runner cannot parse.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    setItem: vi.fn(async () => undefined),
    getItem: vi.fn(async () => null),
    removeItem: vi.fn(async () => undefined),
    multiRemove: vi.fn(async () => undefined),
  },
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

vi.mock('../constants/Config', () => ({
  Config: { API_URL: 'http://api.test', WS_URL: '', SOCIAL_WS_URL: '' },
}));

const { apiRequest, loadTokensFromStorage, clearTokens } = await import('./api');
const SecureStore = await import('expo-secure-store');
const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;

const jsonResponse = (status: number, body: unknown): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

const abortError = (): Error => {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('returns the parsed body and makes exactly one request when the server answers', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { id: 'abc' } }));

    const res = await apiRequest<{ id: string }>('/tasks');

    expect(res).toEqual({ success: true, data: { id: 'abc' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 and succeeds on a later attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: 'ok' }));

    const res = await apiRequest('/tasks');

    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a dropped connection and reports it as offline once attempts run out', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    const res = await apiRequest('/tasks');

    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('offline');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports an aborted request as a timeout, not as offline', async () => {
    fetchMock.mockRejectedValue(abortError());

    const res = await apiRequest('/tasks');

    expect(res.errorKind).toBe('timeout');
  });

  it('does not retry a 4xx — that is an answer, not a missing one', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { success: false, error: 'Email already registered' }));

    const res = await apiRequest('/auth/register');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The server's own wording survives untouched.
    expect(res.error).toBe('Email already registered');
  });

  it('tags a 500 as a server error while keeping the server message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { success: false, error: 'Internal server error' }));

    const res = await apiRequest('/tasks');

    expect(res.errorKind).toBe('server');
    expect(res.error).toBe('Internal server error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tags a 401 as unauthorized so callers can tell it apart from an unreachable server', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { success: false, error: 'No token provided' }));

    const res = await apiRequest('/auth/me');

    expect(res.errorKind).toBe('unauthorized');
  });

  it('reports an unparseable body without claiming the network failed', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    } as unknown as Response);

    const res = await apiRequest('/tasks');

    expect(res.errorKind).toBe('invalid-response');
  });

  it('passes an abort signal so a timed-out request stops consuming a socket', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));

    await apiRequest('/tasks');

    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
  });
});

describe('token storage', () => {
  /**
   * The migration is the risky half of moving off AsyncStorage: get it wrong and
   * every signed-in user is silently logged out by the update, because their
   * tokens are still on the device just not where the app now looks.
   */
  beforeEach(() => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    vi.mocked(SecureStore.setItemAsync).mockClear();
    vi.mocked(AsyncStorage.multiRemove).mockClear();
  });

  it('reads tokens from the secure store when they are there', async () => {
    vi.mocked(SecureStore.getItemAsync)
      .mockImplementation(async (k: string) => (k === 'auth_access_token' ? 'A' : 'R'));

    const { accessToken, refreshToken } = await loadTokensFromStorage();
    expect(accessToken).toBe('A');
    expect(refreshToken).toBe('R');
    // No legacy read is attempted once the secure pair is present.
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('migrates a legacy AsyncStorage pair, then deletes the plaintext', async () => {
    vi.mocked(AsyncStorage.getItem)
      .mockImplementation(async (k: string) => (k === 'auth:access_token' ? 'oldA' : 'oldR'));

    const { accessToken, refreshToken } = await loadTokensFromStorage();

    expect(accessToken).toBe('oldA');
    expect(refreshToken).toBe('oldR');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('auth_access_token', 'oldA');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('auth_refresh_token', 'oldR');
    // The whole point: the unencrypted copy does not survive the migration.
    expect(AsyncStorage.multiRemove)
      .toHaveBeenCalledWith(['auth:access_token', 'auth:refresh_token']);
  });

  it('clears the legacy keys even when only half a pair is left behind', async () => {
    // A half-written pair is unusable, and leaving either half is leaving a
    // token on disk.
    vi.mocked(AsyncStorage.getItem)
      .mockImplementation(async (k: string) => (k === 'auth:access_token' ? 'orphan' : null));

    const { accessToken } = await loadTokensFromStorage();
    expect(accessToken).toBeNull();
    expect(AsyncStorage.multiRemove).toHaveBeenCalled();
  });

  it('survives a secure-store read failure instead of crashing the bootstrap', async () => {
    // SecureStore can throw on a device with no passcode, or when the item was
    // written under a different accessibility class.
    vi.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('keychain unavailable'));

    await expect(loadTokensFromStorage()).resolves.toEqual({
      accessToken: null,
      refreshToken: null,
    });
  });

  it('removes both the secure and the legacy copies on sign-out', async () => {
    clearTokens();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_access_token');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_refresh_token');
    expect(AsyncStorage.multiRemove).toHaveBeenCalled();
  });
});

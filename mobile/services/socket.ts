import { io, Socket } from 'socket.io-client';
import { Config } from '../constants/Config';
import { getAccessToken, ensureFreshAccessToken } from './api';

let timerSocket: Socket | null = null;
let socialSocket: Socket | null = null;

const defaultOptions = {
  transports: ['websocket'],
  reconnection: true,
  // Was 3, which meant a phone that lost signal for a minute gave up on
  // real-time for the rest of the session. Infinity + capped backoff lets it
  // recover whenever the network returns.
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 30000,
  timeout: 5000,
};

// Sockets authenticate with the ACCESS token, which expires in 15 minutes.
// Passing `auth` as a static object captures the token once and replays the same
// expired value on every reconnect, so real-time silently dies. The callback
// form is re-evaluated per connection attempt, so each reconnect sends whatever
// token is current.
function authProvider(cb: (data: { token: string | null }) => void): void {
  cb({ token: getAccessToken() });
}

// The server rejects a handshake with `Authentication required` / `Invalid token`.
// Both mean the access token needs refreshing before the next attempt.
function isAuthError(message: string): boolean {
  return /auth|token/i.test(message);
}

// Refresh once per failure burst; socket.io keeps retrying on its own schedule
// and will pick up the new token via authProvider on the next attempt.
function handleSocketAuthError(label: string, message: string): void {
  console.warn(`[socket] ${label} connect_error:`, message);
  if (!isAuthError(message)) return;
  ensureFreshAccessToken().catch(() => {
    /* transient; socket.io retries and we try again on the next failure */
  });
}

function connectTimerSocket(): Socket {
  if (timerSocket) return timerSocket;

  const url = `${Config.WS_URL}/timer`;
  console.log('[socket] creating timer socket — url:', url);

  timerSocket = io(url, {
    ...defaultOptions,
    auth: authProvider,
  });

  timerSocket.on('connect', () => {
    console.log('[socket] timer CONNECTED — id:', timerSocket?.id);
  });

  timerSocket.on('disconnect', (reason) => {
    console.log('[socket] timer disconnected:', reason);
  });

  timerSocket.on('connect_error', (error) => {
    handleSocketAuthError('timer', error.message);
  });

  return timerSocket;
}

export function reconnectTimerSocket(): void {
  const token = getAccessToken();
  console.log('[socket] reconnectTimerSocket — token present:', !!token);

  if (!token) {
    console.error('[socket] reconnectTimerSocket called with no token — aborting');
    return;
  }

  if (timerSocket) {
    timerSocket.removeAllListeners();
    timerSocket.disconnect();
    timerSocket = null;
  }

  connectTimerSocket();
}

export function connectSocialSocket(): Socket {
  // Returns the existing socket whenever one exists — not only when it is
  // already connected. Checking `.connected` leaked a new socket every time this
  // was called while the previous one was still connecting or reconnecting.
  if (socialSocket) return socialSocket;

  socialSocket = io(`${Config.SOCIAL_WS_URL}/social`, {
    ...defaultOptions,
    auth: authProvider,
  });

  socialSocket.on('connect', () => {
    console.log('[socket] social CONNECTED — id:', socialSocket?.id);
  });

  socialSocket.on('disconnect', (reason) => {
    console.log('[socket] social disconnected:', reason);
  });

  socialSocket.on('connect_error', (error) => {
    handleSocketAuthError('social', error.message);
  });

  return socialSocket;
}

export function disconnectTimerSocket(): void {
  if (timerSocket) {
    timerSocket.removeAllListeners();
    timerSocket.disconnect();
    timerSocket = null;
  }
}

export function disconnectSocialSocket(): void {
  if (socialSocket) {
    socialSocket.disconnect();
    socialSocket = null;
  }
}

export function getSocialSocket(): Socket | null {
  return socialSocket;
}

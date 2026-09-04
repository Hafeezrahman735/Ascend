import { io, Socket } from 'socket.io-client';
import { Config } from '../constants/Config';
import { getAccessToken, ensureFreshAccessToken } from './api';
import { log } from '../lib/log';

let timerSocket: Socket | null = null;

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
  log('[socket] creating timer socket — url:', url);

  timerSocket = io(url, {
    ...defaultOptions,
    auth: authProvider,
  });

  timerSocket.on('connect', () => {
    log('[socket] timer CONNECTED — id:', timerSocket?.id);
  });

  timerSocket.on('disconnect', (reason) => {
    log('[socket] timer disconnected:', reason);
  });

  timerSocket.on('connect_error', (error) => {
    handleSocketAuthError('timer', error.message);
  });

  return timerSocket;
}

export function reconnectTimerSocket(): void {
  const token = getAccessToken();
  log('[socket] reconnectTimerSocket — token present:', !!token);

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

export function disconnectTimerSocket(): void {
  if (timerSocket) {
    timerSocket.removeAllListeners();
    timerSocket.disconnect();
    timerSocket = null;
  }
}


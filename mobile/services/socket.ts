import { io, Socket } from 'socket.io-client';
import { Config } from '../constants/Config';
import { getAccessToken } from './api';

let timerSocket: Socket | null = null;
let socialSocket: Socket | null = null;

const defaultOptions = {
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 3,
  reconnectionDelay: 2000,
  timeout: 5000,
};

function connectTimerSocket(): Socket {
  if (timerSocket?.connected) return timerSocket;

  const token = getAccessToken();
  const url = `${Config.WS_URL}/timer`;
  console.log('[socket] creating timer socket — url:', url, 'token present:', !!token);

  timerSocket = io(url, {
    ...defaultOptions,
    auth: { token },
  });

  timerSocket.on('connect', () => {
    console.log('[socket] timer CONNECTED — id:', timerSocket?.id, 'token was present: true');
  });

  timerSocket.on('disconnect', (reason) => {
    console.log('[socket] timer disconnected:', reason);
  });

  timerSocket.on('connect_error', (error) => {
    console.error('[socket] timer connect_error:', error.message);
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
  if (socialSocket?.connected) return socialSocket;

  socialSocket = io(`${Config.SOCIAL_WS_URL}/social`, {
    ...defaultOptions,
    auth: { token: getAccessToken() },
  });

  socialSocket.on('connect', () => {
    console.log('Social socket connected');
  });

  socialSocket.on('disconnect', (reason) => {
    console.log('Social socket disconnected:', reason);
  });

  return socialSocket;
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

import { Namespace, Socket } from 'socket.io';
import { verifyAccessToken } from '../../middleware/auth';

declare module 'socket.io' {
  interface Socket {
    userId: string;
  }
}

export function setupTimerHandlers(namespace: Namespace): void {
  namespace.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) {
      next(new Error('Authentication required'));
      return;
    }
    try {
      const payload = verifyAccessToken(token as string);
      socket.userId = payload.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  namespace.on('connection', (socket: Socket) => {
    const userId = socket.userId;
    socket.join(`user:${userId}`);

    socket.on('disconnect', () => {});
  });
}

import { Namespace, Socket } from 'socket.io';
import { verifyAccessToken } from '../../middleware/auth';
import { Server as SocketIOServer } from 'socket.io';
import {
  FriendRequestSentEvent,
  FriendRequestAcceptedEvent,
} from '../../middleware/eventBus';

declare module 'socket.io' {
  interface Socket {
    userId: string;
  }
}

const activeUserSockets = new Map<string, Set<string>>();

export function getActiveSocketUserIds(): Set<string> {
  return new Set(activeUserSockets.keys());
}

export function setupSocialSocket(namespace: Namespace): void {
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
    // See the note in modules/timer/handlers.ts — synchronous with the in-memory
    // adapter, would need awaiting under a Redis adapter.
    void socket.join(`user:${userId}`);

    if (!activeUserSockets.has(userId)) {
      activeUserSockets.set(userId, new Set());
    }
    activeUserSockets.get(userId)!.add(socket.id);

    socket.on('disconnect', () => {
      const sockets = activeUserSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          activeUserSockets.delete(userId);
        }
      }
    });
  });
}

export function emitFriendRequestReceived(
  io: SocketIOServer,
  event: FriendRequestSentEvent,
): void {
  io.of('/social').to(`user:${event.targetUserId}`).emit('friend_request:received', {
    requestId: event.requestId,
    fromUserId: event.fromUserId,
    fromUsername: event.fromUsername,
    fromLevel: event.fromLevel,
  });
}

export function emitFriendRequestAccepted(
  io: SocketIOServer,
  event: FriendRequestAcceptedEvent,
): void {
  io.of('/social').to(`user:${event.requesterId}`).emit('friend_request:accepted', {
    friendshipId: event.friendshipId,
    addresseeId: event.addresseeId,
    addresseeUsername: event.addresseeUsername,
  });
}

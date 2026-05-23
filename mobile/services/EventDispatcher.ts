import { connectSocialSocket, getSocialSocket } from './socket';
import { useSocialStore } from '../stores/socialStore';
import { FeedEvent } from '../types';

let connected = false;

export function connectEventDispatcher() {
  if (connected) return;
  connected = true;

  const socket = connectSocialSocket();

  socket.on('connect_error', () => {
    useSocialStore.setState({ error: 'Unable to connect to social server' });
  });

  socket.on('friend:session_started', (data) => {
    useSocialStore.setState((state) => ({
      feed: [
        {
          id: `live-${Date.now()}`,
          userId: data.userId,
          type: 'focus' as const,
          durationSeconds: 0,
          taskLabel: data.taskLabel,
          completedAt: data.startedAt,
        } as any,
        ...state.feed,
      ],
    }));
  });

  socket.on('feed:new_event', (event: FeedEvent) => {
    useSocialStore.getState().prependFeedEvent(event);
  });

  socket.on('friend_request:received', (data) => {
    const incoming = {
      id: data.requestId,
      requesterId: data.fromUserId,
      addresseeId: '',
      status: 'pending',
      requester: {
        id: data.fromUserId,
        username: data.fromUsername,
        avatarUrl: null,
      },
    };
    useSocialStore.setState((state) => ({
      incomingRequests: [incoming as any, ...state.incomingRequests],
    }));
  });

  socket.on('friend_request:accepted', (data) => {
    useSocialStore.setState((state) => ({
      outgoingRequests: state.outgoingRequests.filter((r) => r.id !== data.friendshipId),
    }));
    useSocialStore.getState().loadFriends();
  });
}

export function disconnectEventDispatcher() {
  const socket = getSocialSocket();
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  connected = false;
}

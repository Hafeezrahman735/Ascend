import { create } from 'zustand';
import {
  Friend,
  FriendRequest,
  LeaderboardEntry,
  Session,
  FeedEvent,
  UserSearchResult,
} from '../types';
import { api } from '../services/api';

interface SocialState {
  friends: Friend[];
  feed: Session[];
  feedEvents: FeedEvent[];
  feedCursor: string | null;
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  activeTab: 'feed' | 'friends' | 'requests' | 'rankings';
  weeklyXPLeaderboard: LeaderboardEntry[];
  streakLeaderboardFull: LeaderboardEntry[];
  myLeaderboardEntry: LeaderboardEntry | null;
  isLoading: boolean;
  error: string | null;

  loadFriends: () => Promise<void>;
  sendFriendRequest: (userId: string) => Promise<boolean>;
  removeFriend: (friendshipId: string) => Promise<boolean>;
  searchUsers: (query: string) => Promise<UserSearchResult[]>;
  fetchFeed: () => Promise<void>;
  fetchMoreFeed: () => Promise<void>;
  prependFeedEvent: (event: FeedEvent) => void;
  fetchRequests: () => Promise<void>;
  acceptRequest: (requestId: string) => Promise<boolean>;
  declineRequest: (requestId: string) => Promise<boolean>;
  cancelRequest: (requestId: string) => Promise<boolean>;
  fetchLeaderboard: (type: string, scope: string) => Promise<void>;
  setActiveTab: (tab: 'feed' | 'friends' | 'requests' | 'rankings') => void;
}

export const useSocialStore = create<SocialState>((set, get) => ({
  friends: [],
  feed: [],
  feedEvents: [],
  feedCursor: null,
  incomingRequests: [],
  outgoingRequests: [],
  activeTab: 'feed',
  weeklyXPLeaderboard: [],
  streakLeaderboardFull: [],
  myLeaderboardEntry: null,
  isLoading: false,
  error: null,

  setActiveTab: (tab) => {
    set({ activeTab: tab });
  },

  loadFriends: async () => {
    set({ isLoading: true });
    try {
      const response = await api.get<Friend[]>('/social/friends');
      if (response.success && response.data) {
        set({ friends: response.data, isLoading: false });
      }
    } catch {
      set({ isLoading: false, error: 'Failed to load friends' });
    }
  },

  sendFriendRequest: async (userId: string) => {
    try {
      const response = await api.post('/social/friend-request', { userId });
      if (response.success) {
        return true;
      }
      set({ error: response.error });
      return false;
    } catch {
      set({ error: 'Failed to send request' });
      return false;
    }
  },

  removeFriend: async (friendshipId: string) => {
    try {
      const response = await api.delete(`/social/friends/${friendshipId}`);
      if (response.success) {
        await get().loadFriends();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  searchUsers: async (query: string) => {
    try {
      const response = await api.get<UserSearchResult[]>(`/social/users/search?q=${encodeURIComponent(query)}`);
      if (response.success && response.data) {
        return response.data;
      }
      return [];
    } catch {
      return [];
    }
  },

  fetchFeed: async () => {
    try {
      const response = await api.get<FeedEvent[]>('/social/feed');
      if (response.success && response.data) {
        const data = Array.isArray(response.data) ? response.data : [];
        set({
          feedEvents: data,
          feedCursor: (response as Record<string, unknown>).nextCursor as string | null || null,
        });
      }
    } catch {
      set({ error: 'Failed to load feed' });
    }
  },

  fetchMoreFeed: async () => {
    const cursor = get().feedCursor;
    if (!cursor) return;
    try {
      const response = await api.get<FeedEvent[]>(`/social/feed?cursor=${encodeURIComponent(cursor)}`);
      if (response.success && response.data) {
        const data = Array.isArray(response.data) ? response.data : [];
        set((state) => ({
          feedEvents: [...state.feedEvents, ...data],
          feedCursor: (response as Record<string, unknown>).nextCursor as string | null || null,
        }));
      }
    } catch {
      // silent fail for pagination
    }
  },

  prependFeedEvent: (event: FeedEvent) => {
    set((state) => ({
      feedEvents: [event, ...state.feedEvents],
    }));
  },

  fetchRequests: async () => {
    try {
      const response = await api.get<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>('/social/friend-requests');
      if (response.success && response.data) {
        set({
          incomingRequests: response.data.incoming,
          outgoingRequests: response.data.outgoing,
        });
      }
    } catch {
      set({ error: 'Failed to load requests' });
    }
  },

  acceptRequest: async (requestId: string) => {
    try {
      const response = await api.post(`/social/friend-request/${requestId}/accept`, {});
      if (response.success) {
        set((state) => ({
          incomingRequests: state.incomingRequests.filter((r) => r.id !== requestId),
        }));
        await get().loadFriends();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  declineRequest: async (requestId: string) => {
    try {
      const response = await api.post(`/social/friend-request/${requestId}/decline`, {});
      if (response.success) {
        set((state) => ({
          incomingRequests: state.incomingRequests.filter((r) => r.id !== requestId),
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  cancelRequest: async (requestId: string) => {
    try {
      const response = await api.delete(`/social/friend-request/${requestId}`);
      if (response.success) {
        set((state) => ({
          outgoingRequests: state.outgoingRequests.filter((r) => r.id !== requestId),
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  fetchLeaderboard: async (type: string, scope: string) => {
    try {
      const response = await api.get<{
        entries: LeaderboardEntry[];
        myEntry: LeaderboardEntry | null;
      }>(`/social/leaderboard?type=${encodeURIComponent(type)}&scope=${encodeURIComponent(scope)}`);
      if (response.success && response.data) {
        if (type === 'weekly_xp') {
          set({ weeklyXPLeaderboard: response.data.entries, myLeaderboardEntry: response.data.myEntry });
        } else {
          set({ streakLeaderboardFull: response.data.entries, myLeaderboardEntry: response.data.myEntry });
        }
      }
    } catch {
      set({ error: 'Failed to load leaderboard' });
    }
  },
}));

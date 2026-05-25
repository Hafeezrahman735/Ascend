import { create } from 'zustand';
import {
  Friend,
  FriendRequest,
  LeaderboardEntry,
  Session,
  FeedEvent,
  UserSearchResult,
  SocialPost,
  StudyGroup,
  FocusLeaderboardEntry,
  InAppNotification,
  UserSocialStats,
  UserListItem,
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
  isLoadingFollowers: boolean;
  isLoadingFollowing: boolean;
  isLoadingFriends: boolean;
  error: string | null;

  // Social feed v2
  posts: SocialPost[];
  postsCursor: string | null;
  studyGroups: StudyGroup[];
  selectedGroupId: string | null;
  focusLeaderboard: FocusLeaderboardEntry[];
  myFocusEntry: FocusLeaderboardEntry | null;
  notifications: InAppNotification[];
  unreadCount: number;

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

  // Social feed v2 actions
  fetchPosts: (groupId?: string) => Promise<void>;
  fetchMorePosts: () => Promise<void>;
  toggleReaction: (postId: string, emoji: string, currentUserId: string) => Promise<void>;
  createPost: (draft: Partial<SocialPost>) => Promise<boolean>;
  fetchStudyGroups: () => Promise<void>;
  setSelectedGroup: (groupId: string | null) => void;
  fetchFocusLeaderboard: (scope: string, period: string) => Promise<void>;
  markNotificationsRead: () => void;
  fetchNotifications: () => Promise<void>;

  // Profile social stats
  userSocialStats: UserSocialStats | null;
  followers: UserListItem[];
  following: UserListItem[];
  userPosts: SocialPost[];
  userPostsCursor: string | null;
  fetchUserSocialStats: () => Promise<void>;
  fetchFollowers: () => Promise<void>;
  fetchFollowing: () => Promise<void>;
  fetchUserPosts: () => Promise<void>;
  fetchMoreUserPosts: () => Promise<void>;
}

let leaderboardFetchId = 0;

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
  isLoadingFollowers: false,
  isLoadingFollowing: false,
  isLoadingFriends: false,
  error: null,

  posts: [],
  postsCursor: null,
  studyGroups: [],
  selectedGroupId: null,
  focusLeaderboard: [],
  myFocusEntry: null,
  notifications: [],
  unreadCount: 0,

  userSocialStats: null,
  followers: [],
  following: [],
  userPosts: [],
  userPostsCursor: null,

  setActiveTab: (tab) => {
    set({ activeTab: tab });
  },

  loadFriends: async () => {
    set({ isLoadingFriends: true });
    try {
      const response = await api.get<Friend[]>('/social/friends');
      if (response.success && response.data) {
        set({ friends: response.data });
      }
    } catch {
      set({ error: 'Failed to load friends' });
    } finally {
      set({ isLoadingFriends: false });
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

  fetchPosts: async (groupId?: string) => {
    set({ isLoading: true });
    try {
      const url = groupId
        ? `/social/posts?groupId=${encodeURIComponent(groupId)}`
        : '/social/posts';
      const response = await api.get<{ posts: SocialPost[]; cursor: string | null }>(url);
      if (response.success && response.data) {
        set({
          posts: response.data.posts ?? [],
          postsCursor: response.data.cursor ?? null,
          isLoading: false,
        });
      } else {
        set({ posts: [], isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  fetchMorePosts: async () => {
    const { postsCursor, selectedGroupId } = get();
    if (!postsCursor) return;
    try {
      const url = `/social/posts?cursor=${encodeURIComponent(postsCursor)}${selectedGroupId ? `&groupId=${encodeURIComponent(selectedGroupId)}` : ''}`;
      const response = await api.get<{ posts: SocialPost[]; cursor: string | null }>(url);
      if (response.success && response.data) {
        set((state) => ({
          posts: [...state.posts, ...(response.data?.posts ?? [])],
          postsCursor: response.data?.cursor ?? null,
        }));
      }
    } catch {
      // silent
    }
  },

  toggleReaction: async (postId: string, emoji: string, currentUserId: string) => {
    const { posts, userPosts } = get();

    const applyToggle = (list: SocialPost[]) =>
      list.map((p) => {
        if (p.id !== postId) return p;
        const existing = p.reactions[emoji] ?? [];
        const hasReacted = existing.includes(currentUserId);
        const newIds = hasReacted
          ? existing.filter((id) => id !== currentUserId)
          : [...existing, currentUserId];
        return { ...p, reactions: { ...p.reactions, [emoji]: newIds } };
      });

    set({ posts: applyToggle(posts), userPosts: applyToggle(userPosts) });

    try {
      await api.post(`/social/posts/${postId}/react`, { emoji });
    } catch {
      set({ posts, userPosts });
    }
  },

  createPost: async (draft: Partial<SocialPost>) => {
    try {
      const response = await api.post<SocialPost>('/social/posts', draft);
      if (response.success && response.data) {
        set((state) => ({
          posts: [response.data!, ...state.posts],
          userPosts: [response.data!, ...state.userPosts],
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  fetchStudyGroups: async () => {
    try {
      const response = await api.get<StudyGroup[]>('/social/groups');
      if (response.success && response.data) {
        set({ studyGroups: response.data });
      } else {
        set({ studyGroups: [] });
      }
    } catch {
      set({ studyGroups: [] });
    }
  },

  setSelectedGroup: (groupId: string | null) => {
    set({ selectedGroupId: groupId });
  },

  fetchFocusLeaderboard: async (scope: string, period: string) => {
    const id = ++leaderboardFetchId;
    set({ isLoading: true });
    try {
      const response = await api.get<{
        entries: FocusLeaderboardEntry[];
        myEntry: FocusLeaderboardEntry | null;
      }>(`/social/focus-leaderboard?scope=${encodeURIComponent(scope)}&period=${encodeURIComponent(period)}`);
      if (id !== leaderboardFetchId) return;
      if (response.success && response.data) {
        set({
          focusLeaderboard: response.data.entries ?? [],
          myFocusEntry: response.data.myEntry ?? null,
          isLoading: false,
        });
      } else {
        set({ focusLeaderboard: [], myFocusEntry: null, isLoading: false });
      }
    } catch {
      if (id === leaderboardFetchId) set({ focusLeaderboard: [], myFocusEntry: null, isLoading: false });
    }
  },

  markNotificationsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
  },

  fetchNotifications: async () => {
    try {
      const response = await api.get<{ notifications: InAppNotification[]; unreadCount: number }>('/notifications');
      if (response.success && response.data) {
        set({ notifications: response.data.notifications, unreadCount: response.data.unreadCount });
      }
    } catch {
      // silent
    }
  },

  fetchUserSocialStats: async () => {
    try {
      const response = await api.get<UserSocialStats>('/social/stats/me');
      if (response.success && response.data) {
        set({ userSocialStats: response.data });
      } else {
        set({ userSocialStats: null });
      }
    } catch {
      set({ userSocialStats: null });
    }
  },

  fetchFollowers: async () => {
    set({ isLoadingFollowers: true });
    try {
      const response = await api.get<UserListItem[]>('/social/followers');
      if (response.success && response.data) {
        set({ followers: response.data });
      } else {
        set({ followers: [] });
      }
    } catch {
      set({ followers: [] });
    } finally {
      set({ isLoadingFollowers: false });
    }
  },

  fetchFollowing: async () => {
    set({ isLoadingFollowing: true });
    try {
      const response = await api.get<UserListItem[]>('/social/following');
      if (response.success && response.data) {
        set({ following: response.data });
      } else {
        set({ following: [] });
      }
    } catch {
      set({ following: [] });
    } finally {
      set({ isLoadingFollowing: false });
    }
  },

  fetchUserPosts: async () => {
    try {
      const response = await api.get<{ posts: SocialPost[]; cursor: string | null }>('/social/posts/mine');
      if (response.success && response.data) {
        set({ userPosts: response.data.posts ?? [], userPostsCursor: response.data.cursor ?? null });
      } else {
        set({ userPosts: [], userPostsCursor: null });
      }
    } catch {
      set({ userPosts: [], userPostsCursor: null });
    }
  },

  fetchMoreUserPosts: async () => {
    const { userPostsCursor } = get();
    if (!userPostsCursor) return;
    try {
      const response = await api.get<{ posts: SocialPost[]; cursor: string | null }>(`/social/posts/mine?cursor=${encodeURIComponent(userPostsCursor)}`);
      if (response.success && response.data) {
        set((state) => ({
          userPosts: [...state.userPosts, ...(response.data?.posts ?? [])],
          userPostsCursor: response.data?.cursor ?? null,
        }));
      }
    } catch {
      // silent
    }
  },
}));

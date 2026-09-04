import { create } from 'zustand';
import {
  UserSearchResult,
  SocialPost,
  StudyGroup,
  GroupDetail,
  GroupDetailResult,
  GroupMember,
  FocusLeaderboardEntry,
  InAppNotification,
  UserSocialStats,
  UserListItem,
  PublicUserProfile,
} from '../types';
import { api } from '../services/api';

interface SocialState {
  isLoading: boolean;
  isLoadingFollowers: boolean;
  isLoadingFollowing: boolean;
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

  searchUsers: (query: string) => Promise<UserSearchResult[]>;

  // Social feed v2 actions
  fetchPosts: (groupId?: string) => Promise<void>;
  fetchMorePosts: () => Promise<void>;
  toggleReaction: (postId: string, emoji: string, currentUserId: string) => Promise<void>;
  createPost: (draft: Partial<SocialPost>) => Promise<boolean>;
  fetchStudyGroups: () => Promise<void>;
  fetchAllGroups: () => Promise<StudyGroup[]>;
  joinGroup: (groupId: string) => Promise<boolean>;
  leaveGroup: (groupId: string) => Promise<boolean>;
  createGroup: (data: { name: string; description?: string | null; emoji: string; color: string; isPrivate: boolean }) => Promise<StudyGroup | null>;
  fetchGroupDetail: (groupId: string) => Promise<GroupDetailResult>;
  addGroupMember: (groupId: string, userId: string) => Promise<GroupMember | null>;
  removeGroupMember: (groupId: string, userId: string) => Promise<boolean>;
  /** Any MEMBER may write a group's About text, not just its creator. */
  updateGroupDescription: (groupId: string, description: string | null) =>
    Promise<{ ok: true; description: string | null } | { ok: false; error: string }>;
  setSelectedGroup: (groupId: string | null) => void;
  fetchFocusLeaderboard: (scope: string, period: string) => Promise<void>;
  markNotificationsRead: () => Promise<void>;
  fetchNotifications: () => Promise<void>;

  // Search & follow
  searchResults: UserSearchResult[];
  searchQuery: string;
  isSearching: boolean;
  searchUsersV2: (query: string) => Promise<void>;
  clearSearch: () => void;
  followUser: (userId: string) => Promise<boolean>;
  unfollowUser: (userId: string) => Promise<boolean>;

  // Public profile
  viewedProfile: PublicUserProfile | null;
  fetchUserProfile: (userId: string) => Promise<PublicUserProfile | null>;

  // Profile social stats
  userSocialStats: UserSocialStats | null;
  followers: UserListItem[];
  following: UserListItem[];
  userPosts: SocialPost[];
  userPostsCursor: string | null;
  /**
   * Scoped to the user's own posts.
   *
   * The profile renders this list permanently now (it used to be behind a tab),
   * so binding it to the shared `isLoading` meant any unrelated social action —
   * loading friends, following someone — flashed a spinner inside the profile.
   */
  isLoadingUserPosts: boolean;
  fetchUserSocialStats: () => Promise<void>;
  fetchFollowers: () => Promise<void>;
  fetchFollowing: () => Promise<void>;
  fetchUserPosts: () => Promise<void>;
  fetchMoreUserPosts: () => Promise<void>;
}

let leaderboardFetchId = 0;

export const useSocialStore = create<SocialState>((set, get) => ({
  isLoading: false,
  isLoadingFollowers: false,
  isLoadingFollowing: false,
  error: null,

  posts: [],
  postsCursor: null,
  studyGroups: [],
  selectedGroupId: null,
  focusLeaderboard: [],
  myFocusEntry: null,
  notifications: [],
  unreadCount: 0,

  searchResults: [],
  searchQuery: '',
  isSearching: false,
  viewedProfile: null,

  userSocialStats: null,
  followers: [],
  following: [],
  userPosts: [],
  userPostsCursor: null,
  isLoadingUserPosts: false,

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
      if (response.success) {
        if (response.data) {
          set((state) => ({
            posts: [response.data!, ...state.posts],
            userPosts: [response.data!, ...state.userPosts],
          }));
        } else {
          await get().fetchPosts(get().selectedGroupId ?? undefined);
        }
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

  fetchAllGroups: async () => {
    try {
      const response = await api.get<StudyGroup[]>('/social/groups/all');
      if (response.success && response.data) return response.data;
    } catch {}
    return [];
  },

  joinGroup: async (groupId: string) => {
    try {
      const response = await api.post(`/social/groups/${groupId}/join`, {});
      if (response.success) {
        await get().fetchStudyGroups();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  leaveGroup: async (groupId: string) => {
    try {
      const response = await api.post(`/social/groups/${groupId}/leave`, {});
      if (response.success) {
        set((state) => ({ studyGroups: state.studyGroups.filter((g) => g.id !== groupId) }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  createGroup: async (data) => {
    try {
      const response = await api.post<StudyGroup>('/social/groups', data);
      if (response.success && response.data) {
        set((state) => ({ studyGroups: [response.data!, ...state.studyGroups] }));
        return response.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  // Group detail is deliberately NOT cached in the store. The detail screen owns
  // it in local state so navigating there cannot clobber `studyGroups`, which the
  // Social tab's chip strip renders from.
  fetchGroupDetail: async (groupId: string) => {
    try {
      const response = await api.get<GroupDetail>(`/social/groups/${groupId}`);
      if (response.success && response.data) return { ok: true, detail: response.data };
      // errorKind is set for offline / timeout / 5xx / auth. Those are all
      // "we never got a real answer", not "no such group".
      if (response.errorKind) {
        return { ok: false, reason: 'unavailable', message: response.error };
      }
      return { ok: false, reason: 'not-found', message: response.error };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  },

  addGroupMember: async (groupId: string, userId: string) => {
    try {
      const response = await api.post<GroupMember>(`/social/groups/${groupId}/members`, { userId });
      if (response.success && response.data) return response.data;
    } catch {}
    return null;
  },

  updateGroupDescription: async (groupId: string, description: string | null) => {
    try {
      const response = await api.patch<{ id: string; description: string | null }>(
        `/social/groups/${groupId}`,
        { description },
      );
      if (response.success && response.data) {
        const next = response.data.description;
        // Keep the cached list in step so the Trace tab does not show the old
        // text until its next fetch.
        set((state) => ({
          studyGroups: state.studyGroups.map((g) =>
            g.id === groupId ? { ...g, description: next } : g),
        }));
        return { ok: true as const, description: next };
      }
      // The server's message is the useful one here — it says whether this was
      // a moderation refusal or a permission problem.
      return { ok: false as const, error: response.error ?? 'Could not save that.' };
    } catch {
      return { ok: false as const, error: 'No connection. Try again.' };
    }
  },

  removeGroupMember: async (groupId: string, userId: string) => {
    try {
      const response = await api.delete(`/social/groups/${groupId}/members/${userId}`);
      return !!response.success;
    } catch {
      return false;
    }
  },

  setSelectedGroup: (groupId: string | null) => {
    set({ selectedGroupId: groupId });
  },

  searchUsersV2: async (query: string) => {
    set({ searchQuery: query, isSearching: true });
    if (!query || query.length < 2) {
      set({ searchResults: [], isSearching: false });
      return;
    }
    try {
      const response = await api.get<UserSearchResult[]>(`/social/search?q=${encodeURIComponent(query)}`);
      if (response.success && response.data) {
        set({ searchResults: response.data, isSearching: false });
      } else {
        set({ searchResults: [], isSearching: false });
      }
    } catch {
      set({ searchResults: [], isSearching: false });
    }
  },

  clearSearch: () => {
    set({ searchResults: [], searchQuery: '', isSearching: false });
  },

  followUser: async (userId: string) => {
    try {
      const response = await api.post(`/social/follow/${userId}`, {});
      if (response.success) {
        set((state) => ({
          searchResults: state.searchResults.map((u) =>
            u.id === userId ? { ...u, isFollowing: true } : u
          ),
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  unfollowUser: async (userId: string) => {
    try {
      const response = await api.delete(`/social/follow/${userId}`);
      if (response.success) {
        set((state) => ({
          searchResults: state.searchResults.map((u) =>
            u.id === userId ? { ...u, isFollowing: false } : u
          ),
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  fetchUserProfile: async (userId: string) => {
    try {
      const response = await api.get<PublicUserProfile>(`/social/users/${userId}`);
      if (response.success && response.data) {
        set({ viewedProfile: response.data });
        return response.data;
      }
      return null;
    } catch {
      return null;
    }
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

  markNotificationsRead: async () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
    try {
      await api.post('/notifications/read-all', {});
    } catch {
      // silent — optimistic update already applied
    }
  },

  fetchNotifications: async () => {
    try {
      const response = await api.get<{ id: string; type: string; title: string; body: string; isRead: boolean; createdAt: string }[]>('/notifications');
      if (response.success && response.data) {
        const list = Array.isArray(response.data) ? response.data : [];
        const mapped: InAppNotification[] = list.map((n) => ({
          id: n.id,
          text: n.title + (n.body ? `: ${n.body}` : ''),
          createdAt: n.createdAt,
          isRead: n.isRead,
        }));
        set({ notifications: mapped, unreadCount: mapped.filter((n) => !n.isRead).length });
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
    set({ isLoadingUserPosts: true });
    try {
      const response = await api.get<{ posts: SocialPost[]; cursor: string | null }>('/social/posts/mine');
      if (response.success && response.data) {
        set({ userPosts: response.data.posts ?? [], userPostsCursor: response.data.cursor ?? null });
      } else {
        set({ userPosts: [], userPostsCursor: null });
      }
    } catch {
      set({ userPosts: [], userPostsCursor: null });
    } finally {
      set({ isLoadingUserPosts: false });
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

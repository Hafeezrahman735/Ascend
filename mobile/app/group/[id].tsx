import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, ActivityIndicator, TextInput,
  Modal, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSocialStore } from '../../stores/socialStore';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';
import { useTheme } from '../../hooks/useTheme';
import type { GroupDetail, GroupMember, SocialPost, UserSearchResult } from '../../types';

type LoadError = { reason: 'not-found' | 'unavailable'; message?: string };

/**
 * Focus group detail — identity, description, members, and the group room.
 *
 *   ┌─ header ─────────────────────────────┐  back · emoji · name · members
 *   ├─ about ──────────────────────────────┤  description + member avatars
 *   ├─ room (inverted list) ───────────────┤  group posts, newest at bottom
 *   └─ composer ───────────────────────────┘  one-line send
 *
 * The room is the existing group-scoped post feed (SocialPost rows carrying a
 * groupId), not a separate messages table. Posts are held in LOCAL state rather
 * than the social store: `store.fetchPosts` writes the shared `posts` array that
 * the Social tab renders, so routing through it would wipe the tab's feed on
 * every visit here.
 */

const MAX_MESSAGE = 280;

function initialsAvatar(m: { avatarEmoji: string }) {
  return m.avatarEmoji;
}

// ─── Member row ──────────────────────────────────────────────────────────────

function MemberRow({ member, canRemove, onRemove }: {
  member: GroupMember;
  canRemove: boolean;
  onRemove: (m: GroupMember) => void;
}) {
  const Colors = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', paddingVertical: 11,
      borderBottomWidth: 0.5, borderBottomColor: Colors.BORDER_SOFT,
    }}>
      <View style={{
        width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.raised,
        alignItems: 'center', justifyContent: 'center', marginRight: 12,
      }}>
        <Text style={{ fontSize: 19 }}>{initialsAvatar(member)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600' }}>
          {member.username}
        </Text>
        <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 1 }}>
          Level {member.level}{member.isCreator ? ' · Creator' : ''}
        </Text>
      </View>
      {canRemove && !member.isCreator && (
        <Pressable
          onPress={() => onRemove(member)}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${member.username}`}
          hitSlop={8}
          style={{
            paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
            borderWidth: 1, borderColor: Colors.BORDER_SOFT,
          }}
        >
          <Text style={{ color: Colors.ROSE, fontSize: 12, fontWeight: '700' }}>Remove</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Members sheet ───────────────────────────────────────────────────────────
// One surface for both directions of membership: the current list (with remove)
// and a search box to add. Splitting them into two modals would have meant two
// ways to reach the same idea.

function MembersSheet({ visible, detail, onClose, onAdd, onRemove }: {
  visible: boolean;
  detail: GroupDetail;
  onClose: () => void;
  onAdd: (user: UserSearchResult) => Promise<void>;
  onRemove: (member: GroupMember) => void;
}) {
  const Colors = useTheme();
  const social = useSocialStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  // Debounced so a fast typist does not fire a request per keystroke.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      social.searchUsers(term)
        .then(setResults)
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const memberIds = new Set(detail.members.map((m) => m.id));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '85%', paddingBottom: 28,
        }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 20, paddingVertical: 12,
          }}>
            <Text style={{ flex: 1, color: Colors.textBright, fontSize: 17, fontWeight: '700' }}>
              Members · {detail.members.length}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={Colors.subtext} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}>
            {detail.isCreator && (
              <>
                <Text style={{
                  color: Colors.subtext, fontSize: 11, fontWeight: '700',
                  letterSpacing: 0.5, marginBottom: 8, marginTop: 4,
                }}>
                  ADD SOMEONE
                </Text>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.raised,
                  borderRadius: 12, paddingHorizontal: 12, marginBottom: 10,
                }}>
                  <Ionicons name="search" size={16} color={Colors.subtext} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search by username"
                    placeholderTextColor={Colors.subtext}
                    autoCapitalize="none"
                    style={{ flex: 1, color: Colors.textBright, paddingVertical: 11, paddingHorizontal: 8, fontSize: 14 }}
                  />
                  {searching && <ActivityIndicator size="small" color={Colors.primary} />}
                </View>

                {query.trim().length >= 2 && !searching && results.length === 0 && (
                  <Text style={{ color: Colors.subtext, fontSize: 12, marginBottom: 12 }}>
                    No one found for “{query.trim()}”.
                  </Text>
                )}

                {results.map((u) => {
                  const already = memberIds.has(u.id);
                  return (
                    <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9 }}>
                      <View style={{
                        width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.raised,
                        alignItems: 'center', justifyContent: 'center', marginRight: 11,
                      }}>
                        <Text style={{ fontSize: 17 }}>{u.avatarEmoji}</Text>
                      </View>
                      <Text style={{ flex: 1, color: Colors.textBright, fontSize: 14 }}>{u.username}</Text>
                      <Pressable
                        disabled={already || addingId === u.id}
                        onPress={async () => { setAddingId(u.id); await onAdd(u); setAddingId(null); }}
                        accessibilityRole="button"
                        accessibilityLabel={already ? `${u.username} is already a member` : `Add ${u.username}`}
                        style={{
                          paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16,
                          backgroundColor: already ? Colors.raised : Colors.primary,
                        }}
                      >
                        {addingId === u.id
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={{
                              color: already ? Colors.subtext : '#fff',
                              fontSize: 12, fontWeight: '700',
                            }}>{already ? 'Added' : 'Add'}</Text>}
                      </Pressable>
                    </View>
                  );
                })}

                <View style={{ height: 1, backgroundColor: Colors.BORDER_SOFT, marginVertical: 14 }} />
              </>
            )}

            <Text style={{
              color: Colors.subtext, fontSize: 11, fontWeight: '700',
              letterSpacing: 0.5, marginBottom: 4,
            }}>
              IN THIS GROUP
            </Text>
            {detail.members.map((m) => (
              <MemberRow key={m.id} member={m} canRemove={detail.isCreator} onRemove={onRemove} />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Message row ─────────────────────────────────────────────────────────────

function MessageRow({ post, isMine }: { post: SocialPost; isMine: boolean }) {
  const Colors = useTheme();
  const time = new Date(post.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // Session recaps and achievement posts land in group feeds too. They have no
  // caption, so rendering only `caption` would show an empty bubble.
  const body = post.caption?.trim()
    || (post.type === 'session_recap' && post.focusMinutes != null
      ? `Finished a ${post.focusMinutes}m focus session`
      : post.type === 'achievement_unlock' && post.achievementName
        ? `Unlocked ${post.achievementName}`
        : post.type === 'streak_milestone' && post.streakAtPost != null
          ? `Hit a ${post.streakAtPost}-day streak`
          : 'Shared an update');

  return (
    <View style={{ paddingHorizontal: 16, marginBottom: 10, alignItems: isMine ? 'flex-end' : 'flex-start' }}>
      {!isMine && (
        <Text style={{ color: Colors.subtext, fontSize: 11, marginBottom: 3, marginLeft: 6 }}>
          {post.authorEmoji} {post.authorName}
        </Text>
      )}
      <View style={{
        maxWidth: '80%',
        backgroundColor: isMine ? Colors.primary : Colors.surface,
        borderWidth: isMine ? 0 : 1, borderColor: Colors.BORDER_SOFT,
        borderRadius: 16,
        borderBottomRightRadius: isMine ? 4 : 16,
        borderBottomLeftRadius: isMine ? 16 : 4,
        paddingHorizontal: 13, paddingVertical: 9,
      }}>
        <Text style={{ color: isMine ? '#fff' : Colors.textBright, fontSize: 14, lineHeight: 19 }}>
          {body}
        </Text>
      </View>
      <Text style={{ color: Colors.subtext, fontSize: 10, marginTop: 3, marginHorizontal: 6 }}>{time}</Text>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function GroupDetailScreen() {
  const Colors = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const social = useSocialStore();
  const currentUserId = useAuthStore((s) => s.user?.id) ?? '';

  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const loadPosts = useCallback(async () => {
    if (!id) return;
    setPostsLoading(true);
    try {
      const res = await api.get<{ posts: SocialPost[]; cursor: string | null }>(
        `/social/posts?groupId=${encodeURIComponent(id)}`,
      );
      if (res.success && res.data) setPosts(res.data.posts ?? []);
    } finally {
      setPostsLoading(false);
    }
  }, [id]);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    const result = await social.fetchGroupDetail(id);
    if (result.ok) {
      setDetail(result.detail);
    } else {
      setLoadError({ reason: result.reason, message: result.message });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadDetail();
    loadPosts();
  }, [id]);

  const handleAdd = async (user: UserSearchResult) => {
    if (!id || !detail) return;
    const member = await social.addGroupMember(id, user.id);
    if (!member) {
      Alert.alert('Could not add', `${user.username} could not be added to this group.`);
      return;
    }
    setDetail({
      ...detail,
      members: [...detail.members, member],
      memberCount: detail.members.length + 1,
      memberIds: [...(detail.memberIds ?? []), member.id],
    });
    // The Social tab's chip strip shows member counts, so keep it honest.
    social.fetchStudyGroups();
  };

  const handleRemove = (member: GroupMember) => {
    if (!id || !detail) return;
    Alert.alert(
      `Remove ${member.username}?`,
      'They will lose access to this group and its room.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const ok = await social.removeGroupMember(id, member.id);
            if (!ok) {
              Alert.alert('Could not remove', 'Please try again.');
              return;
            }
            setDetail((d) => (d ? {
              ...d,
              members: d.members.filter((m) => m.id !== member.id),
              memberCount: Math.max(0, d.members.length - 1),
              memberIds: (d.memberIds ?? []).filter((x) => x !== member.id),
            } : d));
            social.fetchStudyGroups();
          },
        },
      ],
    );
  };

  const handleSend = async () => {
    const caption = draft.trim();
    if (!caption || !id || sending) return;
    setSending(true);
    try {
      const res = await api.post<SocialPost>('/social/posts', {
        type: 'free_post',
        caption,
        visibility: 'group',
        groupId: id,
      });
      if (res.success && res.data) {
        // Newest-first, matching the inverted list.
        setPosts((p) => [res.data as SocialPost, ...p]);
        setDraft('');
      } else {
        Alert.alert('Not sent', res.error ?? 'Your message could not be sent.');
      }
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (!detail) {
    // Two different failures used to share one sentence, and the wrong one was
    // shown when the backend simply had not shipped this route yet. Retry is
    // always offered because "unavailable" is usually transient.
    const unavailable = loadError?.reason !== 'not-found';
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <Ionicons
            name={unavailable ? 'cloud-offline-outline' : 'lock-closed-outline'}
            size={44}
            color={Colors.subtext}
          />
          <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 14 }}>
            {unavailable ? "Couldn't load this group" : 'This group is not available'}
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 18 }}>
            {loadError?.message
              || (unavailable
                ? 'Check your connection and try again.'
                : 'It may have been deleted, or it is private and you are not a member.')}
          </Text>
          <Pressable
            onPress={loadDetail}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={{
              marginTop: 20, backgroundColor: Colors.primary,
              borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isMember = detail.isMember !== false;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      {/* header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 10,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginRight: 10 }}
          accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={{ fontSize: 24, marginRight: 10 }}>{detail.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: Colors.textBright, fontSize: 17, fontWeight: '700' }}>
            {detail.name}
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 1 }}>
            {detail.members.length} member{detail.members.length !== 1 ? 's' : ''}
            {detail.isPrivate ? ' · Private' : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => setShowMembers(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Manage members"
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
            borderWidth: 1, borderColor: Colors.BORDER_SOFT,
          }}
        >
          <Ionicons name="people-outline" size={15} color={Colors.primarySoft} />
          <Text style={{ color: Colors.primarySoft, fontSize: 12, fontWeight: '700' }}>
            {detail.isCreator ? 'Manage' : 'Members'}
          </Text>
        </Pressable>
      </View>

      {/* about */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <Text style={{
          color: detail.description ? Colors.text : Colors.subtext,
          fontSize: 13, lineHeight: 18,
          fontStyle: detail.description ? 'normal' : 'italic',
        }}>
          {detail.description || 'No description yet.'}
        </Text>
      </View>
      <View style={{ height: 1, backgroundColor: Colors.BORDER_SOFT }} />

      {/* room */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {postsLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 32 }} />
        ) : posts.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
            <Ionicons name="chatbubbles-outline" size={44} color={Colors.subtext} />
            <Text style={{ color: Colors.text, fontSize: 14, textAlign: 'center', marginTop: 14 }}>
              Nothing here yet. Say the first thing.
            </Text>
          </View>
        ) : (
          <FlatList
            data={posts}
            inverted
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 12 }}
            renderItem={({ item }) => (
              <MessageRow post={item} isMine={item.authorId === currentUserId} />
            )}
          />
        )}

        {/* composer */}
        {isMember ? (
          <View style={{
            flexDirection: 'row', alignItems: 'flex-end', gap: 8,
            paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10,
            borderTopWidth: 1, borderTopColor: Colors.BORDER_SOFT,
            backgroundColor: Colors.bg,
          }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message the group"
              placeholderTextColor={Colors.subtext}
              multiline
              maxLength={MAX_MESSAGE}
              style={{
                flex: 1, color: Colors.textBright, fontSize: 14,
                backgroundColor: Colors.surface, borderRadius: 20,
                borderWidth: 1, borderColor: Colors.BORDER_SOFT,
                paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
                maxHeight: 110,
              }}
            />
            <Pressable
              onPress={handleSend}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={{
                width: 40, height: 40, borderRadius: 20,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: draft.trim() ? Colors.primary : Colors.raised,
              }}
            >
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="arrow-up" size={19} color={draft.trim() ? '#fff' : Colors.subtext} />}
            </Pressable>
          </View>
        ) : (
          <View style={{
            paddingHorizontal: 16, paddingVertical: 14,
            borderTopWidth: 1, borderTopColor: Colors.BORDER_SOFT,
          }}>
            <Text style={{ color: Colors.subtext, fontSize: 13, textAlign: 'center' }}>
              Join this group to post in it.
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>

      <MembersSheet
        visible={showMembers}
        detail={detail}
        onClose={() => setShowMembers(false)}
        onAdd={handleAdd}
        onRemove={handleRemove}
      />
    </SafeAreaView>
  );
}

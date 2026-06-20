import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSocialStore } from '../../stores/socialStore';
import { api } from '../../services/api';
import { useTheme } from '../../hooks/useTheme';
import type { PublicUserProfile, SocialPost } from '../../types';

function formatFocus(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  if (h < 1) return `${Math.floor(seconds / 60)}m`;
  return `${h}h`;
}

function StatBox({ label, value }: { label: string; value: string }) {
  const Colors = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 14 }}>
      <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

export default function UserProfileScreen() {
  const Colors = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const social = useSocialStore();
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    social.fetchUserProfile(id).then((p) => {
      setProfile(p);
      setLoading(false);
    });
    setPostsLoading(true);
    api.get<{ posts: SocialPost[]; cursor: string | null }>(`/social/posts?authorId=${id}`)
      .then((res) => { if (res.success && res.data) setPosts(res.data.posts); })
      .finally(() => setPostsLoading(false));
  }, [id]);

  const handleToggleFollow = async () => {
    if (!profile || profile.isMe) return;
    setFollowLoading(true);
    if (profile.isFollowing) {
      const ok = await social.unfollowUser(profile.id);
      if (ok) setProfile((p) => p ? { ...p, isFollowing: false, followerCount: p.followerCount - 1 } : p);
    } else {
      const ok = await social.followUser(profile.id);
      if (ok) setProfile((p) => p ? { ...p, isFollowing: true, followerCount: p.followerCount + 1 } : p);
    }
    setFollowLoading(false);
  };

  const handleToggleBlock = async () => {
    if (!profile || profile.isMe) return;
    const blocking = !profile.isBlocked;
    const run = async () => {
      setBlockLoading(true);
      const res = blocking
        ? await api.post(`/social/users/${profile.id}/block`, {})
        : await api.delete(`/social/users/${profile.id}/block`);
      if (res.success) {
        // Blocking also implicitly stops following so the relationship is clean.
        setProfile((p) => p ? { ...p, isBlocked: blocking, isFollowing: blocking ? false : p.isFollowing } : p);
      }
      setBlockLoading(false);
    };
    if (blocking) {
      Alert.alert(
        'Block User',
        `Block ${profile.username}? You won't see their posts and they won't see yours.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Block', style: 'destructive', onPress: run },
        ],
      );
    } else {
      run();
    }
  };

  const isGold = profile && (profile.rank === 'Champion' || profile.rank === 'Legend');
  const rankColor = isGold ? Colors.GOLD : Colors.primarySoft;

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }} edges={['top']}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
          <Pressable onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: Colors.subtext, fontSize: 14 }}>User not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={{ flex: 1, color: Colors.textBright, fontSize: 18, fontWeight: '700' }} numberOfLines={1}>
          {profile.username}
        </Text>
        {!profile.isMe && (
          <Pressable
            onPress={handleToggleBlock}
            disabled={blockLoading}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ marginLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 4 }}
            accessibilityLabel={profile.isBlocked ? 'Unblock user' : 'Block user'}
          >
            <Ionicons
              name={profile.isBlocked ? 'ban' : 'ban-outline'}
              size={18}
              color={profile.isBlocked ? Colors.error : Colors.subtext}
            />
            <Text style={{ color: profile.isBlocked ? Colors.error : Colors.subtext, fontSize: 13, fontWeight: '600' }}>
              {profile.isBlocked ? 'Unblock' : 'Block'}
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Avatar + follow */}
        <View style={{ alignItems: 'center', paddingTop: 20, paddingBottom: 24 }}>
          <View style={{
            width: 80, height: 80, borderRadius: 24, backgroundColor: Colors.raised,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: rankColor,
          }}>
            <Text style={{ fontSize: 42 }}>{profile.avatarEmoji}</Text>
          </View>
          <Text style={{ color: Colors.textBright, fontSize: 22, fontWeight: '800', marginTop: 12 }}>
            {profile.username}
          </Text>
          <View style={{
            marginTop: 6, backgroundColor: rankColor + '22', borderRadius: 8,
            paddingHorizontal: 10, paddingVertical: 3,
          }}>
            <Text style={{ color: rankColor, fontSize: 12, fontWeight: '700' }}>
              {profile.rank} · Lv {profile.level}
            </Text>
          </View>

          {!profile.isMe && (
            <Pressable
              onPress={handleToggleFollow}
              disabled={followLoading}
              style={{
                marginTop: 16, paddingHorizontal: 32, paddingVertical: 10,
                borderRadius: 24, borderWidth: 1,
                backgroundColor: profile.isFollowing ? Colors.raised : Colors.primary,
                borderColor: profile.isFollowing ? Colors.BORDER_SOFT : Colors.primary,
              }}
            >
              {followLoading
                ? <ActivityIndicator size="small" color={profile.isFollowing ? Colors.subtext : '#fff'} />
                : <Text style={{
                    color: profile.isFollowing ? Colors.subtext : '#fff',
                    fontWeight: '700', fontSize: 14,
                  }}>
                    {profile.isFollowing ? 'Following' : 'Follow'}
                  </Text>
              }
            </Pressable>
          )}

          {/* Follower/following counts */}
          <View style={{ flexDirection: 'row', marginTop: 16, gap: 24 }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '800' }}>{profile.followerCount}</Text>
              <Text style={{ color: Colors.subtext, fontSize: 12 }}>Followers</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '800' }}>{profile.followingCount}</Text>
              <Text style={{ color: Colors.subtext, fontSize: 12 }}>Following</Text>
            </View>
          </View>
        </View>

        {/* Stats grid */}
        <View style={{
          backgroundColor: Colors.surface, marginHorizontal: 16, borderRadius: 16,
          borderWidth: 1, borderColor: Colors.BORDER_SOFT, marginBottom: 16,
        }}>
          <View style={{ flexDirection: 'row' }}>
            <StatBox label="Streak" value={`${profile.currentStreak}d`} />
            <View style={{ width: 1, backgroundColor: Colors.BORDER_SOFT}} />
            <StatBox label="Best Streak" value={`${profile.longestStreak}d`} />
            <View style={{ width: 1, backgroundColor: Colors.BORDER_SOFT}} />
            <StatBox label="Sessions" value={String(profile.totalSessions)} />
          </View>
          <View style={{ height: 1, backgroundColor: Colors.BORDER_SOFT}} />
          <View style={{ flexDirection: 'row' }}>
            <StatBox label="Total Focus" value={formatFocus(profile.totalFocusTime)} />
            <View style={{ width: 1, backgroundColor: Colors.BORDER_SOFT}} />
            <StatBox label="Level" value={String(profile.level)} />
            <View style={{ width: 1, backgroundColor: Colors.BORDER_SOFT}} />
            <StatBox label="Rank" value={profile.rank} />
          </View>
        </View>

        {/* Recent achievements */}
        {profile.recentAchievements.length > 0 && (
          <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
            <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '700', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Recent Achievements
            </Text>
            {profile.recentAchievements.map((a) => (
              <View key={a.id} style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1,
                borderColor: Colors.BORDER_SOFT, padding: 12, marginBottom: 8,
              }}>
                <Text style={{ fontSize: 28, marginRight: 12 }}>{a.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: Colors.textBright, fontWeight: '600', fontSize: 14 }}>{a.title}</Text>
                  <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{a.description}</Text>
                </View>
                <Text style={{ color: Colors.primarySoft, fontSize: 12, fontWeight: '700' }}>+{a.xpReward} XP</Text>
              </View>
            ))}
          </View>
        )}

        {/* Posts */}
        <View style={{ marginHorizontal: 16 }}>
          <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '700', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Posts
          </Text>
          {postsLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 20 }} />
          ) : posts.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <Text style={{ color: Colors.subtext, fontSize: 13 }}>No posts yet</Text>
            </View>
          ) : (
            posts.map((post) => (
              <View key={post.id} style={{
                backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1,
                borderColor: Colors.BORDER_SOFT, padding: 14, marginBottom: 10,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <View style={{
                    width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.raised,
                    alignItems: 'center', justifyContent: 'center', marginRight: 10,
                  }}>
                    <Text style={{ fontSize: 18 }}>{profile.avatarEmoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.textBright, fontWeight: '600', fontSize: 13 }}>{profile.username}</Text>
                    <Text style={{ color: Colors.subtext, fontSize: 11 }}>
                      {new Date(post.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
                {!!post.caption && (
                  <Text style={{ color: Colors.text, fontSize: 14, lineHeight: 20 }}>{post.caption}</Text>
                )}
                {(post.sessionCount != null || post.focusMinutes != null) && (
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                    {post.sessionCount != null && (
                      <Text style={{ color: Colors.subtext, fontSize: 12 }}>📚 {post.sessionCount} sessions</Text>
                    )}
                    {post.focusMinutes != null && (
                      <Text style={{ color: Colors.subtext, fontSize: 12 }}>⏱ {post.focusMinutes}m focus</Text>
                    )}
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

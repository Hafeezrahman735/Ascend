import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, TextInput, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSocialStore } from '../../stores/socialStore';
import { useTheme } from '../../hooks/useTheme';
import type { GroupDetail, GroupMember, UserSearchResult } from '../../types';

type LoadError = { reason: 'not-found' | 'unavailable'; message?: string };

/**
 * Focus group detail — who and what the group is, and nothing else.
 *
 *   ┌─ identity ───────────────────────┐  icon · title · private · member count
 *   ├─ description ────────────────────┤
 *   ├─ posts link ─────────────────────┤  jumps to the Circle tab, filtered here
 *   ├─ members ────────────────────────┤  inline list, remove for the creator
 *   ├─ add someone ────────────────────┤  creator only, search by username
 *   └─ leave ──────────────────────────┘  members only; the creator cannot
 *
 * This screen used to carry a message room as well. It was removed: the room
 * rendered the same group-scoped posts the Circle tab already shows, so the
 * same content lived in two places with two different composers. Posting now
 * happens in one place, and the Circle tab's group filter is the one way to
 * read a group's posts.
 */

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
        <Text style={{ fontSize: 19 }}>{member.avatarEmoji}</Text>
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

// ─── Add-member search ───────────────────────────────────────────────────────

function AddMemberSearch({ memberIds, onAdd }: {
  memberIds: Set<string>;
  onAdd: (user: UserSearchResult) => Promise<void>;
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
      social.searchUsers(term).then(setResults).finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <>
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
        <Text style={{ color: Colors.subtext, fontSize: 12, marginBottom: 8 }}>
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
                    color: already ? Colors.subtext : '#fff', fontSize: 12, fontWeight: '700',
                  }}>{already ? 'Added' : 'Add'}</Text>}
            </Pressable>
          </View>
        );
      })}
    </>
  );
}

// ─── Section heading ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  const Colors = useTheme();
  return (
    <Text style={{
      color: Colors.subtext, fontSize: 11, fontWeight: '700',
      letterSpacing: 0.5, marginBottom: 8, marginTop: 22,
    }}>
      {children}
    </Text>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function GroupDetailScreen() {
  const Colors = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const social = useSocialStore();

  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    const result = await social.fetchGroupDetail(id);
    if (result.ok) setDetail(result.detail);
    else setLoadError({ reason: result.reason, message: result.message });
    setLoading(false);
  }, [id]);

  useEffect(() => { loadDetail(); }, [id]);

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
    // The Circle tab's chip strip shows member counts, so keep it honest.
    social.fetchStudyGroups();
  };

  const handleRemove = (member: GroupMember) => {
    if (!id || !detail) return;
    Alert.alert(
      `Remove ${member.username}?`,
      'They will lose access to this group and its posts.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const ok = await social.removeGroupMember(id, member.id);
            if (!ok) { Alert.alert('Could not remove', 'Please try again.'); return; }
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

  const handleLeave = () => {
    if (!id || !detail) return;
    Alert.alert(
      `Leave ${detail.name}?`,
      'You will stop seeing its posts. You can rejoin if it is public.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            const ok = await social.leaveGroup(id);
            setLeaving(false);
            if (!ok) { Alert.alert('Could not leave', 'Please try again.'); return; }
            router.back();
          },
        },
      ],
    );
  };

  const openGroupPosts = () => {
    if (!id) return;
    social.setSelectedGroup(id);
    social.fetchPosts(id);
    router.push('/(tabs)/social');
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (!detail) {
    // "unavailable" (offline, timeout, 5xx, a route the deployed backend does
    // not have) is worth retrying; a real 404 is not the same thing and must not
    // borrow its wording.
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
  const memberIds = new Set(detail.members.map((m) => m.id));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginRight: 10 }}
          accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={{ flex: 1, color: Colors.textBright, fontSize: 17, fontWeight: '700' }}>
          Group details
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}>
        {/* identity */}
        <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
          <View style={{
            width: 76, height: 76, borderRadius: 24, backgroundColor: Colors.raised,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1.5, borderColor: Colors.BORDER_SOFT,
          }}>
            <Text style={{ fontSize: 40 }}>{detail.emoji}</Text>
          </View>
          <Text style={{
            color: Colors.textBright, fontSize: 22, fontWeight: '800',
            marginTop: 14, textAlign: 'center',
          }}>
            {detail.name}
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 4 }}>
            {detail.members.length} member{detail.members.length !== 1 ? 's' : ''}
            {detail.isPrivate ? ' · Private' : ' · Public'}
          </Text>
        </View>

        {/* description */}
        <SectionLabel>ABOUT</SectionLabel>
        <Text style={{
          color: detail.description ? Colors.text : Colors.subtext,
          fontSize: 14, lineHeight: 20,
          fontStyle: detail.description ? 'normal' : 'italic',
        }}>
          {detail.description || 'No description yet.'}
        </Text>

        {/* posts live on the Circle tab now, so point at them rather than
            duplicating the feed here */}
        {isMember && (
          <Pressable
            onPress={openGroupPosts}
            accessibilityRole="button"
            accessibilityLabel={`See posts in ${detail.name}`}
            style={{
              flexDirection: 'row', alignItems: 'center', marginTop: 18,
              backgroundColor: Colors.surface, borderRadius: 14,
              borderWidth: 1, borderColor: Colors.BORDER_SOFT,
              paddingHorizontal: 14, paddingVertical: 13,
            }}
          >
            <Ionicons name="chatbubbles-outline" size={18} color={Colors.primarySoft} />
            <Text style={{ flex: 1, color: Colors.textBright, fontSize: 14, fontWeight: '600', marginLeft: 10 }}>
              See posts in this group
            </Text>
            <Ionicons name="chevron-forward" size={17} color={Colors.subtext} />
          </Pressable>
        )}

        {/* members */}
        <SectionLabel>{`MEMBERS · ${detail.members.length}`}</SectionLabel>
        {detail.members.map((m) => (
          <MemberRow key={m.id} member={m} canRemove={detail.isCreator} onRemove={handleRemove} />
        ))}

        {detail.isCreator && (
          <>
            <SectionLabel>ADD SOMEONE</SectionLabel>
            <AddMemberSearch memberIds={memberIds} onAdd={handleAdd} />
          </>
        )}

        {/* The creator cannot leave: they are the only account that can manage
            members, so leaving would strand the group. The server enforces it. */}
        {isMember && !detail.isCreator && (
          <Pressable
            onPress={handleLeave}
            disabled={leaving}
            accessibilityRole="button"
            accessibilityLabel={`Leave ${detail.name}`}
            style={{
              marginTop: 28, borderRadius: 14, paddingVertical: 13, alignItems: 'center',
              borderWidth: 1, borderColor: Colors.BORDER_SOFT,
            }}
          >
            {leaving
              ? <ActivityIndicator size="small" color={Colors.ROSE} />
              : <Text style={{ color: Colors.ROSE, fontSize: 14, fontWeight: '700' }}>Leave group</Text>}
          </Pressable>
        )}

        {!isMember && (
          <Text style={{ color: Colors.subtext, fontSize: 13, textAlign: 'center', marginTop: 28 }}>
            You are not a member of this group.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

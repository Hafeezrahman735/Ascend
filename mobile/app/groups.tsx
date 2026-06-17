import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, ActivityIndicator,
  TextInput, Modal, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSocialStore } from '../stores/socialStore';
import { useTheme } from '../hooks/useTheme';
import type { StudyGroup } from '../types';

const EMOJI_OPTIONS = ['📚','🧠','💡','🔥','⚡','🎯','🏆','🌙','🚀','🎓','✏️','🧮'];

function GroupCard({ group, onJoin, onLeave }: {
  group: StudyGroup;
  onJoin: (id: string) => void;
  onLeave: (id: string) => void;
}) {
  const Colors = useTheme();
  const [loading, setLoading] = useState(false);
  const GROUP_BG: Record<string, string> = {
    purple: Colors.primaryDim, teal: Colors.tealDim, amber: Colors.AMBER_DIM, rose: Colors.ROSE_DIM,
  };
  const GROUP_BORDER: Record<string, string> = {
    purple: Colors.primary, teal: Colors.accent, amber: Colors.AMBER, rose: Colors.ROSE,
  };
  const border = GROUP_BORDER[group.color] ?? Colors.primary;
  const bg = GROUP_BG[group.color] ?? Colors.surface;

  const handleToggle = async () => {
    setLoading(true);
    if (group.isMember) {
      await onLeave(group.id);
    } else {
      await onJoin(group.id);
    }
    setLoading(false);
  };

  return (
    <View style={{
      backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.BORDER_SOFT,
      marginHorizontal: 16, marginBottom: 10, padding: 14,
      flexDirection: 'row', alignItems: 'center',
    }}>
      <View style={{
        width: 48, height: 48, borderRadius: 14, backgroundColor: bg,
        borderWidth: 1.5, borderColor: border,
        alignItems: 'center', justifyContent: 'center', marginRight: 14,
      }}>
        <Text style={{ fontSize: 26 }}>{group.emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: Colors.textBright, fontWeight: '700', fontSize: 15 }}>{group.name}</Text>
        <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 2 }}>
          {group.memberCount ?? group.memberIds.length} member{(group.memberCount ?? group.memberIds.length) !== 1 ? 's' : ''}
          {group.isPrivate ? ' · Private' : ''}
        </Text>
      </View>
      <Pressable
        onPress={handleToggle}
        disabled={loading}
        style={{
          paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
          backgroundColor: group.isMember ? Colors.raised : Colors.primary,
          borderWidth: 1, borderColor: group.isMember ? Colors.BORDER_SOFT : Colors.primary,
        }}
      >
        {loading
          ? <ActivityIndicator size="small" color={group.isMember ? Colors.subtext : '#fff'} />
          : <Text style={{
              color: group.isMember ? Colors.subtext : '#fff',
              fontWeight: '700', fontSize: 13,
            }}>
              {group.isMember ? 'Leave' : 'Join'}
            </Text>
        }
      </Pressable>
    </View>
  );
}

function CreateGroupModal({ visible, onClose, onCreate }: {
  visible: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; emoji: string; color: string; isPrivate: boolean }) => Promise<void>;
}) {
  const Colors = useTheme();
  const COLOR_OPTIONS = [
    { key: 'purple', color: Colors.primary },
    { key: 'teal', color: Colors.accent },
    { key: 'amber', color: Colors.AMBER },
    { key: 'rose', color: Colors.ROSE },
  ] as const;
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📚');
  const [color, setColor] = useState<'purple' | 'teal' | 'amber' | 'rose'>('purple');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => { setName(''); setEmoji('📚'); setColor('purple'); setIsPrivate(false); };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await onCreate({ name: name.trim(), emoji, color, isPrivate });
    setLoading(false);
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 }}>
            <Text style={{ flex: 1, color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>Create Group</Text>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={22} color={Colors.subtext} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
            <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>Group Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. CS Study Squad"
              placeholderTextColor={Colors.subtext}
              maxLength={50}
              style={{
                backgroundColor: Colors.raised, borderRadius: 12, borderWidth: 1,
                borderColor: Colors.BORDER_SOFT, padding: 12, color: Colors.textBright,
                fontSize: 15, marginBottom: 20,
              }}
            />

            <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>Emoji</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 }}>
              {EMOJI_OPTIONS.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => setEmoji(e)}
                  style={{
                    width: 44, height: 44, borderRadius: 12, marginRight: 8, marginBottom: 8,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: emoji === e ? Colors.primaryDim : Colors.raised,
                    borderWidth: 1.5, borderColor: emoji === e ? Colors.primary : Colors.BORDER_SOFT,
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>Color</Text>
            <View style={{ flexDirection: 'row', marginBottom: 20 }}>
              {COLOR_OPTIONS.map(({ key, color: c }) => (
                <Pressable
                  key={key}
                  onPress={() => setColor(key)}
                  style={{
                    width: 36, height: 36, borderRadius: 10, marginRight: 10,
                    backgroundColor: c, alignItems: 'center', justifyContent: 'center',
                    borderWidth: color === key ? 3 : 0, borderColor: '#fff',
                  }}
                />
              ))}
            </View>

            <Pressable
              onPress={() => setIsPrivate((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}
            >
              <View style={{
                width: 40, height: 22, borderRadius: 11,
                backgroundColor: isPrivate ? Colors.primary : Colors.inactive,
                justifyContent: 'center', paddingHorizontal: 2,
              }}>
                <View style={{
                  width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff',
                  alignSelf: isPrivate ? 'flex-end' : 'flex-start',
                }} />
              </View>
              <Text style={{ color: Colors.text, fontSize: 14, marginLeft: 12 }}>Private group</Text>
            </Pressable>

            <Pressable
              onPress={handleCreate}
              disabled={!name.trim() || loading}
              style={{
                backgroundColor: name.trim() ? Colors.primary : Colors.inactive,
                borderRadius: 14, paddingVertical: 14, alignItems: 'center',
              }}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Create Group</Text>
              }
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function GroupsScreen() {
  const Colors = useTheme();
  const router = useRouter();
  const social = useSocialStore();
  const [allGroups, setAllGroups] = useState<StudyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    const groups = await social.fetchAllGroups();
    const myGroupIds = new Set(social.studyGroups.map((g) => g.id));
    setAllGroups(groups.map((g) => ({ ...g, isMember: myGroupIds.has(g.id) })));
    setLoading(false);
  }, [social.studyGroups]);

  useEffect(() => {
    loadGroups();
  }, []);

  const handleJoin = useCallback(async (groupId: string) => {
    const ok = await social.joinGroup(groupId);
    if (ok) {
      setAllGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, isMember: true, memberCount: (g.memberCount ?? g.memberIds.length) + 1 } : g));
    }
  }, []);

  const handleLeave = useCallback(async (groupId: string) => {
    const ok = await social.leaveGroup(groupId);
    if (ok) {
      setAllGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, isMember: false, memberCount: Math.max(0, (g.memberCount ?? g.memberIds.length) - 1) } : g));
    }
  }, []);

  const handleCreate = useCallback(async (data: { name: string; emoji: string; color: string; isPrivate: boolean }) => {
    const group = await social.createGroup(data);
    if (group) {
      setAllGroups((prev) => [{ ...group, isMember: true }, ...prev]);
    } else {
      Alert.alert('Error', 'Failed to create group. Please try again.');
    }
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={{ flex: 1, color: Colors.textBright, fontSize: 22, fontWeight: '800' }}>Study Groups</Text>
        <Pressable
          onPress={() => setShowCreate(true)}
          style={{ backgroundColor: Colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>+ Create</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : allGroups.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 48 }}>📚</Text>
          <Text style={{ color: Colors.text, fontSize: 16, fontWeight: '600', marginTop: 16, textAlign: 'center' }}>
            No groups yet
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 13, marginTop: 8, textAlign: 'center' }}>
            Create a group to study with others
          </Text>
          <Pressable
            onPress={() => setShowCreate(true)}
            style={{
              marginTop: 20, backgroundColor: Colors.primary,
              borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Create Group</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={allGroups}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <GroupCard group={item} onJoin={handleJoin} onLeave={handleLeave} />
          )}
        />
      )}

      <CreateGroupModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
      />
    </SafeAreaView>
  );
}

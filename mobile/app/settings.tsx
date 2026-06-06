import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Switch, Alert, ActivityIndicator,
  ScrollView, TextInput, Modal, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import { useAuthStore } from '../stores/authStore';
import { api } from '../services/api';
import { useGamificationStore } from '../stores/gamificationStore';
import { useUserProfileStore } from '../stores/userProfileStore';
import { useUserSettingsStore } from '../stores/userSettingsStore';
import { getRank, RANK_META } from '../lib/rank';

const AVATAR_EMOJIS = [
  '🦊', '🐸', '🦁', '🐳', '🦉', '🐰',
  '🦋', '🐙', '🦚', '🐻', '🦝', '🐵',
  '🐼', '🦄', '🐧', '🦭', '🐯', '🦦',
  '🐨', '🦩', '🐝', '🐲', '🦕', '🐬',
];

function Divider() {
  return <View style={{ height: 0.5, backgroundColor: Colors.border }} />;
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Text style={{
      color: Colors.subtext, fontSize: 11, fontWeight: '600',
      letterSpacing: 1.2, textTransform: 'uppercase',
      marginBottom: 8, marginTop: 4, paddingHorizontal: 4,
    }}>
      {title}
    </Text>
  );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: Colors.surface, borderRadius: 16,
      borderWidth: 1, borderColor: Colors.border,
      paddingHorizontal: 16, marginBottom: 20, overflow: 'hidden',
    }}>
      {children}
    </View>
  );
}

function SettingsRow({
  label, value, subtitle, onPress, rightComponent,
}: {
  label: string;
  value?: string;
  subtitle?: string;
  onPress?: () => void;
  rightComponent?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress && !rightComponent}
      activeOpacity={onPress ? 0.6 : 1}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}
    >
      <View style={{ flex: 1, marginRight: 10 }}>
        <Text style={{ color: Colors.textBright, fontSize: 15 }}>{label}</Text>
        {subtitle ? (
          <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 2, lineHeight: 16 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightComponent ?? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {value ? (
            <Text style={{ color: Colors.subtext, fontSize: 14 }}>{value}</Text>
          ) : null}
          {onPress ? (
            <Ionicons name="chevron-forward" size={16} color={Colors.subtext} />
          ) : null}
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const logout = useAuthStore((s) => s.logout);
  const xp = useGamificationStore((s) => s.xp);
  const level = useGamificationStore((s) => s.level);
  const rank = getRank(xp);

  const profile = useUserProfileStore();
  const settings = useUserSettingsStore();

  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [editDisplayName, setEditDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');

  useEffect(() => {
    if (user) {
      profile.load(user.id, user.username);
      settings.load(user.id);
    }
  }, [user?.id]);

  function handleLogout() {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: () => logout() },
      ],
    );
  }

  async function handleDeleteAccount() {
    if (deleteText !== 'DELETE') return;
    setShowDeleteConfirm(false);
    try {
      await api.delete('/auth/account');
    } catch {
      // proceed to logout even if the request fails
    }
    logout();
  }

  async function saveDisplayName() {
    if (!user || !displayNameDraft.trim()) return;
    await profile.save(user.id, { displayName: displayNameDraft.trim() });
    setEditDisplayName(false);
  }

  const displayName = profile.displayName || user?.username || '';
  const handle = profile.handle || user?.username || '';
  const avatarEmoji = profile.avatarEmoji || '🦊';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingVertical: 14,
      }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 14 }}>
          <Ionicons name="arrow-back" size={24} color={Colors.textBright} />
        </TouchableOpacity>
        <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '700' }}>Settings</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Snapshot */}
        <View style={{
          backgroundColor: Colors.surface, borderRadius: 20,
          borderWidth: 1, borderColor: Colors.border,
          padding: 20, marginBottom: 28,
          flexDirection: 'row', alignItems: 'center', gap: 16,
          overflow: 'hidden',
        }}>
          <View style={{
            position: 'absolute', top: -20, right: -20,
            width: 100, height: 100, borderRadius: 50,
            backgroundColor: '#7B6EF612',
          }} />

          <TouchableOpacity
            onPress={() => setShowAvatarPicker(true)}
            style={{
              width: 64, height: 64, borderRadius: 20,
              backgroundColor: Colors.raised,
              borderWidth: 2, borderColor: Colors.border,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 34 }}>{avatarEmoji}</Text>
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>
              {displayName}
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 13, marginTop: 2 }}>
              @{handle} · Lv. {level}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 }}>
              <Text style={{ fontSize: 13 }}>{RANK_META[rank].icon}</Text>
              <Text style={{ color: Colors.text, fontSize: 12, fontWeight: '600' }}>{rank}</Text>
            </View>
          </View>
        </View>

        {/* Account */}
        <SectionTitle title="Account" />
        <SettingsCard>
          {editDisplayName ? (
            <View style={{ paddingVertical: 14 }}>
              <Text style={{ color: Colors.subtext, fontSize: 12, marginBottom: 8 }}>Display Name</Text>
              <TextInput
                style={{
                  backgroundColor: Colors.raised, borderWidth: 1, borderColor: Colors.primary,
                  borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
                  color: Colors.textBright, fontSize: 15, marginBottom: 10,
                }}
                value={displayNameDraft}
                onChangeText={setDisplayNameDraft}
                autoFocus
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={saveDisplayName}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setEditDisplayName(false)}
                  style={{
                    flex: 1, paddingVertical: 10, borderRadius: 10,
                    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
                  }}
                >
                  <Text style={{ color: Colors.subtext }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={saveDisplayName}
                  style={{
                    flex: 1, paddingVertical: 10, borderRadius: 10,
                    backgroundColor: Colors.primary, alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <SettingsRow
              label="Display Name"
              value={displayName}
              onPress={() => {
                setDisplayNameDraft(displayName);
                setEditDisplayName(true);
              }}
            />
          )}
          <Divider />
          <SettingsRow label="Handle" value={`@${handle}`} />
          <Divider />
          <SettingsRow label="Email" value={user?.email} />
          <Divider />
          <SettingsRow
            label="Avatar"
            value={avatarEmoji}
            onPress={() => setShowAvatarPicker(true)}
          />
        </SettingsCard>

        {/* Social & Privacy */}
        <SectionTitle title="Social & Privacy" />
        <SettingsCard>
          <SettingsRow
            label="Public Profile"
            subtitle="Anyone can see your stats"
            rightComponent={
              <Switch
                value={settings.publicProfile}
                onValueChange={(v) => user && settings.update(user.id, { publicProfile: v })}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
          <Divider />
          <SettingsRow
            label="Show on Leaderboard"
            rightComponent={
              <Switch
                value={settings.showOnLeaderboard}
                onValueChange={(v) => user && settings.update(user.id, { showOnLeaderboard: v })}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
          <Divider />
          <SettingsRow
            label="Share Focus Stats"
            rightComponent={
              <Switch
                value={settings.shareFocusStats}
                onValueChange={(v) => user && settings.update(user.id, { shareFocusStats: v })}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
          <Divider />
          <SettingsRow
            label="Friends Can See Activity"
            rightComponent={
              <Switch
                value={settings.friendsCanSeeActivity}
                onValueChange={(v) => user && settings.update(user.id, { friendsCanSeeActivity: v })}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
        </SettingsCard>

        {/* Notifications */}
        <SectionTitle title="Notifications" />
        <SettingsCard>
          <SettingsRow
            label="Session Complete"
            rightComponent={
              <Switch
                value={settings.notifySessionComplete}
                onValueChange={(v) => user && settings.update(user.id, { notifySessionComplete: v })}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
          <Divider />
          <SettingsRow
            label="Daily Reminder"
            rightComponent={
              <Switch
                value={settings.notifyDailyReminder}
                onValueChange={(v) => user && settings.update(user.id, { notifyDailyReminder: v })}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
          <Divider />
          <SettingsRow
            label="Friend Activity"
            rightComponent={
              <Switch
                value={settings.notifyFriendActivity}
                onValueChange={(v) => user && settings.update(user.id, { notifyFriendActivity: v })}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
          <Divider />
          <SettingsRow
            label="Achievement Alerts"
            rightComponent={
              <Switch
                value={settings.notifyAchievements}
                onValueChange={(v) => user && settings.update(user.id, { notifyAchievements: v })}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
        </SettingsCard>

        {/* App */}
        <SectionTitle title="App" />
        <SettingsCard>
          <SettingsRow label="Version" value="1.0.0" />
        </SettingsCard>

        {/* Account Actions */}
        <SectionTitle title="Account Actions" />
        <SettingsCard>
          <TouchableOpacity
            onPress={handleLogout}
            disabled={isLoading}
            style={{ paddingVertical: 15, alignItems: 'center' }}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Text style={{ color: '#ef4444', fontWeight: '600', fontSize: 15 }}>Log Out</Text>
            )}
          </TouchableOpacity>
          <Divider />
          <TouchableOpacity
            onPress={() => { setDeleteText(''); setShowDeleteConfirm(true); }}
            style={{ paddingVertical: 15, alignItems: 'center' }}
          >
            <Text style={{ color: '#ef4444', fontSize: 14, opacity: 0.65 }}>Delete Account</Text>
          </TouchableOpacity>
        </SettingsCard>
      </ScrollView>

      {/* Avatar Picker Modal */}
      <Modal
        visible={showAvatarPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAvatarPicker(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: Colors.surface,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: 24, paddingBottom: 48,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ flex: 1, color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>
                Choose Avatar
              </Text>
              <Pressable onPress={() => setShowAvatarPicker(false)}>
                <Ionicons name="close" size={22} color={Colors.subtext} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
              {AVATAR_EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={async () => {
                    if (user) await profile.save(user.id, { avatarEmoji: emoji });
                    setShowAvatarPicker(false);
                  }}
                  style={{
                    width: 56, height: 56, borderRadius: 14,
                    backgroundColor: avatarEmoji === emoji ? Colors.primaryDim : Colors.raised,
                    borderWidth: 2,
                    borderColor: avatarEmoji === emoji ? Colors.primary : Colors.border,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 28 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Account Modal */}
      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConfirm(false)}
      >
        <View style={{
          flex: 1, backgroundColor: '#00000090',
          justifyContent: 'center', paddingHorizontal: 28,
        }}>
          <View style={{
            backgroundColor: Colors.surface, borderRadius: 20, padding: 24,
            borderWidth: 1, borderColor: '#ef444433',
          }}>
            <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700', marginBottom: 10 }}>
              Delete Account
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 14, marginBottom: 20, lineHeight: 20 }}>
              This is permanent. All your data, sessions, and progress will be erased. Type DELETE to confirm.
            </Text>
            <TextInput
              style={{
                backgroundColor: Colors.raised, borderWidth: 1,
                borderColor: deleteText === 'DELETE' ? '#ef4444' : Colors.border,
                borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
                color: Colors.textBright, fontSize: 15, marginBottom: 16,
              }}
              placeholder="Type DELETE"
              placeholderTextColor={Colors.subtext}
              value={deleteText}
              onChangeText={setDeleteText}
              autoCapitalize="characters"
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowDeleteConfirm(false)}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 12,
                  borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
                }}
              >
                <Text style={{ color: Colors.textBright }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDeleteAccount}
                disabled={deleteText !== 'DELETE'}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 12,
                  backgroundColor: deleteText === 'DELETE' ? '#ef4444' : Colors.inactive,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

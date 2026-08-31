import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Switch, Alert, ActivityIndicator,
  ScrollView, TextInput, Modal, Pressable, Linking, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { useAuthStore } from '../stores/authStore';
import { api } from '../services/api';
import { useGamificationStore } from '../stores/gamificationStore';
import { useUserProfileStore } from '../stores/userProfileStore';
import { useUserSettingsStore } from '../stores/userSettingsStore';
import { getRank, RANK_META } from '../lib/rank';
import { useCalendarStore } from '../stores/calendarStore';
import { useTimerStore } from '../stores/timerStore';
import FocusModeSheet from '../components/FocusModeSheet';
import {
  requestCalendarPermission,
  listDeviceCalendars,
  getSelectedCalendarId,
  setSelectedCalendarId,
  type DeviceCalendar,
} from '../services/appleCalendar';

// TODO: replace with your real published values before App Store submission.
const SUPPORT_EMAIL = 'hafeezrahman735@gmail.com'
const PRIVACY_POLICY_URL = 'https://striped-anger-f6d.notion.site/38554567a17b800099fae40ddaf740b9?source=copy_link'

const AVATAR_EMOJIS = [
  '🦊', '🐸', '🦁', '🐳', '🦉', '🐰',
  '🦋', '🐙', '🦚', '🐻', '🦝', '🐵',
  '🐼', '🦄', '🐧', '🦭', '🐯', '🦦',
  '🐨', '🦩', '🐝', '🐲', '🦕', '🐬',
];

function formatReminderTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

function Divider() {
  const Colors = useTheme();
  return <View style={{ height: 0.5, backgroundColor: Colors.border }} />;
}

/**
 * How many focus sessions the user wants to complete each day.
 *
 * Drives the "Sessions to go" and "Focus today" pills on the Tasks tab. Also
 * changeable by tapping either of those pills — this is the second entry point,
 * since a target you can only reach from one screen is easy to never find.
 *
 * NOTE: this value lives in timerStore and is persisted to AsyncStorage only, so
 * unlike every other preference here it does NOT sync across devices and resets
 * on reinstall. Moving it to the server is a follow-up.
 */
function DailySessionTargetRow() {
  const Colors = useTheme();
  const target = useTimerStore((s) => s.settings.dailySessionTarget);
  const setTarget = useTimerStore((s) => s.setDailySessionTarget);
  const sessionMinutes = useTimerStore((s) => Math.round(s.settings.workDuration / 60));

  const focusHours = Math.round((target * sessionMinutes) / 6) / 10;

  return (
    <SettingsRow
      label="Daily session goal"
      subtitle={`${target} sessions ≈ ${focusHours}h of focus per day`}
      rightComponent={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity
            onPress={() => setTarget(target - 1)}
            disabled={target <= 1}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Decrease daily session goal"
            style={{ opacity: target <= 1 ? 0.3 : 1 }}
          >
            <Ionicons name="remove-circle-outline" size={24} color={Colors.primarySoft} />
          </TouchableOpacity>
          <Text style={{ color: Colors.textBright, fontSize: 17, fontWeight: '700', minWidth: 24, textAlign: 'center' }}>
            {target}
          </Text>
          <TouchableOpacity
            onPress={() => setTarget(target + 1)}
            disabled={target >= 50}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Increase daily session goal"
            style={{ opacity: target >= 50 ? 0.3 : 1 }}
          >
            <Ionicons name="add-circle-outline" size={24} color={Colors.primarySoft} />
          </TouchableOpacity>
        </View>
      }
    />
  );
}

/**
 * Google and Apple calendar connections.
 *
 * The two are deliberately asymmetric: Google is a server-side OAuth connection
 * (tokens live in the backend), while Apple is device-native — its permission and
 * chosen calendar never leave the phone, so there is no server call for it here.
 */
function CalendarSyncRows() {
  const Colors = useTheme();
  const user = useAuthStore((s) => s.user);
  const { googleStatus, fetchGoogleStatus } = useCalendarStore();
  const [appleCalendars, setAppleCalendars] = useState<DeviceCalendar[]>([]);
  const [appleSelected, setAppleSelected] = useState<string | null>(null);
  const [showApplePicker, setShowApplePicker] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchGoogleStatus();
    if (user) getSelectedCalendarId(user.id).then(setAppleSelected);
  }, [user?.id]);

  const connectGoogle = async () => {
    setBusy(true);
    try {
      const res = await api.get<{ url: string }>('/calendar/google/auth-url');
      if (res.success && res.data?.url) {
        await Linking.openURL(res.data.url);
      } else {
        Alert.alert('Google Calendar', res.error ?? 'Could not start the connection.');
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnectGoogle = () => {
    Alert.alert('Disconnect Google Calendar?', 'Your Google events will stop appearing in the calendar.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await api.delete('/calendar/google');
          fetchGoogleStatus();
        },
      },
    ]);
  };

  const connectApple = async () => {
    if (!user) return;
    const permission = await requestCalendarPermission();
    if (!permission.granted) {
      // Two failures, opposite advice. Sending someone to Settings when the app
      // never asked is a dead end — iOS does not list an app under Calendars
      // until it has requested access.
      if (permission.reason === 'unavailable') {
        Alert.alert(
          'Not available in this build',
          'Calendar access needs a rebuilt version of the app. This build was made before calendar support was added, so iOS has nothing to ask you about yet.',
        );
      } else {
        Alert.alert(
          'Permission needed',
          'Ascend needs calendar access to show your events. Turn it on in Settings › Ascend › Calendars.',
        );
      }
      return;
    }
    const cals = await listDeviceCalendars();
    if (cals.length === 0) {
      Alert.alert('No calendars found', 'This device has no event calendars available.');
      return;
    }
    setAppleCalendars(cals);
    setShowApplePicker(true);
  };

  const pickAppleCalendar = async (id: string | null) => {
    if (!user) return;
    await setSelectedCalendarId(user.id, id);
    setAppleSelected(id);
    setShowApplePicker(false);
  };

  return (
    <>
      <SettingsRow
        label="Google Calendar"
        subtitle={
          googleStatus?.configured === false
            ? 'Not available on this server'
            : googleStatus?.connected
              ? 'Connected — events show in your calendar'
              : 'Show your Google events alongside your tasks'
        }
        value={googleStatus?.connected ? 'Connected' : busy ? '…' : 'Connect'}
        onPress={
          googleStatus?.configured === false
            ? undefined
            : googleStatus?.connected
              ? disconnectGoogle
              : connectGoogle
        }
      />
      <Divider />
      <SettingsRow
        label={Platform.OS === 'ios' ? 'Apple Calendar' : 'Device Calendar'}
        subtitle="Stays on this device — never uploaded"
        value={appleSelected ? 'Connected' : 'Connect'}
        onPress={appleSelected ? () => pickAppleCalendar(null) : connectApple}
      />

      <Modal visible={showApplePicker} transparent animationType="fade" onRequestClose={() => setShowApplePicker(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#00000088' }} onPress={() => setShowApplePicker(false)} />
        <View style={{ position: 'absolute', left: 20, right: 20, top: '25%', backgroundColor: Colors.surface, borderRadius: 16, padding: 16 }}>
          <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '700', marginBottom: 10 }}>
            Choose a calendar
          </Text>
          {appleCalendars.map((c) => (
            <TouchableOpacity
              key={c.id}
              onPress={() => pickAppleCalendar(c.id)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 }}
            >
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.color }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.text, fontSize: 14 }}>{c.title}</Text>
                <Text style={{ color: Colors.subtext, fontSize: 11 }}>{c.source}</Text>
              </View>
              {appleSelected === c.id && <Ionicons name="checkmark" size={18} color={Colors.primary} />}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>
    </>
  );
}

/**
 * A settings row whose value is one of a small fixed set — clearer than a switch
 * once there are more than two states (Theme has three).
 */
function SegmentedRow({ label, subtitle, options, value, onChange }: {
  label: string;
  subtitle?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const Colors = useTheme();
  return (
    <View style={{ paddingVertical: 14 }}>
      <Text style={{ color: Colors.text, fontSize: 15, fontWeight: '500' }}>{label}</Text>
      {subtitle && (
        <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
      )}
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => onChange(opt.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor: selected ? Colors.primary : Colors.raised,
                borderWidth: 1,
                borderColor: selected ? Colors.primary : Colors.border,
              }}
            >
              <Text style={{
                color: selected ? '#fff' : Colors.subtext,
                fontSize: 13,
                fontWeight: selected ? '700' : '600',
              }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  const Colors = useTheme();
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
  const Colors = useTheme();
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
  const Colors = useTheme();
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
  const Colors = useTheme();
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
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [showFocusSheet, setShowFocusSheet] = useState(false);

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
            backgroundColor: Colors.primary + '12',
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
              <Ionicons name={RANK_META[rank].icon} size={13} color={Colors.text} />
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
                onValueChange={(v) => { if (user) settings.update(user.id, { publicProfile: v }); }}
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
                onValueChange={(v) => { if (user) settings.update(user.id, { showOnLeaderboard: v }); }}
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
                onValueChange={(v) => { if (user) settings.update(user.id, { shareFocusStats: v }); }}
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
                onValueChange={(v) => { if (user) settings.update(user.id, { friendsCanSeeActivity: v }); }}
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
                onValueChange={(v) => { if (user) settings.update(user.id, { notifySessionComplete: v }); }}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
          <Divider />
          <SettingsRow
            label="Daily Reminder"
            subtitle="A nudge to focus every day"
            rightComponent={
              <Switch
                value={settings.notifyDailyReminder}
                onValueChange={(v) => { if (user) settings.update(user.id, { notifyDailyReminder: v }); }}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
          {settings.notifyDailyReminder ? (
            <>
              <Divider />
              <SettingsRow
                label="Reminder Time"
                value={formatReminderTime(settings.dailyReminderHour, settings.dailyReminderMinute)}
                onPress={() => setShowReminderPicker(true)}
              />
            </>
          ) : null}
          <Divider />
          <SettingsRow
            label="Friend Activity"
            subtitle="Friends focusing, hitting goals & new posts"
            rightComponent={
              <Switch
                value={settings.notifyFriendActivity}
                onValueChange={(v) => { if (user) settings.update(user.id, { notifyFriendActivity: v }); }}
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
                onValueChange={(v) => { if (user) settings.update(user.id, { notifyAchievements: v }); }}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
        </SettingsCard>

        {/* Focus Mode — silencing everything ELSE during a session. Sits with
            Notifications because both are about what is allowed to interrupt,
            and deliberately away from "Focus Goals", which is a different
            feature and would read as related if adjacent. */}
        <SectionTitle title="Focus Mode" />
        <SettingsCard>
          <SettingsRow
            label="Set up Focus"
            subtitle="Silence other apps while you focus"
            onPress={() => setShowFocusSheet(true)}
          />
          <Divider />
          <SettingsRow
            label="Remind me at session start"
            subtitle="A one-tap nudge, never a blocker"
            rightComponent={
              <Switch
                value={settings.remindFocusMode}
                onValueChange={(v) => { if (user) settings.update(user.id, { remindFocusMode: v }); }}
                trackColor={{ false: Colors.inactive, true: Colors.primary }}
                thumbColor="white"
              />
            }
          />
        </SettingsCard>

        {/* Appearance */}
        <SectionTitle title="Appearance" />
        <SettingsCard>
          <SegmentedRow
            label="Theme"
            subtitle="System follows your phone's setting"
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            value={settings.theme}
            onChange={(v) => { if (user) settings.update(user.id, { theme: v as 'system' | 'dark' | 'light' }); }}
          />
          <Divider />
          <SegmentedRow
            label="Week starts on"
            subtitle="Used for week ranges in the Calendar tab"
            options={[
              { value: '0', label: 'Sunday' },
              { value: '1', label: 'Monday' },
            ]}
            value={String(settings.weekStartDay)}
            onChange={(v) => { if (user) settings.update(user.id, { weekStartDay: v === '1' ? 1 : 0 }); }}
          />
        </SettingsCard>

        {/* Focus goals */}
        <SectionTitle title="Focus Goals" />
        <SettingsCard>
          <DailySessionTargetRow />
        </SettingsCard>

        {/* Calendar sync */}
        <SectionTitle title="Calendar Sync" />
        <SettingsCard>
          <CalendarSyncRows />
        </SettingsCard>

        {/* App */}
        {/* Legal & Support */}
        <SectionTitle title="Legal & Support" />
        <SettingsCard>
          <SettingsRow
            label="Privacy Policy"
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          />
          <Divider />
          <SettingsRow
            label="Support"
            value={SUPPORT_EMAIL}
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          />
        </SettingsCard>

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

      {/* Daily Reminder Time Picker */}
      {showReminderPicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={(() => {
            const d = new Date();
            d.setHours(settings.dailyReminderHour, settings.dailyReminderMinute, 0, 0);
            return d;
          })()}
          mode="time"
          is24Hour={false}
          onChange={(event, date) => {
            setShowReminderPicker(false);
            if (event.type === 'set' && date && user) {
              settings.update(user.id, {
                dailyReminderHour: date.getHours(),
                dailyReminderMinute: date.getMinutes(),
              });
            }
          }}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal
          visible={showReminderPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowReminderPicker(false)}
        >
          <View style={{ flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' }}>
            <View style={{
              backgroundColor: Colors.surface,
              borderTopLeftRadius: 24, borderTopRightRadius: 24,
              padding: 20, paddingBottom: 40,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ flex: 1, color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>
                  Reminder Time
                </Text>
                <Pressable onPress={() => setShowReminderPicker(false)}>
                  <Text style={{ color: Colors.primary, fontSize: 16, fontWeight: '600' }}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={(() => {
                  const d = new Date();
                  d.setHours(settings.dailyReminderHour, settings.dailyReminderMinute, 0, 0);
                  return d;
                })()}
                mode="time"
                is24Hour={false}
                display="spinner"
                onChange={(_event, date) => {
                  if (date && user) {
                    settings.update(user.id, {
                      dailyReminderHour: date.getHours(),
                      dailyReminderMinute: date.getMinutes(),
                    });
                  }
                }}
              />
            </View>
          </View>
        </Modal>
      )}

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
      <FocusModeSheet visible={showFocusSheet} onClose={() => setShowFocusSheet(false)} />
    </SafeAreaView>
  );
}

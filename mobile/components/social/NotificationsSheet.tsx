/**
 * The notifications inbox, as a bottom sheet.
 *
 * Lived inline in the feed screen until the app's home moved to Today; it now
 * opens from the bell in Today's header. It reads the inbox straight from
 * socialStore, so the screen hosting it only owns whether it is open.
 * Marking everything read is the caller's job, done when the bell is tapped.
 */
import { View, Text, Pressable, FlatList, ActivityIndicator, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { useSocialStore } from '../../stores/socialStore';
import { useTheme } from '../../hooks/useTheme';
import { timeAgo } from '../../lib/timeAgo';

export function NotificationsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const Colors = useTheme();
  const inbox = useSocialStore(
    useShallow((s) => ({
      notifications: s.notifications,
      notificationsCursor: s.notificationsCursor,
      isLoadingMoreNotifications: s.isLoadingMoreNotifications,
      fetchMoreNotifications: s.fetchMoreNotifications,
    })),
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%' }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 }}>
            <Text accessibilityRole="header" style={{ flex: 1, color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>
              Notifications
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close notifications" hitSlop={12}>
              <Ionicons name="close" size={22} color={Colors.subtext} />
            </Pressable>
          </View>
          {inbox.notifications.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ color: Colors.subtext, fontSize: 13 }}>No notifications yet</Text>
            </View>
          ) : (
            <FlatList
              data={inbox.notifications}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingBottom: 32 }}
              // Older pages load as the list nears its end; the cursor is
              // null once the oldest notification is on screen.
              onEndReached={() => { if (inbox.notificationsCursor) inbox.fetchMoreNotifications(); }}
              onEndReachedThreshold={0.5}
              ListFooterComponent={inbox.isLoadingMoreNotifications
                ? <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 16 }} />
                : undefined}
              renderItem={({ item }) => (
                <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.BORDER_SOFT }}>
                  <Text style={{ color: item.isRead ? Colors.subtext : Colors.textBright, fontSize: 14 }}>
                    {item.text}
                  </Text>
                  <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 4 }}>{timeAgo(item.createdAt)}</Text>
                </View>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, TextInput,
  ActivityIndicator, Modal, ScrollView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSocialStore } from '../../stores/socialStore';
import { connectEventDispatcher, disconnectEventDispatcher } from '../../services/EventDispatcher';
import { Colors } from '../../constants/Colors';
import { Friend, UserSearchResult, FriendProfile } from '../../types';
import TabBar from '../../components/TabBar';
import FeedCard from '../../components/FeedCard';
import UserRow from '../../components/UserRow';
import LeaderboardRow from '../../components/LeaderboardRow';
import LevelBadge from '../../components/LevelBadge';
import { api } from '../../services/api';

const INTERNAL_TABS = [
  { key: 'feed', label: 'Feed' },
  { key: 'friends', label: 'Friends' },
  { key: 'requests', label: 'Requests', badge: 0 },
  { key: 'rankings', label: 'Rankings' },
];

function SkeletonCard() {
  return (
    <View className="mx-4 mb-3 bg-dark-card rounded-2xl p-4">
      <View className="flex-row items-center">
        <View className="w-10 h-10 rounded-full bg-gray-700 mr-3" />
        <View className="flex-1">
          <View className="h-3 bg-gray-700 rounded w-32 mb-2" />
          <View className="h-2.5 bg-gray-700 rounded w-48" />
        </View>
      </View>
    </View>
  );
}

export default function SocialScreen() {
  const social = useSocialStore();
  const [activeTab, setActiveTab] = useState<'feed' | 'friends' | 'requests' | 'rankings'>('feed');
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [friendProfile, setFriendProfile] = useState<FriendProfile | null>(null);
  const [showFriendProfile, setShowFriendProfile] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [leaderboardType, setLeaderboardType] = useState<'weekly_xp' | 'longest_streak'>('weekly_xp');
  const [leaderboardScope, setLeaderboardScope] = useState<'global' | 'friends'>('global');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tabsWithBadges = INTERNAL_TABS.map((t) => ({
    ...t,
    badge: t.key === 'requests' ? social.incomingRequests.length : undefined,
  }));

  useEffect(() => {
    connectEventDispatcher();
    social.loadFriends();
    social.fetchFeed();
    social.fetchRequests();
    social.fetchLeaderboard('weekly_xp', 'global');

    return () => disconnectEventDispatcher();
  }, []);

  useEffect(() => {
    if (searchQuery.length >= 2) {
      setIsSearching(true);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(async () => {
        const results = await social.searchUsers(searchQuery);
        setSearchResults(results);
        setIsSearching(false);
      }, 400);
    } else {
      setSearchResults([]);
      setIsSearching(false);
    }
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (activeTab === 'rankings') {
      social.fetchLeaderboard(leaderboardType, leaderboardScope);
    }
    if (activeTab === 'requests') {
      social.fetchRequests();
    }
  }, [activeTab, leaderboardType, leaderboardScope]);

  const handleSendRequest = async (targetUserId: string) => {
    const success = await social.sendFriendRequest(targetUserId);
    if (success) {
      setSearchResults((prev) =>
        prev.map((r) =>
          r.id === targetUserId ? { ...r, relationshipStatus: 'pending_sent' as const } : r,
        ),
      );
      showToast('Friend request sent!');
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    const req = social.incomingRequests.find((r) => r.id === requestId);
    const success = await social.acceptRequest(requestId);
    if (success && req) {
      showToast(`You and ${req.requester.username} are now friends!`);
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    await social.declineRequest(requestId);
  };

  const handleCancelRequest = async (requestId: string) => {
    await social.cancelRequest(requestId);
  };

  const handleAcceptSearchRequest = async (userId: string) => {
    await social.sendFriendRequest(userId);
    setSearchResults((prev) =>
      prev.map((r) =>
        r.id === userId ? { ...r, relationshipStatus: 'pending_sent' as const } : r,
      ),
    );
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const openFriendProfile = async (friend: Friend) => {
    setSelectedFriend(friend);
    setShowFriendProfile(true);
    try {
      const response = await api.get<FriendProfile>(`/social/friends/${friend.id}/profile`);
      if (response.success && response.data) {
        setFriendProfile(response.data);
      }
    } catch {
      // fallback — just show basic info
    }
  };

  const handleRefreshFeed = useCallback(async () => {
    setIsLoadingFeed(true);
    await social.fetchFeed();
    setIsLoadingFeed(false);
  }, []);

  const handleEndReached = useCallback(async () => {
    if (social.feedCursor) {
      await social.fetchMoreFeed();
    }
  }, [social.feedCursor]);

  const handleLeaderboardToggle = () => {
    setLeaderboardType((prev) => (prev === 'weekly_xp' ? 'longest_streak' : 'weekly_xp'));
  };

  const handleScopeToggle = () => {
    setLeaderboardScope((prev) => (prev === 'global' ? 'friends' : 'global'));
  };

  const leaderboardEntries = leaderboardType === 'weekly_xp'
    ? social.weeklyXPLeaderboard
    : social.streakLeaderboardFull;

  const renderFeedTab = () => (
    <FlatList
      data={social.feedEvents}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={isLoadingFeed} onRefresh={handleRefreshFeed} tintColor={Colors.primary} />
      }
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={<View className="h-2" />}
      ListFooterComponent={social.feedCursor ? <ActivityIndicator color={Colors.primary} className="py-4" /> : <View className="h-4" />}
      ListEmptyComponent={
        isLoadingFeed ? (
          <View className="pt-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : (
          <View className="items-center py-16">
            <Ionicons name="newspaper-outline" size={48} color={Colors.darkSubtext} />
            <Text className="text-gray-400 mt-4 font-medium">Nothing yet</Text>
            <Text className="text-gray-500 text-sm mt-1">Add friends to see their progress here</Text>
          </View>
        )
      }
      renderItem={({ item }) => <FeedCard event={item} />}
    />
  );

  const renderFriendsTab = () => (
    <View className="flex-1">
      <View className="px-4 py-3">
        <View className="flex-row items-center bg-dark-card rounded-2xl px-4 py-2.5">
          <Ionicons name="search" size={18} color="gray" />
          <TextInput
            className="flex-1 text-white ml-2 text-sm"
            placeholder="Search by username..."
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="gray" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {searchQuery.length >= 2 ? (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View className="items-center py-10">
              {isSearching ? (
                <ActivityIndicator color={Colors.primary} />
              ) : (
                <>
                  <Ionicons name="search-outline" size={40} color={Colors.darkSubtext} />
                  <Text className="text-gray-400 mt-3">No users found for '{searchQuery}'</Text>
                </>
              )}
            </View>
          }
          renderItem={({ item }) => {
            let actionLabel = 'Add';
            let actionDisabled = false;
            let accentColor: string | undefined;

            if (item.relationshipStatus === 'friends') {
              actionLabel = 'Friends';
              actionDisabled = true;
            } else if (item.relationshipStatus === 'pending_sent') {
              actionLabel = 'Pending';
              actionDisabled = true;
            } else if (item.relationshipStatus === 'pending_received') {
              actionLabel = 'Accept';
              accentColor = Colors.success;
            }

            return (
              <UserRow
                username={item.username}
                avatarUrl={item.avatarUrl}
                level={item.level}
                actionLabel={actionLabel}
                actionDisabled={actionDisabled}
                accentColor={accentColor}
                onAction={() => {
                  if (item.relationshipStatus === 'pending_received') {
                    handleAcceptSearchRequest(item.id);
                  } else if (item.relationshipStatus === 'none') {
                    handleSendRequest(item.id);
                  }
                }}
              />
            );
          }}
        />
      ) : (
        <FlatList
          data={social.friends}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={<View className="h-2" />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Ionicons name="people-outline" size={48} color={Colors.darkSubtext} />
              <Text className="text-gray-400 mt-4 font-medium">No friends yet</Text>
              <Text className="text-gray-500 text-sm mt-1">Search for someone to add</Text>
            </View>
          }
          renderItem={({ item }) => (
            <UserRow
              username={item.username}
              avatarUrl={item.avatarUrl}
              subtitle={undefined}
              activeToday={(item as Friend & { activeToday?: boolean }).activeToday}
              lastActive={(item as Friend & { lastActive?: string }).lastActive}
              onPress={() => openFriendProfile(item)}
            />
          )}
        />
      )}
    </View>
  );

  const renderRequestsTab = () => {
    const { incomingRequests, outgoingRequests } = social;

    return (
      <FlatList
        data={[]}
        keyExtractor={() => 'empty'}
        renderItem={() => null}
        ListHeaderComponent={
          <View>
            {incomingRequests.length > 0 && (
              <View className="mb-4">
                <Text className="text-gray-400 text-sm font-semibold px-6 mb-2">
                  Incoming ({incomingRequests.length})
                </Text>
                {incomingRequests.map((req) => (
                  <View
                    key={req.id}
                    className="mx-4 mb-2 bg-dark-card rounded-2xl p-4 flex-row items-center"
                  >
                    <View className="w-11 h-11 rounded-full bg-primary/20 items-center justify-center">
                      <Text className="text-primary font-bold text-base">
                        {req.requester.username[0]?.toUpperCase() || '?'}
                      </Text>
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-white font-bold text-sm">{req.requester.username}</Text>
                      <Text className="text-gray-400 text-xs">
                        Sent {new Date(req.createdAt || Date.now()).toLocaleDateString()}
                      </Text>
                    </View>
                    <TouchableOpacity
                      className="bg-green-500 px-4 py-2 rounded-full mr-2"
                      onPress={() => handleAcceptRequest(req.id)}
                    >
                      <Text className="text-white text-xs font-bold">Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="border border-red-500 px-4 py-2 rounded-full"
                      onPress={() => handleDeclineRequest(req.id)}
                    >
                      <Text className="text-red-500 text-xs font-bold">Decline</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {incomingRequests.length === 0 && (
              <View className="items-center py-8">
                <Text className="text-gray-500 text-sm">No pending requests</Text>
              </View>
            )}

            {outgoingRequests.length > 0 && (
              <View>
                <Text className="text-gray-400 text-sm font-semibold px-6 mb-2 mt-4">
                  Sent ({outgoingRequests.length})
                </Text>
                {outgoingRequests.map((req) => (
                  <View
                    key={req.id}
                    className="mx-4 mb-2 bg-dark-card rounded-2xl p-4 flex-row items-center"
                  >
                    <View className="w-11 h-11 rounded-full bg-primary/20 items-center justify-center">
                      <Text className="text-primary font-bold text-base">
                        {req.addressee?.username?.[0]?.toUpperCase() || '?'}
                      </Text>
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-white font-bold text-sm">
                        {req.addressee?.username || 'Unknown'}
                      </Text>
                      <Text className="text-gray-400 text-xs">
                        Pending · {new Date(req.createdAt || Date.now()).toLocaleDateString()}
                      </Text>
                    </View>
                    <TouchableOpacity
                      className="border border-gray-500 px-4 py-2 rounded-full"
                      onPress={() => handleCancelRequest(req.id)}
                    >
                      <Text className="text-gray-400 text-xs font-bold">Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {outgoingRequests.length === 0 && (
              <View className="items-center py-8">
                <Text className="text-gray-500 text-sm">You haven't sent any requests</Text>
              </View>
            )}
          </View>
        }
      />
    );
  };

  const renderRankingsTab = () => (
    <View className="flex-1">
      <View className="px-4 py-3 flex-row items-center justify-between">
        <View className="flex-row space-x-2">
          <TouchableOpacity
            className={`px-4 py-2 rounded-full ${
              leaderboardType === 'weekly_xp' ? 'bg-primary' : 'bg-dark-card'
            }`}
            onPress={() => setLeaderboardType('weekly_xp')}
          >
            <Text
              className={`text-xs font-semibold ${
                leaderboardType === 'weekly_xp' ? 'text-white' : 'text-gray-400'
              }`}
            >
              Weekly XP
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`px-4 py-2 rounded-full ${
              leaderboardType === 'longest_streak' ? 'bg-primary' : 'bg-dark-card'
            }`}
            onPress={() => setLeaderboardType('longest_streak')}
          >
            <Text
              className={`text-xs font-semibold ${
                leaderboardType === 'longest_streak' ? 'text-white' : 'text-gray-400'
              }`}
            >
              Longest Streak
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View className="px-4 pb-2">
        <View className="flex-row bg-dark-card rounded-full p-0.5 self-start">
          <TouchableOpacity
            className={`px-4 py-1.5 rounded-full ${
              leaderboardScope === 'global' ? 'bg-primary' : ''
            }`}
            onPress={() => setLeaderboardScope('global')}
          >
            <Text
              className={`text-xs font-semibold ${
                leaderboardScope === 'global' ? 'text-white' : 'text-gray-400'
              }`}
            >
              Global
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`px-4 py-1.5 rounded-full ${
              leaderboardScope === 'friends' ? 'bg-primary' : ''
            }`}
            onPress={() => setLeaderboardScope('friends')}
          >
            <Text
              className={`text-xs font-semibold ${
                leaderboardScope === 'friends' ? 'text-white' : 'text-gray-400'
              }`}
            >
              Friends
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {social.myLeaderboardEntry && !social.myLeaderboardEntry.isMe && (
        <View className="mx-4 mb-3 bg-primary/10 border border-primary/30 rounded-2xl p-3 flex-row items-center">
          <Ionicons name="ribbon" size={18} color={Colors.primary} />
          <Text className="text-primary font-bold ml-2">
            Your Rank: #{social.myLeaderboardEntry.rank}
          </Text>
        </View>
      )}

      <FlatList
        data={leaderboardEntries}
        keyExtractor={(item) => `${item.userId}-${leaderboardType}`}
        refreshControl={
          <RefreshControl
            refreshing={social.isLoading}
            onRefresh={() => social.fetchLeaderboard(leaderboardType, leaderboardScope)}
            tintColor={Colors.primary}
          />
        }
        ListHeaderComponent={<View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons name="trophy-outline" size={48} color={Colors.darkSubtext} />
            <Text className="text-gray-400 mt-4 font-medium">No data yet</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <LeaderboardRow
            entry={item}
            rank={index + 1}
            type={leaderboardType}
            isMe={item.isMe}
          />
        )}
        ListFooterComponent={<View className="h-4" />}
      />
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-dark-bg">
      <View className="px-6 py-4">
        <Text className="text-2xl font-bold text-white">Social</Text>
      </View>

      <TabBar
        tabs={tabsWithBadges}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as typeof activeTab)}
      />

      <View className="flex-1">
        {activeTab === 'feed' && renderFeedTab()}
        {activeTab === 'friends' && renderFriendsTab()}
        {activeTab === 'requests' && renderRequestsTab()}
        {activeTab === 'rankings' && renderRankingsTab()}
      </View>

      <Modal visible={showFriendProfile} transparent animationType="slide">
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-dark-card rounded-t-3xl min-h-[400px] max-h-[80%]">
            <View className="flex-row items-center justify-between px-6 pt-6 pb-4">
              <Text className="text-xl font-bold text-white">Friend Profile</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowFriendProfile(false);
                  setFriendProfile(null);
                }}
              >
                <Ionicons name="close" size={24} color="white" />
              </TouchableOpacity>
            </View>

            <ScrollView className="px-6">
              {friendProfile ? (
                <>
                  <View className="items-center mb-6">
                    <View className="w-20 h-20 rounded-full bg-primary/20 items-center justify-center mb-3">
                      <Text className="text-primary font-bold text-3xl">
                        {friendProfile.username[0]?.toUpperCase() || '?'}
                      </Text>
                    </View>
                    <Text className="text-white text-xl font-bold">{friendProfile.username}</Text>
                    <View className="mt-2">
                      <LevelBadge level={friendProfile.level} size="md" />
                    </View>
                  </View>

                  <View className="flex-row justify-around mb-6 bg-dark-bg rounded-2xl p-4">
                    <View className="items-center">
                      <Text className="text-white text-lg font-bold">{friendProfile.currentStreak}</Text>
                      <Text className="text-gray-400 text-xs">Streak</Text>
                    </View>
                    <View className="w-px bg-gray-700" />
                    <View className="items-center">
                      <Text className="text-white text-lg font-bold">{friendProfile.totalSessions}</Text>
                      <Text className="text-gray-400 text-xs">Sessions</Text>
                    </View>
                    <View className="w-px bg-gray-700" />
                    <View className="items-center">
                      <Text className="text-white text-lg font-bold">
                        {Math.floor(friendProfile.totalFocusTime / 60)}
                      </Text>
                      <Text className="text-gray-400 text-xs">Hours</Text>
                    </View>
                  </View>

                  {friendProfile.recentAchievements.length > 0 && (
                    <View className="mb-6">
                      <Text className="text-gray-400 text-sm font-semibold mb-3">Recent Achievements</Text>
                      <View className="flex-row flex-wrap">
                        {friendProfile.recentAchievements.map((ach) => (
                          <View
                            key={ach.id}
                            className="bg-dark-bg rounded-xl p-3 items-center mr-2 mb-2"
                            style={{ minWidth: 80 }}
                          >
                            <Text className="text-2xl mb-1">{ach.icon}</Text>
                            <Text className="text-white text-xs text-center font-medium">{ach.title}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {friendProfile.recentFeedEvents.length > 0 && (
                    <View className="mb-6">
                      <Text className="text-gray-400 text-sm font-semibold mb-3">Recent Activity</Text>
                      {friendProfile.recentFeedEvents.map((evt) => (
                        <FeedCard key={evt.id} event={evt} />
                      ))}
                    </View>
                  )}
                </>
              ) : (
                <View className="items-center py-16">
                  <ActivityIndicator color={Colors.primary} />
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {toastMessage && (
        <View className="absolute bottom-8 left-6 right-6 bg-dark-card rounded-2xl py-3 px-4 shadow-lg border border-gray-700">
          <Text className="text-white text-center font-medium text-sm">{toastMessage}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

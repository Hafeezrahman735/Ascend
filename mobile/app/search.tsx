import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSocialStore } from '../stores/socialStore';
import { Colors } from '../constants/Colors';
import { BORDER_SOFT } from '../constants/socialTheme';
import type { UserSearchResult } from '../types';

const SURFACE = Colors.surface;
const RAISED = Colors.raised;

function UserRow({ user, onFollow, onPress }: {
  user: UserSearchResult;
  onFollow: (id: string, following: boolean) => void;
  onPress: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    await onFollow(user.id, !!user.isFollowing);
    setLoading(false);
  };

  return (
    <Pressable
      onPress={() => onPress(user.id)}
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingVertical: 12,
        borderBottomWidth: 0.5, borderBottomColor: BORDER_SOFT,
      }}
    >
      <View style={{
        width: 44, height: 44, borderRadius: 13, backgroundColor: RAISED,
        alignItems: 'center', justifyContent: 'center', marginRight: 12,
      }}>
        <Text style={{ fontSize: 24 }}>{user.avatarEmoji || '🦊'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: Colors.textBright, fontWeight: '600', fontSize: 15 }}>{user.username}</Text>
        <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 1 }}>Level {user.level}</Text>
      </View>
      <Pressable
        onPress={handleToggle}
        disabled={loading}
        style={{
          paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
          backgroundColor: user.isFollowing ? Colors.raised : Colors.primary,
          borderWidth: 1,
          borderColor: user.isFollowing ? BORDER_SOFT : Colors.primary,
        }}
      >
        {loading
          ? <ActivityIndicator size="small" color={user.isFollowing ? Colors.subtext : '#fff'} />
          : <Text style={{
              color: user.isFollowing ? Colors.subtext : '#fff',
              fontSize: 13, fontWeight: '600',
            }}>
              {user.isFollowing ? 'Following' : 'Follow'}
            </Text>
        }
      </Pressable>
    </Pressable>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const social = useSocialStore();
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 200);
    return () => { social.clearSearch(); };
  }, []);

  const handleChange = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      social.searchUsersV2(text);
    }, 350);
  }, []);

  const handleFollow = useCallback(async (userId: string, isFollowing: boolean) => {
    if (isFollowing) {
      await social.unfollowUser(userId);
    } else {
      await social.followUser(userId);
    }
  }, []);

  const handlePress = useCallback((userId: string) => {
    router.push(`/user/${userId}` as never);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </Pressable>
          <View style={{
            flex: 1, flexDirection: 'row', alignItems: 'center',
            backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1,
            borderColor: BORDER_SOFT, paddingHorizontal: 12, height: 44,
          }}>
            <Ionicons name="search" size={16} color={Colors.subtext} style={{ marginRight: 8 }} />
            <TextInput
              ref={inputRef}
              placeholder="Search students..."
              placeholderTextColor={Colors.subtext}
              onChangeText={handleChange}
              style={{ flex: 1, color: Colors.textBright, fontSize: 15 }}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        {/* Results */}
        {social.isSearching ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : social.searchResults.length === 0 && social.searchQuery.length >= 2 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Ionicons name="person-outline" size={48} color={Colors.subtext} />
            <Text style={{ color: Colors.text, fontSize: 15, fontWeight: '600', marginTop: 16, textAlign: 'center' }}>
              No students found for "{social.searchQuery}"
            </Text>
          </View>
        ) : social.searchQuery.length < 2 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Ionicons name="search" size={48} color={Colors.subtext} />
            <Text style={{ color: Colors.subtext, fontSize: 14, marginTop: 16, textAlign: 'center' }}>
              Search by username to find and follow other students
            </Text>
          </View>
        ) : (
          <FlatList
            data={social.searchResults}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <UserRow
                user={item}
                onFollow={handleFollow}
                onPress={handlePress}
              />
            )}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

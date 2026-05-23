import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

export default function LoginScreen() {
  const router = useRouter();
  const { login, isLoading, error, clearError } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    if (!email || !password) return;
    const success = await login(email, password);
    if (success) {
      router.replace('/(tabs)');
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-dark-bg dark:bg-dark-bg bg-light-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 justify-center px-8">
        <Text className="text-4xl font-bold text-center mb-2 text-primary">Pomodoro</Text>
        <Text className="text-lg text-center mb-10 text-dark-subtext dark:text-dark-subtext text-light-subtext">
          Focus. Track. Achieve.
        </Text>

        {error && (
          <View className="bg-red-900/20 border border-red-500 rounded-2xl px-4 py-3 mb-4">
            <Text className="text-red-500 text-sm">{error}</Text>
          </View>
        )}

        <View className="space-y-4">
          <View>
            <Text className="text-sm font-medium mb-1 text-dark-text dark:text-dark-text text-light-text">Email</Text>
            <TextInput
              className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl px-4 py-3 text-dark-text dark:text-dark-text text-light-text"
              placeholder="your@email.com"
              placeholderTextColor="#666"
              value={email}
              onChangeText={(t) => { setEmail(t); clearError(); }}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          <View>
            <Text className="text-sm font-medium mb-1 text-dark-text dark:text-dark-text text-light-text">Password</Text>
            <TextInput
              className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl px-4 py-3 text-dark-text dark:text-dark-text text-light-text"
              placeholder="Your password"
              placeholderTextColor="#666"
              value={password}
              onChangeText={(t) => { setPassword(t); clearError(); }}
              secureTextEntry
              autoComplete="password"
            />
          </View>

          <TouchableOpacity
            className="bg-primary rounded-2xl py-4 items-center mt-4"
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-bold text-lg">Log In</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            className="items-center mt-4"
            onPress={() => router.push('/(auth)/register')}
          >
            <Text className="text-accent text-sm">
              Don't have an account? Sign up
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

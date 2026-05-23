import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

export default function RegisterScreen() {
  const router = useRouter();
  const { register, isLoading, error, clearError } = useAuthStore();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleRegister = async () => {
    setLocalError(null);
    if (!email || !username || !password) {
      setLocalError('All fields are required');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters');
      return;
    }
    const success = await register(email, username, password);
    if (success) {
      router.replace('/(tabs)');
    }
  };

  const displayError = localError || error;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-dark-bg dark:bg-dark-bg bg-light-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 justify-center px-8">
        <Text className="text-4xl font-bold text-center mb-2 text-primary">Create Account</Text>
        <Text className="text-lg text-center mb-10 text-dark-subtext dark:text-dark-subtext text-light-subtext">
          Join the productivity community
        </Text>

        {displayError && (
          <View className="bg-red-900/20 border border-red-500 rounded-2xl px-4 py-3 mb-4">
            <Text className="text-red-500 text-sm">{displayError}</Text>
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
              onChangeText={(t) => { setEmail(t); clearError(); setLocalError(null); }}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          <View>
            <Text className="text-sm font-medium mb-1 text-dark-text dark:text-dark-text text-light-text">Username</Text>
            <TextInput
              className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl px-4 py-3 text-dark-text dark:text-dark-text text-light-text"
              placeholder="Choose a username"
              placeholderTextColor="#666"
              value={username}
              onChangeText={(t) => { setUsername(t); clearError(); setLocalError(null); }}
              autoCapitalize="none"
              autoComplete="username"
            />
          </View>

          <View>
            <Text className="text-sm font-medium mb-1 text-dark-text dark:text-dark-text text-light-text">Password</Text>
            <TextInput
              className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl px-4 py-3 text-dark-text dark:text-dark-text text-light-text"
              placeholder="At least 8 characters"
              placeholderTextColor="#666"
              value={password}
              onChangeText={(t) => { setPassword(t); clearError(); setLocalError(null); }}
              secureTextEntry
              autoComplete="new-password"
            />
          </View>

          <View>
            <Text className="text-sm font-medium mb-1 text-dark-text dark:text-dark-text text-light-text">Confirm Password</Text>
            <TextInput
              className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl px-4 py-3 text-dark-text dark:text-dark-text text-light-text"
              placeholder="Confirm your password"
              placeholderTextColor="#666"
              value={confirmPassword}
              onChangeText={(t) => { setConfirmPassword(t); clearError(); setLocalError(null); }}
              secureTextEntry
              autoComplete="new-password"
            />
          </View>

          <TouchableOpacity
            className="bg-primary rounded-2xl py-4 items-center mt-4"
            onPress={handleRegister}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-bold text-lg">Sign Up</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            className="items-center mt-4"
            onPress={() => router.push('/(auth)/login')}
          >
            <Text className="text-accent text-sm">
              Already have an account? Log in
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
      {/* Deep-link target for ascend://reset-password?token=… It has to be in
          this group: the root auth guard redirects any signed-out user whose
          first segment is not (auth), and expo-router keeps group names out of
          the URL, so the link stays /reset-password. */}
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="onboarding1" />
      <Stack.Screen name="onboarding2" />
    </Stack>
  );
}

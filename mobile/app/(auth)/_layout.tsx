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
      {/* Read-only terms text, pushed from the signup form and the gate. Must
          live in this group so it is reachable BEFORE anyone has an account —
          Guideline 1.2 requires the agreement be readable before registering. */}
      <Stack.Screen name="terms" />
      {/* One-time acceptance for accounts that predate the terms. Shown to a
          SIGNED-IN user, which is why the root guard has an explicit escape for
          it — see the onTerms note in app/_layout.tsx. */}
      <Stack.Screen name="terms-gate" />
      <Stack.Screen name="onboarding1" />
      <Stack.Screen name="onboarding2" />
    </Stack>
  );
}

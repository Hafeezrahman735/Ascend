import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Font } from '../../constants/typography';
import { TERMS_SECTIONS, TERMS_INTRO, TERMS_EFFECTIVE_DATE } from '../../constants/termsText';
import { CURRENT_TERMS_VERSION } from '../../constants/legal';
import { AUTH_CONTENT_MAX_WIDTH } from '../../components/auth/authLayout';

/**
 * The Terms of Use, read-only.
 *
 * Lives in the (auth) group because it must be reachable BEFORE anyone has an
 * account: App Store Guideline 1.2 requires the agreement be presented before
 * registering or logging in, and the root auth guard sends any signed-out user
 * outside this group back to login.
 *
 * The text is bundled (constants/termsText.ts) rather than fetched or opened in
 * a browser. Three reasons, in order of how much they matter: a user agreeing to
 * terms must be able to read what they are agreeing to with no network; App
 * Review should never be sent out of the app mid-signup to a page that could
 * change under them; and a hosted page that 404s would turn the consent gate
 * into a dead end. The public copy at TERMS_OF_USE_URL exists for App Store
 * Connect, not for this screen.
 *
 * Purely presentational — accepting happens on the signup form and on the terms
 * gate, never here. This screen is pushed from both and simply pops back.
 */
export default function TermsScreen() {
  const Colors = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          paddingBottom: 48,
          width: '100%',
          maxWidth: AUTH_CONTENT_MAX_WIDTH,
          alignSelf: 'center',
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={{ marginBottom: 20, alignSelf: 'flex-start' }}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>

        <Text
          accessibilityRole="header"
          style={{
            color: Colors.textBright,
            fontFamily: Font.display,
            fontSize: 26,
            letterSpacing: -0.6,
            marginBottom: 6,
          }}
        >
          Terms of Use
        </Text>
        <Text style={{ color: Colors.subtext, fontSize: 12, marginBottom: 20 }}>
          Version {CURRENT_TERMS_VERSION} · Last updated {TERMS_EFFECTIVE_DATE}
        </Text>

        <Text style={{ color: Colors.text, fontSize: 14, lineHeight: 21, marginBottom: 26 }}>
          {TERMS_INTRO}
        </Text>

        {TERMS_SECTIONS.map((section) => (
          <View key={section.heading} style={{ marginBottom: 24 }}>
            <Text
              accessibilityRole="header"
              style={{
                color: Colors.textBright,
                fontSize: 15,
                fontWeight: '700',
                marginBottom: 8,
              }}
            >
              {section.heading}
            </Text>

            {section.body.map((paragraph, i) => (
              <Text
                key={paragraph}
                style={{
                  color: Colors.text,
                  fontSize: 14,
                  lineHeight: 21,
                  marginBottom: 8,
                  // The zero-tolerance and 24-hour clauses lead with the
                  // sentence App Review is looking for; weighting it stops it
                  // reading as one more line of boilerplate.
                  fontWeight: section.emphasise && i === 0 ? '700' : '400',
                }}
              >
                {paragraph}
              </Text>
            ))}

            {section.bullets?.map((bullet) => (
              <View key={bullet} style={{ flexDirection: 'row', marginBottom: 6, paddingLeft: 4 }}>
                <Text style={{ color: Colors.subtext, fontSize: 14, lineHeight: 21 }}>•  </Text>
                <Text style={{ color: Colors.text, fontSize: 14, lineHeight: 21, flex: 1 }}>
                  {bullet}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

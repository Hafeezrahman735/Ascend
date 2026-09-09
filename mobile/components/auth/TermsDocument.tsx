import { View, Text } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Font } from '../../constants/typography';
import { TERMS_SECTIONS, TERMS_INTRO, TERMS_EFFECTIVE_DATE } from '../../constants/termsText';
import { CURRENT_TERMS_VERSION } from '../../constants/legal';

/**
 * The Terms of Service, rendered in full.
 *
 * Presentational only — it takes no props and owns no state. Both places that
 * collect consent embed this above their own checkbox, so the text a user
 * scrolls through at signup is character-for-character the text an existing
 * account scrolls through at the terms gate. Two renderers would eventually
 * drift, and the thing that drifted would be the wording of an agreement.
 *
 * Deliberately NOT scrollable itself: the parent owns the ScrollView, because
 * the consent checkbox has to sit inside the same scroll as the last clause.
 * That is the whole point — a checkbox beside a link can be ticked by someone
 * who never opened it, so the only way to reach this one is to scroll past the
 * terms it refers to.
 */
export function TermsDocument() {
  const Colors = useTheme();

  return (
    <View>
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
        Terms of Service
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
                // The zero-tolerance and 24-hour clauses lead with the sentence
                // App Review is looking for; weighting it stops it reading as
                // one more line of boilerplate.
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

          {/* Paragraphs that belong AFTER the list — section 5 states the
              prohibitions, then explains reporting, blocking and the 24-hour
              enforcement commitment, and that order is the point of it. */}
          {section.tail?.map((paragraph) => (
            <Text
              key={paragraph}
              style={{ color: Colors.text, fontSize: 14, lineHeight: 21, marginTop: 10 }}
            >
              {paragraph}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { passwordToggle } from '../lib/passwordToggle';

/**
 * A labelled password input with a show/hide toggle.
 *
 * Exists as a component rather than a third copy of the same JSX: the auth
 * screen already had the same six-line style block pasted twice, once for the
 * password and once for the confirmation, and any future auth screen would have
 * made it three. The label is part of it for the same reason — it was duplicated
 * alongside every input on the screen.
 *
 * The visibility state lives HERE, per field, on purpose. Sharing one flag
 * across the password and confirm-password inputs would reveal both when the
 * user only asked to check one, and the point of the toggle is to check what you
 * just typed, not to unmask the form.
 */

interface Props {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** 'new-password' on register and reset, 'password' on login. */
  autoComplete?: 'password' | 'new-password';
  /** Labels the toggle for screen readers, e.g. "Confirm password". */
  accessibilityName?: string;
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'next';
}

export default function PasswordField({
  label,
  value,
  onChangeText,
  placeholder,
  autoComplete = 'password',
  accessibilityName,
  onSubmitEditing,
  returnKeyType,
}: Props) {
  const Colors = useTheme();
  const [visible, setVisible] = useState(false);
  const toggle = passwordToggle(visible, accessibilityName ?? label.toLowerCase());

  return (
    <View>
      <Text style={{
        color: Colors.subtext, fontSize: 12, fontWeight: '600',
        letterSpacing: 0.5, marginBottom: 7,
      }}>
        {label}
      </Text>

      <View style={{ justifyContent: 'center' }}>
        <TextInput
          style={{
            backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
            borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
            // Room for the toggle so a long password never runs under the icon.
            paddingRight: 48,
            color: Colors.textBright, fontSize: 15,
            // Applied unconditionally rather than switched with `visible`:
            // toggling secureTextEntry on a live TextInput resets the typeface
            // to monospace on some Android versions, and a style that does not
            // change across the toggle is what prevents it.
          }}
          placeholder={placeholder}
          placeholderTextColor={Colors.subtext}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoComplete={autoComplete}
          // Android turns on suggestions and autocorrect the moment a field
          // stops being secure, which would offer to "correct" a password and
          // leave it in the keyboard's learned-words dictionary.
          autoCorrect={false}
          spellCheck={false}
          autoCapitalize="none"
          // iOS decides the autofill behaviour from textContentType, and leaving
          // it to infer from a field whose secureTextEntry flips mid-edit is what
          // makes the keyboard dismiss and the strong-password overlay reappear.
          // Naming it once, and not changing it, keeps the toggle from disturbing
          // the entry.
          textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
        />

        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={toggle.label}
          accessibilityState={{ selected: visible }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{
            position: 'absolute',
            right: 4,
            // Big enough to hit without the icon crowding the text. The row is
            // ~48px tall, so a 44px square is centred within it and meets the
            // minimum touch target.
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Icon and label come from one place: they follow OPPOSITE
              conventions (icon states the current state, label states the
              action) and keeping that pair together is what stops one of them
              being "fixed" to match the other. See lib/passwordToggle.ts. */}
          <Ionicons name={toggle.icon} size={20} color={Colors.subtext} />
        </Pressable>
      </View>
    </View>
  );
}

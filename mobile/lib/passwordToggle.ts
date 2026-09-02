/**
 * What the show/hide control on a password field should render and announce.
 *
 * Pure and free of react-native imports so it can be unit tested: the mobile
 * vitest project runs under plain Node, so a component cannot be exercised
 * there, but this — the part with an actual convention to get wrong — can.
 *
 * The convention is worth pinning precisely because it is invertible without
 * anyone noticing. Both halves are easy to reverse in a refactor, and neither
 * mistake looks wrong in a diff.
 */

export type PasswordToggleIcon = 'eye-outline' | 'eye-off-outline';

export interface PasswordToggle {
  icon: PasswordToggleIcon;
  /** Read by VoiceOver / TalkBack. */
  label: string;
}

export function passwordToggle(visible: boolean, fieldName: string): PasswordToggle {
  return {
    // The icon states the CURRENT state: an open eye means the password is on
    // screen right now. That is what every platform password field does, so
    // showing the ACTION instead would read as backwards to anyone who has used
    // one before.
    icon: visible ? 'eye-outline' : 'eye-off-outline',
    // The label states the ACTION, which is the opposite convention, and
    // deliberately so: a screen reader announces a button's label as the thing
    // pressing it will do. "Password shown" would be announced as an
    // instruction to show it, which is exactly wrong when it already is.
    label: `${visible ? 'Hide' : 'Show'} ${fieldName}`,
  };
}

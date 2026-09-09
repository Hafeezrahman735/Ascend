import { Linking } from 'react-native';

/**
 * Open a URL outside the app, without letting a failure become an unhandled
 * rejection.
 *
 * `Linking.openURL` rejects when nothing on the device can handle the URL, when
 * the scheme is malformed, and on iOS when the user dismisses the confirmation
 * for certain schemes. Every call site in this app previously ignored the
 * returned promise, so those cases surfaced as an unhandled rejection warning
 * and nothing else — the user tapped a row and it silently did nothing.
 *
 * Silently doing nothing is still the behaviour, deliberately: these are
 * "Privacy Policy" and "Terms" rows, and an error dialog for a link the user can
 * reach another way is more noise than help. The difference is that it is now a
 * contained, logged no-op rather than a stray rejection.
 *
 * console.warn rather than lib/log for the same reason alarm.ts uses it: log is
 * stripped in release, and a legal link that failed to open on a real device is
 * exactly what a device log needs to show.
 */
export function openExternal(url: string): void {
  Linking.openURL(url).catch((err) => {
    console.warn('[openExternal] failed to open', url, err);
  });
}

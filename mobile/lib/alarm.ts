import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { shouldSoundAlarm, alarmAudioMode, type AlarmPreferences } from './alarmPolicy';

/**
 * The noise a finished timer makes while you are looking at the app.
 *
 * ─── Why this exists at all ─────────────────────────────────────────────────
 *
 * The alarm was always bundled — `timer_complete.wav` is registered in app.json's
 * expo-notifications plugin and set as the Android channel sound — but
 * `configureNotificationHandler` suppressed it whenever the app was in the
 * foreground, to avoid duplicating the on-screen Alert. That dedupe compared the
 * wrong two things: a modal needs a glance, and an alarm exists precisely for the
 * moments you are not glancing. A phone face-up on a desk got a haptic and a
 * silent modal.
 *
 * ─── Why the notification handler was NOT the place to fix it ───────────────
 *
 * Flipping `shouldPlaySound` there looks like a one-line fix and is three bugs:
 *
 *  1. It is the GLOBAL handler. Daily reminders (notifications.ts:144) and goal
 *     reminders (:310) both post to the `ascend-timer` channel, whose sound is
 *     this same file — so a goal reminder mid-session would announce that your
 *     session had ended when it had not.
 *  2. Combined with this module it plays the alarm twice.
 *  3. Nondeterministically twice: useTimerNotifications.ts:44 cancels the pending
 *     notification the moment status leaves `running`, racing the OS firing it,
 *     so the double would come and go between runs.
 *
 * So the notification stays the BACKGROUND path and is untouched, and this module
 * is the only foreground sound. Foreground only, deliberately: playback is
 * triggered from JS and no JS runs while the app is suspended. Making this work
 * with the screen locked would need `shouldPlayInBackground` and `audio` in
 * UIBackgroundModes — which a timer has no honest claim to at App Store review.
 */

// Loaded as a Metro asset. NOT interchangeable with the expo-notifications
// plugin's `sounds` entry, which copies the same file to the iOS bundle root and
// Android res/raw for the OS to play by name. The file therefore ships twice;
// see the design doc's open question on trimming it.
const ALARM_ASSET = require('../assets/sounds/timer_complete.wav');

export type { AlarmPreferences } from './alarmPolicy';

/**
 * One player, reused. expo-audio players hold native resources, so creating one
 * per completion leaks them across a day of sessions.
 */
let player: AudioPlayer | null = null;

/**
 * Sound the alarm for a completed phase.
 *
 * `live` is false when the completion is being detected on return from the
 * background rather than as it happens — see shouldSoundAlarm, which owns that
 * rule and is tested.
 *
 * Never throws: a failed alarm must not break the completion path, which is also
 * what writes the finished session to the server.
 */
export async function playAlarm(prefs: AlarmPreferences, live: boolean): Promise<void> {
  if (!shouldSoundAlarm(prefs, live)) return;

  try {
    await setAudioModeAsync(alarmAudioMode(prefs));

    if (!player) player = createAudioPlayer(ALARM_ASSET);
    // Rewind first — a second completion inside the clip's length would
    // otherwise resume from wherever the last one stopped.
    await player.seekTo(0);
    player.play();
  } catch (err) {
    // console.warn, not lib/log: log is stripped in release, and an alarm that
    // silently failed on a real device is exactly what a device log needs.
    console.warn('[alarm] playback failed:', err);
  }
}

/**
 * Silence a playing alarm.
 *
 * Load-bearing, because the clip is 8.62 seconds and the Start button is one tap
 * away: after a focus completion the timer sits in `break` un-started, so without
 * this the alarm plays over the beginning of the next session. Dismissing the
 * Alert does not stop audio on its own.
 *
 * Safe to call when nothing is playing.
 */
export function stopAlarm(): void {
  if (!player) return;
  try {
    player.pause();
    void player.seekTo(0);
  } catch (err) {
    console.warn('[alarm] stop failed:', err);
  }
}

/** Release the native player. For teardown — logout, or a test tidying up. */
export function releaseAlarm(): void {
  if (!player) return;
  try {
    player.remove();
  } catch (err) {
    console.warn('[alarm] release failed:', err);
  } finally {
    player = null;
  }
}

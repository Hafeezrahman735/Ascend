/**
 * When the timer alarm sounds, and how.
 *
 * Split out of lib/alarm.ts so it can be tested: that module require()s the WAV
 * as a Metro asset and talks to a native player, neither of which loads under
 * plain Node. What is left here is the part with actual decisions in it.
 *
 * It also puts the two rules in one place. They started in two — `enabled` was
 * checked inside the player and `live` was checked in the focus screen — which
 * is the shape where one of them quietly stops matching the other.
 */

export interface AlarmPreferences {
  /** Settings → Notifications → "Alarm sound". */
  enabled: boolean;
  /**
   * Settings → Notifications → "Play even on silent". Governs the iOS audio
   * session in-app and the Android notification channel (timerNotificationSound).
   * Known gap: the in-app player on Android plays on the media stream, which
   * the ringer does not mute, so on Android the in-app sound rings on silent
   * whatever this says.
   */
  overrideSilentSwitch: boolean;
}

/**
 * Should this completion make a noise?
 *
 * `live` is false when the app was backgrounded at any point during the run,
 * which means the completion is being detected on RETURN, reconstructed from
 * wall-clock anchors — possibly long after the timer actually ended. The OS
 * notification was the alarm for that case, at the right moment. Sounding again
 * now would be an alarm for something that finished during lunch.
 *
 * The user still gets the modal and the haptic on a stale completion; that is
 * the acknowledgment that used to be missing entirely. This governs only sound.
 */
export function shouldSoundAlarm(prefs: AlarmPreferences, live: boolean): boolean {
  return prefs.enabled && live;
}

/** The audio-session mode an alarm plays under. */
export interface AlarmAudioMode {
  playsInSilentMode: boolean;
  /**
   * `duckOthers` where iOS permits it: this app's users have music or a podcast
   * running during a session, and an alarm mixed underneath at equal volume is
   * inaudible in exactly the case it exists for.
   *
   * It is not always permitted — see alarmAudioMode.
   */
  interruptionMode: 'duckOthers' | 'mixWithOthers';
}

/**
 * The audio session to request before sounding the alarm.
 *
 * THE PAIRING IS NOT FREE. expo-audio rejects one combination outright:
 *
 *   ios/AudioUtils.swift:179
 *     if !mode.playsInSilentMode && mode.interruptionMode == .duckOthers {
 *       throw InvalidAudioModeException(...)
 *     }
 *
 * playsInSilentMode false maps to the AVAudioSession `ambient` category, which
 * is inherently mixable and cannot duck anything. Asking for both threw, and the
 * throw silenced the alarm entirely for every user who had "Play even on silent"
 * turned off — the alarm only worked with BOTH switches on, which is not a
 * relationship either switch claims to have.
 *
 * So ducking is requested only when the session is allowed to duck. Someone with
 * the override off and music playing gets a quieter alarm than they otherwise
 * would; they used to get no alarm at all.
 */
export function alarmAudioMode(prefs: AlarmPreferences): AlarmAudioMode {
  return {
    playsInSilentMode: prefs.overrideSilentSwitch,
    interruptionMode: prefs.overrideSilentSwitch ? 'duckOthers' : 'mixWithOthers',
  };
}

/**
 * Whether an AppState change means the app really left the foreground during a
 * running segment, so the completion will not be live.
 *
 * Only 'background' counts. iOS reports 'inactive' for Control Center, the
 * notification shade, the app switcher, Face ID and call banners. JS keeps
 * running through all of them and the timer completes on time, but treating
 * them as leaving marked the run stale and silenced its alarm. Locking the
 * phone still counts: it goes inactive, then background.
 */
export function leftTheAppDuringRun(next: 'active' | 'inactive' | 'background' | string): boolean {
  return next === 'background';
}

/**
 * Which Android channel a timer notification posts to. Android decides a
 * notification's sound from its CHANNEL, not its content, and freezes each
 * channel's sound when it is first created — so each sound behaviour needs a
 * channel of its own.
 */
export type TimerChannel = 'alarm' | 'standard' | 'silent';

export interface TimerNotificationSound {
  /** iOS: whether the notification carries the alarm sound at all. */
  playsSound: boolean;
  /** Android: the channel whose sound matches the preferences. */
  androidChannel: TimerChannel;
}

/**
 * How the OS notification for a finished timer should sound — the alarm for
 * when the app is not on screen.
 *
 * The same two switches that govern the in-app alarm govern this one. Before,
 * the notification ignored both: turning "Alarm sound" off still rang from a
 * locked phone, and on Android the timer rang through silent with no way to
 * stop it.
 *
 *  - Alarm sound off         → no sound anywhere; the banner still shows.
 *  - Play even on silent on  → Android alarm stream, rings on silent.
 *  - Play even on silent off → an ordinary notification sound, which the
 *                              ringer switch silences like any other.
 *
 * iOS cannot ring a notification through silent without AlarmKit, so there the
 * override has no effect on this path until that lands; playsSound is all iOS
 * reads.
 */
export function timerNotificationSound(prefs: AlarmPreferences): TimerNotificationSound {
  if (!prefs.enabled) return { playsSound: false, androidChannel: 'silent' };
  return {
    playsSound: true,
    androidChannel: prefs.overrideSilentSwitch ? 'alarm' : 'standard',
  };
}

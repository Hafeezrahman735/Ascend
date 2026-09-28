import { describe, it, expect } from 'vitest';
import { shouldSoundAlarm, alarmAudioMode, leftTheAppDuringRun, timerNotificationSound, type AlarmPreferences } from './alarmPolicy';

const ON: AlarmPreferences = { enabled: true, overrideSilentSwitch: true };

describe('shouldSoundAlarm', () => {
  it('sounds on a live completion when the alarm is on', () => {
    expect(shouldSoundAlarm(ON, true)).toBe(true);
  });

  it('stays silent when the user turned the alarm off', () => {
    expect(shouldSoundAlarm({ ...ON, enabled: false }, true)).toBe(false);
  });

  it('stays silent on a completion detected after backgrounding', () => {
    // The OS notification already alarmed, at the right moment. Sounding now
    // would announce a session that ended during lunch.
    expect(shouldSoundAlarm(ON, false)).toBe(false);
  });

  it('is silent when both reasons apply, not accidentally audible', () => {
    expect(shouldSoundAlarm({ ...ON, enabled: false }, false)).toBe(false);
  });

  it('does not let the silent-switch override imply the alarm is on', () => {
    // Regression guard: overrideSilentSwitch is about HOW to play, never WHETHER.
    // Reading it as a second enable is the obvious way to get this wrong.
    expect(shouldSoundAlarm({ enabled: false, overrideSilentSwitch: true }, true)).toBe(false);
  });
});

describe('alarmAudioMode', () => {
  it('plays through the silent switch when the user allows it', () => {
    expect(alarmAudioMode(ON).playsInSilentMode).toBe(true);
  });

  it('respects the silent switch when the user turned the override off', () => {
    expect(alarmAudioMode({ ...ON, overrideSilentSwitch: false }).playsInSilentMode).toBe(false);
  });

  it('ducks other audio when the session is allowed to', () => {
    // A focus app's users are listening to something. Mixing at equal volume
    // makes the alarm inaudible in the one case it exists for — so duck where
    // iOS permits it.
    expect(alarmAudioMode(ON).interruptionMode).toBe('duckOthers');
  });

  it('never pairs duckOthers with playsInSilentMode false', () => {
    // REGRESSION. expo-audio throws on exactly this combination
    // (ios/AudioUtils.swift:179 — "playsInSilentMode == false and duckOthers ==
    // true cannot be set on iOS"). playAlarm awaited setAudioModeAsync before
    // play(), inside one try/catch, so the throw skipped playback entirely: the
    // alarm was silent for every user who had "Play even on silent" off, and
    // rang only when BOTH switches were on.
    //
    // This test fails against the previous implementation, which returned
    // 'duckOthers' unconditionally.
    const mode = alarmAudioMode({ enabled: true, overrideSilentSwitch: false });
    expect(mode.playsInSilentMode).toBe(false);
    expect(mode.interruptionMode).toBe('mixWithOthers');
  });

  it('produces a combination iOS accepts for every preference pairing', () => {
    for (const overrideSilentSwitch of [true, false]) {
      const mode = alarmAudioMode({ enabled: true, overrideSilentSwitch });
      const rejectedByIOS = !mode.playsInSilentMode && mode.interruptionMode === 'duckOthers';
      expect(rejectedByIOS).toBe(false);
    }
  });
});

describe('leftTheAppDuringRun', () => {
  it('counts a real trip to the background', () => {
    // Locking the phone or switching apps suspends JS; the OS notification is
    // the alarm for that run, so the in-app sound must stand down.
    expect(leftTheAppDuringRun('background')).toBe(true);
  });

  it('does NOT count a momentary inactive state', () => {
    // THE regression. Pulling down Control Center, the notification shade, the
    // app switcher, a Face ID prompt or a call banner all pass through
    // 'inactive' while JS keeps running and the timer completes live. Counting
    // them silenced the alarm for the rest of that session.
    expect(leftTheAppDuringRun('inactive')).toBe(false);
  });

  it('does not count coming back', () => {
    expect(leftTheAppDuringRun('active')).toBe(false);
  });
});

describe('timerNotificationSound', () => {
  it('rings on the alarm stream when both switches are on', () => {
    expect(timerNotificationSound({ enabled: true, overrideSilentSwitch: true }))
      .toEqual({ playsSound: true, androidChannel: 'alarm' });
  });

  it('uses an ordinary sound the silent switch can mute when the override is off', () => {
    // The rule: "Play even on silent" off means a phone on silent does not ring.
    // The alarm channel ignores the ringer, so it must not be used here.
    expect(timerNotificationSound({ enabled: true, overrideSilentSwitch: false }))
      .toEqual({ playsSound: true, androidChannel: 'standard' });
  });

  it('makes no sound at all when the alarm is off, whatever the override says', () => {
    // Regression: the notification used to ring regardless of "Alarm sound".
    for (const overrideSilentSwitch of [true, false]) {
      expect(timerNotificationSound({ enabled: false, overrideSilentSwitch }))
        .toEqual({ playsSound: false, androidChannel: 'silent' });
    }
  });
});

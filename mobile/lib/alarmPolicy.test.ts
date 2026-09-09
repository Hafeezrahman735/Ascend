import { describe, it, expect } from 'vitest';
import { shouldSoundAlarm, alarmAudioMode, type AlarmPreferences } from './alarmPolicy';

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

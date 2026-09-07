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

  it('always ducks other audio', () => {
    // A focus app's users are listening to something. Mixing at equal volume
    // makes the alarm inaudible in the one case it exists for.
    expect(alarmAudioMode(ON).interruptionMode).toBe('duckOthers');
    expect(alarmAudioMode({ enabled: true, overrideSilentSwitch: false }).interruptionMode).toBe('duckOthers');
  });
});

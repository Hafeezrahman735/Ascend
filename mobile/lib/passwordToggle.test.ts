import { describe, it, expect } from 'vitest';
import { passwordToggle } from './passwordToggle';

describe('passwordToggle', () => {
  it('shows an open eye when the password is visible', () => {
    // Open eye = "your password is on screen right now", matching every OS
    // password field. Inverting this is the easiest mistake to make here.
    expect(passwordToggle(true, 'password').icon).toBe('eye-outline');
  });

  it('shows a slashed eye when the password is hidden', () => {
    expect(passwordToggle(false, 'password').icon).toBe('eye-off-outline');
  });

  it('labels the ACTION, not the state, because that is how a button is read', () => {
    // A screen reader announces a button label as what pressing it does.
    // "Password shown" would be heard as an instruction to show it.
    expect(passwordToggle(true, 'password').label).toBe('Hide password');
    expect(passwordToggle(false, 'password').label).toBe('Show password');
  });

  it('uses the field name it is given, so two fields do not sound identical', () => {
    expect(passwordToggle(false, 'confirm password').label).toBe('Show confirm password');
  });

  it('never announces the same label for both states', () => {
    for (const name of ['password', 'confirm password', 'new password']) {
      expect(passwordToggle(true, name).label).not.toBe(passwordToggle(false, name).label);
      expect(passwordToggle(true, name).icon).not.toBe(passwordToggle(false, name).icon);
    }
  });
});

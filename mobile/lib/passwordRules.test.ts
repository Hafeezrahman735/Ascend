import { describe, it, expect } from 'vitest';
import { validateNewPassword, MIN_PASSWORD_LENGTH } from './passwordRules';

describe('validateNewPassword', () => {
  it('accepts a password at exactly the minimum', () => {
    expect(validateNewPassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it('rejects one character short', () => {
    expect(validateNewPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1)))
      .toMatch(/at least 8 characters/);
  });

  it('matches the minimum the server enforces', () => {
    // backend registerSchema is z.string().min(8), and resetSchema reuses it.
    // If the server moves and this does not, the client accepts a password the
    // API will reject — which surfaces as a confusing failure after submit.
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it('rejects a mismatched confirmation', () => {
    expect(validateNewPassword('longenough1', 'longenough2')).toMatch(/do not match/);
  });

  it('accepts a matching confirmation', () => {
    expect(validateNewPassword('longenough1', 'longenough1')).toBeNull();
  });

  it('skips the confirmation check when there is no confirmation field', () => {
    // The login form has one password input and no confirmation.
    expect(validateNewPassword('longenough1')).toBeNull();
  });

  it('reports length before mismatch, so the more basic problem is fixed first', () => {
    expect(validateNewPassword('short', 'different')).toMatch(/at least 8 characters/);
  });
});

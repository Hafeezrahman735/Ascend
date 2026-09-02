/**
 * The client-side password rule, in one place.
 *
 * The server is what enforces this — `resetSchema` reuses
 * `registerSchema.shape.password` precisely so signup and reset can never
 * diverge. This exists so the CLIENT does not diverge either: the same check
 * was written out on the register form and again on the reset form, and a rule
 * kept in two places is a rule that will eventually be two rules.
 *
 * The minimum matches the server's `z.string().min(8)`. If that moves, this
 * moves with it, and the test below is what makes the mismatch loud.
 */

export const MIN_PASSWORD_LENGTH = 8;

/** An error message to show, or null when the password is acceptable. */
export function validateNewPassword(password: string, confirmation?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  // Only checked when a confirmation field exists — login has none.
  if (confirmation !== undefined && password !== confirmation) {
    return 'Passwords do not match';
  }
  return null;
}

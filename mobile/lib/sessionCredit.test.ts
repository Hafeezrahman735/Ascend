import { describe, it, expect } from 'vitest';
import { creditableSessionSeconds, MAX_SESSION_SECONDS } from './sessionCredit';

/**
 * The contract these tests pin down is not "trim big numbers" — it is that the
 * client never reports a figure POST /timer/complete will refuse. The server
 * validates with `.int()` and `.max(MAX_SESSION_SECONDS)` and returns 400 rather
 * than clamping, so anything outside this range is a session that is credited on
 * the device and nowhere else.
 */
describe('creditableSessionSeconds', () => {
  it('credits the full run when it is inside the plan', () => {
    expect(creditableSessionSeconds(1200, 1500)).toBe(1200);
  });

  it('never credits more than the block that was planned', () => {
    expect(creditableSessionSeconds(1800, 1500)).toBe(1500);
  });

  it('credits the whole run when there is no plan — the stopwatch case', () => {
    expect(creditableSessionSeconds(4000, null)).toBe(4000);
  });

  it('treats a zero or negative plan as no plan', () => {
    expect(creditableSessionSeconds(900, 0)).toBe(900);
    expect(creditableSessionSeconds(900, -60)).toBe(900);
  });

  it('caps an unplanned run at the ceiling the server enforces', () => {
    // A stopwatch left running overnight. Before the cap this reported ~8h,
    // which the wire schema rejected outright — the device credited itself the
    // time and the server recorded no session at all.
    const overnight = 8 * 60 * 60;
    expect(creditableSessionSeconds(overnight, null)).toBe(MAX_SESSION_SECONDS);
  });

  it('caps a planned run whose plan is itself over the ceiling', () => {
    const sevenHours = 7 * 60 * 60;
    expect(creditableSessionSeconds(sevenHours, sevenHours)).toBe(MAX_SESSION_SECONDS);
  });

  it('floors a negative elapsed to zero rather than crediting backwards', () => {
    expect(creditableSessionSeconds(-30, 1500)).toBe(0);
  });

  it('always returns a whole number, because the wire schema is int', () => {
    for (const elapsed of [10.4, 999.99, 1499.5, MAX_SESSION_SECONDS + 0.7]) {
      expect(Number.isInteger(creditableSessionSeconds(elapsed, null))).toBe(true);
    }
  });

  it('never returns anything the completion schema would reject', () => {
    const cases: [number, number | null][] = [
      [0, null], [1, 1500], [86_400, null], [86_400, 90_000], [-5, null],
    ];
    for (const [elapsed, planned] of cases) {
      const credited = creditableSessionSeconds(elapsed, planned);
      expect(credited).toBeGreaterThanOrEqual(0);
      expect(credited).toBeLessThanOrEqual(MAX_SESSION_SECONDS);
      expect(Number.isInteger(credited)).toBe(true);
    }
  });
});

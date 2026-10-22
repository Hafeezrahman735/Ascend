import { describe, it, expect } from 'vitest';
import { localHourIn } from './localParts';

/**
 * localHourIn decides Early Bird (< 08:00) and Night Owl (>= 22:00), so the
 * cases sit on those boundaries, in zones chosen to be unambiguous: Tokyo and
 * Honolulu have no DST, Kolkata is a half-hour offset, Chicago crosses DST.
 */
const at = (iso: string) => new Date(iso);

describe('localHourIn', () => {
  it('reads the hour in the given zone, not the server’s', () => {
    // 13:00 UTC is 08:00 in Chicago (CDT) — the old getHours() on a UTC
    // server said 13 here, and said 1 for a Chicago 7pm session.
    expect(localHourIn(at('2026-10-21T13:00:00Z'), 'America/Chicago')).toBe(8);
    expect(localHourIn(at('2026-10-22T00:00:00Z'), 'America/Chicago')).toBe(19);
  });

  it('puts 07:59 and 08:00 on either side of the Early Bird line', () => {
    expect(localHourIn(at('2026-10-20T22:59:59Z'), 'Asia/Tokyo')).toBe(7);
    expect(localHourIn(at('2026-10-20T23:00:00Z'), 'Asia/Tokyo')).toBe(8);
  });

  it('puts 21:59 and 22:00 on either side of the Night Owl line', () => {
    expect(localHourIn(at('2026-10-21T07:59:59Z'), 'Pacific/Honolulu')).toBe(21);
    expect(localHourIn(at('2026-10-21T08:00:00Z'), 'Pacific/Honolulu')).toBe(22);
  });

  it('handles a half-hour offset', () => {
    expect(localHourIn(at('2026-10-21T02:29:00Z'), 'Asia/Kolkata')).toBe(7);
    expect(localHourIn(at('2026-10-21T02:30:00Z'), 'Asia/Kolkata')).toBe(8);
  });

  it('follows DST: the same UTC instant is a different local hour either side of the change', () => {
    // US clocks spring forward on 2026-03-08 and fall back on 2026-11-01.
    expect(localHourIn(at('2026-03-07T13:30:00Z'), 'America/Chicago')).toBe(7); // CST, UTC-6
    expect(localHourIn(at('2026-03-09T13:30:00Z'), 'America/Chicago')).toBe(8); // CDT, UTC-5
    expect(localHourIn(at('2026-10-31T12:30:00Z'), 'America/Chicago')).toBe(7); // CDT
    expect(localHourIn(at('2026-11-02T12:30:00Z'), 'America/Chicago')).toBe(6); // CST
  });

  it('reports midnight as 0, never 24', () => {
    expect(localHourIn(at('2026-10-21T15:00:00Z'), 'Asia/Tokyo')).toBe(0);
  });

  it('accepts UTC as a real zone', () => {
    expect(localHourIn(at('2026-10-21T06:00:00Z'), 'UTC')).toBe(6);
  });

  it('returns null rather than guessing when there is no usable zone', () => {
    expect(localHourIn(at('2026-10-21T06:00:00Z'), null)).toBeNull();
    expect(localHourIn(at('2026-10-21T06:00:00Z'), undefined)).toBeNull();
    expect(localHourIn(at('2026-10-21T06:00:00Z'), '')).toBeNull();
    expect(localHourIn(at('2026-10-21T06:00:00Z'), 'Not/A_Zone')).toBeNull();
  });
});

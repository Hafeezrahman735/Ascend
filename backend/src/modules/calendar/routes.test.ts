import { describe, it, expect } from 'vitest';
import { rangeBounds, toDateKey } from './routes';

/**
 * Task.dueDate is stored at UTC midnight of the intended calendar day, so an
 * inclusive `end` needs the bound pushed to the FOLLOWING midnight. A naive
 * `lte: end` silently drops everything due on the last day of the range — the
 * bug these tests exist to prevent.
 */
describe('rangeBounds', () => {
  const bounds = rangeBounds('2026-08-01', '2026-08-07');
  const within = (d: string) => {
    const t = new Date(d);
    return t >= bounds.gte && t < bounds.lt;
  };

  it('starts at the first day midnight', () => {
    expect(bounds.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('ends at the day AFTER the last day (half-open)', () => {
    expect(bounds.lt.toISOString()).toBe('2026-08-08T00:00:00.000Z');
  });

  it('includes an item due on the final day', () => {
    expect(within('2026-08-07T00:00:00.000Z')).toBe(true);
  });

  it('excludes the day after the range', () => {
    expect(within('2026-08-08T00:00:00.000Z')).toBe(false);
  });

  it('excludes the day before the range', () => {
    expect(within('2026-07-31T00:00:00.000Z')).toBe(false);
  });

  it('spans exactly 24h for a single-day (Day view) range', () => {
    const single = rangeBounds('2026-08-03', '2026-08-03');
    expect(single.lt.getTime() - single.gte.getTime()).toBe(86_400_000);
    const sameDay = new Date('2026-08-03T00:00:00.000Z');
    expect(sameDay >= single.gte && sameDay < single.lt).toBe(true);
  });

  it('rolls correctly over a month boundary', () => {
    expect(rangeBounds('2026-02-01', '2026-02-28').lt.toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('rolls correctly over a year boundary', () => {
    expect(rangeBounds('2026-12-28', '2026-12-31').lt.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('toDateKey', () => {
  it('maps an instant to its UTC calendar day', () => {
    expect(toDateKey(new Date('2026-08-03T00:00:00.000Z'))).toBe('2026-08-03');
  });

  it('does not roll over late in the day', () => {
    expect(toDateKey(new Date('2026-08-03T23:59:00.000Z'))).toBe('2026-08-03');
  });

  it('pads single-digit month and day', () => {
    expect(toDateKey(new Date('2026-01-05T12:00:00.000Z'))).toBe('2026-01-05');
  });
});

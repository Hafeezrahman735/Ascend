import { describe, it, expect } from 'vitest';
import {
  getLocalDateString,
  daysUntilLocalDate,
  formatDeadlineLabel,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addMonths,
  eachDayOfRange,
  pickerMinimumDate,
  pickerAcceptsValue,
  parseLocalDate,
  isSameDay,
} from './date';

/** Local 'YYYY-MM-DD' for a date `offset` days from today. */
const isoOffset = (offset: number) => {
  const now = new Date();
  return getLocalDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
};

describe('daysUntilLocalDate', () => {
  // Deadlines are calendar days. The old implementation subtracted epoch
  // milliseconds, which measured rolling 24-hour buckets — so "days left"
  // drifted through the day and shifted when the user travelled or hit DST.
  it.each([
    ['today', 0],
    ['tomorrow', 1],
    ['yesterday', -1],
    ['in 30 days', 30],
    ['90 days ago', -90],
  ])('%s -> %i', (_label, offset) => {
    expect(daysUntilLocalDate(isoOffset(offset))).toBe(offset);
  });

  it('always returns whole days, including across DST', () => {
    expect(Number.isInteger(daysUntilLocalDate('2026-03-15'))).toBe(true);
    expect(Number.isInteger(daysUntilLocalDate('2026-11-01'))).toBe(true);
  });

  it('returns null for missing or malformed input', () => {
    expect(daysUntilLocalDate(null)).toBeNull();
    expect(daysUntilLocalDate(undefined)).toBeNull();
    expect(daysUntilLocalDate('next tuesday')).toBeNull();
  });

  it('rejects an ISO instant — deadlines are date-only', () => {
    expect(daysUntilLocalDate('2026-08-10T00:00:00.000Z')).toBeNull();
  });
});

describe('formatDeadlineLabel', () => {
  it('reads naturally either side of the deadline', () => {
    expect(formatDeadlineLabel(isoOffset(0))).toBe('Due today');
    expect(formatDeadlineLabel(isoOffset(3))).toBe('3d left');
    expect(formatDeadlineLabel(isoOffset(-2))).toBe('2d overdue');
  });

  it('returns null when there is no deadline', () => {
    expect(formatDeadlineLabel(null)).toBeNull();
  });
});

describe('week ranges', () => {
  // 2026-08-03 is a Monday.
  const monday = new Date(2026, 7, 3);

  it('defaults to Sunday-anchored', () => {
    expect(getLocalDateString(startOfWeek(monday))).toBe('2026-08-02');
    expect(getLocalDateString(endOfWeek(monday))).toBe('2026-08-08');
  });

  it('leaves a Sunday as its own week start', () => {
    expect(getLocalDateString(startOfWeek(new Date(2026, 7, 2)))).toBe('2026-08-02');
  });

  it('spans exactly 7 days', () => {
    expect(eachDayOfRange(startOfWeek(monday), endOfWeek(monday))).toHaveLength(7);
  });

  // Honours the user's "week starts on" setting.
  describe('Monday-start (weekStartsOn = 1)', () => {
    it('anchors a mid-week day to its Monday', () => {
      const wednesday = new Date(2026, 7, 5);
      expect(getLocalDateString(startOfWeek(wednesday, 1))).toBe('2026-08-03');
      expect(getLocalDateString(endOfWeek(wednesday, 1))).toBe('2026-08-09');
    });

    it('leaves a Monday as its own week start', () => {
      expect(getLocalDateString(startOfWeek(monday, 1))).toBe('2026-08-03');
    });

    // The case a naive implementation gets wrong: Sunday belongs to the week
    // that STARTED the previous Monday, not the one beginning tomorrow.
    it('puts Sunday at the END of the previous week', () => {
      const sunday = new Date(2026, 7, 9);
      expect(getLocalDateString(startOfWeek(sunday, 1))).toBe('2026-08-03');
      expect(getLocalDateString(endOfWeek(sunday, 1))).toBe('2026-08-09');
    });

    it('still spans exactly 7 days', () => {
      expect(eachDayOfRange(startOfWeek(monday, 1), endOfWeek(monday, 1))).toHaveLength(7);
    });
  });
});

describe('month ranges', () => {
  it('covers a 31-day month', () => {
    const aug = new Date(2026, 7, 3);
    expect(getLocalDateString(startOfMonth(aug))).toBe('2026-08-01');
    expect(getLocalDateString(endOfMonth(aug))).toBe('2026-08-31');
    expect(eachDayOfRange(startOfMonth(aug), endOfMonth(aug))).toHaveLength(31);
  });

  it('handles February in a leap and a non-leap year', () => {
    const leap = new Date(2028, 1, 10);
    const nonLeap = new Date(2026, 1, 10);
    expect(eachDayOfRange(startOfMonth(leap), endOfMonth(leap))).toHaveLength(29);
    expect(eachDayOfRange(startOfMonth(nonLeap), endOfMonth(nonLeap))).toHaveLength(28);
  });
});

describe('stepping between ranges', () => {
  it('crosses a month end without skipping a day', () => {
    expect(getLocalDateString(addDays(new Date(2026, 7, 31), 1))).toBe('2026-09-01');
  });

  it('steps a week across a month boundary', () => {
    expect(getLocalDateString(addDays(new Date(2026, 7, 29), 7))).toBe('2026-09-05');
  });

  it('steps months across a year boundary in both directions', () => {
    expect(getLocalDateString(addMonths(new Date(2026, 11, 15), 1))).toBe('2027-01-01');
    expect(getLocalDateString(addMonths(new Date(2026, 0, 15), -1))).toBe('2025-12-01');
  });
});

describe('parseLocalDate', () => {
  // Must not UTC-shift: parsing '2026-08-03' and formatting it back has to be
  // identity in every timezone, or calendar cells land on the wrong day.
  it.each(['2026-08-03', '2026-03-08', '2026-11-01', '2026-01-01', '2026-12-31'])(
    'round-trips %s unchanged',
    (iso) => {
      expect(getLocalDateString(parseLocalDate(iso))).toBe(iso);
    },
  );
});

describe('isSameDay', () => {
  it('ignores the time component', () => {
    expect(isSameDay(new Date(2026, 7, 3, 1, 0), new Date(2026, 7, 3, 23, 59))).toBe(true);
  });

  it('separates adjacent days', () => {
    expect(isSameDay(new Date(2026, 7, 3, 23, 59), new Date(2026, 7, 4, 0, 1))).toBe(false);
  });
});

describe('pickerMinimumDate', () => {
  // 15:30 on 3 Aug 2026. The time of day matters: the old floor was this
  // instant, which put local midnight of the very same day beneath it.
  const now = new Date(2026, 7, 3, 15, 30);

  it('floors to the start of today, not to this instant', () => {
    expect(pickerMinimumDate(new Date(2026, 7, 10), now)).toEqual(new Date(2026, 7, 3));
  });

  it('admits a value at local midnight today', () => {
    const today = parseLocalDate('2026-08-03');
    expect(pickerMinimumDate(today, now).getTime()).toBeLessThanOrEqual(today.getTime());
  });

  // The crash: an overdue item opens its picker on a date months below the
  // floor, and iOS throws rather than clamping.
  it('drops back to a value in an earlier month', () => {
    const overdue = parseLocalDate('2026-05-19');
    expect(pickerMinimumDate(overdue, now)).toEqual(overdue);
  });

  it('drops back to a value one day old', () => {
    const yesterday = parseLocalDate('2026-08-02');
    expect(pickerMinimumDate(yesterday, now)).toEqual(yesterday);
  });

  it('never returns a floor above the value it was given', () => {
    for (const iso of ['2025-01-01', '2026-08-02', '2026-08-03', '2026-08-04', '2027-12-31']) {
      const value = parseLocalDate(iso);
      expect(pickerMinimumDate(value, now).getTime()).toBeLessThanOrEqual(value.getTime());
    }
  });
});

describe('pickerAcceptsValue', () => {
  // The crash these guard against is a native one, and it survived the first
  // fix. RNDateTimePickerComponentView.mm writes `picker.date` at line 172 and
  // does not relax `picker.minimumDate` until line 188, so a commit that moves
  // both props applies the new date against the OLD floor. Keeping the floor
  // consistent with the value is not enough — the floor has to be captured when
  // the picker opens and the picker has to unmount rather than be handed a value
  // that has since fallen beneath it.
  const floor = new Date(2026, 8, 1); // Sep 1, the start of today

  it('accepts a value on the floor itself', () => {
    expect(pickerAcceptsValue(floor, new Date(2026, 8, 1))).toBe(true);
  });

  it('accepts every value above the floor', () => {
    expect(pickerAcceptsValue(floor, new Date(2026, 8, 2))).toBe(true);
    expect(pickerAcceptsValue(floor, new Date(2027, 0, 1))).toBe(true);
  });

  it('rejects a value one day beneath the floor', () => {
    expect(pickerAcceptsValue(floor, new Date(2026, 7, 31))).toBe(false);
  });

  it('rejects a value a whole month beneath the floor — the reported crash', () => {
    // Opening the form on a fresh task fixes the floor at today, then the sheet
    // is re-seeded for an overdue task without the picker ever closing.
    expect(pickerAcceptsValue(floor, new Date(2026, 5, 15))).toBe(false);
  });

  it('rejects a value beneath the floor by less than a day', () => {
    // Both sides are local midnights in the app, but the comparison must be an
    // instant comparison rather than a day one, since that is what UIKit checks.
    expect(pickerAcceptsValue(floor, new Date(2026, 7, 31, 23, 59, 59))).toBe(false);
  });

  it('admits everything a picker opened at that value can produce', () => {
    // The composition that matters: a floor taken from pickerMinimumDate for a
    // value is always one that value satisfies, however overdue it is. Without
    // this, opening the picker would immediately unmount it.
    const now = new Date(2026, 8, 1, 15, 30);
    for (const value of [
      new Date(2025, 0, 1),
      new Date(2026, 5, 15),
      new Date(2026, 8, 1),
      new Date(2026, 8, 1, 23, 59),
      new Date(2027, 11, 31),
    ]) {
      expect(pickerAcceptsValue(pickerMinimumDate(value, now), value)).toBe(true);
    }
  });
});

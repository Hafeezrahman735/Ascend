import { describe, it, expect } from 'vitest';
import {
  utcDateStr,
  isPlausibleLocalDate,
  resolveLocalDate,
  dayNameFromLocalDate,
} from './localDate';

/**
 * These encode the timezone rules that caused real bugs: recurring habits were
 * spawning (and streaks resetting) against the SERVER's calendar day, so anyone
 * west of UTC lost their streak every evening.
 */
describe('utcDateStr', () => {
  it('pads month and day', () => {
    expect(utcDateStr(new Date('2026-01-05T12:00:00.000Z'))).toBe('2026-01-05');
  });

  it('does not roll over late in the UTC day', () => {
    expect(utcDateStr(new Date('2026-03-05T23:59:59.000Z'))).toBe('2026-03-05');
  });
});

describe('dayNameFromLocalDate', () => {
  // 2026-07-29 is a Wednesday.
  it.each([
    ['2026-07-29', 'wed'],
    ['2026-07-30', 'thu'],
    ['2026-08-01', 'sat'],
    ['2026-08-02', 'sun'],
  ])('%s -> %s', (date, expected) => {
    expect(dayNameFromLocalDate(date)).toBe(expected);
  });
});

describe('isPlausibleLocalDate', () => {
  const reference = new Date('2026-07-29T12:00:00.000Z');

  it('accepts the same UTC day', () => {
    expect(isPlausibleLocalDate('2026-07-29', reference)).toBe(true);
  });

  // Real timezones span UTC-12..UTC+14, so ±1 day is legitimate.
  it('accepts one day behind (far-west device)', () => {
    expect(isPlausibleLocalDate('2026-07-28', reference)).toBe(true);
  });

  it('accepts one day ahead (far-east device)', () => {
    expect(isPlausibleLocalDate('2026-07-30', reference)).toBe(true);
  });

  it('rejects two days out — no timezone is that far off', () => {
    expect(isPlausibleLocalDate('2026-07-27', reference)).toBe(false);
    expect(isPlausibleLocalDate('2026-07-31', reference)).toBe(false);
  });

  it('rejects a far-future date used to fabricate a streak', () => {
    expect(isPlausibleLocalDate('2030-01-01', reference)).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isPlausibleLocalDate('yesterday', reference)).toBe(false);
    expect(isPlausibleLocalDate('29-07-2026', reference)).toBe(false);
  });

  it('rejects a well-shaped but impossible date', () => {
    expect(isPlausibleLocalDate('2026-13-45', reference)).toBe(false);
  });
});

describe('resolveLocalDate', () => {
  it('keeps the user calendar day when the server has already rolled over', () => {
    // 5pm Monday in California is Tuesday 01:00 UTC. The habit is still Monday's.
    const californiaMondayEvening = new Date('2026-08-04T01:00:00.000Z');
    expect(utcDateStr(californiaMondayEvening)).toBe('2026-08-04'); // server says Tuesday
    expect(resolveLocalDate('2026-08-03', californiaMondayEvening)).toBe('2026-08-03');
  });

  it('accepts a client already on tomorrow (far-east device)', () => {
    const aucklandTuesdayMorning = new Date('2026-08-03T19:00:00.000Z');
    expect(resolveLocalDate('2026-08-04', aucklandTuesdayMorning)).toBe('2026-08-04');
  });

  it('falls back to the UTC date when no localDate is sent', () => {
    const reference = new Date('2026-07-29T12:00:00.000Z');
    expect(resolveLocalDate(undefined, reference)).toBe('2026-07-29');
    expect(resolveLocalDate(null, reference)).toBe('2026-07-29');
  });

  it('falls back rather than throwing on an implausible date', () => {
    const reference = new Date('2026-07-29T12:00:00.000Z');
    expect(resolveLocalDate('2030-01-01', reference)).toBe('2026-07-29');
  });
});

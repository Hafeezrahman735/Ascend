import { describe, it, expect } from 'vitest';
import { isCalendarDate, normalizeBlocks, firstTimedBlock, validateTimePair, MAX_BLOCKS_PER_TASK } from './workBlocks';

describe('isCalendarDate', () => {
  it('accepts a real day and rejects an impossible one', () => {
    expect(isCalendarDate('2026-11-02')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-13-45')).toBe(false);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-11-2')).toBe(false);
  });
});

describe('validateTimePair', () => {
  it('allows neither or both, end after start', () => {
    expect(validateTimePair(null, null)).toBeNull();
    expect(validateTimePair(540, 660)).toBeNull();
    expect(validateTimePair(540, null)).toMatch(/both/);
    expect(validateTimePair(660, 540)).toMatch(/after/);
    expect(validateTimePair(540, 540)).toMatch(/after/);
  });
});

describe('normalizeBlocks', () => {
  it('sorts by day then start, untimed last within a day', () => {
    const result = normalizeBlocks([
      { date: '2026-11-04' },
      { date: '2026-11-02', startMinutes: 840, endMinutes: 900 },
      { date: '2026-11-02' },
      { date: '2026-11-02', startMinutes: 540, endMinutes: 660 },
    ]);
    expect('blocks' in result && result.blocks).toEqual([
      { date: '2026-11-02', startMinutes: 540, endMinutes: 660 },
      { date: '2026-11-02', startMinutes: 840, endMinutes: 900 },
      { date: '2026-11-02', startMinutes: null, endMinutes: null },
      { date: '2026-11-04', startMinutes: null, endMinutes: null },
    ]);
  });

  it('rejects two any-time blocks on one day and two equal starts', () => {
    expect(normalizeBlocks([{ date: '2026-11-02' }, { date: '2026-11-02' }])).toEqual({ error: 'Only one any-time work block per day' });
    expect(normalizeBlocks([
      { date: '2026-11-02', startMinutes: 540, endMinutes: 600 },
      { date: '2026-11-02', startMinutes: 540, endMinutes: 660 },
    ])).toEqual({ error: 'Two work blocks start at the same time on the same day' });
  });

  it('rejects a bad pair and a list over the cap', () => {
    expect(normalizeBlocks([{ date: '2026-11-02', startMinutes: 540 }])).toHaveProperty('error');
    const many = Array.from({ length: MAX_BLOCKS_PER_TASK + 1 }, (_, i) => ({ date: '2026-11-02', startMinutes: i, endMinutes: i + 1 }));
    expect(normalizeBlocks(many)).toHaveProperty('error');
  });
});

describe('firstTimedBlock', () => {
  it('picks the earliest block that has a time', () => {
    expect(firstTimedBlock([
      { date: '2026-11-04', startMinutes: 600, endMinutes: 660 },
      { date: '2026-11-02', startMinutes: null, endMinutes: null },
      { date: '2026-11-03', startMinutes: 900, endMinutes: 960 },
    ])).toEqual({ date: '2026-11-03', startMinutes: 900, endMinutes: 960 });
    expect(firstTimedBlock([{ date: '2026-11-02', startMinutes: null, endMinutes: null }])).toBeNull();
  });
});

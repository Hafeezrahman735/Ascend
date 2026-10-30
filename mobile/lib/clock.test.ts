import { describe, expect, it } from 'vitest';
import { formatClock } from './clock';

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(252)).toBe('4:12');
    expect(formatClock(1122)).toBe('18:42');
  });

  it('adds hours past sixty minutes', () => {
    expect(formatClock(3909)).toBe('1:05:09');
  });

  it('never shows a negative or fractional time', () => {
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(59.9)).toBe('0:59');
  });
});

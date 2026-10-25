import { describe, it, expect } from 'vitest';
import {
  shiftKey, daysBetween, mondayIndex, weekRange,
  climbSeries, nextMilestone, activeDayShare, weekBars, heatmapCells, HEATMAP_WEEKS,
  weekdayAverages, peakWindow, hourLabel, groupGoals, paceShares,
  parsePlannedHours, paceCopy, plannedHoursText, topMovers, moverSentence,
  linePath, areaPath, indexAtX, dayLabel, weekLabel, compactHours,
} from './timeAnalytics';

const H = 3600;

describe('day keys', () => {
  it('shifts across month, year and DST boundaries by whole days', () => {
    expect(shiftKey('2026-03-28', 2)).toBe('2026-03-30');
    expect(shiftKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(daysBetween('2026-04-01', '2026-03-01')).toBe(-31);
  });

  it('indexes weekdays from Monday and finds the Monday-start week', () => {
    expect(mondayIndex('2026-10-19')).toBe(0); // Monday
    expect(mondayIndex('2026-10-25')).toBe(6); // Sunday
    expect(weekRange('2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(weekRange('2026-10-19', -1)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });
});

describe('climbSeries', () => {
  it('fills quiet days flat and ends on the all-time total at today', () => {
    const pts = climbSeries(
      [{ date: '2026-10-01', seconds: H }, { date: '2026-10-03', seconds: 2 * H }],
      '2026-10-05',
    );
    expect(pts.map((p) => p.total)).toEqual([H, H, 3 * H, 3 * H, 3 * H]);
    expect(pts[pts.length - 1].date).toBe('2026-10-05');
  });

  it('never goes down, and thins long histories while keeping both ends', () => {
    const daily = Array.from({ length: 900 }, (_, i) => ({ date: shiftKey('2024-01-01', i), seconds: (i % 3) * 600 }));
    const pts = climbSeries(daily, shiftKey('2024-01-01', 899), 100);
    expect(pts).toHaveLength(100);
    expect(pts[0].date).toBe('2024-01-01');
    expect(pts[99].total).toBe(daily.reduce((a, d) => a + d.seconds, 0));
    for (let i = 1; i < pts.length; i += 1) expect(pts[i].total).toBeGreaterThanOrEqual(pts[i - 1].total);
  });

  it('is empty with no history, and accepts unsorted input', () => {
    expect(climbSeries([], '2026-10-05')).toEqual([]);
    const pts = climbSeries([{ date: '2026-10-02', seconds: 60 }, { date: '2026-10-01', seconds: 60 }], '2026-10-02');
    expect(pts.map((p) => p.total)).toEqual([60, 120]);
  });
});

describe('nextMilestone', () => {
  it('climbs the early rungs, then every 100h', () => {
    expect(nextMilestone(0)).toEqual({ hours: 1, remainingSeconds: H });
    expect(nextMilestone(7 * H).hours).toBe(10);
    expect(nextMilestone(100 * H).hours).toBe(200);
    expect(nextMilestone(312 * H)).toEqual({ hours: 400, remainingSeconds: 88 * H });
  });
});

describe('activeDayShare', () => {
  it('divides active days by days since the first session, inclusive', () => {
    expect(activeDayShare(5, '2026-10-01', '2026-10-10')).toBe(0.5);
    expect(activeDayShare(1, '2026-10-10', '2026-10-10')).toBe(1);
    expect(activeDayShare(0, null, '2026-10-10')).toBeNull();
  });
});

describe('weekBars', () => {
  it('lays out Monday to Sunday and flags today and the future', () => {
    const bars = weekBars([{ date: '2026-10-20', seconds: 900 }], '2026-10-19', '2026-10-21');
    expect(bars.map((b) => b.seconds)).toEqual([0, 900, 0, 0, 0, 0, 0]);
    expect(bars[2].isToday).toBe(true);
    expect(bars.filter((b) => b.isFuture)).toHaveLength(4);
  });
});

describe('heatmapCells', () => {
  it('ends on the current week, Monday rows first, with a full rectangle', () => {
    const cells = heatmapCells([], '2026-10-21');
    expect(cells).toHaveLength(HEATMAP_WEEKS * 7);
    const last = cells[cells.length - 1];
    expect(last.date).toBe('2026-10-25');
    expect(last.row).toBe(6);
    expect(last.col).toBe(HEATMAP_WEEKS - 1);
    expect(last.isFuture).toBe(true);
    expect(mondayIndex(cells[0].date)).toBe(0);
  });

  it('levels by quartile of the user’s own active days', () => {
    const daily = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ date: shiftKey('2026-10-01', n), seconds: n * 600 }));
    const cells = heatmapCells(daily, '2026-10-21');
    const level = (d: string) => cells.find((c) => c.date === d)!.level;
    expect(level('2026-10-01')).toBe(0);
    expect(level(shiftKey('2026-10-01', 1))).toBe(1);
    expect(level(shiftKey('2026-10-01', 8))).toBe(4);
  });
});

describe('patterns', () => {
  it('averages each weekday by how often it occurs in the window', () => {
    // 2026-10-05 is a Monday; 8 days holds two Mondays and one of each other day.
    const sundayFirst = [700, 1200, 0, 0, 0, 0, 0];
    const avg = weekdayAverages(sundayFirst, '2026-10-05', '2026-10-12');
    expect(avg[0]).toBe(600); // Monday: 1200 over two Mondays
    expect(avg[6]).toBe(700); // Sunday
  });

  it('finds the busiest two-hour window and labels hours', () => {
    const byHour = new Array(24).fill(0);
    byHour[9] = 600; byHour[10] = 900; byHour[20] = 1000;
    expect(peakWindow(byHour)).toEqual({ start: 9, seconds: 1500 });
    expect(peakWindow(new Array(24).fill(0))).toBeNull();
    expect([hourLabel(0), hourLabel(9), hourLabel(12), hourLabel(23)]).toEqual(['12am', '9am', '12pm', '11pm']);
  });
});

describe('groupGoals', () => {
  const base = { plannedMinutes: 60, deadline: null, isCompleted: false, isArchived: false, createdAt: '2026-01-01' };
  it('puts planned goals by soonest deadline, undated last, and drops archived', () => {
    const g = groupGoals([
      { ...base, id: 'none', deadline: null },
      { ...base, id: 'late', deadline: '2026-12-01' },
      { ...base, id: 'soon', deadline: '2026-11-01' },
      { ...base, id: 'free', plannedMinutes: null },
      { ...base, id: 'done', isCompleted: true },
      { ...base, id: 'gone', isArchived: true },
    ]);
    expect(g.planned.map((x) => x.id)).toEqual(['soon', 'late', 'none']);
    expect(g.unplanned.map((x) => x.id)).toEqual(['free']);
    expect(g.completed.map((x) => x.id)).toEqual(['done']);
  });

  it('turns planned vs done into clamped bar shares', () => {
    expect(paceShares(30 * 60, 60, 15 * 60)).toEqual({ done: 0.5, expected: 0.25 });
    expect(paceShares(200 * 60, 60, null)).toEqual({ done: 1, expected: null });
  });
});

describe('planned hours input', () => {
  it('accepts whole and decimal hours, empty as no plan', () => {
    expect(parsePlannedHours('10')).toBe(600);
    expect(parsePlannedHours(' 1.5 ')).toBe(90);
    expect(parsePlannedHours('0,25')).toBe(15);
    expect(parsePlannedHours('')).toBeNull();
  });

  it('refuses what the server would refuse', () => {
    expect(parsePlannedHours('0')).toBeUndefined();
    expect(parsePlannedHours('-2')).toBeUndefined();
    expect(parsePlannedHours('abc')).toBeUndefined();
    expect(parsePlannedHours('1667')).toBeUndefined(); // 100,020 minutes
  });

  it('round-trips minutes to the text the form shows', () => {
    expect(plannedHoursText(600)).toBe('10');
    expect(plannedHoursText(90)).toBe('1.5');
    expect(plannedHoursText(null)).toBe('');
    expect(parsePlannedHours(plannedHoursText(100))).toBe(100);
  });
});

describe('trends', () => {
  it('keeps the biggest movers past the noise floor', () => {
    const movers = topMovers([
      { name: 'tiny', seconds: 600, previousSeconds: 0 },
      { name: 'big', seconds: 4 * H, previousSeconds: H },
      { name: 'new', seconds: H, previousSeconds: 0 },
    ]);
    expect(movers.map((m) => m.name)).toEqual(['big', 'new']);
    expect(moverSentence(movers[0], 'week')).toBe('big is up 300% from the previous week.');
    expect(moverSentence(movers[1], 'week')).toBe('new is new this week.');
  });
});

describe('chart geometry', () => {
  it('draws from bottom-left and closes the area to the baseline', () => {
    expect(linePath([0, 5, 10], 100, 50, 10)).toBe('M0,50 L50,25 L100,0');
    expect(areaPath([0, 10], 100, 50, 10)).toBe('M0,50 L100,0 L100,50 L0,50 Z');
    expect(linePath([], 100, 50, 10)).toBe('');
    expect(linePath([0, 0], 100, 50, 0)).toBe('M0,50 L100,50');
  });

  it('maps a finger position to the nearest point, clamped', () => {
    expect(indexAtX(0, 300, 10)).toBe(0);
    expect(indexAtX(300, 300, 10)).toBe(9);
    expect(indexAtX(-40, 300, 10)).toBe(0);
    expect(indexAtX(160, 300, 10)).toBe(5);
  });
});

describe('labels', () => {
  it('formats days, weeks and headline hours', () => {
    expect(dayLabel('2026-03-07')).toBe('Sat 7 Mar');
    expect(weekLabel('2026-10-19', '2026-10-25')).toBe('19–25 Oct');
    expect(weekLabel('2026-09-28', '2026-10-04')).toBe('28 Sep – 4 Oct');
    expect([compactHours(1800), compactHours(5400), compactHours(312 * H)]).toEqual(['30m', '1.5h', '312h']);
  });
});

describe('paceCopy', () => {
  const fmt = (s: number) => `${Math.round(s / 60)}m`;
  const pace = (status: Parameters<typeof paceCopy>[0]['status'], extra = {}) => ({
    status, remainingSeconds: 1800, deltaSeconds: null, perDayToFinishSeconds: null, ...extra,
  });
  it('states the gap and the daily fix when behind, and colours by status', () => {
    expect(paceCopy(pace('behind', { deltaSeconds: -3600, perDayToFinishSeconds: 1200 }), fmt))
      .toEqual({ text: 'Behind by 60m · 20m/day to finish', tone: 'warning' });
    expect(paceCopy(pace('ahead', { deltaSeconds: 900 }), fmt)).toEqual({ text: 'Ahead by 15m', tone: 'accent' });
    expect(paceCopy(pace('past_due'), fmt).text).toBe('Past due · 30m left');
    expect(paceCopy(pace('no_deadline'), fmt).text).toBe('30m left · no deadline');
    expect(paceCopy(pace('reached'), fmt).tone).toBe('accent');
    expect(paceCopy(pace('on_pace'), fmt)).toEqual({ text: 'On pace', tone: 'primary' });
  });
});

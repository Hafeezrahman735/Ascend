import { describe, it, expect } from 'vitest';
import {
  TYPE_META, DAY_GROUP_ORDER, calendarTaxonomyIsComplete, calendarItemKey,
  countsTowardLoad, isNote, itemTimeRange, itemIsDone, itemTitle, isPastEvent,
  bookedMinutes, groupItemsByDate, isRenderableCalendarItem,
  itemWeight, UNTIMED_TASK_WEIGHT, HABIT_WEIGHT, DEADLINE_WEIGHT, ALL_DAY_EVENT_WEIGHT,
} from './calendarItems';
import type { CalendarEvent, CalendarItem, CalendarItemType } from '../types';

function eventItem(over: Partial<CalendarEvent> = {}): CalendarItem {
  const data: CalendarEvent = {
    id: 'e1',
    title: 'Dentist',
    date: '2026-08-25',
    startMinutes: 14 * 60,
    endMinutes: 15 * 60,
    isArchived: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
  return { type: 'event', date: data.date, data };
}

describe('the calendar taxonomy', () => {
  // This is the guard, not a formality. DayView iterates DAY_GROUP_ORDER and
  // looks each type up in TYPE_META, so a type missing from the array renders
  // NOWHERE — fetched, stored, counted in the day's length, and invisible — and
  // a type missing from TYPE_META crashes on TYPE_META[type].icon.
  it('gives every declared item type both a meta entry and a place in the day order', () => {
    expect(calendarTaxonomyIsComplete()).toBe(true);
  });

  it('has no duplicate entries in the day order', () => {
    expect(new Set(DAY_GROUP_ORDER).size).toBe(DAY_GROUP_ORDER.length);
  });

  it('puts events first, so an all-day event frames the day rather than joining the queue', () => {
    expect(DAY_GROUP_ORDER[0]).toBe('event');
  });

  it('gives every type a non-empty label and icon', () => {
    for (const type of DAY_GROUP_ORDER) {
      expect(TYPE_META[type].label.length).toBeGreaterThan(0);
      expect(TYPE_META[type].icon.length).toBeGreaterThan(0);
    }
  });
});

describe('isRenderableCalendarItem', () => {
  // The two inputs this guards are the persisted range cache — `JSON.parse` of
  // whatever an older build left on disk — and the device calendar bridge.
  // Neither is validated by a type annotation, and every view reads through
  // `item.data` with an unchecked cast, so a bad row is a crashed tab rather
  // than a missing line. A cached one crashes it again after a restart.

  it('accepts a well-formed item of every declared type', () => {
    for (const type of DAY_GROUP_ORDER) {
      expect(isRenderableCalendarItem({ type, date: '2026-08-25', data: { id: 'x' } })).toBe(true);
    }
  });

  it('rejects a type this build does not know', () => {
    expect(isRenderableCalendarItem({ type: 'external_outlook', date: '2026-08-25', data: {} }))
      .toBe(false);
  });

  it('rejects an item with no data to render', () => {
    expect(isRenderableCalendarItem({ type: 'task', date: '2026-08-25', data: null })).toBe(false);
    expect(isRenderableCalendarItem({ type: 'task', date: '2026-08-25' })).toBe(false);
  });

  it('rejects a date that is not a day key, since every view buckets by it', () => {
    for (const date of ['2026-8-25', '25/08/2026', '2026-08-25T00:00:00Z', '', 20260825]) {
      expect(isRenderableCalendarItem({ type: 'task', date, data: { id: 'x' } })).toBe(false);
    }
  });

  it('rejects values that are not items at all', () => {
    for (const value of [null, undefined, 'task', 42, []]) {
      expect(isRenderableCalendarItem(value)).toBe(false);
    }
  });

  it('lets a real item through untouched', () => {
    const item = eventItem();
    expect(isRenderableCalendarItem(item)).toBe(true);
  });

  it('filters a mixed list down to what the views can draw', () => {
    const mixed: unknown[] = [
      eventItem(),
      { type: 'task', date: '2026-08-25', data: { id: 't1' } },
      { type: 'gremlin', date: '2026-08-25', data: {} },
      { type: 'note', date: 'tomorrow', data: {} },
      null,
    ];
    expect(mixed.filter(isRenderableCalendarItem)).toHaveLength(2);
  });
});

describe('calendarItemKey', () => {
  it('is stable for the same item and distinct across items', () => {
    const a = eventItem({ id: 'a' });
    const b = eventItem({ id: 'b' });
    expect(calendarItemKey(a)).toBe(calendarItemKey(eventItem({ id: 'a' })));
    expect(calendarItemKey(a)).not.toBe(calendarItemKey(b));
  });

  it('separates two types that happen to share an id', () => {
    const event = eventItem({ id: 'shared' });
    const note: CalendarItem = {
      type: 'note',
      date: '2026-08-25',
      data: { id: 'shared', content: 'x' },
    };
    expect(calendarItemKey(event)).not.toBe(calendarItemKey(note));
  });

  it('does not throw on data with no id', () => {
    const orphan: CalendarItem = { type: 'task', date: '2026-08-25', data: null };
    expect(() => calendarItemKey(orphan)).not.toThrow();
  });
});

describe('itemTimeRange for events', () => {
  it('reads the wall-clock minutes straight through', () => {
    expect(itemTimeRange(eventItem())).toEqual({ start: 840, end: 900 });
  });

  it('returns null for an all-day event, so it lands in the agenda not the grid', () => {
    expect(itemTimeRange(eventItem({ startMinutes: null, endMinutes: null }))).toBeNull();
  });

  it('treats a half-set pair as all-day rather than inventing an end', () => {
    // The server refuses to store one without the other, so this is bad data.
    // Drawing a block with a made-up end would be worse than showing it untimed.
    expect(itemTimeRange(eventItem({ endMinutes: null }))).toBeNull();
  });
});

describe('itemIsDone and countsTowardLoad', () => {
  it('never reports an event as done — you do not complete an appointment', () => {
    expect(itemIsDone(eventItem())).toBe(false);
  });

  it('counts an event as occupying the day, and a note as not', () => {
    expect(countsTowardLoad(eventItem())).toBe(true);
    expect(countsTowardLoad({ type: 'note', date: '2026-08-25', data: {} })).toBe(false);
  });

  it('titles an event by its title', () => {
    expect(itemTitle(eventItem({ title: 'Standup' }))).toBe('Standup');
  });
});

describe('isPastEvent', () => {
  const now = new Date(2026, 7, 25, 15, 30); // 25 Aug 2026, 15:30 local

  it('is true for a day already gone', () => {
    expect(isPastEvent(eventItem({ date: '2026-08-24' }), now)).toBe(true);
  });

  it('is false for a day still ahead', () => {
    expect(isPastEvent(eventItem({ date: '2026-08-26' }), now)).toBe(false);
  });

  it('is true once today\'s event has ended', () => {
    expect(isPastEvent(eventItem({ startMinutes: 780, endMinutes: 840 }), now)).toBe(true);
  });

  it('is false while today\'s event is still running', () => {
    expect(isPastEvent(eventItem({ startMinutes: 900, endMinutes: 960 }), now)).toBe(false);
  });

  it('is false for an all-day event today, however late it is', () => {
    expect(isPastEvent(eventItem({ startMinutes: null, endMinutes: null }), now)).toBe(false);
  });

  it('is false for anything that is not an event', () => {
    const task: CalendarItem = {
      type: 'task',
      date: '2020-01-01',
      data: { id: 't', title: 'Old', isCompleted: false },
    };
    expect(isPastEvent(task, now)).toBe(false);
  });
});

describe('bookedMinutes', () => {
  it('counts an event alongside a task — an hour is gone whatever the reason', () => {
    const task: CalendarItem = {
      type: 'task',
      date: '2026-08-25',
      data: { id: 't', title: 'Write', isCompleted: false, startMinutes: 540, endMinutes: 600 },
    };
    expect(bookedMinutes([task, eventItem()])).toBe(120);
  });

  it('ignores untimed items rather than guessing a length for them', () => {
    expect(bookedMinutes([eventItem({ startMinutes: null, endMinutes: null })])).toBe(0);
  });

  it('is zero for an empty day', () => {
    expect(bookedMinutes([])).toBe(0);
  });
});

describe('groupItemsByDate', () => {
  it('buckets by date, preserving order within a day', () => {
    const grouped = groupItemsByDate([
      eventItem({ id: 'a', date: '2026-08-25' }),
      eventItem({ id: 'b', date: '2026-08-26' }),
      eventItem({ id: 'c', date: '2026-08-25' }),
    ]);
    expect(grouped.get('2026-08-25')?.map((i) => (i.data as CalendarEvent).id)).toEqual(['a', 'c']);
    expect(grouped.get('2026-08-26')).toHaveLength(1);
  });
});

describe('countsTowardLoad is about weight, not visibility', () => {
  /**
   * This predicate used to be called `isScheduledItem`, and Week and Month both
   * filtered their DISPLAY lists through it. The result: a plain note was
   * unreachable outside Day view, a note-only day rendered an empty week column
   * and an unshaded month cell, and Day view printed "Nothing on this day"
   * directly above the notes it was holding. Splitting the predicate is the fix;
   * these pin the contract so it cannot be re-merged by accident.
   */
  it('excludes only notes, and includes every other declared type', () => {
    for (const type of DAY_GROUP_ORDER) {
      const item: CalendarItem = { type, date: '2026-08-25', data: { title: 'x', content: 'x' } };
      expect(countsTowardLoad(item), type).toBe(type !== 'note');
    }
  });

  it('partitions every type exactly once — nothing is both, nothing is neither', () => {
    for (const type of DAY_GROUP_ORDER) {
      const item: CalendarItem = { type, date: '2026-08-25', data: { title: 'x', content: 'x' } };
      expect(countsTowardLoad(item) !== isNote(item), type).toBe(true);
    }
  });

  it('keeps a goal deadline visible — a due date is a commitment, not a jotting', () => {
    const deadline: CalendarItem = {
      type: 'goal_deadline', date: '2026-08-25', data: { id: 'g', title: 'Ship it', deadline: '2026-08-25' },
    };
    expect(countsTowardLoad(deadline)).toBe(true);
    expect(isNote(deadline)).toBe(false);
  });

  it('does not let notes inflate booked time', () => {
    const note: CalendarItem = { type: 'note', date: '2026-08-25', data: { id: 'n', content: 'x' } };
    expect(bookedMinutes([note, note, note])).toBe(0);
    expect(bookedMinutes([eventItem(), note])).toBe(60);
  });
});

describe('every type is handled by the shared helpers', () => {
  // Reaching a `default` branch is how a new type ends up rendering as a blank
  // row instead of failing loudly, so exercise all of them.
  it('returns a string title for every declared type without throwing', () => {
    for (const type of DAY_GROUP_ORDER as CalendarItemType[]) {
      const item: CalendarItem = { type, date: '2026-08-25', data: { title: 'x', content: 'x' } };
      expect(typeof itemTitle(item)).toBe('string');
    }
  });
});


describe('itemWeight', () => {
  /**
   * Weight is what the month heat map shades by. It used to shade by booked
   * minutes, which meant it counted only the items carrying a clock — so an
   * untimed task and a goal deadline both scored zero, and a day holding a hard
   * deadline rendered as an empty one.
   *
   * The constants below are invented calibration, not measurements. These tests
   * reference the exported constants rather than the literals on purpose: tuning
   * them is expected, and a test that hardcodes 30 turns a deliberate adjustment
   * into a red suite.
   */

  const at = (startMinutes: number, endMinutes: number) => ({
    id: 't', title: 'Write', isCompleted: false, startMinutes, endMinutes,
  });

  it('weighs a timed task by its real duration', () => {
    const item: CalendarItem = { type: 'task', date: '2026-08-25', data: at(540, 630) };
    expect(itemWeight(item)).toBe(90);
  });

  it('gives an untimed task a default rather than nothing', () => {
    const item: CalendarItem = {
      type: 'task',
      date: '2026-08-25',
      data: { id: 't', title: 'Write', isCompleted: false },
    };
    expect(itemWeight(item)).toBe(UNTIMED_TASK_WEIGHT);
  });

  it('weighs a recurring task flat, whether or not it carries a time', () => {
    // The projected occurrence the calendar route sends for a future date is a
    // deliberately narrow placeholder: title and isCompleted, no startMinutes.
    // Weighting by duration would make today's spawned copy heavier than the
    // identical one next Tuesday, and next Tuesday would darken by itself the
    // morning it spawned. The accepted cost is that a two-hour habit weighs the
    // same as a five-minute one.
    const spawned: CalendarItem = { type: 'habit_instance', date: '2026-08-25', data: at(540, 660) };
    const projected: CalendarItem = {
      type: 'habit_instance',
      date: '2026-09-01',
      data: { id: 'projected:x:2026-09-01', title: 'Read', isCompleted: false },
    };
    expect(itemWeight(spawned)).toBe(HABIT_WEIGHT);
    expect(itemWeight(projected)).toBe(HABIT_WEIGHT);
    expect(itemWeight(spawned)).toBe(itemWeight(projected));
  });

  it('gives a goal deadline weight — it has no clock but it is still a claim on the day', () => {
    const item: CalendarItem = {
      type: 'goal_deadline',
      date: '2026-08-25',
      data: { id: 'g', title: 'Ship it' },
    };
    expect(itemWeight(item)).toBe(DEADLINE_WEIGHT);
  });

  it('weighs a timed event by its duration', () => {
    expect(itemWeight(eventItem())).toBe(60);
  });

  it('weighs an all-day event heaviest of all — a conference is the whole day', () => {
    expect(itemWeight(eventItem({ startMinutes: null, endMinutes: null })))
      .toBe(ALL_DAY_EVENT_WEIGHT);
  });

  it('weighs an all-day external event the same way', () => {
    const item: CalendarItem = {
      type: 'external_google',
      date: '2026-08-25',
      data: { id: 'g1', title: 'Offsite', isAllDay: true, startTime: null },
    };
    expect(itemWeight(item)).toBe(ALL_DAY_EVENT_WEIGHT);
  });

  it('treats a zero-length block as its untimed self, not as nothing', () => {
    // Guards the invariant below against bad data: a start equal to its end
    // would otherwise sum to zero and shade the day free.
    const task: CalendarItem = { type: 'task', date: '2026-08-25', data: at(540, 540) };
    expect(itemWeight(task)).toBe(UNTIMED_TASK_WEIGHT);
    expect(itemWeight(eventItem({ startMinutes: 540, endMinutes: 540 })))
      .toBe(ALL_DAY_EVENT_WEIGHT);
  });

  it('gives a note and a to-do no weight at all', () => {
    const noteData = { id: 'n', content: 'idea', isTodo: false, isCompleted: false };
    const note: CalendarItem = { type: 'note', date: '2026-08-25', data: noteData };
    const todo: CalendarItem = {
      type: 'note',
      date: '2026-08-25',
      data: { ...noteData, isTodo: true },
    };
    expect(itemWeight(note)).toBe(0);
    expect(itemWeight(todo)).toBe(0);
  });

  it('gives EVERY non-note type a positive weight', () => {
    /**
     * The invariant MonthView deleted its count-based fallback on. That fallback
     * existed only because untimed items scored zero; without it, any type that
     * weighs nothing renders its whole day as free — which is worse than the bug
     * this all replaced. A new CalendarItemType that forgets a branch fails here
     * rather than in someone's calendar.
     */
    for (const type of DAY_GROUP_ORDER) {
      if (type === 'note') continue;
      // Deliberately bare data: no times, no fields beyond identity. This is the
      // worst case, and it is exactly the shape a projected item arrives in.
      const item: CalendarItem = { type, date: '2026-08-25', data: { id: 'x', title: 'x' } };
      expect(itemWeight(item), type).toBeGreaterThan(0);
    }
  });

  it('leaves bookedMinutes alone — a day of untimed work still books nothing', () => {
    // The two numbers must not converge. MonthView shades by weight and prints
    // booked minutes; if weight leaked into that tile, a day with one untimed
    // task would report "30m booked" having booked nothing.
    const untimed: CalendarItem = {
      type: 'task',
      date: '2026-08-25',
      data: { id: 't', title: 'Write', isCompleted: false },
    };
    expect(itemWeight(untimed)).toBeGreaterThan(0);
    expect(bookedMinutes([untimed])).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  TYPE_META, DAY_GROUP_ORDER, calendarTaxonomyIsComplete, calendarItemKey,
  isScheduledItem, itemTimeRange, itemIsDone, itemTitle, isPastEvent,
  bookedMinutes, groupItemsByDate,
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

describe('itemIsDone and isScheduledItem', () => {
  it('never reports an event as done — you do not complete an appointment', () => {
    expect(itemIsDone(eventItem())).toBe(false);
  });

  it('counts an event as occupying the day, and a note as not', () => {
    expect(isScheduledItem(eventItem())).toBe(true);
    expect(isScheduledItem({ type: 'note', date: '2026-08-25', data: {} })).toBe(false);
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

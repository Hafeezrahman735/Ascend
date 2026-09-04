import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { touchKey } from '../lib/lruIndex';
import { api } from '../services/api';
import type { CalendarEvent, CalendarItem, CalendarStats, GoogleCalendarStatus, Note } from '../types';
import { useAuthStore } from './authStore';
import { isRenderableCalendarItem } from '../lib/calendarItems';
import {
  fetchAppleEvents,
  getSelectedCalendarId,
  isAppleCalendarSupported,
} from '../services/appleCalendar';

/**
 * Calendar data for the visible range.
 *
 * Cached per range rather than as one blob: users scrub back and forth across
 * weeks and months, and a single cache key would mean refetching a range that
 * was already loaded a moment ago.
 */

const rangeKey = (userId: string, start: string, end: string) =>
  `calendar:cache:${userId}:${start}:${end}`;

// Keep the set of cached range keys so logout can clear them all — AsyncStorage
// has no prefix-delete.
const INDEX_KEY = (userId: string) => `calendar:cache:index:${userId}`;

/**
 * How many ranges are kept on disk.
 *
 * There was no cap at all: every week or month ever scrolled to left a
 * permanent key behind, and the index listing them was re-parsed and
 * re-serialised on every write. Scrubbing through a year of months meant
 * hundreds of orphaned keys that only a logout would clear.
 *
 * Twelve is sized for the way the calendar is actually used — a few weeks
 * either side of now, plus the odd month view — and the LRU means the range you
 * keep returning to survives a scroll past a dozen others.
 */
const MAX_CACHED_RANGES = 12;

/**
 * Keeps only the items the views can actually render.
 *
 * Applied to both sources that are not this build's own code: the disk cache,
 * which an older build wrote and which no type annotation validates, and the
 * merged fetch result, which includes device-calendar rows from the native
 * bridge. Every view casts through `item.data` unchecked, so one malformed row
 * takes the whole tab down rather than itself.
 *
 * Logged rather than dropped quietly — an item vanishing from the calendar is
 * exactly the kind of thing that should leave a trace.
 */
function renderableOnly(items: unknown, source: string): CalendarItem[] {
  if (!Array.isArray(items)) {
    console.warn(`[calendarStore] ${source} was not an array — ignoring`);
    return [];
  }
  const kept = items.filter(isRenderableCalendarItem);
  if (kept.length !== items.length) {
    console.warn(`[calendarStore] dropped ${items.length - kept.length} unrenderable item(s) from ${source}`);
  }
  return kept;
}

async function readCache(userId: string, start: string, end: string): Promise<CalendarItem[] | null> {
  try {
    const raw = await AsyncStorage.getItem(rangeKey(userId, start, end));
    return raw ? renderableOnly(JSON.parse(raw), 'cache') : null;
  } catch {
    return null;
  }
}

async function writeCache(
  userId: string,
  start: string,
  end: string,
  items: CalendarItem[],
): Promise<void> {
  try {
    const key = rangeKey(userId, start, end);
    await AsyncStorage.setItem(key, JSON.stringify(items));

    const rawIndex = await AsyncStorage.getItem(INDEX_KEY(userId));
    const stored: string[] = rawIndex ? JSON.parse(rawIndex) : [];
    const { index, evicted } = touchKey(stored, key, MAX_CACHED_RANGES);

    // Drop the payloads first: an index that still lists an evicted key is
    // recoverable on the next write, but a key with no index entry is a leak
    // nothing will ever clean up.
    if (evicted.length > 0) await AsyncStorage.multiRemove(evicted);
    await AsyncStorage.setItem(INDEX_KEY(userId), JSON.stringify(index));
  } catch (err) {
    console.warn('[calendarStore] cache write failed:', err);
  }
}

async function clearCache(userId: string): Promise<void> {
  try {
    const rawIndex = await AsyncStorage.getItem(INDEX_KEY(userId));
    const index: string[] = rawIndex ? JSON.parse(rawIndex) : [];
    if (index.length > 0) await AsyncStorage.multiRemove(index);
    await AsyncStorage.removeItem(INDEX_KEY(userId));
  } catch {
    /* best effort */
  }
}

export interface EventInput {
  title: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** Minutes from local midnight. Both null together is an all-day event. */
  startMinutes?: number | null;
  endMinutes?: number | null;
}

/** True when a date falls inside the range currently painted on screen. */
function inLoadedRange(range: { start: string; end: string } | null, date: string): boolean {
  return !!range && date >= range.start && date <= range.end;
}

interface CalendarStoreState {
  /** Items for the currently-viewed range, server + device merged. */
  items: CalendarItem[];
  notes: Note[];
  stats: CalendarStats | null;
  googleStatus: GoogleCalendarStatus | null;
  isLoading: boolean;
  isLoadingStats: boolean;
  error: string | null;
  /** Set when Google is connected but its events couldn't be loaded this fetch. */
  syncWarning: string | null;
  loadedRange: { start: string; end: string } | null;
  /**
   * Set when another store changes something the calendar renders — a task
   * created, rescheduled, completed or deleted. The calendar screen refetches
   * on focus while this is true, so switching back from the Tasks tab never
   * shows a stale day.
   */
  isStale: boolean;

  fetchRange: (start: string, end: string) => Promise<void>;
  fetchStats: (start: string, end: string) => Promise<void>;
  fetchGoogleStatus: () => Promise<void>;
  createNote: (data: { content: string; date?: string | null; isTodo?: boolean }) => Promise<void>;
  updateNote: (id: string, data: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  /**
   * Events live only inside `items` — there is no second slice.
   *
   * Notes have one because the app needs unscheduled notes, which GET /calendar
   * cannot return. An event always carries a date, so `items` is a complete
   * source for it and a parallel array could only ever disagree with itself.
   */
  createEvent: (data: EventInput) => Promise<CalendarEvent | null>;
  updateEvent: (id: string, data: Partial<EventInput>) => Promise<boolean>;
  deleteEvent: (id: string) => Promise<void>;
  clearCalendar: (userId?: string) => void;
  /** Marks the calendar for refetch after an external change. */
  invalidate: () => void;
}

export const useCalendarStore = create<CalendarStoreState>((set, get) => ({
  items: [],
  notes: [],
  stats: null,
  googleStatus: null,
  isLoading: false,
  isLoadingStats: false,
  error: null,
  syncWarning: null,
  loadedRange: null,
  isStale: false,

  fetchRange: async (start, end) => {
    const userId = useAuthStore.getState().user?.id;
    set({ isLoading: true, error: null, syncWarning: null, loadedRange: { start, end } });

    // Paint cached items for this exact range immediately, so scrubbing back to a
    // week you already visited is instant rather than a spinner.
    if (userId) {
      const cached = await readCache(userId, start, end);
      if (cached) set({ items: cached, isLoading: false });
    }

    try {
      const res = await api.get<{
        items: CalendarItem[];
        googleConnected: boolean;
        googleSyncError: string | null;
      }>(`/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);

      if (!res.success || !res.data) {
        set({ error: res.error || 'Failed to load calendar', isLoading: false });
        return;
      }

      let items = res.data.items;

      // Apple events are read on-device and merged here — never fetched by, or
      // stored on, the server.
      if (userId && isAppleCalendarSupported()) {
        const appleCalendarId = await getSelectedCalendarId(userId);
        if (appleCalendarId) {
          const appleItems = await fetchAppleEvents(appleCalendarId, start, end);
          items = [...items, ...appleItems];
        }
      }

      // A later range change may have landed while this request was in flight.
      const current = get().loadedRange;
      if (current && (current.start !== start || current.end !== end)) return;

      items = renderableOnly(items, 'fetch');

      const notes = items
        .filter((i) => i.type === 'note')
        .map((i) => i.data as Note);

      set({
        items,
        notes,
        isLoading: false,
        isStale: false,
        syncWarning: res.data.googleSyncError,
      });

      if (userId) writeCache(userId, start, end, items);
    } catch {
      set({ error: 'Failed to load calendar', isLoading: false });
    }
  },

  fetchStats: async (start, end) => {
    set({ isLoadingStats: true });
    try {
      // tzOffset so day-of-week buckets follow the user's calendar day.
      const tzOffset = -new Date().getTimezoneOffset();
      const res = await api.get<CalendarStats>(
        `/calendar/stats?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&tzOffset=${tzOffset}`,
      );
      set({ stats: res.success && res.data ? res.data : null, isLoadingStats: false });
    } catch {
      set({ isLoadingStats: false });
    }
  },

  fetchGoogleStatus: async () => {
    try {
      const res = await api.get<GoogleCalendarStatus>('/calendar/google/status');
      if (res.success && res.data) set({ googleStatus: res.data });
    } catch {
      /* non-critical */
    }
  },

  createNote: async (data) => {
    const previous = get().notes;
    const tempId = `temp-${Date.now()}`;
    const optimistic: Note = {
      id: tempId,
      content: data.content,
      date: data.date ?? null,
      isTodo: data.isTodo ?? false,
      isCompleted: false,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set({ notes: [...previous, optimistic] });

    try {
      const res = await api.post<Note>('/notes', data);
      if (res.success && res.data) {
        const confirmed = res.data;
        set({
          notes: get().notes.map((n) => (n.id === tempId ? confirmed : n)),
          // Keep the aggregated item list in step so Day view updates without a refetch.
          items: [
            ...get().items.filter((i) => !(i.type === 'note' && (i.data as Note).id === tempId)),
            ...(confirmed.date ? [{ type: 'note' as const, date: confirmed.date, data: confirmed }] : []),
          ],
        });
      } else {
        set({ notes: previous });
      }
    } catch {
      set({ notes: previous });
    }
  },

  updateNote: async (id, data) => {
    const previous = get().notes;
    const previousItems = get().items;
    const applyLocal = (n: Note) => (n.id === id ? { ...n, ...data } : n);
    set({
      notes: previous.map(applyLocal),
      items: previousItems.map((i) =>
        i.type === 'note' && (i.data as Note).id === id
          ? { ...i, data: applyLocal(i.data as Note) }
          : i,
      ),
    });

    try {
      const res = await api.patch<Note>(`/notes/${id}`, data);
      if (!res.success) set({ notes: previous, items: previousItems });
    } catch {
      set({ notes: previous, items: previousItems });
    }
  },

  deleteNote: async (id) => {
    const previous = get().notes;
    const previousItems = get().items;
    set({
      notes: previous.filter((n) => n.id !== id),
      items: previousItems.filter((i) => !(i.type === 'note' && (i.data as Note).id === id)),
    });

    try {
      const res = await api.delete(`/notes/${id}`);
      if (!res.success) set({ notes: previous, items: previousItems });
    } catch {
      set({ notes: previous, items: previousItems });
    }
  },

  createEvent: async (data) => {
    try {
      const res = await api.post<CalendarEvent>('/events', data);
      if (!res.success || !res.data) {
        set({ error: res.error || 'Could not create the event' });
        return null;
      }
      const created = res.data;
      // Only merge into `items` when the new date is on screen. Splicing in a
      // day the current range does not cover would show a row that the next
      // refetch silently removes.
      if (inLoadedRange(get().loadedRange, created.date)) {
        set({ items: [...get().items, { type: 'event', date: created.date, data: created }] });
      }
      return created;
    } catch {
      set({ error: 'Could not create the event' });
      return null;
    }
  },

  updateEvent: async (id, data) => {
    const previousItems = get().items;
    try {
      const res = await api.patch<CalendarEvent>(`/events/${id}`, data);
      if (!res.success || !res.data) {
        set({ error: res.error || 'Could not update the event' });
        return false;
      }
      const updated = res.data;
      // Applied after the server answers rather than optimistically: an event can
      // change DAY, and moving a row between buckets before the write is
      // confirmed means unwinding two days on failure instead of one.
      const withoutOld = previousItems.filter(
        (i) => !(i.type === 'event' && (i.data as CalendarEvent).id === id),
      );
      set({
        items: inLoadedRange(get().loadedRange, updated.date)
          ? [...withoutOld, { type: 'event', date: updated.date, data: updated }]
          : withoutOld,
      });
      return true;
    } catch {
      set({ error: 'Could not update the event' });
      return false;
    }
  },

  deleteEvent: async (id) => {
    const previousItems = get().items;
    set({
      items: previousItems.filter(
        (i) => !(i.type === 'event' && (i.data as CalendarEvent).id === id),
      ),
    });

    try {
      const res = await api.delete(`/events/${id}`);
      if (!res.success) set({ items: previousItems, error: 'Could not delete the event' });
    } catch {
      set({ items: previousItems, error: 'Could not delete the event' });
    }
  },

  // Called by other stores after they change something the calendar shows.
  // The persisted range cache is dropped too: it is painted instantly on the
  // next visit, so leaving it would briefly redisplay a task that was just
  // deleted or rescheduled.
  invalidate: () => {
    const userId = useAuthStore.getState().user?.id;
    if (userId) void clearCache(userId);
    set({ isStale: true });
  },

  clearCalendar: (userId?: string) => {
    const resolved = userId ?? useAuthStore.getState().user?.id;
    set({
      items: [],
      notes: [],
      stats: null,
      googleStatus: null,
      isLoading: false,
      error: null,
      syncWarning: null,
      loadedRange: null,
      isStale: false,
    });
    if (resolved) clearCache(resolved);
  },
}));

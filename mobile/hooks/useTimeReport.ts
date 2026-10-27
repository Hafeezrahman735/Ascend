import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { getLocalDateString, getDeviceTimeZone } from '../utils/date';
import type { TimeReport, TimeHistory, TimeSessionsPage, GoalDaily } from '../types';

/**
 * Fetches `GET /time-report` (by period or window), `/time-report/history`
 * and `/time-report/sessions`.
 *
 * The report is screen-local: nothing else reads it, and it is derived data
 * that must not become a second source of truth beside the session history. So
 * it lives in component state rather than a store.
 *
 * Two things worth knowing about the shape below:
 *
 * - `loading` is DERIVED by comparing the request key to the key of whatever
 *   is currently loaded, rather than being its own state written at the top of
 *   the effect. That keeps the effect free of a synchronous setState (which
 *   causes a cascading render) and makes it impossible for a spinner to get
 *   stuck on if a code path forgets to clear it.
 * - Every request is cancellable. Switching period twice quickly used to let
 *   the slower first response land last and overwrite the newer one, so the
 *   screen showed a period the switcher was not pointing at.
 */

export type ReportPeriod = 'today' | 'week' | 'month' | 'quarter' | 'all';

export const REPORT_PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'all', label: 'All' },
];

/**
 * The server refuses a range longer than 730 days, so "All" is the last two
 * years rather than literally everything. The screen prints the resolved range
 * under the headline instead of quietly implying a longer history.
 */
const ALL_DAYS = 729;
const QUARTER_DAYS = 89;

/** Shift a local Date by whole days without tripping over DST. */
function shiftDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export function rangeFor(period: ReportPeriod, now: Date = new Date()): { from: string; to: string } {
  const to = getLocalDateString(now);

  switch (period) {
    case 'today':
      return { from: to, to };
    case 'week': {
      // Monday-start, matching getMonday on the tasks screen.
      const day = now.getDay();
      const back = day === 0 ? 6 : day - 1;
      return { from: getLocalDateString(shiftDays(now, -back)), to };
    }
    case 'month':
      return { from: getLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)), to };
    case 'quarter':
      return { from: getLocalDateString(shiftDays(now, -QUARTER_DAYS)), to };
    case 'all':
    default:
      return { from: getLocalDateString(shiftDays(now, -ALL_DAYS)), to };
  }
}

interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** Which request produced this. Empty until the first one lands. */
  key: string;
}

function tzParam(): string {
  const tz = getDeviceTimeZone();
  return tz ? `tz=${encodeURIComponent(tz)}` : '';
}

async function fetchResource<T>(path: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await api.get<T>(path);
    if (res.success && res.data) return { data: res.data, error: null };
    return { data: null, error: res.error ?? 'Could not load your report.' };
  } catch {
    // Offline is the common case here, not a bug worth a stack trace.
    return { data: null, error: 'No connection. Pull down to try again.' };
  }
}

/**
 * One GET, keyed by its path. The shared shape behind every hook below: see
 * the note at the top of this file on derived `loading` and cancellation.
 * The previous answer stays in `data` while a new path loads, so switching
 * week or period never blanks the screen.
 */
function useResource<T>(path: string) {
  const [loaded, setLoaded] = useState<Loaded<T>>({ data: null, error: null, key: '' });
  const [nonce, setNonce] = useState(0);

  const key = `${path}#${nonce}`;
  const loading = loaded.key !== key;

  useEffect(() => {
    let cancelled = false;
    fetchResource<T>(path).then((result) => {
      if (!cancelled) setLoaded({ ...result, key });
    });
    return () => { cancelled = true; };
  }, [key, path]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data: loaded.data, error: loaded.error, loading, reload };
}

/** `GET /time-report` for any local-day window. */
export function useTimeReportRange(from: string, to: string) {
  const { data, ...rest } = useResource<TimeReport>(`/time-report?from=${from}&to=${to}&${tzParam()}`);
  return { report: data, ...rest };
}

export function useTimeReport(period: ReportPeriod) {
  const { from, to } = rangeFor(period);
  return useTimeReportRange(from, to);
}

/** `GET /time-report/history`: all-time focus by local day. */
export function useTimeHistory() {
  const { data, ...rest } = useResource<TimeHistory>(`/time-report/history?${tzParam()}`);
  return { history: data, ...rest };
}

/** `GET /time-report/goals/:id/daily`: one goal's climb. */
export function useGoalDaily(goalId: string) {
  const { data, ...rest } = useResource<GoalDaily>(`/time-report/goals/${encodeURIComponent(goalId)}/daily?${tzParam()}`);
  return { goalDaily: data, ...rest };
}

export type TimeHistoryState = ReturnType<typeof useTimeHistory>;

/** Which rows of the report a session list is drilling into. */
export interface SessionsQuery {
  by: 'goal' | 'task';
  /** A goal or task id; null for the "none" group (no goal / no task). */
  key: string | null;
  from: string;
  to: string;
}

function sessionsPath(q: SessionsQuery, cursor: string | null): string {
  const which = q.key === null ? 'none=true' : `key=${encodeURIComponent(q.key)}`;
  const after = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
  return `/time-report/sessions?by=${q.by}&${which}&from=${q.from}&to=${q.to}&${tzParam()}${after}`;
}

/**
 * `GET /time-report/sessions`, a page at a time. Pages accumulate; a new
 * query starts over. `loadMore` is a no-op while a page is in flight or when
 * there is nothing left, so a list end firing twice cannot double up.
 *
 * Same derived-loading shape as useResource: the request is a key, and a page
 * is in flight exactly when the loaded key differs from it.
 */
export function useSessionPages(query: SessionsQuery | null) {
  const queryKey = query ? sessionsPath(query, null) : '';
  const [cursor, setCursor] = useState<{ query: string; cursor: string | null }>({ query: '', cursor: null });
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    query: string;
    pages: TimeSessionsPage[];
    error: string | null;
  }>({ key: '', query: '', pages: [], error: null });

  const pageCursor = cursor.query === queryKey ? cursor.cursor : null;
  const requestKey = `${queryKey}@${pageCursor ?? ''}#${nonce}`;
  const inFlight = queryKey !== '' && loaded.key !== requestKey;

  useEffect(() => {
    if (!queryKey) return;
    let cancelled = false;
    const path = pageCursor ? `${queryKey}&cursor=${encodeURIComponent(pageCursor)}` : queryKey;
    fetchResource<TimeSessionsPage>(path).then(({ data, error }) => {
      if (cancelled) return;
      setLoaded((s) => {
        const base = s.query === queryKey && pageCursor ? s.pages : [];
        return { key: requestKey, query: queryKey, pages: data ? [...base, data] : base, error };
      });
    });
    return () => { cancelled = true; };
  }, [queryKey, pageCursor, requestKey]);

  const pages = loaded.query === queryKey ? loaded.pages : [];
  const nextCursor = pages[pages.length - 1]?.nextCursor ?? null;

  const loadMore = useCallback(() => {
    if (!inFlight && nextCursor) setCursor({ query: queryKey, cursor: nextCursor });
  }, [inFlight, nextCursor, queryKey]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);

  return {
    totals: pages[0]?.totals ?? null,
    truncated: pages[0]?.truncated ?? false,
    sessions: pages.flatMap((p) => p.sessions),
    loading: inFlight && pages.length === 0,
    loadingMore: inFlight && pages.length > 0,
    error: inFlight || loaded.query !== queryKey ? null : loaded.error,
    hasMore: nextCursor !== null,
    loadMore,
    retry,
  };
}

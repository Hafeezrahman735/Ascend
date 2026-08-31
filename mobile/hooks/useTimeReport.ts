import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { getLocalDateString, getDeviceTimeZone } from '../utils/date';
import type { TimeReport } from '../types';

/**
 * Fetches `GET /time-report` for a period.
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

interface Loaded {
  report: TimeReport | null;
  error: string | null;
  /** Which request produced this. Empty until the first one lands. */
  key: string;
}

async function fetchReport(period: ReportPeriod): Promise<{ report: TimeReport | null; error: string | null }> {
  const { from, to } = rangeFor(period);
  const tz = getDeviceTimeZone();
  const query = `from=${from}&to=${to}${tz ? `&tz=${encodeURIComponent(tz)}` : ''}`;

  try {
    const res = await api.get<TimeReport>(`/time-report?${query}`);
    if (res.success && res.data) return { report: res.data, error: null };
    return { report: null, error: res.error ?? 'Could not load your report.' };
  } catch {
    // Offline is the common case here, not a bug worth a stack trace.
    return { report: null, error: 'No connection. Pull down to try again.' };
  }
}

export function useTimeReport(period: ReportPeriod) {
  const [loaded, setLoaded] = useState<Loaded>({ report: null, error: null, key: '' });
  const [nonce, setNonce] = useState(0);

  const key = `${period}:${nonce}`;
  const loading = loaded.key !== key;

  useEffect(() => {
    let cancelled = false;
    fetchReport(period).then((result) => {
      if (!cancelled) setLoaded({ ...result, key });
    });
    return () => { cancelled = true; };
  }, [key, period]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { report: loaded.report, error: loaded.error, loading, reload };
}

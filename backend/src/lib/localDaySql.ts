import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * The local day a `sessions s` row belongs to, in SQL.
 *
 * The same rule as `effectiveLocal` in lib/timeReport.ts, written once more
 * so all-time history can be grouped in the database instead of loading every
 * row: an exact stamp is kept, and anything approximate or unstamped is
 * resolved from `completed_at` in the caller's zone. `completed_at` is a UTC
 * `timestamp` with no zone, hence the double AT TIME ZONE.
 *
 * The integration tests hold the two forms together: the same sessions must
 * land on the same days through /time-report and /time-report/history.
 */
export function sessionLocalDaySql(timeZone: string): Prisma.Sql {
  return Prisma.sql`(CASE
    WHEN NOT s.local_date_approx AND s.local_date IS NOT NULL
         AND s.local_hour IS NOT NULL AND s.local_weekday IS NOT NULL
      THEN s.local_date
    ELSE to_char((s.completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')
  END)`;
}

/**
 * The zone to give Postgres. Intl and Postgres each ship their own zone data,
 * so a zone Intl accepts is checked against Postgres too; one it does not know
 * falls back to UTC, the same fallback `safeTimeZone` uses.
 */
export async function postgresTimeZone(timeZone: string): Promise<string> {
  if (timeZone === 'UTC') return timeZone;
  const known = knownZones.get(timeZone);
  if (known !== undefined) return known ? timeZone : 'UTC';
  const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = ${timeZone}) AS ok`;
  const ok = rows[0]?.ok ?? false;
  knownZones.set(timeZone, ok);
  return ok ? timeZone : 'UTC';
}

/**
 * Postgres's answer per zone, for the life of the process. pg_timezone_names
 * is built by reading the zone files on every query (seconds when cold), and
 * the answer cannot change while the server runs. Bounded in practice by the
 * ~600 zone names `safeTimeZone` lets through.
 */
const knownZones = new Map<string, boolean>();

/**
 * Which database a demo seed or teardown is allowed to write to.
 *
 * backend/.env points at Railway STAGING, production is a second Railway
 * database with the same name, and one DATABASE_URL decides between them. A
 * yes/no opt-in (the older seeder's ALLOW_REMOTE_SEED=1) is too easy to leave
 * set in a shell that has since been pointed somewhere else. So a remote write
 * has to name the exact host it expects, and a mismatch stops the run.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type TargetCheck =
  | { ok: true; host: string; isLocal: boolean }
  | { ok: false; host: string; reason: string };

export function checkDemoTarget(databaseUrl: string | undefined, expectedHost: string | undefined): TargetCheck {
  if (!databaseUrl) return { ok: false, host: 'unset', reason: 'DATABASE_URL is not set.' };

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return { ok: false, host: 'invalid', reason: 'DATABASE_URL is not a valid connection string.' };
  }

  if (LOCAL_HOSTS.has(host)) return { ok: true, host, isLocal: true };

  if (!expectedHost) {
    return {
      ok: false,
      host,
      reason: `Refusing to write to remote database "${host}". If this is STAGING, re-run with DEMO_SEED_HOST=${host}. Never point this at production.`,
    };
  }
  if (expectedHost !== host) {
    return {
      ok: false,
      host,
      reason: `DATABASE_URL points at "${host}" but DEMO_SEED_HOST says "${expectedHost}". Check which database this shell is using.`,
    };
  }
  return { ok: true, host, isLocal: false };
}

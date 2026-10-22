import { config as loadDotenv } from 'dotenv';
import path from 'path';

/**
 * Loads .env.test and refuses to continue unless the target database is local.
 *
 * This guard is not paranoia: backend/.env points DATABASE_URL at the Railway
 * database over its public proxy, and the integration suite empties every
 * table between tests. Without this check, a missing .env.test or a stray
 * `DATABASE_URL=...` in the environment would quietly wipe real user data.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function loadTestEnv(): string {
  // override: true so an ambient DATABASE_URL from the shell (or a previously
  // loaded .env) can never win over the test database.
  loadDotenv({ path: path.resolve(__dirname, '../../.env.test'), override: true });

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy backend/.env.test.example to backend/.env.test and fill in your local Postgres password.',
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid connection string.');
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run integration tests against "${host}". ` +
        'These tests empty every table, so DATABASE_URL must point at a local Postgres.',
    );
  }

  // Password hashing at the minimum cost: these tests check auth behaviour,
  // not bcrypt's strength, and cost 12 spent ~480ms of CPU per test user.
  // config.ts allows a cost this low only because NODE_ENV is 'test'.
  // Set here, not only in .env.test, so a copy of the example file missing
  // the line cannot turn the cost guard into a boot failure.
  process.env.NODE_ENV = 'test';
  process.env.BCRYPT_COST = '4';

  return url;
}

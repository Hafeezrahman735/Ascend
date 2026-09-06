import { defineConfig } from 'vitest/config';

/**
 * Two suites with very different costs:
 *
 * - `unit` is pure logic (date maths, XP curves, progress formulas). No I/O, so
 *   it stays fast enough to run on every save.
 * - `integration` drives the real Express app against a real Postgres. It runs
 *   in a single fork because every test truncates shared tables — parallel
 *   workers would delete each other's fixtures mid-assertion.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.integration.test.ts'],
          environment: 'node',
          setupFiles: ['src/test/setup.integration.ts'],
          globalSetup: ['src/test/globalSetup.integration.ts'],
          pool: 'forks',
          // Vitest 4 REMOVED `poolOptions`; it is silently ignored, not an
          // error. This suite carried `poolOptions: { forks: { singleFork:
          // true } }` across the v4 upgrade and lost single-process execution
          // without anything failing loudly — the runner only prints a
          // deprecation line. `maxWorkers`/`minWorkers` are the v4 spelling.
          //
          // It matters more than it looks. Retention prunes on the write path
          // are deliberately unawaited (see lib/retention.ts), so a DELETE can
          // still be in flight when the next file's beforeEach issues its
          // TRUNCATE — and TRUNCATE takes an ACCESS EXCLUSIVE lock. With one
          // process those at least share a connection pool; with several, the
          // contention showed up as an intermittent 500 from an unrelated
          // route, roughly one full run in two.
          maxWorkers: 1,
          minWorkers: 1,
          // Files must not interleave either: every test truncates shared
          // tables in beforeEach, so a second file running concurrently wipes
          // the first file's fixtures mid-test.
          fileParallelism: false,
          // Schema push on the first run plus bcrypt hashing make these slower
          // than unit tests by an order of magnitude.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

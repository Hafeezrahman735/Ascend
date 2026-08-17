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
          poolOptions: { forks: { singleFork: true } },
          // Schema push on the first run plus bcrypt hashing make these slower
          // than unit tests by an order of magnitude.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

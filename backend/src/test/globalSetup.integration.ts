import { execFileSync } from 'child_process';
import path from 'path';
import { loadTestEnv } from './env';

/**
 * Runs once per `vitest run`, before any worker starts.
 *
 * The test database is shaped with `prisma db push` rather than `migrate deploy`
 * so the suite always reflects schema.prisma as it is right now — including
 * changes that have not been captured in a migration yet. That is deliberate:
 * these tests exist to check the code against the current schema, not against
 * migration history.
 */
export default function setup(): void {
  const url = loadTestEnv();

  execFileSync(
    'npx',
    ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
}

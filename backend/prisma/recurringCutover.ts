/**
 * CLI wrapper for the one-time recurring-task cutover.
 *
 *   npx tsx prisma/recurringCutover.ts --dry-run
 *   npx tsx prisma/recurringCutover.ts
 *
 * Deletes every daily copy of a recurring task. Run once per environment,
 * WITH the release that stops reading copies — never before it. The logic
 * lives in src/lib/recurringCutover.ts so it can be tested against a real
 * database; this file is only argument parsing and output.
 *
 * Dry-run first and read the counts, per CLAUDE.md. Check which database
 * DATABASE_URL points at: backend/.env is staging.
 */

import { prisma } from '../src/lib/prisma';
import { runRecurringCutover } from '../src/lib/recurringCutover';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const host = new URL(process.env.DATABASE_URL ?? '').host;
  console.log(`${dryRun ? 'DRY RUN — no writes' : 'Writing changes'} on ${host}\n`);

  const result = await runRecurringCutover({ dryRun });

  console.log('─── Summary ───');
  console.log(`  copies deleted:       ${result.copies}`);
  console.log(`  completions added:    ${result.completionsAdded}  (one per completed copy day)`);
  console.log(`  sessions re-pointed:  ${result.sessionsRepointed}  (moved onto their recurring task)`);
  console.log(`  sessions detached:    ${result.sessionsDetached}  (copy of a task that no longer exists)`);
  if (dryRun) console.log('\nDRY RUN — nothing was written.');
}

main()
  .catch((err) => {
    console.error('Cutover failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

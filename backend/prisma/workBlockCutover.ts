/**
 * CLI wrapper for the one-time work-block cutover.
 *
 *   npx tsx prisma/workBlockCutover.ts --dry-run
 *   npx tsx prisma/workBlockCutover.ts
 *
 * Moves each timed one-off task's time onto a work block on its due day and
 * clears the task's own times; due dates are kept. Run once per environment,
 * WITH the release that reads work blocks. The logic lives in
 * src/lib/workBlockCutover.ts so it is tested against a real database; this
 * file is only argument parsing and output.
 *
 * Dry-run first and read the counts, per CLAUDE.md. Check which database
 * DATABASE_URL points at: backend/.env is staging.
 */

import { prisma } from '../src/lib/prisma';
import { runWorkBlockCutover } from '../src/lib/workBlockCutover';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const host = new URL(process.env.DATABASE_URL ?? '').host;
  console.log(`${dryRun ? 'DRY RUN — no writes' : 'Writing changes'} on ${host}\n`);

  const result = await runWorkBlockCutover({ dryRun });

  console.log('─── Summary ───');
  console.log(`  timed one-off tasks:  ${result.timedTasks}  (a full time pair and a due day)`);
  console.log(`  blocks created:       ${result.blocksCreated}  (one per timed task, on its due day)`);
  console.log(`  task times cleared:   ${result.timesCleared}  (includes half-set pairs, which get no block)`);
  if (dryRun) console.log('\nDRY RUN — nothing was written.');
}

main()
  .catch((err) => {
    console.error('Cutover failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

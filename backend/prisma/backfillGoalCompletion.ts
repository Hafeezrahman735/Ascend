/**
 * CLI wrapper for the one-time goal-completion backfill.
 *
 *   npx tsx prisma/backfillGoalCompletion.ts --dry-run
 *   npx tsx prisma/backfillGoalCompletion.ts
 *
 * Run once per environment, WITH the release that collapses goal progress to
 * tasks. The logic lives in src/lib/backfillGoalCompletion.ts so it can be
 * tested against a real database; this file is only argument parsing and output.
 *
 * Dry-run first and read the count, per CLAUDE.md.
 */

import { prisma } from '../src/lib/prisma';
import { backfillGoalCompletion } from '../src/lib/backfillGoalCompletion';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? 'DRY RUN — no writes\n' : 'Writing changes\n');

  const result = await backfillGoalCompletion({
    dryRun,
    onProgress: (done, total) => {
      if (done % 50 === 0 || done === total) console.log(`  ${done}/${total} scanned`);
    },
  });

  if (result.scanned === 0) {
    console.log('No open goals. Nothing to backfill.');
    return;
  }

  console.log('\n─── Summary ───');
  console.log(`  scanned:    ${result.scanned}  (open, unarchived goals)`);
  console.log(`  completed:  ${result.completed}  (every linked task done)`);
  console.log(`  still open: ${result.stillOpen}`);
  console.log(`  no tasks:   ${result.empty}  (0% — an empty goal is not a finished one)`);
  console.log('\n  Completed goals were dated by their LAST finished task, not by now,');
  console.log('  and awarded no XP, no feed event and no notification. That work was');
  console.log('  finished before this release; nobody is congratulated for it twice.');
  if (dryRun) console.log('\nDRY RUN — nothing was written.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * CLI wrapper for the one-time habit goal-link backfill.
 *
 *   npx tsx prisma/backfillHabitGoalLinks.ts --dry-run
 *   npx tsx prisma/backfillHabitGoalLinks.ts
 *
 * Run once per environment, WITH the release that makes goal time follow the
 * habit template's link. The logic lives in src/lib/backfillHabitGoalLinks.ts
 * so it can be tested against a real database; this file is only argument
 * parsing and output.
 *
 * Dry-run first and read the count, per CLAUDE.md.
 */

import { prisma } from '../src/lib/prisma';
import { backfillHabitGoalLinks } from '../src/lib/backfillHabitGoalLinks';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? 'DRY RUN — no writes\n' : 'Writing changes\n');

  const result = await backfillHabitGoalLinks({ dryRun });

  console.log('─── Summary ───');
  console.log(`  scanned: ${result.scanned}  (live habit templates with no goal)`);
  console.log(`  linked:  ${result.linked}  (template given its live instance's goal)`);
  if (dryRun) console.log('\nDRY RUN — nothing was written.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

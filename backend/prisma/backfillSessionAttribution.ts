/**
 * CLI wrapper for the session-attribution backfill.
 *
 *   npx tsx prisma/backfillSessionAttribution.ts --dry-run
 *   npx tsx prisma/backfillSessionAttribution.ts
 *
 * Run once per environment after the schema push. The logic lives in
 * src/lib/backfillAttribution.ts so it can be tested against a real database;
 * this file is only argument parsing and output.
 */

import { PrismaClient } from '@prisma/client';
import { backfillSessionAttribution } from '../src/lib/backfillAttribution';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? 'DRY RUN — no writes\n' : 'Writing changes\n');

  const result = await backfillSessionAttribution(prisma, {
    dryRun,
    onProgress: (done, total) => console.log(`  ${done}/${total} processed`),
  });

  if (result.total === 0) {
    console.log('Nothing to backfill. Every session is already stamped.');
    return;
  }

  console.log('\n─── Summary ───');
  console.log(`  scanned:       ${result.scanned}`);
  console.log(`  attributed:    ${result.attributed}  (task row still exists)`);
  console.log(`  no task:       ${result.noTask}  (free-form timer runs — nothing to recover)`);
  console.log(`  task missing:  ${result.taskMissing}  (task row gone — unrecoverable)`);
  console.log(`  with a goal:   ${result.withGoal}`);
  console.log(`  recurring:     ${result.recurring}`);
  console.log("\n  Every backfilled row is flagged localDateApprox: the user's");
  console.log('  timezone at the time was never recorded, so the day and hour are');
  console.log('  UTC. New sessions carry the real zone and are exact.');
  if (dryRun) console.log('\nDRY RUN — nothing was written.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

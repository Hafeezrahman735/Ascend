/**
 * Removes everything prisma/seed-demo-account.ts created: test_user_1, every
 * account on @ascend.invalid, all they own, and any reactions they left on
 * real posts.
 *
 * Run:  npm run teardown:demo-account
 * Env:  DEMO_SEED_HOST  the database host, required for any remote DB
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { teardownDemoAccount } from '../src/lib/demoAccount/seed';
import { checkDemoTarget } from '../src/lib/demoAccount/target';

async function main(): Promise<void> {
  const target = checkDemoTarget(process.env.DATABASE_URL, process.env.DEMO_SEED_HOST);
  if (!target.ok) throw new Error(target.reason);

  const prisma = new PrismaClient();
  try {
    const removed = await teardownDemoAccount(prisma);
    console.log(removed.length === 0
      ? `No demo accounts on ${target.host}. Nothing to remove.`
      : `Removed ${removed.length} demo accounts from ${target.host}: ${removed.join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`\nDemo teardown failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

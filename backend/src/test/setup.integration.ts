import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach } from 'vitest';
import { loadTestEnv } from './env';

// Must run before anything imports src/config.ts or src/lib/prisma.ts — config
// validates the environment at import time and calls process.exit(1) when it
// fails, which inside a worker looks like a silent crash rather than a failure.
loadTestEnv();

interface TruncateContext {
  prisma: PrismaClient;
  statement: string;
}

let context: TruncateContext | null = null;

/**
 * Resolved lazily, and imported dynamically, so PrismaClient is constructed
 * only after loadTestEnv() has put the test DATABASE_URL in place.
 */
async function getContext(): Promise<TruncateContext> {
  if (context) return context;

  const { prisma } = await import('../lib/prisma');

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `;

  const statement = `TRUNCATE TABLE ${tables
    .map((t) => `"public"."${t.tablename}"`)
    .join(', ')} RESTART IDENTITY CASCADE`;

  context = { prisma, statement: tables.length > 0 ? statement : '' };
  return context;
}

/**
 * Truncating between tests rather than wrapping each in a rolled-back
 * transaction is deliberate: the routes under test open their own transactions
 * (`prisma.$transaction`) and fire eventBus handlers that write after the
 * response is sent. A per-test transaction would contain neither.
 */
beforeEach(async () => {
  const { prisma, statement } = await getContext();
  if (!statement) return;
  await prisma.$executeRawUnsafe(statement);
});

afterAll(async () => {
  if (context) await context.prisma.$disconnect();
});

import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach } from 'vitest';
import { loadTestEnv } from './env';

// Must run before anything imports src/config.ts or src/lib/prisma.ts — config
// validates the environment at import time and calls process.exit(1) when it
// fails, which inside a worker looks like a silent crash rather than a failure.
loadTestEnv();

interface ClearContext {
  prisma: PrismaClient;
  statement: string;
}

let context: ClearContext | null = null;

/**
 * Resolved lazily, and imported dynamically, so PrismaClient is constructed
 * only after loadTestEnv() has put the test DATABASE_URL in place.
 *
 * Clears tables with DELETE, children before parents, in one DO block.
 * It used to TRUNCATE all twenty tables before every test, which Postgres does
 * by swapping in fresh files for each one: about 600ms per test on a dev
 * machine, roughly a third of the suite's runtime. The tables hold a few
 * rows at most between tests, and deleting those takes a few milliseconds.
 * No table uses a sequence, so nothing needed RESTART IDENTITY.
 */
async function getContext(): Promise<ClearContext> {
  if (context) return context;

  const { prisma } = await import('../lib/prisma');

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `;
  const edges = await prisma.$queryRaw<Array<{ child: string; parent: string }>>`
    SELECT cl.relname AS child, pr.relname AS parent
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_class pr ON pr.oid = c.confrelid
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  `;

  const order = childrenFirst(tables.map((t) => t.tablename), edges);
  const statement = order.length > 0
    ? `DO $$ BEGIN ${order.map((t) => `DELETE FROM "public"."${t}";`).join(' ')} END $$;`
    : '';

  context = { prisma, statement };
  return context;
}

/**
 * Orders tables so every table comes before any table it references, which
 * lets plain DELETEs run without tripping a foreign key. Self-references are
 * ignored; a cycle would mean the schema changed shape, so it fails loudly.
 */
function childrenFirst(tables: string[], edges: Array<{ child: string; parent: string }>): string[] {
  const remaining = new Set(tables);
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const next = [...remaining].filter((t) =>
      !edges.some((e) => e.parent === t && e.child !== t && remaining.has(e.child)),
    );
    if (next.length === 0) {
      throw new Error(`Foreign-key cycle among: ${[...remaining].join(', ')}`);
    }
    for (const t of next.sort()) {
      ordered.push(t);
      remaining.delete(t);
    }
  }
  return ordered;
}

/**
 * Clearing between tests rather than wrapping each in a rolled-back
 * transaction is deliberate: the routes under test open their own transactions
 * (`prisma.$transaction`) and fire eventBus handlers that write after the
 * response is sent. A per-test transaction would contain neither.
 */
async function clearTables(): Promise<void> {
  const { prisma, statement } = await getContext();
  if (statement) await prisma.$executeRawUnsafe(statement);
}

beforeEach(clearTables);

/**
 * Also cleared when a file finishes, so nothing it wrote is visible to the
 * next file's import. That matters because index.ts warms the achievement
 * catalogue cache at import time, before the next file's first beforeEach:
 * it would cache the previous file's seeded catalogue, the clear would then
 * delete those rows, and every unlock would fail its foreign key. TRUNCATE
 * hid this — its lock made the warm-up wait and read an empty table — but a
 * DELETE does not block readers.
 */
afterAll(async () => {
  if (!context) return;
  await clearTables();
  await context.prisma.$disconnect();
});

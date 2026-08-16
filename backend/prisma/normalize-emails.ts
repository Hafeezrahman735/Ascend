/**
 * One-off migration: lowercase existing User.email values.
 *
 * The auth routes now normalize email to lowercase on both register and login.
 * Any account stored with uppercase (e.g. "Sam@Gmail.com") would no longer match
 * at login, so existing rows must be normalized to match. Run this once, as part
 * of the same deploy that ships the auth change.
 *
 *   Preview (default, writes nothing):
 *     npx tsx prisma/normalize-emails.ts
 *
 *   Apply:
 *     npx tsx prisma/normalize-emails.ts --apply
 *
 * Collisions — two accounts whose emails differ only by case — are reported and
 * skipped, never merged or deleted. Deciding which account survives is a
 * judgement call about real user data, so it is left to a human.
 *
 * Safe to re-run: already-lowercase rows are ignored.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const needsChange = users.filter((u) => u.email !== u.email.toLowerCase());

  // Group every account by its normalized email to find case-only duplicates.
  const byNormalized = new Map<string, typeof users>();
  for (const u of users) {
    const key = u.email.toLowerCase();
    const bucket = byNormalized.get(key);
    if (bucket) bucket.push(u);
    else byNormalized.set(key, [u]);
  }
  const collisions = [...byNormalized.entries()].filter(([, group]) => group.length > 1);
  const collidingIds = new Set(collisions.flatMap(([, group]) => group.map((u) => u.id)));

  console.log(`Scanned ${users.length} accounts.`);
  console.log(`  ${needsChange.length} have a non-lowercase email.`);
  console.log(`  ${collisions.length} normalized address(es) are claimed by more than one account.\n`);

  if (collisions.length > 0) {
    console.log('COLLISIONS — resolve these by hand, they are skipped below:');
    for (const [normalized, group] of collisions) {
      console.log(`  ${normalized}`);
      for (const u of group) {
        console.log(`    - ${u.id}  ${u.email}  (@${u.username}, created ${u.createdAt.toISOString()})`);
      }
    }
    console.log('');
  }

  const safe = needsChange.filter((u) => !collidingIds.has(u.id));
  if (safe.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  if (!apply) {
    console.log(`DRY RUN — would update ${safe.length} account(s):`);
    for (const u of safe.slice(0, 20)) {
      console.log(`  ${u.email}  ->  ${u.email.toLowerCase()}`);
    }
    if (safe.length > 20) console.log(`  … and ${safe.length - 20} more`);
    console.log('\nRe-run with --apply to write these changes.');
    return;
  }

  let updated = 0;
  for (const u of safe) {
    await prisma.user.update({
      where: { id: u.id },
      data: { email: u.email.toLowerCase() },
    });
    updated++;
  }
  console.log(`Updated ${updated} account(s).`);
  if (collisions.length > 0) {
    console.log(`${collidingIds.size} account(s) skipped due to collisions — see above.`);
  }
}

main()
  .catch((err) => {
    console.error('normalize-emails failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

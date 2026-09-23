/**
 * Seeds the marketing demo account (test_user_1) and the seven people around
 * it, for App Store and launch screenshots. STAGING ONLY.
 *
 * Re-running wipes and rebuilds everything, with every date relative to now,
 * so the screens always read "today", "12m ago", "Due tomorrow". Sign out of
 * the app before re-running and back in after: each run creates fresh ids.
 *
 * Run:  npm run seed:demo-account
 * Env:  DEMO_ACCOUNT_EMAIL     login email (must not belong to another account)
 *       DEMO_ACCOUNT_PASSWORD  login password (8+ characters)
 *       DEMO_SEED_HOST         the database host, required for any remote DB
 *       DEMO_TIMEZONE          the phone's IANA zone (default: this machine's)
 *
 * The content and the rules it follows live in src/lib/demoAccount/.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedDemoAccount } from '../src/lib/demoAccount/seed';
import { checkDemoTarget } from '../src/lib/demoAccount/target';

async function main(): Promise<void> {
  const target = checkDemoTarget(process.env.DATABASE_URL, process.env.DEMO_SEED_HOST);
  if (!target.ok) throw new Error(target.reason);

  const email = process.env.DEMO_ACCOUNT_EMAIL;
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  if (!email || !password || password.length < 8) {
    throw new Error('Set DEMO_ACCOUNT_EMAIL and DEMO_ACCOUNT_PASSWORD (8+ characters) — see backend/README.md.');
  }
  const timeZone = process.env.DEMO_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  console.log(`Seeding the demo account into ${target.host} (timezone ${timeZone})...`);
  const prisma = new PrismaClient();
  try {
    const s = await seedDemoAccount(prisma, { email, password, timeZone });
    const hm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

    console.log(`\n  ${s.username}  ·  ${s.rank}  ·  ${s.currentStreak}-day streak (longest ${s.longestStreak})`);
    console.log(`  today ${s.today}: ${s.todaySessions} sessions, ${hm(s.todayFocusMinutes)}`);
    console.log(`  all time: ${s.totalSessions} sessions, ${hm(s.totalFocusMinutes)}, ${s.tasksCompleted} tasks completed`);
    console.log(`  achievements (${s.achievements.length}): ${s.achievements.join(', ')}`);
    console.log('\n  Friends leaderboard (all time):');
    s.leaderboard.forEach((r, i) => console.log(`   ${i + 1}. ${r.username.padEnd(14)} ${hm(r.focusMinutes).padStart(8)}  ${r.rank}`));
    if (s.skippedRecaps.length > 0) {
      console.log(`\n  Skipped ${s.skippedRecaps.length} recap(s) that fell on a day already covered — one recap per day, as the app does.`);
    }
    console.log(`\n  Log in as ${s.email} with DEMO_ACCOUNT_PASSWORD.`);
    console.log('  On the phone: set the daily goal to 3h and tap the Live Activity task to make it current.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`\nDemo seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

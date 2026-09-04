import { PrismaClient, AchievementCategory } from '@prisma/client';

const prisma = new PrismaClient();

interface AchievementSeed {
  key: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  category: AchievementCategory;
  threshold: number;
}

// ─── Deliberately NOT seeded ─────────────────────────────────────────────────
// 'accountability-partner' — unlocked when a friend completed a goal. The
// session-target goal system that fired that event has been deleted, and
// TaskGoal (the goal system users can reach) is personal: it groups one user's
// own tasks with no shared or friend-visible concept. There is nothing to hang
// the achievement on, so it stays disabled until goal sharing is actually
// designed. It has never been seeded, so no user holds it or can lose it.
//
// Separately unseeded and unrelated to goals — a pre-existing seed-data gap:
// 'social-butterfly', 'early-bird', 'night-owl', 'speed-runner', 'marathon'.
// modules/achievements/handler.ts still branches on these keys, so 'speed-runner'
// and 'marathon' run session count/findMany queries on every completion that can
// never unlock anything. Worth a follow-up ticket; out of scope for the goals work.
const achievements: AchievementSeed[] = [
  { key: 'streak_3', title: 'Three Days Running', description: 'Complete focus sessions 3 days in a row', icon: '🔥', xpReward: 50, category: 'STREAK', threshold: 3 },
  { key: 'streak_7', title: 'Full Week', description: 'Complete focus sessions 7 days in a row', icon: '📅', xpReward: 100, category: 'STREAK', threshold: 7 },
  { key: 'streak_14', title: 'Two Weeks Steady', description: 'Complete focus sessions 14 days in a row', icon: '🗿', xpReward: 200, category: 'STREAK', threshold: 14 },
  { key: 'streak_30', title: 'A Month of Showing Up', description: 'Complete focus sessions 30 days in a row', icon: '👑', xpReward: 500, category: 'STREAK', threshold: 30 },
  { key: 'streak_60', title: 'Sixty Days', description: 'Complete focus sessions 60 days in a row', icon: '💎', xpReward: 1000, category: 'STREAK', threshold: 60 },
  { key: 'streak_100', title: 'One Hundred Days', description: 'Complete focus sessions 100 days in a row', icon: '🌟', xpReward: 2000, category: 'STREAK', threshold: 100 },
  { key: 'sessions_1', title: 'Started', description: 'Complete your first focus session', icon: '🌱', xpReward: 25, category: 'SESSIONS', threshold: 1 },
  { key: 'sessions_10', title: 'Ten In', description: 'Complete 10 focus sessions', icon: '🌿', xpReward: 50, category: 'SESSIONS', threshold: 10 },
  { key: 'sessions_25', title: 'Twenty-Five Deep', description: 'Complete 25 focus sessions', icon: '🌳', xpReward: 100, category: 'SESSIONS', threshold: 25 },
  { key: 'sessions_50', title: 'Fifty Sessions', description: 'Complete 50 focus sessions', icon: '🏆', xpReward: 200, category: 'SESSIONS', threshold: 50 },
  { key: 'sessions_100', title: 'One Hundred Sessions', description: 'Complete 100 focus sessions', icon: '💯', xpReward: 500, category: 'SESSIONS', threshold: 100 },
  { key: 'sessions_250', title: 'Two Fifty', description: 'Complete 250 focus sessions', icon: '🚀', xpReward: 1000, category: 'SESSIONS', threshold: 250 },
  { key: 'sessions_500', title: 'Five Hundred', description: 'Complete 500 focus sessions', icon: '⭐', xpReward: 2500, category: 'SESSIONS', threshold: 500 },
  { key: 'focus_60', title: 'First Hour', description: 'Accumulate 1 hour of total focus time', icon: '⏱️', xpReward: 50, category: 'FOCUS_TIME', threshold: 1 },
  { key: 'focus_300', title: 'Five Hours In', description: 'Accumulate 5 hours of total focus time', icon: '⏳', xpReward: 100, category: 'FOCUS_TIME', threshold: 5 },
  { key: 'focus_600', title: 'Ten Hours', description: 'Accumulate 10 hours of total focus time', icon: '📈', xpReward: 200, category: 'FOCUS_TIME', threshold: 10 },
  { key: 'focus_3000', title: 'Fifty Hours', description: 'Accumulate 50 hours of total focus time', icon: '💪', xpReward: 500, category: 'FOCUS_TIME', threshold: 50 },
  { key: 'focus_6000', title: 'One Hundred Hours', description: 'Accumulate 100 hours of total focus time', icon: '🦸', xpReward: 1000, category: 'FOCUS_TIME', threshold: 100 },
  { key: 'focus_12000', title: 'Two Hundred Hours', description: 'Accumulate 200 hours of total focus time', icon: '🧙', xpReward: 2500, category: 'FOCUS_TIME', threshold: 200 },
  { key: 'level_5', title: 'Level Five', description: 'Reach level 5', icon: '🧠', xpReward: 150, category: 'LEVEL', threshold: 5 },
  { key: 'level_10', title: 'Level Ten', description: 'Reach level 10', icon: '🎯', xpReward: 500, category: 'LEVEL', threshold: 10 },

  // ── TASKS ──
  // The AchievementCategory enum has always had TASKS, but nothing was seeded
  // against it and checkAchievements had no branch for it. Both are now wired,
  // measured against User.tasksCompleted.
  { key: 'tasks_1', title: 'First One Done', description: 'Complete your first task', icon: '✅', xpReward: 25, category: 'TASKS', threshold: 1 },
  { key: 'tasks_10', title: 'Ten Finished', description: 'Complete 10 tasks', icon: '📋', xpReward: 75, category: 'TASKS', threshold: 10 },
  { key: 'tasks_50', title: 'Fifty Finished', description: 'Complete 50 tasks', icon: '⚙️', xpReward: 250, category: 'TASKS', threshold: 50 },
  { key: 'tasks_100', title: 'One Hundred Finished', description: 'Complete 100 tasks', icon: '🏁', xpReward: 600, category: 'TASKS', threshold: 100 },
  { key: 'tasks_500', title: 'Five Hundred Finished', description: 'Complete 500 tasks', icon: '🔨', xpReward: 2000, category: 'TASKS', threshold: 500 },

  // ── Behavioural achievements ──
  // These five were already evaluated by handleSessionCompleted in
  // modules/achievements/handler.ts but were never seeded, so that logic ran on
  // every session and could never unlock anything.
  //
  // Their unlock conditions are bespoke (time of day, sessions-in-a-day, friend
  // count), not counter thresholds, so `threshold` is an unused placeholder of 1
  // and their keys are listed in BEHAVIOURAL_KEYS so the generic threshold check
  // skips them. Category is cosmetic here — it only groups them in the UI.
  { key: 'social-butterfly', title: 'Social Butterfly', description: 'Follow 5 or more people', icon: '🦋', xpReward: 150, category: 'SESSIONS', threshold: 1 },
  { key: 'early-bird', title: 'Early Bird', description: 'Complete a focus session before 8am', icon: '🌅', xpReward: 100, category: 'SESSIONS', threshold: 1 },
  { key: 'night-owl', title: 'Night Owl', description: 'Complete a focus session after 10pm', icon: '🦉', xpReward: 100, category: 'SESSIONS', threshold: 1 },
  { key: 'speed-runner', title: 'Speed Runner', description: 'Complete 8 focus sessions in a single day', icon: '⚡', xpReward: 300, category: 'SESSIONS', threshold: 1 },
  { key: 'marathon', title: 'Marathon', description: 'Focus for 4 hours in a single day', icon: '🏃', xpReward: 400, category: 'SESSIONS', threshold: 1 },
];

async function seed() {
  console.log('Seeding achievements...');

  for (const achievement of achievements) {
    const { key, title, description, icon, xpReward, category, threshold } = achievement;
    await prisma.achievement.upsert({
      where: { key },
      update: { title, description, icon, xpReward, category, threshold },
      create: { key, title, description, icon, xpReward, category, threshold },
    });
  }

  console.log(`Seeded ${achievements.length} achievements`);
  await prisma.$disconnect();
}

seed().catch((error) => {
  console.error('Seed error:', error);
  prisma.$disconnect();
  process.exit(1);
});

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

const achievements: AchievementSeed[] = [
  { key: 'streak_3', title: 'Three-Day Streak', description: 'Complete focus sessions 3 days in a row', icon: '🔥', xpReward: 50, category: 'STREAK', threshold: 3 },
  { key: 'streak_7', title: 'Week Warrior', description: 'Complete focus sessions 7 days in a row', icon: '🔥', xpReward: 100, category: 'STREAK', threshold: 7 },
  { key: 'streak_14', title: 'Fortnight Focus', description: 'Complete focus sessions 14 days in a row', icon: '⚡', xpReward: 200, category: 'STREAK', threshold: 14 },
  { key: 'streak_30', title: 'Monthly Master', description: 'Complete focus sessions 30 days in a row', icon: '👑', xpReward: 500, category: 'STREAK', threshold: 30 },
  { key: 'streak_60', title: 'Two-Month Titan', description: 'Complete focus sessions 60 days in a row', icon: '💎', xpReward: 1000, category: 'STREAK', threshold: 60 },
  { key: 'streak_100', title: 'Century Streak', description: 'Complete focus sessions 100 days in a row', icon: '🌟', xpReward: 2000, category: 'STREAK', threshold: 100 },
  { key: 'sessions_1', title: 'First Steps', description: 'Complete your first focus session', icon: '🌱', xpReward: 25, category: 'SESSIONS', threshold: 1 },
  { key: 'sessions_10', title: 'Getting Started', description: 'Complete 10 focus sessions', icon: '🌿', xpReward: 50, category: 'SESSIONS', threshold: 10 },
  { key: 'sessions_25', title: 'Dedicated', description: 'Complete 25 focus sessions', icon: '🌳', xpReward: 100, category: 'SESSIONS', threshold: 25 },
  { key: 'sessions_50', title: 'Half Century', description: 'Complete 50 focus sessions', icon: '🏆', xpReward: 200, category: 'SESSIONS', threshold: 50 },
  { key: 'sessions_100', title: 'Century Club', description: 'Complete 100 focus sessions', icon: '💯', xpReward: 500, category: 'SESSIONS', threshold: 100 },
  { key: 'sessions_250', title: 'Unstoppable', description: 'Complete 250 focus sessions', icon: '🚀', xpReward: 1000, category: 'SESSIONS', threshold: 250 },
  { key: 'sessions_500', title: 'Focus Legend', description: 'Complete 500 focus sessions', icon: '⭐', xpReward: 2500, category: 'SESSIONS', threshold: 500 },
  { key: 'focus_60', title: 'Hour of Power', description: 'Accumulate 1 hour of total focus time', icon: '⏱️', xpReward: 50, category: 'FOCUS_TIME', threshold: 1 },
  { key: 'focus_300', title: '5-Hour Marathon', description: 'Accumulate 5 hours of total focus time', icon: '🏃', xpReward: 100, category: 'FOCUS_TIME', threshold: 5 },
  { key: 'focus_600', title: '10-Hour Dedication', description: 'Accumulate 10 hours of total focus time', icon: '📈', xpReward: 200, category: 'FOCUS_TIME', threshold: 10 },
  { key: 'focus_3000', title: '50-Hour Grind', description: 'Accumulate 50 hours of total focus time', icon: '💪', xpReward: 500, category: 'FOCUS_TIME', threshold: 50 },
  { key: 'focus_6000', title: '100-Hour Hero', description: 'Accumulate 100 hours of total focus time', icon: '🦸', xpReward: 1000, category: 'FOCUS_TIME', threshold: 100 },
  { key: 'focus_12000', title: 'Time Wizard', description: 'Accumulate 200 hours of total focus time', icon: '🧙', xpReward: 2500, category: 'FOCUS_TIME', threshold: 200 },
  { key: 'level_5', title: 'Focused Mind', description: 'Reach level 5', icon: '🧠', xpReward: 150, category: 'LEVEL', threshold: 5 },
  { key: 'level_10', title: 'Focus Elite', description: 'Reach level 10', icon: '🎯', xpReward: 500, category: 'LEVEL', threshold: 10 },
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

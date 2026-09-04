import { PrismaClient } from '@prisma/client';
import { achievements } from '../src/lib/achievementSeedData';

const prisma = new PrismaClient();


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

import { prisma } from './prisma';
import type { Achievement } from '@prisma/client';

// The achievement catalogue is seeded reference data that only changes on
// deploy/seed (the server restarts then). Reading it from the DB on every
// session/goal event is pure waste, so we load it once and serve from memory.
//
// Order matches the previous `findMany({ orderBy: { threshold: 'asc' } })` so
// the user-facing achievements list is byte-for-byte identical.
let catalogue: Achievement[] = [];
let loaded = false;

export async function loadAchievementCatalogue(): Promise<void> {
  catalogue = await prisma.achievement.findMany({ orderBy: { threshold: 'asc' } });
  loaded = true;
}

// Drop-in replacement for `await prisma.achievement.findMany(...)`. Loads on
// first use if the boot-time warm-up didn't run, then serves from memory.
export async function ensureAchievementCatalogue(): Promise<Achievement[]> {
  if (!loaded) await loadAchievementCatalogue();
  return catalogue;
}

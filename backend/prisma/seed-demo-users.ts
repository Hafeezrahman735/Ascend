/**
 * Demo user seeder — creates 5 realistic showcase accounts with stats, focus
 * sessions, tasks, goals, social posts, and a follow graph so the app looks
 * alive for demos / screenshots.
 *
 * Idempotent: re-running upserts the users by email and replaces their
 * generated content (sessions/tasks/goals/posts/follows) so you never get
 * duplicates. Does NOT touch any real accounts.
 *
 * Run:  npx tsx prisma/seed-demo-users.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const HOURS = 3600;
const MIN = 60;
const now = Date.now();
const day = (n: number) => new Date(now - n * 86400000); // n days ago

// Shared password for all demo accounts (each login listed at the end of the run).
const DEMO_PASSWORD = 'AscendDemo!2026';

/**
 * Stable pseudo-random in [0,1) from a string.
 *
 * Scheduling is DERIVED from this rather than hand-written per task, so the
 * five accounts get a full calendar without 25 literal date edits — and it is
 * deterministic, so re-running the seed does not reshuffle everyone’s week.
 */
function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Local calendar day n days from today, as the UTC-midnight Date dueDate expects. */
function dueDateFor(offsetDays: number): Date {
  const d = new Date(now + offsetDays * 86400000);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** 'YYYY-MM-DD' n days from today, for Note.date. */
function dayKey(offsetDays: number): string {
  const d = new Date(now + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Block lengths that produce a readable timeline rather than uniform bars. */
const BLOCK_MINUTES = [30, 45, 60, 90, 120];

const HABITS: { title: string; tags: string[]; days: string[]; startHour: number; minutes: number }[] = [
  { title: 'Morning review', tags: ['routine'], days: ['mon', 'tue', 'wed', 'thu', 'fri'], startHour: 8, minutes: 20 },
  { title: 'Flashcards', tags: ['study'], days: [], startHour: 19, minutes: 25 },
  { title: 'Read 20 pages', tags: ['reading'], days: [], startHour: 21, minutes: 30 },
  { title: 'Inbox zero', tags: ['work'], days: ['mon', 'wed', 'fri'], startHour: 17, minutes: 15 },
  { title: 'Practice set', tags: ['cs'], days: ['tue', 'thu'], startHour: 16, minutes: 45 },
];

const NOTE_POOL: { content: string; isTodo: boolean }[] = [
  { content: 'Bring the charger tomorrow', isTodo: true },
  { content: 'Ask about the deadline extension', isTodo: true },
  { content: 'Chapter 4 was harder than 3 — budget more time', isTodo: false },
  { content: 'Book the study room for Thursday', isTodo: true },
  { content: 'Felt sharpest in the first 40 minutes today', isTodo: false },
  { content: 'Email the group about splitting sections', isTodo: true },
  { content: 'Print the practice exam', isTodo: true },
  { content: 'Afternoons keep getting eaten by meetings', isTodo: false },
  { content: 'Review flashcards before bed', isTodo: true },
  { content: 'Two short blocks worked better than one long one', isTodo: false },
];

interface AttachedStat { label: string; value: string }

interface DemoPost {
  type: 'session_recap' | 'achievement_unlock' | 'streak_milestone' | 'free_post';
  caption: string;
  daysAgo: number;
  payload: Record<string, unknown>;
}

interface DemoTask {
  title: string;
  description?: string;
  tags: string[];
  priority: 'low' | 'medium' | 'high';
  isCompleted: boolean;
  daysAgo: number; // when created
  estimatedMinutes?: number;
  sessionsOnTask?: number;
}

interface DemoGoal {
  title: string;
  tag: string;
  targetSessions: number;
  deadlineDays: number; // due in N days
  isCompleted?: boolean;
}

interface DemoSession {
  durationSeconds: number;
  taskLabel: string;
  daysAgo: number;
}

interface DemoUser {
  email: string;
  username: string;
  bioRole: string;
  xp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  totalFocusTime: number; // seconds
  totalSessions: number;
  posts: DemoPost[];
  tasks: DemoTask[];
  goals: DemoGoal[];
  sessions: DemoSession[];
}

// ── Personas ──────────────────────────────────────────────────────────────────

const users: DemoUser[] = [
  // 1) High-school senior — newer / lighter user
  {
    email: 'leo@ascend.app',
    username: 'leo_kim',
    bioRole: 'High school senior · college apps + calculus',
    xp: 380,
    level: 3,
    currentStreak: 5,
    longestStreak: 9,
    totalFocusTime: 11 * HOURS,
    totalSessions: 22,
    sessions: [
      { durationSeconds: 25 * MIN, taskLabel: 'Calc BC — integrals', daysAgo: 0 },
      { durationSeconds: 30 * MIN, taskLabel: 'Common App essay draft', daysAgo: 1 },
      { durationSeconds: 25 * MIN, taskLabel: 'Calc BC — practice set', daysAgo: 2 },
      { durationSeconds: 20 * MIN, taskLabel: 'AP Gov reading', daysAgo: 3 },
      { durationSeconds: 25 * MIN, taskLabel: 'Common App essay draft', daysAgo: 4 },
      { durationSeconds: 25 * MIN, taskLabel: 'Calc BC — integrals', daysAgo: 6 },
    ],
    tasks: [
      { title: 'Finish Common App personal essay', tags: ['college-apps'], priority: 'high', isCompleted: false, daysAgo: 6, estimatedMinutes: 180, sessionsOnTask: 4 },
      { title: 'Calc BC: integration by parts pset', tags: ['math'], priority: 'high', isCompleted: false, daysAgo: 2, estimatedMinutes: 90, sessionsOnTask: 2 },
      { title: 'AP Gov chapter 7 notes', tags: ['ap-gov'], priority: 'medium', isCompleted: true, daysAgo: 3, estimatedMinutes: 45, sessionsOnTask: 1 },
      { title: 'Request counselor rec letter', tags: ['college-apps'], priority: 'medium', isCompleted: true, daysAgo: 8 },
    ],
    goals: [
      { title: 'Submit 3 college applications', tag: 'college-apps', targetSessions: 12, deadlineDays: 21 },
      { title: 'Master Calc BC unit 6', tag: 'math', targetSessions: 8, deadlineDays: 14 },
    ],
    posts: [
      {
        type: 'free_post', daysAgo: 1,
        caption: 'First week using Ascend to stop procrastinating on my college essays. Showing up 5 days straight feels unreal 😮‍💨',
        payload: { contentTag: 'motivation' },
      },
      {
        type: 'session_recap', daysAgo: 0,
        caption: 'Knocked out a calc set before dinner.',
        payload: { sessionCount: 3, focusMinutes: 75, streakAtPost: 5 },
      },
    ],
  },

  // 2) High-school junior — SAT + AP grind, consistent
  {
    email: 'maya@ascend.app',
    username: 'maya_chen',
    bioRole: 'High school junior · SAT prep + AP Bio',
    xp: 1450,
    level: 5,
    currentStreak: 12,
    longestStreak: 15,
    totalFocusTime: 41 * HOURS,
    totalSessions: 78,
    sessions: [
      { durationSeconds: 50 * MIN, taskLabel: 'SAT Math — practice test', daysAgo: 0 },
      { durationSeconds: 45 * MIN, taskLabel: 'AP Bio — cell respiration', daysAgo: 0 },
      { durationSeconds: 50 * MIN, taskLabel: 'SAT Reading drills', daysAgo: 1 },
      { durationSeconds: 40 * MIN, taskLabel: 'AP Bio flashcards', daysAgo: 2 },
      { durationSeconds: 50 * MIN, taskLabel: 'SAT Math — practice test', daysAgo: 3 },
      { durationSeconds: 45 * MIN, taskLabel: 'AP Bio — genetics', daysAgo: 4 },
      { durationSeconds: 50 * MIN, taskLabel: 'SAT Writing review', daysAgo: 5 },
      { durationSeconds: 40 * MIN, taskLabel: 'AP Bio flashcards', daysAgo: 6 },
      { durationSeconds: 50 * MIN, taskLabel: 'SAT Math — practice test', daysAgo: 7 },
    ],
    tasks: [
      { title: 'Full SAT practice test #4', tags: ['sat'], priority: 'high', isCompleted: false, daysAgo: 3, estimatedMinutes: 180, sessionsOnTask: 3 },
      { title: 'AP Bio: cellular respiration unit', tags: ['ap-bio'], priority: 'high', isCompleted: false, daysAgo: 4, estimatedMinutes: 120, sessionsOnTask: 4 },
      { title: 'Review SAT math mistakes log', tags: ['sat'], priority: 'medium', isCompleted: true, daysAgo: 2, sessionsOnTask: 2 },
      { title: 'AP Bio genetics flashcards', tags: ['ap-bio'], priority: 'medium', isCompleted: true, daysAgo: 5, sessionsOnTask: 1 },
      { title: 'Read 1 chapter of assigned novel', tags: ['english'], priority: 'low', isCompleted: false, daysAgo: 1 },
    ],
    goals: [
      { title: 'Hit 1450 on SAT practice', tag: 'sat', targetSessions: 20, deadlineDays: 30 },
      { title: 'Finish AP Bio Unit 3', tag: 'ap-bio', targetSessions: 10, deadlineDays: 12 },
    ],
    posts: [
      {
        type: 'streak_milestone', daysAgo: 0,
        caption: '12 days in a row! SAT in 4 weeks, locked in 🔒',
        payload: { streakAtPost: 12, totalSessionsAtPost: 78, totalFocusHoursAtPost: 41 },
      },
      {
        type: 'free_post', daysAgo: 2,
        caption: 'Study tip: redo every SAT math question you missed the NEXT day, not at the end of the week. Spaced repetition >>> cramming.',
        payload: { contentTag: 'study_tip', attachedStats: [{ label: 'Avg/day', value: '1h 35m' }, { label: 'Streak', value: '12d' }] as AttachedStat[] },
      },
    ],
  },

  // 3) Working professional — junior dev studying for a cert
  {
    email: 'sam@ascend.app',
    username: 'sam_rivera',
    bioRole: 'Software developer · AWS cert + side project',
    xp: 1850,
    level: 5,
    currentStreak: 8,
    longestStreak: 19,
    totalFocusTime: 53 * HOURS,
    totalSessions: 96,
    sessions: [
      { durationSeconds: 50 * MIN, taskLabel: 'AWS SAA — VPC module', daysAgo: 0 },
      { durationSeconds: 45 * MIN, taskLabel: 'Side project: auth flow', daysAgo: 1 },
      { durationSeconds: 50 * MIN, taskLabel: 'AWS SAA — IAM deep dive', daysAgo: 1 },
      { durationSeconds: 50 * MIN, taskLabel: 'AWS practice exam', daysAgo: 2 },
      { durationSeconds: 40 * MIN, taskLabel: 'Side project: bug fixes', daysAgo: 4 },
      { durationSeconds: 50 * MIN, taskLabel: 'AWS SAA — S3 + storage', daysAgo: 5 },
      { durationSeconds: 45 * MIN, taskLabel: 'System design reading', daysAgo: 7 },
    ],
    tasks: [
      { title: 'Pass AWS Solutions Architect practice exam (80%+)', tags: ['aws', 'career'], priority: 'high', isCompleted: false, daysAgo: 5, estimatedMinutes: 240, sessionsOnTask: 5 },
      { title: 'Ship auth flow for side project', tags: ['side-project'], priority: 'high', isCompleted: false, daysAgo: 4, estimatedMinutes: 180, sessionsOnTask: 3 },
      { title: 'AWS VPC + networking module', tags: ['aws'], priority: 'medium', isCompleted: true, daysAgo: 0, sessionsOnTask: 1 },
      { title: 'Write standup notes', tags: ['work'], priority: 'low', isCompleted: true, daysAgo: 1 },
    ],
    goals: [
      { title: 'Earn AWS SAA certification', tag: 'aws', targetSessions: 25, deadlineDays: 28 },
      { title: 'Launch side project v1', tag: 'side-project', targetSessions: 15, deadlineDays: 45 },
    ],
    posts: [
      {
        type: 'session_recap', daysAgo: 0,
        caption: 'Lunch-break focus block before standup. VPCs finally make sense.',
        payload: { sessionCount: 1, focusMinutes: 50, streakAtPost: 8 },
      },
      {
        type: 'free_post', daysAgo: 4,
        caption: 'Balancing a full-time dev job + cert prep is brutal. Two 50-min blocks before work has been the only thing that works. Anyone else study before 8am?',
        payload: { contentTag: 'question' },
      },
    ],
  },

  // 4) College sophomore — CS major, heavy user
  {
    email: 'jordan@ascend.app',
    username: 'jordan_blake',
    bioRole: 'College sophomore · CS major',
    xp: 4200,
    level: 7,
    currentStreak: 23,
    longestStreak: 31,
    totalFocusTime: 96 * HOURS,
    totalSessions: 184,
    sessions: [
      { durationSeconds: 50 * MIN, taskLabel: 'Data Structures — heaps', daysAgo: 0 },
      { durationSeconds: 50 * MIN, taskLabel: 'Data Structures — heaps', daysAgo: 0 },
      { durationSeconds: 45 * MIN, taskLabel: 'Discrete math pset', daysAgo: 1 },
      { durationSeconds: 50 * MIN, taskLabel: 'OS project — scheduler', daysAgo: 1 },
      { durationSeconds: 50 * MIN, taskLabel: 'Leetcode — graphs', daysAgo: 2 },
      { durationSeconds: 50 * MIN, taskLabel: 'Discrete math pset', daysAgo: 3 },
      { durationSeconds: 45 * MIN, taskLabel: 'OS project — scheduler', daysAgo: 4 },
      { durationSeconds: 50 * MIN, taskLabel: 'Linear algebra review', daysAgo: 5 },
      { durationSeconds: 50 * MIN, taskLabel: 'Leetcode — DP', daysAgo: 6 },
      { durationSeconds: 50 * MIN, taskLabel: 'Data Structures — trees', daysAgo: 7 },
    ],
    tasks: [
      { title: 'OS project: build CPU scheduler', tags: ['cs', 'project'], priority: 'high', isCompleted: false, daysAgo: 7, estimatedMinutes: 360, sessionsOnTask: 6 },
      { title: 'Discrete math problem set 8', tags: ['math'], priority: 'high', isCompleted: false, daysAgo: 3, estimatedMinutes: 120, sessionsOnTask: 2 },
      { title: 'Grind 20 graph Leetcode problems', tags: ['interview-prep'], priority: 'medium', isCompleted: false, daysAgo: 6, estimatedMinutes: 300, sessionsOnTask: 4 },
      { title: 'Data Structures: heaps reading + notes', tags: ['cs'], priority: 'medium', isCompleted: true, daysAgo: 0, sessionsOnTask: 2 },
      { title: 'Linear algebra midterm review', tags: ['math'], priority: 'low', isCompleted: true, daysAgo: 5, sessionsOnTask: 1 },
    ],
    goals: [
      { title: 'Ace OS midterm', tag: 'cs', targetSessions: 30, deadlineDays: 18 },
      { title: 'Land a summer SWE internship', tag: 'interview-prep', targetSessions: 50, deadlineDays: 60 },
    ],
    posts: [
      {
        type: 'streak_milestone', daysAgo: 1,
        caption: '23-day streak. Honestly the streak is the only reason I open my laptop some mornings 😅',
        payload: { streakAtPost: 23, totalSessionsAtPost: 184, totalFocusHoursAtPost: 96 },
      },
      {
        type: 'achievement_unlock', daysAgo: 3,
        caption: 'Two months of consistency unlocked!',
        payload: {
          achievementIcon: '💎', achievementName: 'Two-Month Titan',
          achievementDescription: 'Complete focus sessions 60 days in a row',
          achievementXpReward: 1000, achievementRank: 'Expert',
        },
      },
      {
        type: 'free_post', daysAgo: 5,
        caption: 'Resource: MIT 6.006 lectures on YouTube are gold for data structures. Free and better than my actual lectures.',
        payload: { contentTag: 'resource' },
      },
    ],
  },

  // 5) College senior — pre-med MCAT grind, top of the leaderboard
  {
    email: 'priya@ascend.app',
    username: 'priya_patel',
    bioRole: 'College senior · pre-med, MCAT prep',
    xp: 9100,
    level: 9,
    currentStreak: 34,
    longestStreak: 41,
    totalFocusTime: 168 * HOURS,
    totalSessions: 322,
    sessions: [
      { durationSeconds: 55 * MIN, taskLabel: 'MCAT — biochem amino acids', daysAgo: 0 },
      { durationSeconds: 55 * MIN, taskLabel: 'MCAT — biochem amino acids', daysAgo: 0 },
      { durationSeconds: 50 * MIN, taskLabel: 'UWorld CARS passages', daysAgo: 0 },
      { durationSeconds: 55 * MIN, taskLabel: 'MCAT — physics review', daysAgo: 1 },
      { durationSeconds: 55 * MIN, taskLabel: 'AAMC full-length review', daysAgo: 1 },
      { durationSeconds: 50 * MIN, taskLabel: 'UWorld CARS passages', daysAgo: 2 },
      { durationSeconds: 55 * MIN, taskLabel: 'MCAT — orgo mechanisms', daysAgo: 3 },
      { durationSeconds: 55 * MIN, taskLabel: 'MCAT — psych/soc deck', daysAgo: 4 },
      { durationSeconds: 50 * MIN, taskLabel: 'AAMC full-length #3', daysAgo: 5 },
      { durationSeconds: 55 * MIN, taskLabel: 'MCAT — biochem pathways', daysAgo: 6 },
      { durationSeconds: 55 * MIN, taskLabel: 'UWorld CARS passages', daysAgo: 7 },
    ],
    tasks: [
      { title: 'AAMC Full-Length #4 + full review', tags: ['mcat'], priority: 'high', isCompleted: false, daysAgo: 5, estimatedMinutes: 480, sessionsOnTask: 7 },
      { title: 'Finish biochem amino acids deck', tags: ['mcat', 'biochem'], priority: 'high', isCompleted: false, daysAgo: 0, estimatedMinutes: 120, sessionsOnTask: 3 },
      { title: 'Daily 5 CARS passages (UWorld)', tags: ['mcat', 'cars'], priority: 'high', isCompleted: false, daysAgo: 2, sessionsOnTask: 4 },
      { title: 'Submit secondary application essays', tags: ['med-apps'], priority: 'medium', isCompleted: true, daysAgo: 4, sessionsOnTask: 2 },
      { title: 'Orgo reaction mechanisms review', tags: ['mcat', 'orgo'], priority: 'medium', isCompleted: true, daysAgo: 3, sessionsOnTask: 1 },
    ],
    goals: [
      { title: 'Score 515+ on the MCAT', tag: 'mcat', targetSessions: 80, deadlineDays: 40 },
      { title: 'Complete all AAMC full-lengths', tag: 'mcat', targetSessions: 20, deadlineDays: 35 },
    ],
    posts: [
      {
        type: 'achievement_unlock', daysAgo: 0,
        caption: 'Monthly Master 👑 — 30 days straight of MCAT grind. The deck doesn\'t study itself.',
        payload: {
          achievementIcon: '👑', achievementName: 'Monthly Master',
          achievementDescription: 'Complete focus sessions 30 days in a row',
          achievementXpReward: 500, achievementRank: 'Elite',
        },
      },
      {
        type: 'streak_milestone', daysAgo: 2,
        caption: 'MCAT in 6 weeks. 168 hours logged on Ascend so far. We move.',
        payload: { streakAtPost: 34, totalSessionsAtPost: 322, totalFocusHoursAtPost: 168 },
      },
      {
        type: 'free_post', daysAgo: 4,
        caption: 'Motivation for anyone deep in a hard prep season: you will not feel ready, and that\'s normal. Show up for the reps anyway. Consistency compounds. 🙌',
        payload: { contentTag: 'motivation', attachedStats: [{ label: 'Total focus', value: '168h' }, { label: 'Streak', value: '34d' }] as AttachedStat[] },
      },
    ],
  },
];

// ── Seeder ──────────────────────────────────────────────────────────────────

async function seedDemoUsers() {
  // This writes real rows. The repo runs three databases (local, Railway
  // staging, Railway production) off one DATABASE_URL, so a mistyped .env is
  // the difference between seeding a sandbox and putting five fake accounts
  // on a leaderboard real people can see. Local is allowed silently; anything
  // else has to be asked for.
  const dbUrl = process.env.DATABASE_URL ?? '';
  const host = (dbUrl.match(/@([^/:?]+)/) ?? [])[1] ?? 'unknown';
  const isLocal = /^(localhost|127\.0\.0\.1|::1)$/.test(host);
  if (!isLocal && process.env.ALLOW_REMOTE_SEED !== '1') {
    console.error(`\nRefusing to seed a remote database.\n`);
    console.error(`  host: ${host}`);
    console.error(`\nIf that is deliberate, re-run with ALLOW_REMOTE_SEED=1.`);
    console.error(`Never point this at production — it deletes and rewrites`);
    console.error(`every task, goal, session, note and post for the demo emails.\n`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`Seeding demo users into ${host}...\n`);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const created: { username: string; email: string; id: string }[] = [];

  for (const u of users) {
    // Upsert the user (idempotent on email).
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        username: u.username,
        passwordHash,
        privacySetting: 'public',
        xp: u.xp,
        level: u.level,
        currentStreak: u.currentStreak,
        longestStreak: u.longestStreak,
        totalFocusTime: u.totalFocusTime,
        totalSessions: u.totalSessions,
        lastActiveDate: day(0),
      },
      create: {
        email: u.email,
        username: u.username,
        passwordHash,
        privacySetting: 'public',
        xp: u.xp,
        level: u.level,
        currentStreak: u.currentStreak,
        longestStreak: u.longestStreak,
        totalFocusTime: u.totalFocusTime,
        totalSessions: u.totalSessions,
        lastActiveDate: day(0),
      },
    });

    // Streak row.
    await prisma.streak.upsert({
      where: { userId: user.id },
      update: { currentStreak: u.currentStreak, longestStreak: u.longestStreak, lastSessionDate: day(0) },
      create: { userId: user.id, currentStreak: u.currentStreak, longestStreak: u.longestStreak, lastSessionDate: day(0) },
    });

    // Wipe previously-seeded generated content for this user so re-runs don't duplicate.
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.task.deleteMany({ where: { userId: user.id } });
    await prisma.taskGoal.deleteMany({ where: { userId: user.id } });
    await prisma.socialPost.deleteMany({ where: { authorId: user.id } });
    await prisma.note.deleteMany({ where: { userId: user.id } });
    await prisma.userAchievement.deleteMany({ where: { userId: user.id } });

    // Sessions.
    for (const s of u.sessions) {
      await prisma.session.create({
        data: {
          userId: user.id,
          type: 'focus',
          durationSeconds: s.durationSeconds,
          plannedDurationSeconds: s.durationSeconds,
          taskLabel: s.taskLabel,
          completedAt: day(s.daysAgo),
        },
      });
    }

    // Goals (TaskGoal).
    for (const g of u.goals) {
      await prisma.taskGoal.create({
        data: {
          userId: user.id,
          title: g.title,
          tag: g.tag,
          targetSessions: g.targetSessions,
          deadline: new Date(now + g.deadlineDays * 86400000),
          isCompleted: g.isCompleted ?? false,
          completedAt: g.isCompleted ? day(1) : null,
        },
      });
    }

    // Tasks. Scheduling is derived so every account has a populated calendar:
    // a completed task keeps its original day, an open one is spread across the
    // week ahead, and roughly half of the dated ones get a time block so the Day
    // timeline and the Month workload shading have something to draw.
    for (const [idx, t] of u.tasks.entries()) {
      const seed = `${u.username}:${t.title}`;
      const r = hashUnit(seed);

      // Completed work sits on the day it was done; open work lands in the next
      // ten days. One task per account is deliberately left undated so the
      // Planning tab’s UNSCHEDULED list is never empty.
      const leaveUndated = idx === u.tasks.length - 1 && !t.isCompleted;
      const offset = t.isCompleted ? -t.daysAgo : Math.floor(r * 10);
      const dueDate = leaveUndated ? null : dueDateFor(offset);

      // Times only make sense with a day attached.
      const wantsTime = dueDate !== null && hashUnit(`${seed}:time`) < 0.55;
      const startHour = 8 + Math.floor(hashUnit(`${seed}:hour`) * 10); // 08:00-17:00
      const block = BLOCK_MINUTES[Math.floor(hashUnit(`${seed}:len`) * BLOCK_MINUTES.length)];
      const startMinutes = wantsTime ? startHour * 60 : null;
      const endMinutes = wantsTime ? Math.min(23 * 60 + 55, startHour * 60 + block) : null;

      await prisma.task.create({
        data: {
          userId: user.id,
          title: t.title,
          description: t.description ?? null,
          tags: t.tags,
          priority: t.priority,
          estimatedMinutes: t.estimatedMinutes ?? null,
          dueDate,
          startMinutes,
          endMinutes,
          isCompleted: t.isCompleted,
          completedAt: t.isCompleted ? day(Math.max(0, t.daysAgo - 1)) : null,
          sessionsOnTask: t.sessionsOnTask ?? 0,
          totalTimeOnTask: (t.sessionsOnTask ?? 0) * 25 * MIN,
          // Populates the per-task history the stats modal reads.
          sessionDates: Array.from({ length: t.sessionsOnTask ?? 0 }, (_, i) => dayKey(-(t.daysAgo + i))),
          createdAt: day(t.daysAgo),
        },
      });
    }

    // A recurring habit per account: a template plus today’s instance, which is
    // the shape spawn-recurring produces. Without this the Day view’s
    // "Recurring tasks" group is empty on every demo account.
    const habit = HABITS[created.length % HABITS.length];
    const template = await prisma.task.create({
      data: {
        userId: user.id,
        title: habit.title,
        tags: habit.tags,
        priority: 'medium',
        estimatedMinutes: habit.minutes,
        isRecurring: true,
        recurringDays: habit.days,
        startMinutes: habit.startHour * 60,
        endMinutes: habit.startHour * 60 + habit.minutes,
        lastSpawnedDate: dayKey(0),
        currentStreak: u.currentStreak,
        longestStreak: u.longestStreak,
        totalCompletions: u.currentStreak * 2,
        totalFocusTimeMs: u.currentStreak * 2 * habit.minutes * MIN,
        createdAt: day(30),
      },
    });
    await prisma.task.create({
      data: {
        userId: user.id,
        title: habit.title,
        tags: habit.tags,
        priority: 'medium',
        estimatedMinutes: habit.minutes,
        dueDate: dueDateFor(0),
        startMinutes: habit.startHour * 60,
        endMinutes: habit.startHour * 60 + habit.minutes,
        parentTaskId: template.id,
        lifetimeStreak: u.currentStreak,
        lifetimeTotalCompletions: u.currentStreak * 2,
        lifetimeTotalFocusTime: u.currentStreak * 2 * habit.minutes * MIN,
        createdAt: day(0),
      },
    });

    // Notes and to-dos across the visible fortnight.
    for (let i = 0; i < 4; i += 1) {
      const pick = NOTE_POOL[Math.floor(hashUnit(`${u.username}:note:${i}`) * NOTE_POOL.length)];
      const offset = Math.floor(hashUnit(`${u.username}:noteday:${i}`) * 7) - 2;
      await prisma.note.create({
        data: {
          userId: user.id,
          content: pick.content,
          date: dayKey(offset),
          isTodo: pick.isTodo,
          isCompleted: pick.isTodo && offset < 0,
          createdAt: day(Math.max(0, -offset)),
        },
      });
    }

    // Unlock the achievements these stats actually earn. Awarding arbitrary
    // ones would make the profile screen lie about how it got there.
    const earned = await prisma.achievement.findMany();
    for (const a of earned) {
      const meets = a.category === 'STREAK' ? u.longestStreak >= a.threshold
        : a.category === 'SESSIONS' ? u.totalSessions >= a.threshold
        // threshold is HOURS in seed.ts; totalFocusTime is seconds.
        : a.category === 'FOCUS_TIME' ? u.totalFocusTime >= a.threshold * HOURS
        : false;
      if (!meets) continue;
      await prisma.userAchievement.create({
        data: { userId: user.id, achievementId: a.id, unlockedAt: day(Math.floor(hashUnit(`${u.username}:${a.key}`) * 30)) },
      });
    }

    // Social posts.
    for (const p of u.posts) {
      await prisma.socialPost.create({
        data: {
          authorId: user.id,
          type: p.type,
          caption: p.caption,
          visibility: 'public',
          payload: p.payload,
          reactions: {},
          createdAt: day(p.daysAgo),
        },
      });
    }

    created.push({ username: user.username, email: user.email, id: user.id });
    console.log(`  ✓ ${u.username.padEnd(14)} L${u.level}  ${u.currentStreak}d streak  ${Math.round(u.totalFocusTime / 3600)}h focus  (${u.posts.length} posts, ${u.tasks.length} tasks)`);
  }

  // Follow graph: full mesh so everyone's "friends" feed + leaderboard is populated.
  console.log('\nBuilding follow graph (full mesh)...');
  for (const a of created) {
    for (const b of created) {
      if (a.id === b.id) continue;
      await prisma.follow.upsert({
        where: { followerId_followingId: { followerId: a.id, followingId: b.id } },
        update: {},
        create: { followerId: a.id, followingId: b.id },
      });
    }
  }

  console.log('\n────────────────────────────────────────────');
  console.log(' DEMO ACCOUNT LOGINS');
  console.log('────────────────────────────────────────────');
  for (const c of created) {
    console.log(` ${c.email.padEnd(20)}  password: ${DEMO_PASSWORD}`);
  }
  console.log('────────────────────────────────────────────');

  await prisma.$disconnect();
}

seedDemoUsers().catch((error) => {
  console.error('Demo seed error:', error);
  prisma.$disconnect();
  process.exit(1);
});

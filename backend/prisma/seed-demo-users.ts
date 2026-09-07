/**
 * Demo user seeder — five showcase accounts with a whole app behind them.
 *
 * The point is a demo where every screen has something to show: a calendar with
 * a worked-in month behind it and appointments ahead of it, goals that are
 * genuinely part-done, a feed with reactions on it, groups with people in them,
 * a notification tray, an activity log, and a focus report that can actually
 * break time down by tag, goal, task and hour.
 *
 * ─── The one rule this file follows ─────────────────────────────────────────
 *
 * A persona declares INTENT — who they are, what they are working on, roughly
 * how much. Everything a screen can add up is DERIVED from the rows that get
 * written, never declared alongside them.
 *
 * That is not tidiness. A profile that says "34-day streak, 322 sessions" over
 * a calendar with nine sessions in it is not a demo of this app, it is a demo
 * of two screens disagreeing — and the calendar is the one telling the truth.
 * So the session history is laid out to PRODUCE the streaks, and the totals on
 * the user row are counted back off the sessions that were written.
 *
 * Idempotent: re-running upserts the users by email and replaces everything
 * generated for them, so you never get duplicates. Does NOT touch real
 * accounts, and refuses to run against a remote database without an explicit
 * opt-in.
 *
 * Run:  npm run db:seed:demo        (or: npx tsx prisma/seed-demo-users.ts)
 */
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { buildAttribution } from '../src/lib/sessionAttribution';
import {
  HISTORY_DAYS,
  hashUnit,
  sessionCountByDay,
  type HistoryShape,
} from '../src/lib/demoHistory';

const prisma = new PrismaClient();

const HOURS = 3600;
const MIN = 60;
const now = Date.now();
const day = (n: number) => new Date(now - n * 86400000); // n days ago

// Shared password for all demo accounts (each login listed at the end of the run).
const DEMO_PASSWORD = 'AscendDemo!2026';

/** Focus blocks land between these hours. See sessionInstantOn for why UTC. */
const FIRST_FOCUS_HOUR = 7;
const LAST_FOCUS_HOUR = 22;

/** Deterministic pick from a list. */
function pick<T>(list: readonly T[], seed: string): T {
  return list[Math.floor(hashUnit(seed) * list.length)];
}

/** Local calendar day n days from today, as the UTC-midnight Date dueDate expects. */
function dueDateFor(offsetDays: number): Date {
  const d = new Date(now + offsetDays * 86400000);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** 'YYYY-MM-DD' n days from today, for Note.date, Event.date and localDate. */
function dayKey(offsetDays: number): string {
  const d = new Date(now + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The instant a session finished, on the day `dayKey(offsetDays)` names.
 *
 * Built as UTC-midnight-of-that-day plus the hour, and attributed with
 * `timeZone: 'UTC'`, so the frozen localDate/localHour on the row agree exactly
 * with the day the task, note and event rows were given. Demo accounts have no
 * real timezone to be faithful to; what matters is that the calendar, the
 * report and the streak all read the same day.
 */
function sessionInstantOn(offsetDays: number, hour: number): Date {
  const d = new Date(now + offsetDays * 86400000);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), hour));
}

/** Block lengths that produce a readable timeline rather than uniform bars. */
const BLOCK_MINUTES = [30, 45, 60, 90, 120];

/** Minutes added to a focus block so the report is not a row of identical bars. */
const BLOCK_JITTER = [-10, -5, 0, 0, 5, 15];

const HABITS: { title: string; tags: string[]; days: string[]; startHour: number; minutes: number }[] = [
  { title: 'Morning review', tags: ['routine'], days: ['mon', 'tue', 'wed', 'thu', 'fri'], startHour: 8, minutes: 20 },
  { title: 'Flashcards', tags: ['study'], days: [], startHour: 19, minutes: 25 },
  { title: 'Read 20 pages', tags: ['reading'], days: [], startHour: 21, minutes: 30 },
  { title: 'Inbox zero', tags: ['work'], days: ['mon', 'wed', 'fri'], startHour: 17, minutes: 15 },
  { title: 'Practice set', tags: ['cs'], days: ['tue', 'thu'], startHour: 16, minutes: 45 },
  { title: 'Evening shutdown', tags: ['routine'], days: ['sun', 'mon', 'tue', 'wed', 'thu'], startHour: 22, minutes: 10 },
  { title: 'Stretch + walk', tags: ['health'], days: [], startHour: 7, minutes: 20 },
];

/** Two habits each, so the projected "Recurring" row is not a single lonely
 *  line on every day of the month view. */
const HABITS_PER_USER = 2;

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
  { content: 'Back up the notes folder', isTodo: true },
  { content: 'Slept badly — the 9am block was a write-off', isTodo: false },
  { content: 'Swap Thursday and Friday around next week', isTodo: true },
  { content: 'Sitting near the window helps more than I expected', isTodo: false },
];

const NOTES_PER_USER = 9;

/**
 * Events — time that is spoken for but is not work the user does. Deliberately
 * the kind of thing a task would be wrong for: you do not complete a dentist
 * appointment, and ticking one off must never award XP or post to the feed.
 *
 * `startHour` null means an all-day event.
 */
const EVENT_POOL: { title: string; startHour: number | null; minutes: number }[] = [
  { title: 'Dentist',                 startHour: 14, minutes: 60 },
  { title: 'Team standup',            startHour: 9,  minutes: 15 },
  { title: 'Lunch with Sam',          startHour: 12, minutes: 75 },
  { title: 'Physio',                  startHour: 17, minutes: 45 },
  { title: 'Flight to Lisbon',        startHour: 7,  minutes: 150 },
  { title: 'Supervisor check-in',     startHour: 11, minutes: 30 },
  { title: 'Public holiday',          startHour: null, minutes: 0 },
  { title: 'Conference day',          startHour: null, minutes: 0 },
  { title: 'Haircut',                 startHour: 16, minutes: 30 },
  { title: 'Group project sync',      startHour: 15, minutes: 60 },
  { title: 'Doctor — annual check',   startHour: 10, minutes: 45 },
  { title: 'Dinner with family',      startHour: 19, minutes: 120 },
  { title: 'Car service',             startHour: 8,  minutes: 90 },
  { title: 'Volunteering shift',      startHour: 13, minutes: 180 },
  { title: 'Moving day',              startHour: null, minutes: 0 },
  { title: 'Concert',                 startHour: 20, minutes: 150 },
];

/** Spread across roughly a month, biased forward: a calendar full of
 *  appointments you have already been to is not what the app is for. */
const EVENTS_PER_USER = 10;
const EVENT_WINDOW_START = -10;
const EVENT_WINDOW_END = 20;

interface AttachedStat { label: string; value: string }

/**
 * What a screen can add up once the rows exist. Passed to any post whose copy
 * quotes a number, so a caption cannot drift away from the account under it.
 */
interface DerivedStats {
  totalSessions: number;
  totalFocusHours: number;
  currentStreak: number;
  tasksCompleted: number;
}

type Copy<T> = T | ((s: DerivedStats) => T);

function resolve<T>(value: Copy<T>, stats: DerivedStats): T {
  return typeof value === 'function' ? (value as (s: DerivedStats) => T)(stats) : value;
}

interface DemoPost {
  type: 'session_recap' | 'achievement_unlock' | 'streak_milestone' | 'accountability' | 'free_post';
  caption: Copy<string>;
  daysAgo: number;
  payload: Copy<Record<string, unknown>>;
}

/**
 * A strand of work this person does, drawn on repeatedly to build history.
 *
 * `tag` is what makes the rest of the app light up: it links the session to the
 * task that carries the same tag, through it to that task's goal, and it is
 * what the focus report's tag breakdown counts.
 */
interface DemoFocus {
  label: string;
  tag: string;
  minutes: number;
}

interface DemoTask {
  title: string;
  description?: string;
  tags: string[];
  priority: 'low' | 'medium' | 'high';
  isCompleted: boolean;
  daysAgo: number; // when created
  estimatedMinutes?: number;
}

interface DemoGoal {
  title: string;
  tag: string;
  targetSessions: number;
  deadlineDays: number; // due in N days
  isCompleted?: boolean;
}

interface DemoUser {
  email: string;
  username: string;
  /** Shown in the run summary. The User row has nowhere to put it — there is no
   *  bio column — so it documents the persona rather than seeding one. */
  bioRole: string;
  avatarEmoji: string;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  /** A target, not a promise: the generator hits it where the streak geometry
   *  allows and the user row is written with whatever was actually created. */
  totalSessions: number;
  focus: DemoFocus[];
  posts: DemoPost[];
  tasks: DemoTask[];
  goals: DemoGoal[];
}

// ── Personas ──────────────────────────────────────────────────────────────────

const users: DemoUser[] = [
  // 1) High-school senior — newer / lighter user
  {
    email: 'leo@ascend.app',
    username: 'leo_kim',
    bioRole: 'High school senior · college apps + calculus',
    avatarEmoji: '🦊',
    xp: 380,
    currentStreak: 5,
    longestStreak: 9,
    totalSessions: 64,
    focus: [
      { label: 'Calc BC — integrals', tag: 'math', minutes: 25 },
      { label: 'Calc BC — practice set', tag: 'math', minutes: 30 },
      { label: 'Common App essay draft', tag: 'college-apps', minutes: 30 },
      { label: 'Supplemental essays', tag: 'college-apps', minutes: 25 },
      { label: 'AP Gov reading', tag: 'ap-gov', minutes: 20 },
    ],
    tasks: [
      { title: 'Finish Common App personal essay', tags: ['college-apps'], priority: 'high', isCompleted: false, daysAgo: 6, estimatedMinutes: 180 },
      { title: 'Calc BC: integration by parts pset', tags: ['math'], priority: 'high', isCompleted: false, daysAgo: 2, estimatedMinutes: 90 },
      { title: 'Draft the "why us" supplemental', tags: ['college-apps'], priority: 'medium', isCompleted: false, daysAgo: 4, estimatedMinutes: 60 },
      { title: 'Calc BC: u-substitution pset', tags: ['math'], priority: 'medium', isCompleted: true, daysAgo: 9, estimatedMinutes: 60 },
      { title: 'AP Gov chapter 7 notes', tags: ['ap-gov'], priority: 'medium', isCompleted: true, daysAgo: 3, estimatedMinutes: 45 },
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
        payload: (s) => ({ sessionCount: 3, focusMinutes: 75, streakAtPost: s.currentStreak }),
      },
    ],
  },

  // 2) High-school junior — SAT + AP grind, consistent
  {
    email: 'maya@ascend.app',
    username: 'maya_chen',
    bioRole: 'High school junior · SAT prep + AP Bio',
    avatarEmoji: '🦋',
    xp: 1450,
    currentStreak: 12,
    longestStreak: 15,
    totalSessions: 148,
    focus: [
      { label: 'SAT Math — practice test', tag: 'sat', minutes: 50 },
      { label: 'SAT Reading drills', tag: 'sat', minutes: 45 },
      { label: 'SAT Writing review', tag: 'sat', minutes: 40 },
      { label: 'AP Bio — cell respiration', tag: 'ap-bio', minutes: 45 },
      { label: 'AP Bio flashcards', tag: 'ap-bio', minutes: 30 },
      { label: 'Assigned novel', tag: 'english', minutes: 35 },
    ],
    tasks: [
      { title: 'Full SAT practice test #4', tags: ['sat'], priority: 'high', isCompleted: false, daysAgo: 3, estimatedMinutes: 180 },
      { title: 'AP Bio: cellular respiration unit', tags: ['ap-bio'], priority: 'high', isCompleted: false, daysAgo: 4, estimatedMinutes: 120 },
      { title: 'Review SAT math mistakes log', tags: ['sat'], priority: 'medium', isCompleted: true, daysAgo: 2 },
      { title: 'AP Bio genetics flashcards', tags: ['ap-bio'], priority: 'medium', isCompleted: true, daysAgo: 5 },
      { title: 'Read 1 chapter of assigned novel', tags: ['english'], priority: 'low', isCompleted: false, daysAgo: 1 },
      // The three tasks behind the finished goal below.
      { title: 'Diagnostic SAT — sit it cold', tags: ['sat-baseline'], priority: 'medium', isCompleted: true, daysAgo: 26 },
      { title: 'Score the diagnostic + build the mistakes log', tags: ['sat-baseline'], priority: 'medium', isCompleted: true, daysAgo: 24 },
      { title: 'Pick a target score and a weekly plan', tags: ['sat-baseline'], priority: 'low', isCompleted: true, daysAgo: 22 },
    ],
    goals: [
      { title: 'Hit 1450 on SAT practice', tag: 'sat', targetSessions: 20, deadlineDays: 30 },
      { title: 'Finish AP Bio Unit 3', tag: 'ap-bio', targetSessions: 10, deadlineDays: 12 },
      { title: 'Set an honest SAT baseline', tag: 'sat-baseline', targetSessions: 4, deadlineDays: -18, isCompleted: true },
    ],
    posts: [
      {
        type: 'streak_milestone', daysAgo: 0,
        caption: '12 days in a row! SAT in 4 weeks, locked in 🔒',
        payload: (s) => ({ streakAtPost: s.currentStreak, totalSessionsAtPost: s.totalSessions, totalFocusHoursAtPost: s.totalFocusHours }),
      },
      {
        type: 'free_post', daysAgo: 2,
        caption: 'Study tip: redo every SAT math question you missed the NEXT day, not at the end of the week. Spaced repetition >>> cramming.',
        payload: { contentTag: 'study_tip', attachedStats: [{ label: 'Avg/day', value: '1h 35m' }, { label: 'Streak', value: '12d' }] as AttachedStat[] },
      },
      {
        type: 'accountability', daysAgo: 5,
        caption: 'Public commitment: full practice test every Saturday until the exam. Come after me if I miss one.',
        payload: {},
      },
    ],
  },

  // 3) Working professional — junior dev studying for a cert
  {
    email: 'sam@ascend.app',
    username: 'sam_rivera',
    bioRole: 'Software developer · AWS cert + side project',
    avatarEmoji: '🐙',
    xp: 1850,
    currentStreak: 8,
    longestStreak: 19,
    totalSessions: 172,
    focus: [
      { label: 'AWS SAA — VPC module', tag: 'aws', minutes: 50 },
      { label: 'AWS SAA — IAM deep dive', tag: 'aws', minutes: 50 },
      { label: 'AWS practice exam', tag: 'aws', minutes: 60 },
      { label: 'Side project: auth flow', tag: 'side-project', minutes: 45 },
      { label: 'Side project: bug fixes', tag: 'side-project', minutes: 40 },
      { label: 'System design reading', tag: 'career', minutes: 45 },
    ],
    tasks: [
      { title: 'Pass AWS Solutions Architect practice exam (80%+)', tags: ['aws', 'career'], priority: 'high', isCompleted: false, daysAgo: 5, estimatedMinutes: 240 },
      { title: 'Ship auth flow for side project', tags: ['side-project'], priority: 'high', isCompleted: false, daysAgo: 4, estimatedMinutes: 180 },
      { title: 'AWS VPC + networking module', tags: ['aws'], priority: 'medium', isCompleted: true, daysAgo: 0 },
      { title: 'AWS IAM + policies module', tags: ['aws'], priority: 'medium', isCompleted: true, daysAgo: 6 },
      { title: 'Write standup notes', tags: ['work'], priority: 'low', isCompleted: true, daysAgo: 1 },
      { title: 'Fix the signup rate-limit bug', tags: ['side-project'], priority: 'medium', isCompleted: false, daysAgo: 2, estimatedMinutes: 60 },
      { title: 'Side project: pick the stack and scaffold it', tags: ['side-project'], priority: 'medium', isCompleted: true, daysAgo: 21, estimatedMinutes: 120 },
    ],
    goals: [
      { title: 'Earn AWS SAA certification', tag: 'aws', targetSessions: 25, deadlineDays: 28 },
      { title: 'Launch side project v1', tag: 'side-project', targetSessions: 15, deadlineDays: 45 },
    ],
    posts: [
      {
        type: 'session_recap', daysAgo: 0,
        caption: 'Lunch-break focus block before standup. VPCs finally make sense.',
        payload: (s) => ({ sessionCount: 1, focusMinutes: 50, streakAtPost: s.currentStreak }),
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
    avatarEmoji: '🦉',
    xp: 4200,
    currentStreak: 23,
    longestStreak: 31,
    totalSessions: 268,
    focus: [
      { label: 'Data Structures — heaps', tag: 'cs', minutes: 50 },
      { label: 'Data Structures — trees', tag: 'cs', minutes: 50 },
      { label: 'OS project — scheduler', tag: 'cs', minutes: 55 },
      { label: 'Discrete math pset', tag: 'math', minutes: 45 },
      { label: 'Linear algebra review', tag: 'math', minutes: 40 },
      { label: 'Leetcode — graphs', tag: 'interview-prep', minutes: 50 },
      { label: 'Leetcode — DP', tag: 'interview-prep', minutes: 50 },
    ],
    tasks: [
      { title: 'OS project: build CPU scheduler', tags: ['cs', 'project'], priority: 'high', isCompleted: false, daysAgo: 7, estimatedMinutes: 360 },
      { title: 'Discrete math problem set 8', tags: ['math'], priority: 'high', isCompleted: false, daysAgo: 3, estimatedMinutes: 120 },
      { title: 'Grind 20 graph Leetcode problems', tags: ['interview-prep'], priority: 'medium', isCompleted: false, daysAgo: 6, estimatedMinutes: 300 },
      { title: 'Rewrite the resume for SWE roles', tags: ['interview-prep'], priority: 'medium', isCompleted: false, daysAgo: 9, estimatedMinutes: 90 },
      { title: 'Mock interview with the careers centre', tags: ['interview-prep'], priority: 'medium', isCompleted: true, daysAgo: 12, estimatedMinutes: 60 },
      { title: 'Data Structures: heaps reading + notes', tags: ['cs'], priority: 'medium', isCompleted: true, daysAgo: 0 },
      { title: 'Linear algebra midterm review', tags: ['math'], priority: 'low', isCompleted: true, daysAgo: 5 },
      // The three tasks behind the finished goal below.
      { title: 'Pick a language and stick to it', tags: ['dsa-foundations'], priority: 'medium', isCompleted: true, daysAgo: 40 },
      { title: 'Work through arrays + hashing', tags: ['dsa-foundations'], priority: 'medium', isCompleted: true, daysAgo: 34 },
      { title: 'Work through two-pointer + sliding window', tags: ['dsa-foundations'], priority: 'medium', isCompleted: true, daysAgo: 29 },
    ],
    goals: [
      { title: 'Ace OS midterm', tag: 'cs', targetSessions: 30, deadlineDays: 18 },
      { title: 'Land a summer SWE internship', tag: 'interview-prep', targetSessions: 50, deadlineDays: 60 },
      { title: 'Build the DSA foundations', tag: 'dsa-foundations', targetSessions: 12, deadlineDays: -25, isCompleted: true },
    ],
    posts: [
      {
        type: 'streak_milestone', daysAgo: 1,
        caption: (s) => `${s.currentStreak}-day streak. Honestly the streak is the only reason I open my laptop some mornings 😅`,
        payload: (s) => ({ streakAtPost: s.currentStreak, totalSessionsAtPost: s.totalSessions, totalFocusHoursAtPost: s.totalFocusHours }),
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
    avatarEmoji: '🦚',
    xp: 9100,
    currentStreak: 34,
    longestStreak: 41,
    totalSessions: 372,
    focus: [
      { label: 'MCAT — biochem amino acids', tag: 'mcat', minutes: 55 },
      { label: 'MCAT — biochem pathways', tag: 'mcat', minutes: 55 },
      { label: 'MCAT — physics review', tag: 'mcat', minutes: 50 },
      { label: 'MCAT — orgo mechanisms', tag: 'mcat', minutes: 50 },
      { label: 'MCAT — psych/soc deck', tag: 'mcat', minutes: 45 },
      { label: 'UWorld CARS passages', tag: 'cars', minutes: 50 },
      { label: 'AAMC full-length review', tag: 'aamc', minutes: 60 },
      { label: 'Secondary application essays', tag: 'med-apps', minutes: 40 },
    ],
    tasks: [
      { title: 'AAMC Full-Length #4 + full review', tags: ['aamc', 'mcat'], priority: 'high', isCompleted: false, daysAgo: 5, estimatedMinutes: 480 },
      { title: 'AAMC Full-Length #5', tags: ['aamc'], priority: 'high', isCompleted: false, daysAgo: 1, estimatedMinutes: 480 },
      { title: 'Finish biochem amino acids deck', tags: ['mcat', 'biochem'], priority: 'high', isCompleted: false, daysAgo: 0, estimatedMinutes: 120 },
      { title: 'Daily 5 CARS passages (UWorld)', tags: ['cars'], priority: 'high', isCompleted: false, daysAgo: 2 },
      { title: 'AAMC Full-Length #3 + review', tags: ['aamc'], priority: 'high', isCompleted: true, daysAgo: 8, estimatedMinutes: 480 },
      { title: 'CARS — hold the daily passage habit for 30 days', tags: ['cars'], priority: 'medium', isCompleted: true, daysAgo: 6 },
      { title: 'Submit secondary application essays', tags: ['med-apps'], priority: 'medium', isCompleted: true, daysAgo: 4 },
      { title: 'Orgo reaction mechanisms review', tags: ['mcat', 'orgo'], priority: 'medium', isCompleted: true, daysAgo: 3 },
      { title: 'Rebuild the psych/soc Anki deck', tags: ['mcat'], priority: 'low', isCompleted: true, daysAgo: 11 },
    ],
    goals: [
      { title: 'Score 515+ on the MCAT', tag: 'mcat', targetSessions: 80, deadlineDays: 40 },
      { title: 'Complete all AAMC full-lengths', tag: 'aamc', targetSessions: 20, deadlineDays: 35 },
      { title: 'Finish the CARS daily habit', tag: 'cars', targetSessions: 30, deadlineDays: 40 },
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
        caption: (s) => `MCAT in 6 weeks. ${s.totalFocusHours} hours logged on Ascend so far. We move.`,
        payload: (s) => ({ streakAtPost: s.currentStreak, totalSessionsAtPost: s.totalSessions, totalFocusHoursAtPost: s.totalFocusHours }),
      },
      {
        type: 'free_post', daysAgo: 4,
        caption: 'Motivation for anyone deep in a hard prep season: you will not feel ready, and that\'s normal. Show up for the reps anyway. Consistency compounds. 🙌',
        payload: (s) => ({
          contentTag: 'motivation',
          attachedStats: [
            { label: 'Total focus', value: `${s.totalFocusHours}h` },
            { label: 'Streak', value: `${s.currentStreak}d` },
          ] as AttachedStat[],
        }),
      },
    ],
  },
];

// ── Focus groups ─────────────────────────────────────────────────────────────
// Surfaced in the UI as "Focus Group". Seeded after every user exists, because a
// group is a set of people and there is nothing to show in one with a single
// member in it.

interface DemoGroup {
  name: string;
  description: string;
  emoji: string;
  color: 'purple' | 'teal' | 'amber' | 'rose';
  isPrivate: boolean;
  /** Username. Also a member — the creator is added to `members` implicitly. */
  createdBy: string;
  members: string[];
  posts: { author: string; caption: string; daysAgo: number }[];
}

const GROUPS: DemoGroup[] = [
  {
    name: 'Finals Week',
    description: 'Three weeks of exams, one shared timer. Post what you got through, not how you felt about it.',
    emoji: '📚',
    color: 'purple',
    isPrivate: false,
    createdBy: 'jordan_blake',
    members: ['maya_chen', 'leo_kim', 'priya_patel'],
    posts: [
      { author: 'jordan_blake', caption: 'Room 2 in the library is free all week. Table by the window is mine, the rest is fair game.', daysAgo: 3 },
      { author: 'leo_kim', caption: 'Two hours on calc before school. Nobody warned me 6am was quiet enough to actually think.', daysAgo: 1 },
      { author: 'maya_chen', caption: 'Bio unit 3 done. Starting the practice test tomorrow morning, someone check I actually did.', daysAgo: 0 },
    ],
  },
  {
    name: '5AM Club',
    description: 'One block before the day starts. No excuses accepted after 7am.',
    emoji: '☀️',
    color: 'amber',
    isPrivate: false,
    createdBy: 'sam_rivera',
    members: ['priya_patel', 'jordan_blake'],
    posts: [
      { author: 'sam_rivera', caption: '50 minutes on IAM policies before the kettle boiled. This is the only hour nobody can book over.', daysAgo: 2 },
      { author: 'priya_patel', caption: 'Day 30 of the early block. It stopped being hard around day 12 and I still do not know why.', daysAgo: 0 },
    ],
  },
  {
    name: 'MCAT 2027',
    description: 'Small and private on purpose. Full-length scores, honest post-mortems, no score-flexing.',
    emoji: '🧬',
    color: 'teal',
    isPrivate: true,
    createdBy: 'priya_patel',
    members: ['maya_chen'],
    posts: [
      { author: 'priya_patel', caption: 'FL#3 done. CARS still the weak leg — 8 passages a day from here until it moves.', daysAgo: 5 },
      { author: 'priya_patel', caption: 'Biochem pathways finally sticking. Third pass was the one that did it, not the first two.', daysAgo: 1 },
    ],
  },
  {
    name: 'Ship It',
    description: 'Side projects that are still side projects. Weekly: what shipped, what did not, why.',
    emoji: '🚀',
    color: 'rose',
    isPrivate: false,
    createdBy: 'sam_rivera',
    members: ['jordan_blake'],
    posts: [
      { author: 'sam_rivera', caption: 'Auth flow is behind a feature flag and working. Rate-limit bug is next and it is entirely my own fault.', daysAgo: 4 },
      { author: 'jordan_blake', caption: 'Scheduler passes the fairness tests. Threw away the first design completely, kept about six lines.', daysAgo: 2 },
    ],
  },
];

/** The reaction bar on a post, matching mobile's REACTIONS. */
const REACTION_EMOJIS = ['🔥', '🫡', '❤️', '💪'];

// ── History generation ───────────────────────────────────────────────────────

interface PlannedSession {
  daysAgo: number;
  focus: DemoFocus;
  hour: number;
  minutes: number;
}

/**
 * Every focus session this account will have.
 *
 * The day layout and the per-day counts — the part carrying the invariant that
 * the history produces the streaks on the profile — live in lib/demoHistory,
 * where the unit suite can reach them. What is left here is turning a count
 * into sessions: what the block was for, when in the day it ran, how long.
 */
function planSessions(u: DemoUser): PlannedSession[] {
  const shape: HistoryShape = {
    seed: u.username,
    currentStreak: u.currentStreak,
    longestStreak: u.longestStreak,
    totalSessions: u.totalSessions,
  };
  const counts = sessionCountByDay(shape);

  const planned: PlannedSession[] = [];
  for (const day of [...counts.keys()].sort((a, b) => a - b)) {
    const total = counts.get(day) ?? 0;
    for (let i = 0; i < total; i += 1) {
      const seed = `${u.username}:s:${day}:${i}`;
      const focus = pick(u.focus, `${seed}:what`);
      const span = LAST_FOCUS_HOUR - FIRST_FOCUS_HOUR;
      // Blocks on the same day are spread through it rather than stacked on one
      // hour, so the report's hour-of-day breakdown has a shape.
      const hour = FIRST_FOCUS_HOUR
        + Math.floor((i / Math.max(1, total)) * span)
        + Math.floor(hashUnit(`${seed}:hour`) * 2);
      planned.push({
        daysAgo: day,
        focus,
        hour: Math.min(LAST_FOCUS_HOUR, hour),
        minutes: Math.max(10, focus.minutes + pick(BLOCK_JITTER, `${seed}:jitter`)),
      });
    }
  }
  return planned;
}

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
  const catalogue = await prisma.achievement.findMany();

  const created: {
    username: string;
    email: string;
    id: string;
    bioRole: string;
    stats: DerivedStats;
    postCount: number;
  }[] = [];

  for (const [userIndex, u] of users.entries()) {
    const profile = {
      username: u.username,
      passwordHash,
      privacySetting: 'public' as const,
      avatarEmoji: u.avatarEmoji,
      xp: u.xp,
      currentStreak: u.currentStreak,
      longestStreak: u.longestStreak,
      lastActiveDate: day(0),
    };

    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: profile,
      create: { email: u.email, ...profile },
    });

    // Wipe previously-seeded generated content for this user so re-runs don't
    // duplicate. Group membership and authored groups go too — the group pass
    // below rebuilds both, and a group left behind by an earlier shape of this
    // file would sit in the list with nobody in it.
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.task.deleteMany({ where: { userId: user.id } });
    await prisma.taskGoal.deleteMany({ where: { userId: user.id } });
    await prisma.socialPost.deleteMany({ where: { authorId: user.id } });
    await prisma.note.deleteMany({ where: { userId: user.id } });
    await prisma.event.deleteMany({ where: { userId: user.id } });
    await prisma.userAchievement.deleteMany({ where: { userId: user.id } });
    await prisma.feedEvent.deleteMany({ where: { userId: user.id } });
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.studyGroup.deleteMany({ where: { createdBy: user.id } });
    await prisma.studyGroupMember.deleteMany({ where: { userId: user.id } });

    // ── Goals ───────────────────────────────────────────────────────────────
    // Created before tasks, because a task is linked to its goal by tag as it
    // is written and there is nothing to link to otherwise.
    const goalByTag = new Map<string, { id: string; title: string }>();
    for (const g of u.goals) {
      const goal = await prisma.taskGoal.create({
        data: {
          userId: user.id,
          title: g.title,
          tag: g.tag,
          targetSessions: g.targetSessions,
          deadline: dueDateFor(g.deadlineDays),
          isCompleted: g.isCompleted ?? false,
          // A goal that is done was done before its deadline passed.
          completedAt: g.isCompleted ? dueDateFor(g.deadlineDays - 2) : null,
          createdAt: day(Math.max(7, -g.deadlineDays + 14)),
        },
      });
      goalByTag.set(g.tag, { id: goal.id, title: goal.title });
    }

    /** The goal a task belongs to: the first of its tags that names one. */
    const goalForTags = (tags: string[]) => {
      for (const tag of tags) {
        const goal = goalByTag.get(tag);
        if (goal) return goal;
      }
      return null;
    };

    // ── Tasks ───────────────────────────────────────────────────────────────
    // Scheduling is derived so every account has a populated calendar: a
    // completed task keeps its original day, an open one is spread across the
    // fortnight ahead, and roughly half of the dated ones get a time block so
    // the Day timeline and the Month workload shading have something to draw.
    //
    // Guarantee one unscheduled item per account. Keying off the LAST task only
    // worked when that task happened to be open, which was true for one of the
    // five — leaving Planning's UNSCHEDULED list empty everywhere else.
    const firstOpenIdx = u.tasks.findIndex((t) => !t.isCompleted);
    const taskRows: { id: string; title: string; tags: string[]; priority: string; goalId: string | null }[] = [];

    for (const [idx, t] of u.tasks.entries()) {
      const seed = `${u.username}:${t.title}`;
      const r = hashUnit(seed);
      const goal = goalForTags(t.tags);

      // Completed work sits on the day it was done; open work lands in the next
      // fortnight. One task per account is deliberately left undated so the
      // Planning tab's UNSCHEDULED list is never empty.
      const leaveUndated = idx === firstOpenIdx;
      const offset = t.isCompleted ? -t.daysAgo : Math.floor(r * 14);
      const dueDate = leaveUndated ? null : dueDateFor(offset);

      // Times only make sense with a day attached.
      const wantsTime = dueDate !== null && hashUnit(`${seed}:time`) < 0.55;
      const startHour = 8 + Math.floor(hashUnit(`${seed}:hour`) * 10); // 08:00-17:00
      const block = pick(BLOCK_MINUTES, `${seed}:len`);
      const startMinutes = wantsTime ? startHour * 60 : null;
      const endMinutes = wantsTime ? Math.min(23 * 60 + 55, startHour * 60 + block) : null;

      const row = await prisma.task.create({
        data: {
          userId: user.id,
          title: t.title,
          description: t.description ?? null,
          tags: t.tags,
          priority: t.priority,
          estimatedMinutes: t.estimatedMinutes ?? null,
          taskGoalId: goal?.id ?? null,
          dueDate,
          startMinutes,
          endMinutes,
          isCompleted: t.isCompleted,
          completedAt: t.isCompleted ? day(Math.max(0, t.daysAgo - 1)) : null,
          createdAt: day(t.daysAgo),
        },
      });
      taskRows.push({ id: row.id, title: row.title, tags: row.tags, priority: row.priority, goalId: goal?.id ?? null });
    }

    // ── Habits ──────────────────────────────────────────────────────────────
    // A template plus today's instance each, which is the shape
    // POST /tasks/spawn-recurring produces. The calendar projects templates
    // across the whole visible range, so these are what keep the month view
    // from being blank on days nothing else lands on.
    //
    // No past instances are seeded: spawn-recurring archives yesterday's, and
    // every calendar query filters isArchived, so they would be rows nothing
    // can read.
    for (let h = 0; h < HABITS_PER_USER; h += 1) {
      const habit = HABITS[(userIndex * HABITS_PER_USER + h) % HABITS.length];
      const shared = {
        userId: user.id,
        title: habit.title,
        tags: habit.tags,
        priority: 'medium',
        estimatedMinutes: habit.minutes,
        startMinutes: habit.startHour * 60,
        endMinutes: habit.startHour * 60 + habit.minutes,
      };
      const template = await prisma.task.create({
        data: {
          ...shared,
          isRecurring: true,
          recurringDays: habit.days,
          lastSpawnedDate: dayKey(0),
          currentStreak: u.currentStreak,
          longestStreak: u.longestStreak,
          totalCompletions: u.currentStreak * 2,
          totalFocusTimeMs: u.currentStreak * 2 * habit.minutes * MIN,
          createdAt: day(HISTORY_DAYS),
        },
      });
      await prisma.task.create({
        data: {
          ...shared,
          dueDate: dueDateFor(0),
          parentTaskId: template.id,
          lifetimeStreak: u.currentStreak,
          lifetimeTotalCompletions: u.currentStreak * 2,
          lifetimeTotalFocusTime: u.currentStreak * 2 * habit.minutes * MIN,
          createdAt: day(0),
        },
      });
    }

    // ── Sessions ────────────────────────────────────────────────────────────
    // Every session is attributed with lib/sessionAttribution, the same
    // function the live POST /timer/complete path uses. Stamping the demo rows
    // by hand would be a second implementation of the app's own rule, and it is
    // the frozen stamp — not the task row — that the focus report reads, so a
    // seed that skipped it produced accounts whose every hour was "Untagged".
    const planned = planSessions(u);
    const sessionsPerTask = new Map<string, { count: number; seconds: number; dates: Set<string> }>();
    const sessionRows: Prisma.SessionCreateManyInput[] = [];
    let totalFocusSeconds = 0;

    for (const p of planned) {
      // The task this block was against: one carrying the same tag, preferring
      // an open one, since that is the work still in front of them.
      const candidates = taskRows.filter((t) => t.tags.includes(p.focus.tag));
      const task = candidates.length > 0
        ? pick(candidates, `${u.username}:link:${p.daysAgo}:${p.focus.label}`)
        : null;
      const goal = task?.goalId
        ? [...goalByTag.values()].find((g) => g.id === task.goalId) ?? null
        : goalByTag.get(p.focus.tag) ?? null;

      const localDate = dayKey(-p.daysAgo);
      const completedAt = sessionInstantOn(-p.daysAgo, p.hour);
      const durationSeconds = p.minutes * MIN;

      const attribution = buildAttribution({
        task: task
          ? {
            title: task.title,
            tags: task.tags,
            priority: task.priority,
            taskGoalId: task.goalId,
            isRecurring: false,
            parentTaskId: null,
          }
          : null,
        goal,
        completedAt,
        localDate,
        timeZone: 'UTC',
      });

      sessionRows.push({
        userId: user.id,
        type: 'focus',
        durationSeconds,
        plannedDurationSeconds: p.focus.minutes * MIN,
        taskLabel: p.focus.label,
        taskId: task?.id ?? null,
        completedAt,
        createdAt: completedAt,
        // A free-form session has no task, so it has no tag to be counted
        // under. Give it the strand's own tag rather than leaving the report
        // with a bucket it cannot name.
        ...attribution,
        primaryTag: attribution.primaryTag ?? p.focus.tag,
        tags: attribution.tags.length > 0 ? attribution.tags : [p.focus.tag],
      });

      totalFocusSeconds += durationSeconds;
      if (task) {
        const entry = sessionsPerTask.get(task.id)
          ?? { count: 0, seconds: 0, dates: new Set<string>() };
        entry.count += 1;
        entry.seconds += durationSeconds;
        entry.dates.add(localDate);
        sessionsPerTask.set(task.id, entry);
      }
    }

    // One insert rather than a few hundred round trips. The heaviest account
    // alone is ~370 sessions, and the seed is routinely pointed at a Railway
    // database over the public proxy.
    await prisma.session.createMany({ data: sessionRows });

    // Per-task history, counted off the sessions that were actually written
    // rather than declared beside them. This is what the task stats modal reads.
    for (const [taskId, entry] of sessionsPerTask) {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          sessionsOnTask: entry.count,
          totalTimeOnTask: entry.seconds,
          sessionDates: [...entry.dates].sort(),
        },
      });
    }

    // ── Derived profile totals ──────────────────────────────────────────────
    const tasksCompleted = u.tasks.filter((t) => t.isCompleted).length;
    const stats: DerivedStats = {
      totalSessions: planned.length,
      totalFocusHours: Math.round(totalFocusSeconds / HOURS),
      currentStreak: u.currentStreak,
      tasksCompleted,
    };

    await prisma.user.update({
      where: { id: user.id },
      data: {
        totalSessions: stats.totalSessions,
        totalFocusTime: totalFocusSeconds,
        tasksCompleted,
      },
    });

    // ── Notes ───────────────────────────────────────────────────────────────
    const noteRows: Prisma.NoteCreateManyInput[] = [];
    for (let i = 0; i < NOTES_PER_USER; i += 1) {
      const note = pick(NOTE_POOL, `${u.username}:note:${i}`);
      const offset = Math.floor(hashUnit(`${u.username}:noteday:${i}`) * 24) - 10;
      noteRows.push({
        userId: user.id,
        content: note.content,
        date: dayKey(offset),
        isTodo: note.isTodo,
        isCompleted: note.isTodo && offset < 0,
        createdAt: day(Math.max(0, -offset)),
      });
    }
    await prisma.note.createMany({ data: noteRows });

    // ── Events ──────────────────────────────────────────────────────────────
    const eventSpan = EVENT_WINDOW_END - EVENT_WINDOW_START;
    const eventRows: Prisma.EventCreateManyInput[] = [];
    for (let i = 0; i < EVENTS_PER_USER; i += 1) {
      const event = pick(EVENT_POOL, `${u.username}:event:${i}`);
      const offset = EVENT_WINDOW_START
        + Math.floor(hashUnit(`${u.username}:eventday:${i}`) * eventSpan);
      const startMinutes = event.startHour === null ? null : event.startHour * 60;
      eventRows.push({
        userId: user.id,
        title: event.title,
        date: dayKey(offset),
        startMinutes,
        endMinutes: startMinutes === null ? null : startMinutes + event.minutes,
        createdAt: day(Math.max(0, -offset) + 1),
      });
    }
    await prisma.event.createMany({ data: eventRows });

    // ── Achievements ────────────────────────────────────────────────────────
    // Unlock the ones these stats actually earn. Awarding arbitrary ones would
    // make the profile screen lie about how it got there.
    const unlocked: { title: string; daysAgo: number }[] = [];
    const unlockRows: Prisma.UserAchievementCreateManyInput[] = [];
    for (const a of catalogue) {
      const meets = a.category === 'STREAK' ? u.longestStreak >= a.threshold
        : a.category === 'SESSIONS' ? stats.totalSessions >= a.threshold
        // threshold is HOURS in seed.ts; totalFocusTime is seconds.
        : a.category === 'FOCUS_TIME' ? totalFocusSeconds >= a.threshold * HOURS
        : a.category === 'RANK' ? u.xp >= a.threshold
        : a.category === 'TASKS' ? tasksCompleted >= a.threshold
        : false;
      if (!meets) continue;
      const daysAgo = Math.floor(hashUnit(`${u.username}:${a.key}`) * 30);
      unlockRows.push({ userId: user.id, achievementId: a.id, unlockedAt: day(daysAgo) });
      unlocked.push({ title: a.title, daysAgo });
    }
    await prisma.userAchievement.createMany({ data: unlockRows });
    unlocked.sort((a, b) => a.daysAgo - b.daysAgo);

    // ── Public posts ────────────────────────────────────────────────────────
    await prisma.socialPost.createMany({
      data: u.posts.map((p) => ({
        authorId: user.id,
        type: p.type,
        caption: resolve(p.caption, stats),
        visibility: 'public',
        payload: resolve(p.payload, stats) as Prisma.InputJsonValue,
        reactions: {},
        createdAt: day(p.daysAgo),
      })),
    });

    // ── Activity log ────────────────────────────────────────────────────────
    // The Tasks tab's Recent Activity card. Written from what was actually
    // created above, in the payload shape each live emitter uses — otherwise
    // the card renders a column of the generic "Activity" fallback.
    const activity: { eventType: string; payload: Prisma.InputJsonValue; daysAgo: number }[] = [];
    for (const p of planned.slice(0, 12)) {
      activity.push({
        eventType: 'session_completed',
        payload: { durationMinutes: p.minutes, taskTitle: p.focus.label },
        daysAgo: p.daysAgo,
      });
    }
    for (const t of u.tasks.filter((t) => t.isCompleted)) {
      activity.push({ eventType: 'task_completed', payload: { taskTitle: t.title }, daysAgo: Math.max(0, t.daysAgo - 1) });
    }
    for (const g of u.goals.filter((g) => g.isCompleted)) {
      activity.push({ eventType: 'goal_completed', payload: { goalTitle: g.title, xpEarned: 250 }, daysAgo: -g.deadlineDays + 2 });
    }
    for (const a of unlocked.slice(0, 4)) {
      activity.push({ eventType: 'achievement_unlocked', payload: { achievementTitle: a.title }, daysAgo: a.daysAgo });
    }
    activity.push({ eventType: 'streak_milestone', payload: { streakDays: u.currentStreak }, daysAgo: 0 });

    await prisma.feedEvent.createMany({
      data: activity.map((e, i) => ({
        userId: user.id,
        eventType: e.eventType,
        payload: e.payload,
        // Spread within the day so the log has a stable order rather than a
        // dozen rows sharing one timestamp.
        createdAt: new Date(day(Math.max(0, e.daysAgo)).getTime() - i * 60_000),
      })),
    });

    created.push({
      username: user.username,
      email: user.email,
      id: user.id,
      bioRole: u.bioRole,
      stats,
      postCount: u.posts.length,
    });
    console.log(
      `  ✓ ${u.username.padEnd(14)} ${String(u.xp).padStart(5)}xp  ${String(u.currentStreak).padStart(2)}d streak  `
      + `${String(stats.totalSessions).padStart(3)} sessions  ${String(stats.totalFocusHours).padStart(3)}h  — ${u.bioRole}`,
    );
  }

  const byUsername = new Map(created.map((c) => [c.username, c]));

  // ── Follow graph ────────────────────────────────────────────────────────
  // Full mesh, so every account's following feed and leaderboard is populated.
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

  // ── Focus groups ────────────────────────────────────────────────────────
  console.log('Creating focus groups...');
  for (const g of GROUPS) {
    const creator = byUsername.get(g.createdBy);
    if (!creator) continue;

    const group = await prisma.studyGroup.create({
      data: {
        name: g.name,
        description: g.description,
        emoji: g.emoji,
        color: g.color,
        isPrivate: g.isPrivate,
        createdBy: creator.id,
        createdAt: day(45),
      },
    });

    const memberIds = new Set([creator.id]);
    for (const username of g.members) {
      const member = byUsername.get(username);
      if (member) memberIds.add(member.id);
    }
    await prisma.studyGroupMember.createMany({
      data: [...memberIds].map((userId, i) => ({
        groupId: group.id,
        userId,
        joinedAt: day(45 - i * 3),
      })),
    });

    // A group post from a non-member would be rejected by POST /social/posts,
    // so it must not be seeded either.
    const groupPosts = g.posts
      .map((p) => ({ post: p, author: byUsername.get(p.author) }))
      .filter((x) => x.author && memberIds.has(x.author.id));
    await prisma.socialPost.createMany({
      data: groupPosts.map(({ post, author }) => ({
        authorId: author!.id,
        type: 'free_post',
        caption: post.caption,
        visibility: 'group',
        groupId: group.id,
        payload: { contentTag: 'general' },
        reactions: {},
        createdAt: day(post.daysAgo),
      })),
    });

    console.log(`  ✓ ${g.emoji} ${g.name.padEnd(12)} ${memberIds.size} members, ${groupPosts.length} posts${g.isPrivate ? ' (private)' : ''}`);
  }

  // ── Reactions ───────────────────────────────────────────────────────────
  // Every post gets some. An empty reaction bar under every card is the single
  // clearest tell that a feed is seeded rather than used.
  console.log('Adding reactions...');
  const posts = await prisma.socialPost.findMany({
    where: { authorId: { in: created.map((c) => c.id) } },
    select: { id: true, authorId: true, groupId: true },
  });

  // Who can plausibly react: group posts are only visible to members.
  const membershipRows = await prisma.studyGroupMember.findMany({
    where: { userId: { in: created.map((c) => c.id) } },
    select: { groupId: true, userId: true },
  });
  const groupMembers = new Map<string, string[]>();
  for (const m of membershipRows) {
    groupMembers.set(m.groupId, [...(groupMembers.get(m.groupId) ?? []), m.userId]);
  }

  let reactionCount = 0;
  for (const post of posts) {
    const audience = (post.groupId ? groupMembers.get(post.groupId) ?? [] : created.map((c) => c.id))
      .filter((id) => id !== post.authorId);
    if (audience.length === 0) continue;

    const reactions: Record<string, string[]> = {};
    for (const [i, reactorId] of audience.entries()) {
      if (hashUnit(`${post.id}:${reactorId}`) > 0.62) continue;
      const emoji = pick(REACTION_EMOJIS, `${post.id}:${reactorId}:emoji`);
      reactions[emoji] = [...(reactions[emoji] ?? []), reactorId];
      reactionCount += 1;
      // Two or three faces under a post reads as real; five on every post does not.
      if (i >= 2 && Object.keys(reactions).length >= 2) break;
    }
    if (Object.keys(reactions).length === 0) continue;
    await prisma.socialPost.update({ where: { id: post.id }, data: { reactions } });
  }
  console.log(`  ✓ ${reactionCount} reactions across ${posts.length} posts`);

  // ── Notifications ───────────────────────────────────────────────────────
  // Written in the same title/body shape modules/notifications/handler.ts uses,
  // because the client renders them as `title: body` and nothing re-derives them.
  console.log('Filling notification trays...');
  let notificationCount = 0;
  for (const c of created) {
    const rows: { type: string; title: string; body: string; daysAgo: number; isRead: boolean }[] = [];

    const persona = users.find((u) => u.username === c.username);
    for (const g of persona?.goals.filter((g) => g.isCompleted) ?? []) {
      rows.push({
        type: 'goal_completed',
        title: 'Goal done',
        body: `${g.title} (3/3 tasks)`,
        daysAgo: -g.deadlineDays + 2,
        isRead: true,
      });
    }

    const recentUnlocks = await prisma.userAchievement.findMany({
      where: { userId: c.id },
      orderBy: { unlockedAt: 'desc' },
      take: 3,
      include: { achievement: { select: { title: true } } },
    });
    for (const ua of recentUnlocks) {
      rows.push({
        type: 'achievement_unlocked',
        title: 'Achievement unlocked',
        body: `You earned "${ua.achievement.title}"`,
        daysAgo: Math.round((now - ua.unlockedAt.getTime()) / 86400000),
        isRead: false,
      });
    }

    // What the people they follow have been posting. Everyone follows everyone
    // here, so this is every other demo account's recent public posts.
    const friendPosts = await prisma.socialPost.findMany({
      where: {
        authorId: { in: created.filter((o) => o.id !== c.id).map((o) => o.id) },
        visibility: 'public',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { author: { select: { username: true } } },
    });
    for (const p of friendPosts) {
      rows.push({
        type: 'friend_post',
        title: `${p.author.username} shared a post`,
        body: p.caption?.trim() ? `"${p.caption.trim().slice(0, 80)}"` : 'Tap to see what they shared.',
        daysAgo: Math.round((now - p.createdAt.getTime()) / 86400000),
        isRead: hashUnit(`${c.id}:${p.id}:read`) < 0.5,
      });
    }

    await prisma.notification.createMany({
      data: rows.map((r, i) => ({
        userId: c.id,
        type: r.type,
        title: r.title,
        body: r.body,
        isRead: r.isRead,
        createdAt: new Date(day(Math.max(0, r.daysAgo)).getTime() - i * 90_000),
      })),
    });
    notificationCount += rows.length;
  }
  console.log(`  ✓ ${notificationCount} notifications`);

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

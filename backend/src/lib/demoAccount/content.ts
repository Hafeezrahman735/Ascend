/**
 * What the marketing demo account contains: a developer's workday, and the
 * people around it.
 *
 * This file declares INTENT only — which tasks exist, which days were worked,
 * what people said. Every number a screen adds up (streaks, totals, per-task
 * time, goal progress, achievements) is derived by plan.ts and seed.ts from
 * the rows that actually get written. See prisma/seed-demo-users.ts for why
 * that rule matters: a profile that declares its totals beside its history is
 * two screens waiting to disagree.
 */

/** Every account this seed owns has an email on this domain. It is what the
 *  teardown matches on, and `.invalid` is reserved (RFC 2606), so nothing is
 *  ever delivered to one. */
export const DEMO_EMAIL_DOMAIN = '@ascend.invalid';

export const MAIN_USERNAME = 'test_user_1';
export const MAIN_AVATAR = '🧑‍💻';

/**
 * XP decides Rank. It is set rather than summed from sessions on purpose: at
 * 10 XP per focus minute (lib/xp.ts), four weeks of real history is already
 * Champion, the top tier — and the brief is a rank that looks earned, not
 * maxed. Nothing in the app recomputes XP from sessions, so no screen can
 * contradict it. 3,400 is Elite, the middle of the five tiers.
 */
export const MAIN_XP = 3400;

/** A focus block counted as "one session" when a task is estimated in sessions. */
export const SESSION_MINUTES = 50;

export type GoalKey = 'ship' | 'role' | 'launch' | 'ml' | 'reading';

export interface GoalSpec {
  key: GoalKey;
  title: string;
  tag: string;
  /** The goal's start, where the Goals lens pace line begins. No task or
   *  habit on the goal is older than it. */
  createdDaysAgo: number;
  /** Days from today; negative is past. Omitted = no deadline. */
  deadlineInDays?: number;
  /** Planned focus time. Omitted = unplanned, which the Goals lens lists apart. */
  plannedHours?: number;
  /** Set = finished on that day, after every task on it. */
  completedDaysAgo?: number;
}

/**
 * One of each shape the Goals lens draws: planned with a deadline (ship,
 * role), planned without one (ml), unplanned (reading), and finished (launch).
 */
export const GOALS: GoalSpec[] = [
  { key: 'ship', title: 'Ship Ascend v1.1', tag: 'ascend', createdDaysAgo: 30, deadlineInDays: 21, plannedHours: 32 },
  { key: 'role', title: 'Land an ML/SWE role', tag: 'interview-prep', createdDaysAgo: 75, deadlineInDays: 75, plannedHours: 55 },
  { key: 'launch', title: 'Launch Ascend v1.0', tag: 'ascend', createdDaysAgo: 89, deadlineInDays: -30, plannedHours: 45, completedDaysAgo: 32 },
  { key: 'ml', title: 'Build an ML portfolio', tag: 'ml', createdDaysAgo: 85, plannedHours: 60 },
  { key: 'reading', title: 'Read 12 technical books this year', tag: 'learning', createdDaysAgo: 28 },
];

export type TaskKey =
  | 'live-activity' | 'calendar-view' | 'auth-tests' | 'graph-dp' | 'election-model'
  | 'linkedin-post' | 'forgot-password' | 'security-audit' | 'timer-rerender' | 'mock-sysdesign'
  | 'onsite-prep' | 'release-notes' | 'design-book'
  | 'v1-sync' | 'v1-social' | 'v1-appstore'
  | 'kaggle' | 'transformer' | 'resume' | 'ddia' | 'blog';

export interface TaskSpec {
  key: TaskKey;
  title: string;
  tag: string;
  goal?: GoalKey;
  estSessions: number;
  priority: 'low' | 'medium' | 'high';
  createdDaysAgo: number;
  /** Days from today; negative is past. Omitted = no due date. */
  dueInDays?: number;
  /** Set = the task is done, on that day. */
  completedDaysAgo?: number;
  /** The task's Description box. */
  description?: string;
  /** A time slot on the due day, so the task sits on the calendar timeline. */
  slot?: { startHour: number; minutes: number };
}

export const TASKS: TaskSpec[] = [
  // Open work. The first is the Focus screen's current task.
  {
    key: 'live-activity', title: 'Build iOS Live Activity for the focus timer', tag: 'ascend', goal: 'ship', estSessions: 4, priority: 'high', createdDaysAgo: 2, dueInDays: 1,
    description: 'Lock-screen countdown the OS keeps ticking. Pause freezes the remaining time; resume sets a new end date.',
    slot: { startHour: 9, minutes: 120 },
  },
  {
    key: 'calendar-view', title: 'Add calendar day/week view', tag: 'ascend', goal: 'ship', estSessions: 6, priority: 'medium', createdDaysAgo: 9, dueInDays: 3,
    description: 'Day timeline with timed tasks, events and habits. Week view shows the load per day.',
    slot: { startHour: 14, minutes: 90 },
  },
  {
    key: 'auth-tests', title: 'Write integration tests for the auth routes', tag: 'backend', goal: 'ship', estSessions: 3, priority: 'high', createdDaysAgo: 4, dueInDays: 2,
    description: 'Login, refresh rotation, logout and password reset against the real test database, including the 401 and 429 paths.',
    slot: { startHour: 10, minutes: 90 },
  },
  {
    key: 'graph-dp', title: 'Solve 15 graph/DP LeetCode problems', tag: 'interview-prep', goal: 'role', estSessions: 6, priority: 'medium', createdDaysAgo: 14,
    description: 'Topological sort, Dijkstra, interval DP, knapsack. Write the recurrence down before coding.',
  },
  {
    key: 'election-model', title: 'Refactor the election prediction model into a clean repo', tag: 'ml', goal: 'ml', estSessions: 3, priority: 'low', createdDaysAgo: 21,
    description: 'Split the notebook into data, features and model modules, with a README showing the backtest.',
  },
  {
    key: 'linkedin-post', title: 'Write the LinkedIn launch post for Ascend', tag: 'ascend', goal: 'ship', estSessions: 1, priority: 'medium', createdDaysAgo: 1, dueInDays: 0,
    description: 'What Ascend does, one screenshot, the TestFlight link. Under 150 words.',
    slot: { startHour: 16, minutes: 45 },
  },
  // Due later than the Due Soon card reaches (0-2 days), so it keeps its three.
  {
    key: 'onsite-prep', title: 'Prepare for the Datadog onsite', tag: 'interview-prep', goal: 'role', estSessions: 5, priority: 'high', createdDaysAgo: 3, dueInDays: 8,
    description: 'Two system design run-throughs, one behavioural mock, and a page of STAR stories.',
    slot: { startHour: 18, minutes: 60 },
  },
  {
    key: 'release-notes', title: 'Write the v1.1 release notes', tag: 'ascend', goal: 'ship', estSessions: 1, priority: 'low', createdDaysAgo: 1, dueInDays: 5,
    description: 'Live Activity, calendar views, faster sync. Five bullets at most.',
  },
  {
    key: 'design-book', title: 'Finish "A Philosophy of Software Design"', tag: 'learning', goal: 'reading', estSessions: 6, priority: 'low', createdDaysAgo: 10,
    description: 'Chapters 9-15, with one note per chapter on what to change in the codebase.',
  },
  // Recently finished, so there is history behind the completion rate.
  {
    key: 'forgot-password', title: 'Forgot-password flow with hashed reset tokens', tag: 'backend', goal: 'ship', estSessions: 6, priority: 'high', createdDaysAgo: 24, dueInDays: -14, completedDaysAgo: 15,
    description: 'Single-use tokens stored hashed, valid for 30 minutes. The same response whether or not the email exists.',
  },
  {
    key: 'security-audit', title: 'Security audit: IDOR checks + rate limiting', tag: 'backend', goal: 'ship', estSessions: 8, priority: 'high', createdDaysAgo: 16, dueInDays: -7, completedDaysAgo: 8,
    description: 'Every route that takes an id checks ownership. Rate limits on login, signup and reset.',
  },
  {
    key: 'timer-rerender', title: 'Fix timer re-render issue on the Focus screen', tag: 'ascend', goal: 'ship', estSessions: 4, priority: 'medium', createdDaysAgo: 27, dueInDays: -21, completedDaysAgo: 22,
    description: 'The whole screen re-rendered every second. The tick now lives in its own component.',
  },
  {
    key: 'mock-sysdesign', title: 'Mock system design interview prep', tag: 'interview-prep', goal: 'role', estSessions: 6, priority: 'medium', createdDaysAgo: 20, dueInDays: -4, completedDaysAgo: 5,
    description: 'URL shortener, news feed and rate limiter, 45 minutes each, recorded.',
  },
  // The two months before: the v1.0 launch and side projects. They carry the
  // older history behind the Activity lens and the climb charts.
  {
    key: 'v1-sync', title: 'Offline sync for focus sessions', tag: 'backend', goal: 'launch', estSessions: 25, priority: 'high', createdDaysAgo: 88, dueInDays: -60, completedDaysAgo: 62,
    description: 'Queue finished sessions on the phone and replay them when the network is back.',
  },
  {
    key: 'v1-social', title: 'Social feed, follows and reactions', tag: 'ascend', goal: 'launch', estSessions: 30, priority: 'medium', createdDaysAgo: 80, dueInDays: -42, completedDaysAgo: 45,
    description: 'Daily recap posts, follow/unfollow, four reactions. No comments in v1.',
  },
  {
    key: 'v1-appstore', title: 'App Store submission and review fixes', tag: 'ascend', goal: 'launch', estSessions: 12, priority: 'high', createdDaysAgo: 50, dueInDays: -33, completedDaysAgo: 33,
    description: 'Screenshots, privacy labels, account deletion. Two rejections, both fixed.',
  },
  {
    key: 'kaggle', title: 'Kaggle tabular competition: finish in the top 15%', tag: 'ml', goal: 'ml', estSessions: 25, priority: 'medium', createdDaysAgo: 84, completedDaysAgo: 50,
    description: 'Gradient boosting with target encoding. Finished 212th of 1,840.',
  },
  {
    key: 'transformer', title: 'Implement a transformer from scratch', tag: 'ml', goal: 'ml', estSessions: 18, priority: 'medium', createdDaysAgo: 55, completedDaysAgo: 35,
    description: 'Attention, positional encoding and a training loop in plain PyTorch, trained on Shakespeare.',
  },
  {
    key: 'resume', title: 'Rewrite the resume and portfolio site', tag: 'career', goal: 'role', estSessions: 8, priority: 'high', createdDaysAgo: 74, dueInDays: -60, completedDaysAgo: 60,
    description: 'One page. Lead with Ascend and the Kaggle result.',
  },
  {
    key: 'ddia', title: 'Read "Designing Data-Intensive Applications"', tag: 'learning', goal: 'role', estSessions: 18, priority: 'medium', createdDaysAgo: 70, completedDaysAgo: 33,
    description: 'Chapters 1-9, with notes on replication and partitioning for system design rounds.',
  },
  {
    key: 'blog', title: 'Write 3 blog posts about building Ascend', tag: 'writing', estSessions: 8, priority: 'low', createdDaysAgo: 60, completedDaysAgo: 38,
    description: 'Offline sync, the focus timer, and what App Review rejected.',
  },
];

export type HabitKey = 'reading' | 'leetcode' | 'ml-paper' | 'plan-tomorrow' | 'sql-challenge' | 'weekly-review' | 'kaggle-notebook';

export interface HabitSpec {
  key: HabitKey;
  title: string;
  tag: string;
  goal?: GoalKey;
  /** Empty = every day, the same convention as Task.recurringDays. */
  days: string[];
  minutes: number;
  startHour: number;
  /** When the recurring task was created. It has no occurrences before. */
  startedDaysAgo: number;
  /** "Repeat until", days from today, inclusive. Negative = it has ended.
   *  Omitted = it never ends. */
  endInDays?: number;
  /** Today's instance exists but is not ticked off yet. Not a miss: the day
   *  is not over, so the streak still stands on yesterday. */
  pendingToday?: boolean;
  /** Scheduled occurrences, counting back from the latest one (today, or the
   *  last day of an ended task), that were NOT done. Everything else in the
   *  window was done. The streak falls out of where the first miss sits. */
  missedOccurrences: number[];
}

/**
 * One recurring task for each thing the feature does: every day, weekdays,
 * chosen weekdays, one day a week (no instance most days, so the list shows
 * when it is back), an end date still ahead, an end date already passed, one
 * still open today, and streaks at different lengths, one broken yesterday.
 */
export const HABITS: HabitSpec[] = [
  // Daily: 12 in a row, broken by the day the overall streak broke.
  { key: 'reading', title: 'Read 20 pages / technical reading', tag: 'learning', goal: 'reading', days: [], minutes: 30, startHour: 21, startedDaysAgo: 28, missedOccurrences: [12, 18] },
  // Weekdays: 8 in a row.
  { key: 'leetcode', title: '1 LeetCode problem', tag: 'interview-prep', goal: 'role', days: ['mon', 'tue', 'wed', 'thu', 'fri'], minutes: 25, startHour: 18, startedDaysAgo: 28, missedOccurrences: [8, 13] },
  // Three times a week.
  { key: 'ml-paper', title: 'Review an ML paper', tag: 'ml', goal: 'ml', days: ['mon', 'wed', 'fri'], minutes: 45, startHour: 20, startedDaysAgo: 28, missedOccurrences: [5] },
  // Daily, still to do today: the one recurring task to tick off on the phone.
  { key: 'plan-tomorrow', title: 'Plan tomorrow’s focus blocks', tag: 'planning', days: [], minutes: 10, startHour: 22, startedDaysAgo: 21, pendingToday: true, missedOccurrences: [3, 9] },
  // 30 days in all, 10 still to go. Missed yesterday, so its streak is 1.
  { key: 'sql-challenge', title: '30-day SQL challenge', tag: 'learning', goal: 'role', days: [], minutes: 20, startHour: 7, startedDaysAgo: 20, endInDays: 10, missedOccurrences: [1, 11] },
  // Sundays only.
  { key: 'weekly-review', title: 'Weekly review', tag: 'planning', days: ['sun'], minutes: 30, startHour: 18, startedDaysAgo: 84, missedOccurrences: [4] },
  // Ended six days ago.
  { key: 'kaggle-notebook', title: 'Daily Kaggle notebook', tag: 'ml', goal: 'ml', days: ['mon', 'tue', 'wed', 'thu', 'fri'], minutes: 40, startHour: 19, startedDaysAgo: 45, endInDays: -6, missedOccurrences: [2, 9] },
];

/**
 * How many focus blocks were run each day, by days-ago. Days not listed were
 * not worked. Days 0-11 are the live 12-day streak; day 12 is the miss that
 * started it, and day 18 is an earlier one.
 */
export const SESSIONS_BY_DAY: Record<number, number> = {
  0: 3, 1: 4, 2: 2, 3: 5, 4: 1, 5: 3, 6: 2, 7: 4, 8: 3, 9: 1, 10: 2, 11: 3,
  13: 2, 14: 4, 15: 3, 16: 1, 17: 2,
  19: 3, 20: 2, 21: 5, 22: 1, 23: 2, 24: 3, 25: 2, 26: 1, 27: 2,
};

/** What a block was spent on: a task, a habit's instance that day, or nothing
 *  in particular — the timer started without a task, as people do. */
export type Strand = { kind: 'task'; key: TaskKey } | { kind: 'habit'; key: HabitKey } | { kind: 'free' };

export interface FixedBlock {
  strand: Strand;
  minutes: number;
}

/**
 * Days whose blocks are chosen rather than generated, because a post or a
 * screen describes them. Today is the Focus screen (3 sessions, 1h 40m, one of
 * them on the Live Activity — its first, so it reads as ~25% of a 4-session
 * estimate). Yesterday is the "auth tests passing" recap.
 */
export const FIXED_DAYS: Record<number, FixedBlock[]> = {
  // Only habits that run every day belong here: a weekday habit's block would
  // land on a Saturday whenever the seed is re-run on one.
  0: [
    { strand: { kind: 'habit', key: 'reading' }, minutes: 25 },
    { strand: { kind: 'task', key: 'live-activity' }, minutes: 50 },
    { strand: { kind: 'task', key: 'graph-dp' }, minutes: 25 },
  ],
  1: [
    { strand: { kind: 'task', key: 'auth-tests' }, minutes: 50 },
    { strand: { kind: 'task', key: 'auth-tests' }, minutes: 45 },
    { strand: { kind: 'task', key: 'calendar-view' }, minutes: 60 },
    { strand: { kind: 'habit', key: 'reading' }, minutes: 30 },
  ],
};

/** Tasks a generated block may never land on: their history is fixed above. */
export const FIXED_ONLY_TASKS: TaskKey[] = ['live-activity', 'linkedin-post'];

/**
 * Notes carry no title, so "Launch checklist" is a run of to-dos rather than
 * one note — which is how the Notes screen shows a checklist anyway.
 */
export interface NoteSpec {
  content: string;
  isTodo: boolean;
  isCompleted: boolean;
  /** The day it is pinned to, from today. Omitted = today; null = no day. */
  dayOffset?: number | null;
}

export const NOTES: NoteSpec[] = [
  {
    content: [
      'Live Activity architecture',
      '• The OS owns the countdown: pass the end date to Text(timerInterval:), never push ticks',
      '• Pause = freeze the remaining seconds and show them static; resume = new end date',
      '• States: idle → running → paused → running → done. Only running has an end date',
      '• Update the activity on every state change, end it on done or discard',
    ].join('\n'),
    isTodo: false,
    isCompleted: false,
  },
  { content: 'Launch: record the 30s demo video', isTodo: true, isCompleted: true },
  { content: 'Launch: App Store screenshots (6.7" and 6.1")', isTodo: true, isCompleted: true },
  { content: 'Launch: privacy policy + support URL live', isTodo: true, isCompleted: true },
  { content: 'Launch: LinkedIn post drafted and reviewed', isTodo: true, isCompleted: false },
  { content: 'Launch: submit v1.1 for review', isTodo: true, isCompleted: false },
  // Spread over the calendar, past and ahead, plus two with no day.
  { content: 'Retro: the auth tests were flaky because every file shared one database. Clear the tables after each file.', isTodo: false, isCompleted: false, dayOffset: -5 },
  { content: 'Renew the app’s domain before it lapses', isTodo: true, isCompleted: true, dayOffset: -3 },
  { content: 'Ideas for v1.2: a weekly review screen, and a widget for today’s focus', isTodo: false, isCompleted: false, dayOffset: -1 },
  { content: 'Send the Datadog recruiter my availability', isTodo: true, isCompleted: false, dayOffset: 2 },
  { content: 'Pack the charger and laptop stand for SF', isTodo: true, isCompleted: false, dayOffset: 7 },
  { content: 'Run through the STAR stories once more', isTodo: true, isCompleted: false, dayOffset: 8 },
  { content: 'Onsite questions: on-call load, and how ML models reach production', isTodo: false, isCompleted: false, dayOffset: 9 },
  { content: 'Call Mom', isTodo: true, isCompleted: false, dayOffset: 12 },
  { content: 'Book list: DDIA, The Pragmatic Programmer, A Philosophy of Software Design', isTodo: false, isCompleted: false, dayOffset: null },
  { content: 'Cancel the unused SaaS subscriptions', isTodo: true, isCompleted: false, dayOffset: null },
];

export interface EventSpec {
  title: string;
  /** Days from today; negative is past. */
  dayOffset: number;
  /** Start as [hour, minute] with a length. Omitted = all day. */
  at?: { start: [number, number]; minutes: number };
}

/** Repeating appointments, written out one row per day: events do not repeat. */
export const WEEKLY_EVENTS: { title: string; days: string[]; at: { start: [number, number]; minutes: number }; fromDay: number; toDay: number }[] = [
  { title: 'Gym', days: ['mon', 'wed', 'fri'], at: { start: [7, 0], minutes: 60 }, fromDay: -21, toDay: 21 },
];

export const EVENTS: EventSpec[] = [
  { title: 'Coffee chat with a Stripe engineer', dayOffset: -12, at: { start: [16, 0], minutes: 45 } },
  { title: 'Dentist', dayOffset: -9, at: { start: [9, 0], minutes: 45 } },
  { title: 'Ascend beta feedback call', dayOffset: -6, at: { start: [11, 0], minutes: 30 } },
  { title: 'Coffee with Priya', dayOffset: -3, at: { start: [15, 0], minutes: 60 } },
  { title: 'Mock interview with Jordan', dayOffset: -2, at: { start: [17, 0], minutes: 60 } },
  { title: '1:1 with my mentor', dayOffset: 0, at: { start: [12, 30], minutes: 30 } },
  { title: 'Recruiter screen: Datadog', dayOffset: 2, at: { start: [14, 0], minutes: 30 } },
  { title: 'Ascend v1.1 code freeze', dayOffset: 4 },
  { title: 'Pair programming with Marcus', dayOffset: 6, at: { start: [19, 0], minutes: 90 } },
  { title: 'Flight to San Francisco', dayOffset: 8, at: { start: [17, 30], minutes: 210 } },
  { title: 'Datadog onsite interview', dayOffset: 9, at: { start: [10, 0], minutes: 300 } },
  { title: 'SF AI Builders hackathon', dayOffset: 10 },
  { title: 'SF AI Builders hackathon', dayOffset: 11 },
  { title: 'Mom’s birthday', dayOffset: 12 },
  { title: 'Dentist follow-up', dayOffset: 15, at: { start: [8, 30], minutes: 30 } },
  { title: 'Book club: Designing Data-Intensive Applications', dayOffset: 18, at: { start: [19, 30], minutes: 60 } },
  { title: 'Quarterly planning', dayOffset: 25, at: { start: [10, 0], minutes: 120 } },
];

// ── The people around them ──────────────────────────────────────────────────

export interface RecapSpec {
  /** When it was posted, in minutes before the seed runs. */
  minutesAgo: number;
  sessions: number;
  focusMinutes: number;
  caption: string;
}

export interface FriendSpec {
  username: string;
  /** Documents the persona; the User row has no bio column. */
  persona: string;
  avatarEmoji: string;
  xp: number;
  /** Consecutive worked days ending on the day of their latest recap. */
  streak: number;
  /** What their sessions are labelled as. */
  strands: string[];
  /** Typical blocks on a worked day that no recap describes. */
  blocksPerDay: [min: number, max: number];
  blockMinutes: number[];
  /** Worked days before the streak, reaching back this far. */
  historyDays: number;
  recaps: RecapSpec[];
}

export const FRIENDS: FriendSpec[] = [
  {
    username: 'tom_founder', persona: 'Early-stage founder', avatarEmoji: '🦅', xp: 8800, streak: 40,
    strands: ['Pricing page copy', 'Investor update', 'Customer calls prep', 'Onboarding teardown'],
    blocksPerDay: [2, 4], blockMinutes: [45, 50, 60, 90], historyDays: 30,
    recaps: [
      { minutesAgo: 70, sessions: 2, focusMinutes: 130, caption: 'Pricing page copy. Rewrote it three times, kept the shortest one.' },
    ],
  },
  {
    username: 'jordan_ml', persona: 'ML grad student', avatarEmoji: '🐙', xp: 6200, streak: 27,
    strands: ['LoRA paper', 'Ablation runs', 'Thesis chapter 3', 'Reading group prep'],
    blocksPerDay: [2, 3], blockMinutes: [45, 50, 60], historyDays: 25,
    recaps: [
      { minutesAgo: 180, sessions: 3, focusMinutes: 150, caption: 'Read the whole LoRA paper. Now I actually get it.' },
      { minutesAgo: 1000, sessions: 4, focusMinutes: 150, caption: 'Ablations finally finished. Writing up the numbers tomorrow.' },
    ],
  },
  {
    username: 'priya_codes', persona: 'Backend engineer', avatarEmoji: '🦉', xp: 4100, streak: 18,
    strands: ['Auth middleware', 'Billing service migration', 'On-call follow-ups'],
    blocksPerDay: [1, 2], blockMinutes: [45, 50], historyDays: 10,
    recaps: [
      { minutesAgo: 45, sessions: 2, focusMinutes: 95, caption: 'Finally untangled the auth middleware. Two sessions, zero tabs open.' },
      { minutesAgo: 1100, sessions: 3, focusMinutes: 140, caption: 'Moved the billing service off the old queue. Quiet, boring, done.' },
    ],
  },
  {
    username: 'marcus.builds', persona: 'Indie iOS developer', avatarEmoji: '🐻', xp: 2900, streak: 9,
    strands: ['TestFlight build', 'Widget extension', 'App Review notes'],
    blocksPerDay: [1, 2], blockMinutes: [30, 45, 50], historyDays: 12,
    recaps: [
      { minutesAgo: 12, sessions: 1, focusMinutes: 50, caption: 'Shipped a TestFlight build. Going for a walk.' },
    ],
  },
  {
    username: 'sam_writes', persona: 'Technical writer', avatarEmoji: '🦔', xp: 2200, streak: 14,
    strands: ['Payments API docs', 'Style guide pass', 'Changelog'],
    blocksPerDay: [1, 2], blockMinutes: [30, 45], historyDays: 8,
    recaps: [
      { minutesAgo: 400, sessions: 2, focusMinutes: 110, caption: 'Docs rewrite for the payments API, done before lunch.' },
    ],
  },
  {
    username: 'elena_designs', persona: 'Product designer, freelance', avatarEmoji: '🦩', xp: 1600, streak: 6,
    strands: ['Onboarding wireframes', 'Client design review', 'Component library'],
    blocksPerDay: [1, 2], blockMinutes: [40, 45, 50], historyDays: 10,
    recaps: [
      { minutesAgo: 260, sessions: 2, focusMinutes: 80, caption: 'Morning block before client calls. Wireframes for the onboarding flow.' },
    ],
  },
  {
    username: 'aisha.dev', persona: 'Bootcamp grad, job searching', avatarEmoji: '🐝', xp: 450, streak: 2,
    strands: ['LeetCode mediums', 'Portfolio project', 'Applications'],
    blocksPerDay: [1, 2], blockMinutes: [25, 30, 45], historyDays: 6,
    recaps: [
      { minutesAgo: 95, sessions: 3, focusMinutes: 105, caption: 'Three LeetCode mediums. Graph problems are starting to click.' },
      { minutesAgo: 1200, sessions: 1, focusMinutes: 25, caption: 'Slow day, but I showed up. 25 minutes is still 25 minutes.' },
    ],
  },
];

/** The main account's own recaps. Their numbers come from the day's sessions. */
export const MAIN_RECAPS: { daysAgo: 0 | 1; minutesAfterLastSession: number; caption: string }[] = [
  { daysAgo: 0, minutesAfterLastSession: 20, caption: 'Live Activity timer finally counts down on the lock screen.' },
  { daysAgo: 1, minutesAfterLastSession: 15, caption: 'Auth tests passing against the real DB. Good day.' },
];

export const GROUP = {
  name: 'Night Shift Builders',
  description: 'Side projects after the day job. Post what shipped, not how tired you are.',
  emoji: '🌙',
  color: 'teal' as const,
  // Private so the group does not show up in other staging users' group lists.
  isPrivate: true,
  members: ['priya_codes', 'marcus.builds', 'jordan_ml', 'elena_designs'],
  posts: [
    { author: 'marcus.builds', minutesAgo: 300, caption: 'Widget extension builds again. Two evenings on a provisioning profile.' },
    { author: MAIN_USERNAME, minutesAgo: 150, caption: 'Live Activity is in. Calendar view next, then v1.1 goes to review.' },
  ],
};

/** The reaction bar on a post, matching mobile's REACTIONS. */
export const REACTION_EMOJIS = ['🔥', '🫡', '❤️', '💪'] as const;

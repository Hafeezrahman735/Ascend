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

export type GoalKey = 'ship' | 'role';

export const GOALS: { key: GoalKey; title: string; tag: string; deadlineInDays: number }[] = [
  { key: 'ship', title: 'Ship Ascend v1.1', tag: 'ascend', deadlineInDays: 21 },
  { key: 'role', title: 'Land an ML/SWE role', tag: 'interview-prep', deadlineInDays: 75 },
];

export type TaskKey =
  | 'live-activity' | 'calendar-view' | 'auth-tests' | 'graph-dp' | 'election-model'
  | 'linkedin-post' | 'forgot-password' | 'security-audit' | 'timer-rerender' | 'mock-sysdesign';

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
}

export const TASKS: TaskSpec[] = [
  // Open work. The first is the Focus screen's current task.
  { key: 'live-activity', title: 'Build iOS Live Activity for the focus timer', tag: 'ascend', goal: 'ship', estSessions: 4, priority: 'high', createdDaysAgo: 2, dueInDays: 1 },
  { key: 'calendar-view', title: 'Add calendar day/week view', tag: 'ascend', goal: 'ship', estSessions: 6, priority: 'medium', createdDaysAgo: 9, dueInDays: 3 },
  { key: 'auth-tests', title: 'Write integration tests for the auth routes', tag: 'backend', goal: 'ship', estSessions: 3, priority: 'high', createdDaysAgo: 4, dueInDays: 2 },
  { key: 'graph-dp', title: 'Solve 15 graph/DP LeetCode problems', tag: 'interview-prep', goal: 'role', estSessions: 6, priority: 'medium', createdDaysAgo: 14 },
  { key: 'election-model', title: 'Refactor the election prediction model into a clean repo', tag: 'ml', estSessions: 3, priority: 'low', createdDaysAgo: 21 },
  { key: 'linkedin-post', title: 'Write the LinkedIn launch post for Ascend', tag: 'ascend', goal: 'ship', estSessions: 1, priority: 'medium', createdDaysAgo: 1, dueInDays: 0 },
  // Recently finished, so there is history behind the completion rate.
  { key: 'forgot-password', title: 'Forgot-password flow with hashed reset tokens', tag: 'backend', goal: 'ship', estSessions: 6, priority: 'high', createdDaysAgo: 24, dueInDays: -14, completedDaysAgo: 15 },
  { key: 'security-audit', title: 'Security audit: IDOR checks + rate limiting', tag: 'backend', goal: 'ship', estSessions: 8, priority: 'high', createdDaysAgo: 16, dueInDays: -7, completedDaysAgo: 8 },
  { key: 'timer-rerender', title: 'Fix timer re-render issue on the Focus screen', tag: 'ascend', goal: 'ship', estSessions: 4, priority: 'medium', createdDaysAgo: 27, dueInDays: -21, completedDaysAgo: 22 },
  { key: 'mock-sysdesign', title: 'Mock system design interview prep', tag: 'interview-prep', goal: 'role', estSessions: 6, priority: 'medium', createdDaysAgo: 20, dueInDays: -4, completedDaysAgo: 5 },
];

export type HabitKey = 'reading' | 'leetcode' | 'ml-paper';

export interface HabitSpec {
  key: HabitKey;
  title: string;
  tag: string;
  goal?: GoalKey;
  /** Empty = every day, the same convention as Task.recurringDays. */
  days: string[];
  minutes: number;
  startHour: number;
  /** Scheduled occurrences, counting back from today, that were NOT done.
   *  Everything else in the history window was done. The streak falls out of
   *  where the first miss sits. */
  missedOccurrences: number[];
}

export const HABITS: HabitSpec[] = [
  // Daily: 12 in a row, broken by the day the overall streak broke.
  { key: 'reading', title: 'Read 20 pages / technical reading', tag: 'learning', days: [], minutes: 30, startHour: 21, missedOccurrences: [12, 18] },
  // Weekdays: 8 in a row.
  { key: 'leetcode', title: '1 LeetCode problem', tag: 'interview-prep', goal: 'role', days: ['mon', 'tue', 'wed', 'thu', 'fri'], minutes: 25, startHour: 18, missedOccurrences: [8, 13] },
  // Three times a week.
  { key: 'ml-paper', title: 'Review an ML paper', tag: 'ml', goal: 'role', days: ['mon', 'wed', 'fri'], minutes: 45, startHour: 20, missedOccurrences: [5] },
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
export const NOTES: { content: string; isTodo: boolean; isCompleted: boolean }[] = [
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

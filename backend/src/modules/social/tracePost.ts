import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { localPartsOf, safeTimeZone } from '../../lib/localParts';
import { eventBus, EventTypes } from '../../middleware/eventBus';

/**
 * The daily trace post — what a finished session leaves behind for other people.
 *
 * ONE POST PER USER PER DAY, updated in place, not one post per session. That
 * is the whole design decision here and it is worth stating plainly: a person
 * who runs five pomodoros in an afternoon must not push five cards into their
 * followers' feeds. The card is a receipt for the day's work — "3 sessions,
 * 1h 15m, 4 tasks, 7d streak" — so the first session of the day creates it and
 * every session after that revises the same row upward.
 *
 * The numbers are recomputed from the sessions table each time rather than
 * incremented. Incrementing would drift the moment a request is retried, a
 * session is deleted, or two completions race; recomputing cannot, and the read
 * is a single indexed query on (userId, localDate).
 *
 * Only posts this code wrote are ever touched — see `auto` in the payload. A
 * session_recap the user composed by hand in the app is theirs, and an
 * automatic update must never overwrite their caption.
 */

/** Marks a post as owned by this automation rather than written by the user. */
const AUTO_FLAG = true;

export interface DailyTraceNumbers {
  sessionCount: number;
  focusMinutes: number;
  tasksCompleted: number;
  streakAtPost: number;
}

export interface UpsertResult {
  postId: string;
  created: boolean;
  numbers: DailyTraceNumbers;
}

/**
 * Why this can decline to post at all.
 *
 * `privacy` is not an error — it is the setting working. Returned rather than
 * thrown so the caller can log it without a stack trace, and so the tests can
 * assert on the reason instead of on "nothing happened", which would also pass
 * if the feature were simply broken.
 */
export type SkipReason = 'privacy' | 'no_sessions';

export async function upsertDailyTracePost(input: {
  userId: string;
  /** 'YYYY-MM-DD' in the user's local timezone — the day the post represents. */
  localDate: string;
  /** IANA zone, used only to decide which tasks count as finished "today". */
  timeZone?: string | null;
}): Promise<UpsertResult | { skipped: SkipReason }> {
  const { userId, localDate, timeZone } = input;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      publicProfile: true,
      shareFocusStats: true,
      currentStreak: true,
    },
  });

  // Both flags, not either. `publicProfile` governs whether strangers may see
  // you at all and `shareFocusStats` governs the numbers specifically — and the
  // numbers ARE this post, so switching off either one has to stop it.
  if (!user || !user.publicProfile || !user.shareFocusStats) {
    return { skipped: 'privacy' };
  }

  const numbers = await computeDailyNumbers({
    userId,
    localDate,
    timeZone,
    currentStreak: user.currentStreak,
  });

  // Nothing to show. Reachable when a session is deleted after the fact, and
  // the guard keeps an empty "0 sessions" receipt out of the feed.
  if (numbers.sessionCount === 0) {
    return { skipped: 'no_sessions' };
  }

  const existing = await findTodaysAutoPost(userId, localDate);

  const payload: Prisma.InputJsonValue = {
    localDate,
    auto: AUTO_FLAG,
    sessionCount: numbers.sessionCount,
    focusMinutes: numbers.focusMinutes,
    tasksCompleted: numbers.tasksCompleted,
    streakAtPost: numbers.streakAtPost,
  };

  if (existing) {
    await prisma.socialPost.update({
      where: { id: existing.id },
      data: { payload },
    });
    // Deliberately no event on update: followers are told once that you showed
    // up today, not again after every pomodoro.
    return { postId: existing.id, created: false, numbers };
  }

  const post = await prisma.socialPost.create({
    data: {
      authorId: userId,
      type: 'session_recap',
      caption: null,
      visibility: 'public',
      groupId: null,
      payload,
      reactions: {},
    },
  });

  eventBus.emit(EventTypes.POST_CREATED, {
    postId: post.id,
    authorId: userId,
    authorUsername: user.username ?? 'Someone',
    type: post.type,
    caption: null,
  });

  return { postId: post.id, created: true, numbers };
}

/**
 * Today's post, if this automation wrote it.
 *
 * Matched on the payload rather than on a date range over createdAt, because
 * createdAt is a server instant and the post belongs to the user's calendar
 * day — the same distinction lib/localDate.ts exists to keep. The `auto` clause
 * is what protects a hand-written recap from being rewritten.
 */
async function findTodaysAutoPost(userId: string, localDate: string) {
  return prisma.socialPost.findFirst({
    where: {
      authorId: userId,
      type: 'session_recap',
      AND: [
        { payload: { path: ['localDate'], equals: localDate } },
        { payload: { path: ['auto'], equals: true } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * The day's numbers, read back from the tables that own them.
 *
 * Sessions carry a frozen `localDate`, so their side is an exact indexed match.
 * Tasks do not — Task.completedAt is a plain instant — so their local day has
 * to be resolved through the user's timezone the same way reports do it. The
 * ±1 day window is a coarse prefilter for the index; the formatter decides.
 */
async function computeDailyNumbers(input: {
  userId: string;
  localDate: string;
  timeZone?: string | null;
  currentStreak: number;
}): Promise<DailyTraceNumbers> {
  const { userId, localDate, timeZone, currentStreak } = input;

  const dayStart = new Date(`${localDate}T00:00:00.000Z`);
  const windowStart = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(dayStart.getTime() + 48 * 60 * 60 * 1000);

  const [sessionAgg, candidateTasks] = await Promise.all([
    prisma.session.aggregate({
      where: { userId, localDate, type: 'focus' },
      _count: { _all: true },
      _sum: { durationSeconds: true },
    }),
    prisma.task.findMany({
      where: {
        userId,
        isCompleted: true,
        completedAt: { gte: windowStart, lt: windowEnd },
      },
      select: { completedAt: true },
    }),
  ]);

  const zone = safeTimeZone(timeZone);
  const tasksCompleted = candidateTasks.filter(
    (t) => t.completedAt != null && localPartsOf(t.completedAt, zone).dateKey === localDate,
  ).length;

  return {
    sessionCount: sessionAgg._count._all,
    focusMinutes: Math.round((sessionAgg._sum.durationSeconds ?? 0) / 60),
    tasksCompleted,
    streakAtPost: currentStreak,
  };
}

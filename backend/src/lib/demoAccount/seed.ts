/**
 * Writes (and removes) the marketing demo account and the people around it.
 *
 * Idempotent by teardown: every run first deletes every demo account (see
 * DEMO_ACCOUNTS), then writes the whole set again inside one transaction.
 * A failed run therefore leaves the previous data exactly as it was, and a
 * successful one never duplicates anything.
 *
 * Invoked by prisma/seed-demo-account.ts and prisma/teardown-demo-account.ts,
 * which own the "which database is this" guard. Nothing on a request path
 * imports this module.
 */
import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { Prisma, type PrismaClient } from '@prisma/client';
import { buildAttribution } from '../sessionAttribution';
import { CURRENT_TERMS_VERSION } from '../terms';
import { getRankTitle } from '../rank';
import { hashUnit } from '../demoHistory';
import { calendarDay, dateKeyIn, shiftDateKey, streaksFrom, zonedInstant } from './time';
import { checkPlan, deriveUnlocks, leaderboardOf, planFriend, planMain, sumMinutes, type FriendPlan, type LeaderboardRow, type MainPlan } from './plan';
import {
  DEMO_EMAIL_DOMAIN, FRIENDS, GOALS, GROUP, HABITS, MAIN_AVATAR, MAIN_RECAPS, MAIN_USERNAME,
  MAIN_XP, NOTES, REACTION_EMOJIS, SESSION_MINUTES, TASKS,
  type GoalKey, type HabitKey, type TaskKey,
} from './content';

type Tx = Prisma.TransactionClient;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface SeedOptions {
  email: string;
  password: string;
  /** The phone's timezone. Decides what "today" is on every screen. */
  timeZone: string;
  now?: Date;
  /** The API server's clock, which achievements/handler.ts reads. Railway is UTC. */
  serverTimeZone?: string;
}

export interface SeedSummary {
  email: string;
  username: string;
  today: string;
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  totalFocusMinutes: number;
  todaySessions: number;
  todayFocusMinutes: number;
  tasksCompleted: number;
  rank: string;
  achievements: string[];
  /** All-time focus board over the main account and everyone it follows. */
  leaderboard: LeaderboardRow[];
  skippedRecaps: string[];
}

export function friendEmail(username: string): string {
  return `demo+${username}${DEMO_EMAIL_DOMAIN}`;
}

// ── Teardown ────────────────────────────────────────────────────────────────

/**
 * Which accounts belong to the seed: the friends, by their reserved email
 * domain, and the main account by its username. The main account's email is
 * whatever is easy to type on a phone, so it cannot carry the tag itself; the
 * username can, because the seed is what creates it.
 */
const DEMO_ACCOUNTS = { OR: [{ email: { endsWith: DEMO_EMAIL_DOMAIN } }, { username: MAIN_USERNAME }] };

/**
 * Removes every demo account and everything they own. Mirrors
 * DELETE /auth/account: the two tables without foreign keys are cleared by
 * hand, and the rest cascades from the User relations.
 */
export async function removeDemoAccounts(tx: Tx): Promise<string[]> {
  const users = await tx.user.findMany({
    where: DEMO_ACCOUNTS,
    select: { id: true, username: true },
  });
  if (users.length === 0) return [];
  const ids = users.map((u) => u.id);

  const demoPosts = await tx.socialPost.findMany({ where: { authorId: { in: ids } }, select: { id: true } });
  await tx.postReport.deleteMany({
    where: { OR: [{ reportedBy: { in: ids } }, { postId: { in: demoPosts.map((p) => p.id) } }] },
  });
  await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] } });

  // A demo account may have reacted to a real post while someone was trying
  // the app out. Reactions are ids inside a JSON column, so no cascade reaches
  // them; scrub them so the counts on real posts stay honest.
  const idSet = new Set(ids);
  const reacted = await tx.socialPost.findMany({
    where: { authorId: { notIn: ids }, NOT: { reactions: { equals: {} } } },
    select: { id: true, reactions: true },
  });
  for (const post of reacted) {
    const current = (post.reactions ?? {}) as Record<string, string[]>;
    const next: Record<string, string[]> = {};
    let changed = false;
    for (const [emoji, reactors] of Object.entries(current)) {
      const kept = reactors.filter((id) => !idSet.has(id));
      if (kept.length !== reactors.length) changed = true;
      if (kept.length > 0) next[emoji] = kept;
    }
    if (changed) await tx.socialPost.update({ where: { id: post.id }, data: { reactions: next } });
  }

  await tx.user.deleteMany({ where: { id: { in: ids } } });
  return users.map((u) => u.username);
}

export async function teardownDemoAccount(prisma: PrismaClient): Promise<string[]> {
  return prisma.$transaction((tx) => removeDemoAccounts(tx), { timeout: 60_000 });
}

// ── Seed ────────────────────────────────────────────────────────────────────

interface FriendRow {
  id: string;
  username: string;
  plan: FriendPlan;
}

export async function seedDemoAccount(prisma: PrismaClient, options: SeedOptions): Promise<SeedSummary> {
  const { email, password, timeZone } = options;
  const now = options.now ?? new Date();
  const serverTimeZone = options.serverTimeZone ?? 'UTC';

  // An existing account on this email that is not the demo account belongs to
  // someone. Refuse before the teardown runs, rather than fail on the unique
  // constraint after it — the rollback would cover it, but the message would not.
  const owner = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { username: true } });
  if (owner && owner.username !== MAIN_USERNAME) {
    throw new Error(`${email} already belongs to "${owner.username}", which is not the demo account. Pick another email.`);
  }

  // ── Plan everything before touching the database ─────────────────────────
  const main = planMain(now, timeZone);
  const friendPlans = FRIENDS.map((f) => planFriend(f, now, timeZone));
  const board = leaderboardOf(main, friendPlans);
  checkPlan(main, board);

  const today = main.today;
  const dayKey = (offset: number) => shiftDateKey(today, offset);
  const noonOf = (daysAgo: number) => zonedInstant(dayKey(-daysAgo), 12, 0, timeZone);

  // bcrypt is deliberately slow; keep it outside the transaction's clock.
  const [mainHash, friendHash] = await Promise.all([
    bcrypt.hash(password, 12),
    // Nobody logs in as a friend. A random password nobody knows keeps it so.
    bcrypt.hash(randomBytes(24).toString('base64url'), 12),
  ]);
  const catalogue = await prisma.achievement.findMany({ select: { id: true, key: true, category: true, threshold: true, title: true } });

  return prisma.$transaction(async (tx) => {
    await removeDemoAccounts(tx);

    const accountFields = {
      privacySetting: 'public' as const,
      termsAcceptedAt: now,
      termsVersion: CURRENT_TERMS_VERSION,
    };

    // ── The main account ──────────────────────────────────────────────────
    const user = await tx.user.create({
      data: {
        ...accountFields,
        email: email.toLowerCase(),
        username: MAIN_USERNAME,
        passwordHash: mainHash,
        avatarEmoji: MAIN_AVATAR,
        xp: MAIN_XP,
        createdAt: noonOf(35),
      },
    });

    const goalIds = new Map<GoalKey, { id: string; title: string }>();
    for (const g of GOALS) {
      const row = await tx.taskGoal.create({
        data: {
          userId: user.id,
          title: g.title,
          tag: g.tag,
          deadline: calendarDay(dayKey(g.deadlineInDays)),
          createdAt: noonOf(28),
        },
      });
      goalIds.set(g.key, { id: row.id, title: row.title });
    }

    // Per-strand history, counted off the planned sessions.
    const statsFor = (match: (s: MainPlan['sessions'][number]) => boolean) => {
      const sessions = main.sessions.filter(match);
      return {
        count: sessions.length,
        seconds: sumMinutes(sessions) * 60,
        dates: [...new Set(sessions.map((s) => s.dateKey))].sort(),
        last: sessions[sessions.length - 1]?.completedAt,
      };
    };

    // ── Tasks ─────────────────────────────────────────────────────────────
    const taskRows = new Map<TaskKey, { id: string; title: string; tag: string; priority: string; goalId: string | null }>();
    const taskCompletions: Date[] = [];
    for (const t of TASKS) {
      const stats = statsFor((s) => s.strand.kind === 'task' && s.strand.key === t.key);
      const goal = t.goal ? goalIds.get(t.goal) ?? null : null;
      // Ticked off just after the last block on it.
      const completedAt = t.completedDaysAgo === undefined
        ? null
        : new Date((stats.last ?? noonOf(t.completedDaysAgo)).getTime() + 5 * MINUTE_MS);
      if (completedAt) taskCompletions.push(completedAt);

      const row = await tx.task.create({
        data: {
          userId: user.id,
          title: t.title,
          tags: [t.tag],
          priority: t.priority,
          estimatedMinutes: t.estSessions * SESSION_MINUTES,
          taskGoalId: goal?.id ?? null,
          dueDate: t.dueInDays === undefined ? null : calendarDay(dayKey(t.dueInDays)),
          isCompleted: completedAt !== null,
          completedAt,
          sessionsOnTask: stats.count,
          totalTimeOnTask: stats.seconds,
          sessionDates: stats.dates,
          createdAt: noonOf(t.createdDaysAgo),
        },
      });
      taskRows.set(t.key, { id: row.id, title: t.title, tag: t.tag, priority: t.priority, goalId: goal?.id ?? null });
    }

    // ── Habits: a template, plus today's instance ─────────────────────────
    // The shape POST /tasks/spawn-recurring leaves behind. Past instances are
    // not written: spawn archives them, and nothing reads archived rows.
    // Today's is written completed — both because the streaks run through
    // today, and because an open habit due today would take a slot on the
    // Due Soon card from the real deadlines.
    const habitRows = new Map<HabitKey, { templateId: string; instanceId: string | null; goalId: string | null }>();
    for (const h of HABITS) {
      const history = main.habits.get(h.key)!;
      const all = statsFor((s) => s.strand.kind === 'habit' && s.strand.key === h.key);
      const todays = statsFor((s) => s.strand.kind === 'habit' && s.strand.key === h.key && s.dateKey === today);
      const goal = h.goal ? goalIds.get(h.goal) ?? null : null;
      const shared = {
        userId: user.id,
        title: h.title,
        tags: [h.tag],
        priority: 'medium',
        estimatedMinutes: h.minutes,
        startMinutes: h.startHour * 60,
        endMinutes: h.startHour * 60 + h.minutes,
        taskGoalId: goal?.id ?? null,
      };

      const template = await tx.task.create({
        data: {
          ...shared,
          isRecurring: true,
          recurringDays: h.days,
          lastSpawnedDate: today,
          currentStreak: history.currentStreak,
          longestStreak: history.longestStreak,
          totalCompletions: history.completedOn.length,
          // Seconds, despite the name — the complete route adds totalTimeOnTask
          // to it and the client formats it with formatSeconds.
          totalFocusTimeMs: all.seconds,
          createdAt: noonOf(28),
        },
      });

      let instanceId: string | null = null;
      if (history.scheduledToday) {
        // Done after its session today, or a while ago if it had none.
        const doneAt = todays.last
          ? new Date(todays.last.getTime() + 2 * MINUTE_MS)
          : new Date(Math.max(zonedInstant(today, 0, 30, timeZone).getTime(), now.getTime() - 150 * MINUTE_MS));
        taskCompletions.push(doneAt);
        const instance = await tx.task.create({
          data: {
            ...shared,
            dueDate: calendarDay(today),
            parentTaskId: template.id,
            isCompleted: true,
            completedAt: doneAt,
            sessionsOnTask: todays.count,
            totalTimeOnTask: todays.seconds,
            sessionDates: todays.dates,
            lifetimeStreak: history.currentStreak,
            lifetimeTotalCompletions: history.completedOn.length,
            lifetimeTotalFocusTime: all.seconds,
            createdAt: zonedInstant(today, 0, 5, timeZone),
          },
        });
        instanceId = instance.id;
      }
      habitRows.set(h.key, { templateId: template.id, instanceId, goalId: goal?.id ?? null });
    }

    // Earlier habit completions happened on instances that are archived now.
    // They still count as tasks completed, as each one did in the live app.
    for (const h of HABITS) {
      for (const dateKey of main.habits.get(h.key)!.completedOn) {
        if (dateKey !== today) taskCompletions.push(zonedInstant(dateKey, Math.min(23, h.startHour + 1), 0, timeZone));
      }
    }

    // ── Sessions ──────────────────────────────────────────────────────────
    // Attributed with lib/sessionAttribution, the function POST /timer/complete
    // uses, so the focus report reads these rows exactly as it reads live ones.
    const sessionRows: Prisma.SessionCreateManyInput[] = main.sessions.map((s) => {
      // A free block has no task, so it is stamped exactly as the live route
      // stamps a timer run without one: no title, no tag, no goal.
      let taskId: string | null = null;
      let attributionTask: Parameters<typeof buildAttribution>[0]['task'] = null;
      let goal: { id: string; title: string } | null = null;

      if (s.strand.kind === 'task') {
        const t = taskRows.get(s.strand.key)!;
        taskId = t.id;
        attributionTask = { title: t.title, tags: [t.tag], priority: t.priority, taskGoalId: t.goalId, isRecurring: false, parentTaskId: null };
        goal = t.goalId ? [...goalIds.values()].find((g) => g.id === t.goalId) ?? null : null;
      } else if (s.strand.kind === 'habit') {
        const key = s.strand.key;
        const habit = HABITS.find((h) => h.key === key)!;
        const rows = habitRows.get(habit.key)!;
        // Only today's instance still exists to link to.
        taskId = s.dateKey === today ? rows.instanceId : null;
        attributionTask = { title: habit.title, tags: [habit.tag], priority: 'medium', taskGoalId: rows.goalId, isRecurring: false, parentTaskId: rows.templateId };
        goal = rows.goalId ? [...goalIds.values()].find((g) => g.id === rows.goalId) ?? null : null;
      }

      return {
        userId: user.id,
        type: 'focus',
        durationSeconds: s.minutes * 60,
        plannedDurationSeconds: s.minutes * 60,
        taskLabel: attributionTask?.title ?? null,
        taskId,
        completedAt: s.completedAt,
        createdAt: s.completedAt,
        ...buildAttribution({ task: attributionTask, goal, completedAt: s.completedAt, localDate: s.dateKey, timeZone }),
      };
    });
    await tx.session.createMany({ data: sessionRows });

    const streak = streaksFrom(main.sessions.map((s) => s.dateKey), today);
    const totalFocusSeconds = sumMinutes(main.sessions) * 60;
    await tx.user.update({
      where: { id: user.id },
      data: {
        totalSessions: main.sessions.length,
        totalFocusTime: totalFocusSeconds,
        tasksCompleted: taskCompletions.length,
        currentStreak: streak.current,
        longestStreak: streak.longest,
        lastActiveDate: streak.lastActive ? calendarDay(streak.lastActive) : null,
      },
    });

    // ── Notes ─────────────────────────────────────────────────────────────
    await tx.note.createMany({
      data: NOTES.map((n, i) => ({
        userId: user.id,
        content: n.content,
        date: today,
        isTodo: n.isTodo,
        isCompleted: n.isCompleted,
        createdAt: new Date(noonOf(2).getTime() + i * MINUTE_MS),
      })),
    });

    // ── Friends ───────────────────────────────────────────────────────────
    const friends: FriendRow[] = [];
    for (const [i, f] of FRIENDS.entries()) {
      const plan = friendPlans[i];
      const fStreak = streaksFrom(plan.sessions.map((s) => s.dateKey), today);
      const focusSeconds = sumMinutes(plan.sessions) * 60;
      const first = plan.sessions[0]?.completedAt ?? now;
      const row = await tx.user.create({
        data: {
          ...accountFields,
          email: friendEmail(f.username),
          username: f.username,
          passwordHash: friendHash,
          avatarEmoji: f.avatarEmoji,
          // Staging only, and a second fence besides: their profiles stay closed
          // to anyone who taps through. They DO appear on the leaderboard —
          // showOnLeaderboard=false removes them from every scope, which would
          // leave the account alone on its own board.
          publicProfile: false,
          showOnLeaderboard: true,
          xp: f.xp,
          currentStreak: fStreak.current,
          longestStreak: fStreak.longest,
          lastActiveDate: fStreak.lastActive ? calendarDay(fStreak.lastActive) : null,
          totalSessions: plan.sessions.length,
          totalFocusTime: focusSeconds,
          createdAt: new Date(first.getTime() - 2 * DAY_MS),
        },
      });
      await tx.session.createMany({
        data: plan.sessions.map((s) => ({
          userId: row.id,
          type: 'focus',
          durationSeconds: s.minutes * 60,
          plannedDurationSeconds: s.minutes * 60,
          taskLabel: s.label,
          completedAt: s.completedAt,
          createdAt: s.completedAt,
          ...buildAttribution({ task: null, goal: null, completedAt: s.completedAt, localDate: s.dateKey, timeZone }),
        })),
      });
      friends.push({ id: row.id, username: f.username, plan });
    }
    const byUsername = new Map<string, string>([[MAIN_USERNAME, user.id], ...friends.map((f): [string, string] => [f.username, f.id])]);

    // ── Follows ───────────────────────────────────────────────────────────
    // The account follows everyone (that is its Friends board and feed); they
    // all follow back; and they follow some of each other.
    const followRows: Prisma.FollowCreateManyInput[] = [];
    const mainFollowTimes: Date[] = [];
    for (const [i, f] of friends.entries()) {
      const at = new Date(noonOf(26 - i).getTime());
      mainFollowTimes.push(at);
      followRows.push({ followerId: user.id, followingId: f.id, createdAt: at });
      followRows.push({ followerId: f.id, followingId: user.id, createdAt: new Date(at.getTime() + 3 * 60 * MINUTE_MS) });
      for (const other of friends) {
        if (other.id !== f.id && hashUnit(`follow:${f.username}:${other.username}`) < 0.5) {
          followRows.push({ followerId: f.id, followingId: other.id, createdAt: noonOf(30) });
        }
      }
    }
    await tx.follow.createMany({ data: followRows });

    // ── Posts ─────────────────────────────────────────────────────────────
    const tasksDoneOn = (dateKey: string) =>
      taskCompletions.filter((d) => dateKeyIn(d, timeZone) === dateKey).length;

    for (const recap of MAIN_RECAPS) {
      const dateKey = dayKey(-recap.daysAgo);
      const day = main.sessions.filter((s) => s.dateKey === dateKey);
      const last = day[day.length - 1].completedAt;
      const postedAt = new Date(Math.min(last.getTime() + recap.minutesAfterLastSession * MINUTE_MS, now.getTime() - MINUTE_MS));
      await tx.socialPost.create({
        data: {
          authorId: user.id,
          type: 'session_recap',
          caption: recap.caption,
          visibility: 'public',
          // `auto` + `localDate` is the shape upsertDailyRecapPost looks for.
          // If a real session is finished on the demo account today, the app
          // updates this card's numbers in place (keeping the caption) rather
          // than posting a second recap beside it.
          payload: {
            localDate: dateKey,
            auto: true,
            sessionCount: day.length,
            focusMinutes: sumMinutes(day),
            tasksCompleted: tasksDoneOn(dateKey),
            streakAtPost: streaksFrom(main.sessions.filter((s) => s.dateKey <= dateKey).map((s) => s.dateKey), dateKey).current,
          },
          reactions: {},
          createdAt: postedAt,
        },
      });
    }

    for (const f of friends) {
      await tx.socialPost.createMany({
        data: f.plan.recaps.map((r) => ({
          authorId: f.id,
          type: 'session_recap',
          caption: r.caption,
          visibility: 'public',
          // A hand-written recap: no task count, which the card then omits.
          payload: { sessionCount: r.sessionCount, focusMinutes: r.focusMinutes, streakAtPost: r.streakAtPost },
          reactions: {},
          createdAt: r.postedAt,
        })),
      });
    }

    // ── The group ─────────────────────────────────────────────────────────
    const group = await tx.studyGroup.create({
      data: {
        name: GROUP.name,
        description: GROUP.description,
        emoji: GROUP.emoji,
        color: GROUP.color,
        isPrivate: GROUP.isPrivate,
        createdBy: user.id,
        createdAt: noonOf(21),
      },
    });
    const memberIds = [user.id, ...GROUP.members.map((m) => byUsername.get(m)!)];
    await tx.studyGroupMember.createMany({
      data: memberIds.map((userId, i) => ({ groupId: group.id, userId, joinedAt: noonOf(21 - i) })),
    });
    await tx.socialPost.createMany({
      data: GROUP.posts.map((p) => ({
        authorId: byUsername.get(p.author)!,
        type: 'free_post',
        caption: p.caption,
        visibility: 'group',
        groupId: group.id,
        payload: { contentTag: 'general' },
        reactions: {},
        createdAt: new Date(now.getTime() - p.minutesAgo * MINUTE_MS),
      })),
    });

    // ── Reactions ─────────────────────────────────────────────────────────
    // 1-6 per post from people who could see it, with the account's own posts
    // at the busier end. An empty reaction bar is the surest tell of a seed.
    const allIds = [user.id, ...friends.map((f) => f.id)];
    const posts = await tx.socialPost.findMany({
      where: { authorId: { in: allIds } },
      select: { id: true, authorId: true, groupId: true, caption: true },
    });
    for (const post of posts) {
      const audience = (post.groupId ? memberIds : allIds).filter((id) => id !== post.authorId);
      const seed = `react:${post.caption}`;
      const floor = post.authorId === user.id ? 3 : 1;
      const count = Math.min(audience.length, floor + Math.floor(hashUnit(`${seed}:count`) * (7 - floor)));
      const reactors = [...audience]
        .sort((a, b) => hashUnit(`${seed}:${byIndex(allIds, a)}`) - hashUnit(`${seed}:${byIndex(allIds, b)}`))
        .slice(0, count);
      const reactions: Record<string, string[]> = {};
      for (const [i, reactorId] of reactors.entries()) {
        const emoji = REACTION_EMOJIS[Math.floor(hashUnit(`${seed}:emoji:${i}`) * REACTION_EMOJIS.length)];
        reactions[emoji] = [...(reactions[emoji] ?? []), reactorId];
      }
      await tx.socialPost.update({ where: { id: post.id }, data: { reactions } });
    }

    // ── Achievements ──────────────────────────────────────────────────────
    const unlocks = deriveUnlocks(catalogue, {
      sessions: main.sessions,
      taskCompletions,
      followsCreatedAt: mainFollowTimes,
      xp: MAIN_XP,
      serverTimeZone,
    });
    await tx.userAchievement.createMany({
      data: unlocks.map((u) => ({ userId: user.id, achievementId: u.achievementId, unlockedAt: u.unlockedAt })),
    });

    // ── Recent Activity ───────────────────────────────────────────────────
    // In the payload shapes the live emitters use, so the card renders real
    // rows rather than its generic fallback.
    const titleOf = new Map(catalogue.map((a) => [a.id, a.title]));
    const recentSessions = main.sessions.filter((s) => s.dateKey >= dayKey(-1));
    const events: Prisma.FeedEventCreateManyInput[] = [
      ...recentSessions.map((s, i) => ({
        userId: user.id,
        eventType: 'session_completed',
        payload: { durationMinutes: s.minutes, taskTitle: sessionRows[main.sessions.indexOf(s)].taskLabel },
        createdAt: new Date(s.completedAt.getTime() + i),
      })),
      ...TASKS.filter((t) => t.completedDaysAgo !== undefined).map((t) => ({
        userId: user.id,
        eventType: 'task_completed',
        payload: { taskTitle: t.title },
        createdAt: noonOf(t.completedDaysAgo!),
      })),
      ...unlocks.map((u) => ({
        userId: user.id,
        eventType: 'achievement_unlocked',
        payload: { achievementTitle: titleOf.get(u.achievementId) ?? u.key },
        createdAt: u.unlockedAt,
      })),
    ];
    await tx.feedEvent.createMany({ data: events });

    const todays = main.sessions.filter((s) => s.dateKey === today);
    return {
      email: user.email,
      username: user.username,
      today,
      currentStreak: streak.current,
      longestStreak: streak.longest,
      totalSessions: main.sessions.length,
      totalFocusMinutes: totalFocusSeconds / 60,
      todaySessions: todays.length,
      todayFocusMinutes: sumMinutes(todays),
      tasksCompleted: taskCompletions.length,
      rank: getRankTitle(MAIN_XP),
      achievements: unlocks.map((u) => u.key),
      leaderboard: board,
      skippedRecaps: friendPlans.flatMap((p) => p.skipped),
    };
  }, { timeout: 120_000, maxWait: 15_000 });
}

/** A stable per-run handle for a user id, so reaction order does not depend
 *  on the random UUIDs a run happens to be given. */
function byIndex(ids: string[], id: string): number {
  return ids.indexOf(id);
}

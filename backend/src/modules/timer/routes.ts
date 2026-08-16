import { Router, Request, Response } from 'express';
import { Namespace } from 'socket.io';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import { eventBus, EventTypes } from '../../middleware/eventBus';
import { runGamification } from '../../lib/gamification';
import { getLevelTitle } from '../../lib/xp';
import { resolveLocalDate } from '../../lib/localDate';
import { syncGoalCompletion } from '../../lib/goalProgress';
import {
  MAX_SESSION_SECONDS,
  isCompletionTimeAcceptable,
  creditedSeconds as computeCreditedSeconds,
} from '../../lib/sessionCredit';

const startSchema = z.object({
  taskLabel: z.string().nullable().optional(),
  durationSeconds: z.number().int().positive(),
  startedAt: z.number(),
  taskId: z.string().optional().nullable(),
});

const pauseSchema = z.object({
  // Seconds elapsed in the current phase. Kept for clients already in the wild,
  // which send only this; the server converts it to remaining below.
  elapsedSeconds: z.number().int().min(0).optional(),
  // Preferred: the client already knows its exact remaining time, and this is
  // what the column actually stores.
  remainingSeconds: z.number().int().min(0).optional(),
});

const resumeSchema = z.object({
  resumedAt: z.number(),
});

const completeSchema = z.object({
  completedAt: z.number(),
  localDate: z.string().optional().nullable(), // YYYY-MM-DD in the client's local timezone
  actualElapsedSeconds: z.number().int().min(0).max(MAX_SESSION_SECONDS),
  taskLabel: z.string().nullable().optional(),
  taskId: z.string().optional().nullable(),
  plannedDurationSeconds: z.number().int().min(0).max(MAX_SESSION_SECONDS).optional().nullable(),
  clientSessionId: z.string().max(36).optional().nullable(),
});

export function setupTimerRoutes(router: Router, timerNamespace: Namespace): void {

  router.post('/timer/start', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const { taskLabel, durationSeconds, startedAt } = startSchema.parse(req.body);

      await prisma.timerState.upsert({
        where: { userId },
        create: {
          userId,
          phase: 'focus',
          phaseType: 'focus',
          totalSeconds: durationSeconds,
          remainingSeconds: durationSeconds,
          isRunning: true,
          taskLabel: taskLabel || null,
          startedAt: new Date(startedAt),
          pausedAt: null,
          pomodoroCount: 0,
        },
        update: {
          phase: 'focus',
          phaseType: 'focus',
          totalSeconds: durationSeconds,
          remainingSeconds: durationSeconds,
          isRunning: true,
          taskLabel: taskLabel || null,
          startedAt: new Date(startedAt),
          pausedAt: null,
        },
      });

      timerNamespace.to(`user:${userId}`).emit('timer:started', {
        userId,
        taskLabel,
        durationSeconds,
        startedAt,
      });

      res.json({ success: true, data: null });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      if (handleAuthError(res, err)) return;
      console.error('Timer start error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  router.post('/timer/pause', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const { elapsedSeconds, remainingSeconds } = pauseSchema.parse(req.body);

      const existing = await prisma.timerState.findUnique({
        where: { userId },
        select: { totalSeconds: true },
      });

      // The column means REMAINING. It was previously being written with the
      // elapsed value, which is the opposite quantity. Prefer what the client
      // sends; otherwise derive it from the phase length on record.
      const total = existing?.totalSeconds ?? 0;
      const remaining = remainingSeconds ?? Math.max(0, total - (elapsedSeconds ?? 0));

      // Upsert, not update: a user who never hit /timer/start (or whose state was
      // cleared) has no row, and update() throws P2025 there — a 500 on an
      // otherwise harmless pause.
      await prisma.timerState.upsert({
        where: { userId },
        create: {
          userId,
          phase: 'focus',
          phaseType: 'focus',
          totalSeconds: total,
          remainingSeconds: remaining,
          isRunning: false,
          pausedAt: new Date(),
        },
        update: {
          isRunning: false,
          remainingSeconds: remaining,
          pausedAt: new Date(),
        },
      });

      timerNamespace.to(`user:${userId}`).emit('timer:paused', {
        userId,
        remainingSeconds: remaining,
      });

      res.json({ success: true, data: null });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      if (handleAuthError(res, err)) return;
      console.error('Timer pause error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  router.post('/timer/resume', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const { resumedAt } = resumeSchema.parse(req.body);

      // Upsert for the same reason as /timer/pause — no row must not mean a 500.
      await prisma.timerState.upsert({
        where: { userId },
        create: {
          userId,
          phase: 'focus',
          phaseType: 'focus',
          totalSeconds: 0,
          remainingSeconds: 0,
          isRunning: true,
          startedAt: new Date(resumedAt),
          pausedAt: null,
        },
        update: {
          isRunning: true,
          startedAt: new Date(resumedAt),
          pausedAt: null,
        },
      });

      timerNamespace.to(`user:${userId}`).emit('timer:resumed', {
        userId,
        resumedAt,
      });

      res.json({ success: true, data: null });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      if (handleAuthError(res, err)) return;
      console.error('Timer resume error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  router.post('/timer/complete', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const { completedAt, localDate, actualElapsedSeconds, taskLabel, taskId, plannedDurationSeconds, clientSessionId } = completeSchema.parse(req.body);

      // ── Validate the client-reported completion time ──
      // Everything downstream (streaks, daily goals, leaderboards) keys off these
      // values, so they are bounded here rather than trusted as sent. Rules live
      // in lib/sessionCredit.ts so they can be tested directly.
      if (!isCompletionTimeAcceptable(completedAt)) {
        res.status(400).json({ success: false, error: 'Session completion time is out of range' });
        return;
      }
      const completedAtDate = new Date(completedAt);

      // Use the client's local date when it is plausible for this completion
      // time; otherwise fall back to the UTC date rather than rejecting the
      // session outright — losing focus time is worse than losing a timezone.
      const sessionLocalDate = resolveLocalDate(localDate, completedAtDate, `POST /timer/complete user=${userId}`);

      const creditedSeconds = computeCreditedSeconds(actualElapsedSeconds, plannedDurationSeconds);

      // Idempotency check — reject duplicate submissions before touching the DB
      if (clientSessionId) {
        const existing = await prisma.session.findUnique({
          where: { clientSessionId },
        });
        if (existing) {
          console.log(`[timer] Duplicate clientSessionId ${clientSessionId} — skipping`);
          res.json({ success: true, data: { sessionId: existing.id, alreadyProcessed: true, newlyUnlocked: [] } });
          return;
        }
      }

      // Only associate the session with a task the caller actually owns. An
      // unowned or missing id is dropped rather than rejected so the focus time
      // is still recorded (e.g. the task was deleted mid-session).
      let ownedTaskId: string | null = null;
      if (taskId) {
        const ownedTask = await prisma.task.findFirst({
          where: { id: taskId, userId },
          select: { id: true },
        });
        if (ownedTask) {
          ownedTaskId = ownedTask.id;
        } else {
          console.warn(`[timer] Ignoring taskId=${taskId} not owned by user=${userId}`);
        }
      }

      const session = await prisma.session.create({
        data: {
          userId,
          type: 'focus',
          durationSeconds: creditedSeconds,
          plannedDurationSeconds: plannedDurationSeconds || null,
          taskLabel: taskLabel || null,
          taskId: ownedTaskId,
          completedAt: completedAtDate,
          clientSessionId: clientSessionId || null,
        },
      });

      console.log(`[timer] Session saved: user=${userId} duration=${creditedSeconds}s id=${session.id}`);

      // Update task session counters if an owned task was linked. Scoped by
      // userId again so the write itself can never touch another user's row.
      if (ownedTaskId) {
        try {
          const task = await prisma.task.findFirst({
            where: { id: ownedTaskId, userId },
            select: { sessionDates: true, taskGoalId: true },
          });
          if (task) {
            const updatedDates = Array.from(new Set([...task.sessionDates, sessionLocalDate]));
            await prisma.task.updateMany({
              where: { id: ownedTaskId, userId },
              data: {
                sessionsOnTask: { increment: 1 },
                totalTimeOnTask: { increment: creditedSeconds },
                sessionDates: updatedDates,
              },
            });

            // A session against a linked task moves the goal's sessions
            // component, which may complete it.
            if (task.taskGoalId) {
              await syncGoalCompletion(userId, [task.taskGoalId]);
            }
          }
        } catch (taskErr) {
          // Non-fatal — session is already saved; log and continue
          console.warn(`[timer] Task counter update failed for taskId=${ownedTaskId}:`, taskErr);
        }
      }

      const gamification = await runGamification(userId, creditedSeconds, completedAtDate, sessionLocalDate);

      eventBus.emit(EventTypes.FEED_CREATE, {
        userId,
        eventType: 'session_completed',
        payload: {
          durationMinutes: Math.round(creditedSeconds / 60),
          taskTitle: taskLabel || null,
          xpEarned: gamification.xpEarned,
          streak: gamification.newStreak,
        },
      });

      if (gamification.leveledUp) {
        eventBus.emit(EventTypes.FEED_CREATE, {
          userId,
          eventType: 'level_up',
          payload: {
            newLevel: gamification.level,
            levelTitle: getLevelTitle(gamification.level),
          },
        });
      }

      const STREAK_MILESTONES = [3, 7, 14, 30, 100];
      if (STREAK_MILESTONES.includes(gamification.newStreak)) {
        const existing = await prisma.feedEvent.findFirst({
          where: {
            userId,
            eventType: 'streak_milestone',
            payload: { path: ['streakDays'], equals: gamification.newStreak },
          },
        });
        if (!existing) {
          eventBus.emit(EventTypes.FEED_CREATE, {
            userId,
            eventType: 'streak_milestone',
            payload: { streakDays: gamification.newStreak },
          });
        }
      }

      await prisma.timerState.upsert({
        where: { userId },
        create: {
          userId,
          phase: 'idle',
          phaseType: 'focus',
          totalSeconds: 1500,
          remainingSeconds: 1500,
          isRunning: false,
          startedAt: null,
          pausedAt: null,
        },
        update: {
          phase: 'idle',
          phaseType: 'focus',
          totalSeconds: 1500,
          remainingSeconds: 1500,
          isRunning: false,
          startedAt: null,
          pausedAt: null,
        },
      });

      eventBus.emit(EventTypes.SESSION_COMPLETED, {
        userId,
        sessionId: session.id,
        type: 'focus',
        durationSeconds: creditedSeconds,
        taskLabel: taskLabel || null,
        taskId: ownedTaskId,
        completedAt: completedAtDate.toISOString(),
        localDate: sessionLocalDate,
      });

      timerNamespace.to(`user:${userId}`).emit('timer:completed', {
        userId,
        sessionId: session.id,
        durationSeconds: creditedSeconds,
      });

      res.json({
        success: true,
        data: {
          sessionId: session.id,
          // Seconds actually credited — may be less than the client reported if
          // it exceeded the planned duration.
          creditedSeconds,
          xpEarned: gamification.xpEarned,
          totalXP: gamification.totalXP,
          level: gamification.level,
          leveledUp: gamification.leveledUp,
          newStreak: gamification.newStreak,
          longestStreak: gamification.longestStreak,
          newlyUnlocked: gamification.newlyUnlocked.map((a) => ({
            id: a.id,
            key: a.key,
            title: a.title,
            description: a.description,
            icon: a.icon,
            xpReward: a.xpReward,
            category: a.category,
            threshold: a.threshold,
            unlockedAt: a.unlockedAt,
          })),
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      if (handleAuthError(res, err)) return;
      console.error('Timer complete error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  router.get('/timer/active', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const state = await prisma.timerState.findUnique({ where: { userId } });

      if (!state) {
        res.json({ success: true, data: { phase: 'idle' } });
        return;
      }

      res.json({
        success: true,
        data: {
          phase: state.phase,
          phaseType: state.phaseType,
          totalSeconds: state.totalSeconds,
          remainingSeconds: state.remainingSeconds,
          isRunning: state.isRunning,
          startedAt: state.startedAt?.getTime() ?? null,
          pausedAt: state.pausedAt?.getTime() ?? null,
          pomodoroCount: state.pomodoroCount,
          taskLabel: state.taskLabel,
        },
      });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('Timer active error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  router.get('/timer/sessions', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const sessions = await prisma.session.findMany({
        where: { userId },
        orderBy: { completedAt: 'desc' },
        take: 200,
        select: {
          id: true,
          completedAt: true,
          durationSeconds: true,
          taskId: true,
          taskLabel: true,
          clientSessionId: true,
        },
      });

      res.json({ success: true, data: { sessions } });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('Timer sessions error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  router.get('/timer/sessions/week', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const sessions = await prisma.session.findMany({
        where: {
          userId,
          type: 'focus',
          completedAt: { gte: sevenDaysAgo },
        },
        select: {
          completedAt: true,
          durationSeconds: true,
        },
        orderBy: { completedAt: 'desc' },
      });

      // tzOffset: minutes the client's local timezone is ahead of UTC (positive = east, negative = west)
      const tzOffset = parseInt(req.query.tzOffset as string ?? '0', 10) || 0;
      const toLocalDateStr = (utcDate: Date): string => {
        const local = new Date(utcDate.getTime() + tzOffset * 60_000);
        return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
      };

      const activeDates = Array.from(
        new Set(sessions.map(s => toLocalDateStr(new Date(s.completedAt))))
      );

      res.json({ success: true, data: { sessions, activeDates } });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('[timer/sessions/week] error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
}

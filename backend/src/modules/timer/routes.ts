import { Router, Request, Response } from 'express';
import { Namespace } from 'socket.io';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import { eventBus, EventTypes } from '../../middleware/eventBus';
import { runGamification } from '../goals/handler';
import { getLevelTitle } from '../../lib/xp';

const startSchema = z.object({
  taskLabel: z.string().nullable().optional(),
  durationSeconds: z.number().int().positive(),
  startedAt: z.number(),
  taskId: z.string().optional().nullable(),
});

const pauseSchema = z.object({
  elapsedSeconds: z.number().int().min(0),
});

const resumeSchema = z.object({
  resumedAt: z.number(),
});

const completeSchema = z.object({
  completedAt: z.number(),
  localDate: z.string().optional().nullable(), // YYYY-MM-DD in the client's local timezone
  actualElapsedSeconds: z.number().int().min(0),
  taskLabel: z.string().nullable().optional(),
  taskId: z.string().optional().nullable(),
  plannedDurationSeconds: z.number().int().optional().nullable(),
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
      const { elapsedSeconds } = pauseSchema.parse(req.body);

      await prisma.timerState.update({
        where: { userId },
        data: {
          isRunning: false,
          remainingSeconds: elapsedSeconds,
          pausedAt: new Date(),
        },
      });

      timerNamespace.to(`user:${userId}`).emit('timer:paused', {
        userId,
        elapsedSeconds,
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

      await prisma.timerState.update({
        where: { userId },
        data: {
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
      // Use the client-supplied local date if provided; fall back to UTC date of completedAt.
      const sessionLocalDate = localDate ?? new Date(completedAt).toISOString().split('T')[0];

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

      const session = await prisma.session.create({
        data: {
          userId,
          type: 'focus',
          durationSeconds: actualElapsedSeconds,
          plannedDurationSeconds: plannedDurationSeconds || null,
          taskLabel: taskLabel || null,
          taskId: taskId || null,
          completedAt: new Date(completedAt),
          clientSessionId: clientSessionId || null,
        },
      });

      console.log(`[timer] Session saved: user=${userId} duration=${actualElapsedSeconds}s id=${session.id}`);

      // Update task session counters if a task was linked
      if (taskId) {
        try {
          const today = sessionLocalDate;
          const task = await prisma.task.findUnique({
            where: { id: taskId },
            select: { sessionDates: true },
          });
          if (task) {
            const updatedDates = Array.from(new Set([...task.sessionDates, today]));
            await prisma.task.update({
              where: { id: taskId },
              data: {
                sessionsOnTask: { increment: 1 },
                totalTimeOnTask: { increment: actualElapsedSeconds },
                sessionDates: updatedDates,
              },
            });
          }
        } catch (taskErr) {
          // Non-fatal — session is already saved; log and continue
          console.warn(`[timer] Task counter update failed for taskId=${taskId}:`, taskErr);
        }
      }

      const gamification = await runGamification(userId, actualElapsedSeconds, new Date(completedAt), sessionLocalDate);

      eventBus.emit(EventTypes.FEED_CREATE, {
        userId,
        eventType: 'session_completed',
        payload: {
          durationMinutes: Math.round(actualElapsedSeconds / 60),
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
        durationSeconds: actualElapsedSeconds,
        taskLabel: taskLabel || null,
        taskId: taskId || null,
        completedAt: new Date(completedAt).toISOString(),
        localDate: sessionLocalDate,
      });

      timerNamespace.to(`user:${userId}`).emit('timer:completed', {
        userId,
        sessionId: session.id,
        durationSeconds: actualElapsedSeconds,
      });

      res.json({
        success: true,
        data: {
          sessionId: session.id,
          verified: true,
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

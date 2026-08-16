import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  authenticate,
} from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { handleAuthError, handleZodError } from '../../lib/errors';
export const authRouter = Router();

// Email is stored and matched lowercase. Without this, signing up as
// "Sam@Gmail.com" and later typing "sam@gmail.com" fails to log in (Postgres
// compares case-sensitively), and the unique constraint would allow both as
// separate accounts. Mobile keyboards autocapitalise, so this is routine.
// Trimming catches trailing whitespace from paste/autofill.
const normalizeEmail = (v: string) => v.trim().toLowerCase();

const registerSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  username: z.string().trim().min(3).max(50),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

authRouter.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, username, password } = registerSchema.parse(req.body);

    // Username is matched case-insensitively so "Admin" and "admin" can't coexist
    // as separate accounts — in a social feed that reads as impersonation. The
    // original casing is still stored and displayed.
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username: { equals: username, mode: 'insensitive' } }],
      },
    });
    if (existingUser) {
      res.status(409).json({
        success: false,
        error: existingUser.email === email ? 'Email already registered' : 'Username already taken',
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, username, passwordHash },
    });

    const accessToken = signAccessToken({ userId: user.id, username: user.username });
    const refreshToken = signRefreshToken({ userId: user.id, username: user.username });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatarUrl: user.avatarUrl,
          privacySetting: user.privacySetting,
          createdAt: user.createdAt,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors[0].message });
      return;
    }
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    const accessToken = signAccessToken({ userId: user.id, username: user.username });
    const refreshToken = signRefreshToken({ userId: user.id, username: user.username });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt,
      },
    });

    // Prune this user's expired tokens on the way through — see /auth/refresh.
    prisma.refreshToken
      .deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
      .catch((err) => console.error('Refresh token cleanup failed:', err));

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatarUrl: user.avatarUrl,
          privacySetting: user.privacySetting,
          createdAt: user.createdAt,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors[0].message });
      return;
    }
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.post('/auth/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
      return;
    }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });
    if (!storedToken) {
      res.status(401).json({ success: false, error: 'Refresh token not found' });
      return;
    }

    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    const newAccessToken = signAccessToken({ userId: user.id, username: user.username });
    const newRefreshToken = signRefreshToken({ userId: user.id, username: user.username });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: newRefreshToken,
        expiresAt,
      },
    });

    // Opportunistic cleanup. A row was written on every login and every refresh
    // and only ever deleted on explicit logout, so expired tokens accumulated
    // forever. Pruning this user's expired rows here keeps the table bounded
    // without needing a scheduled job. Best-effort: never fail a refresh over it.
    prisma.refreshToken
      .deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
      .catch((err) => console.error('Refresh token cleanup failed:', err));

    res.json({
      success: true,
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors[0].message });
      return;
    }
    console.error('Refresh error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    await prisma.refreshToken.deleteMany({ where: { userId } });
    res.json({ success: true, data: { message: 'Logged out successfully' } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Logout error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

  // Proactively resets the overall day-streak the moment a day is missed, instead
  // of the lazy "recompute on next session" path in lib/streak.ts. Called on app
  // boot / foreground alongside recurring-task spawning. The streak survives only
  // if the user was active today or yesterday; any older last-active means at least
  // one full day was missed, so it resets to 0 immediately. Never increments here.
  authRouter.post('/auth/me/streak-check', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const schema = z.object({ localDate: z.string().optional() });
      const { localDate } = schema.parse(req.body ?? {});
      const today = localDate ?? new Date().toISOString().split('T')[0];

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { currentStreak: true, lastActiveDate: true },
      });
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      let currentStreak = user.currentStreak;

      if (user.lastActiveDate && currentStreak !== 0) {
        // lastActiveDate is stored as midnight UTC of the user's local date, so UTC
        // getters return the correct calendar day (matches lib/streak.ts semantics).
        const la = user.lastActiveDate;
        const lastActive = `${la.getUTCFullYear()}-${String(la.getUTCMonth() + 1).padStart(2, '0')}-${String(la.getUTCDate()).padStart(2, '0')}`;

        const y = new Date(`${today}T00:00:00.000Z`);
        y.setUTCDate(y.getUTCDate() - 1);
        const yesterday = `${y.getUTCFullYear()}-${String(y.getUTCMonth() + 1).padStart(2, '0')}-${String(y.getUTCDate()).padStart(2, '0')}`;

        if (lastActive !== today && lastActive !== yesterday) {
          await prisma.user.update({ where: { id: userId }, data: { currentStreak: 0 } });
          currentStreak = 0;
        }
      }

      res.json({ success: true, data: { currentStreak } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: error.errors[0].message });
        return;
      }
      if (handleAuthError(res, error)) return;
      console.error('Streak check error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  authRouter.get('/auth/me', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      res.json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatarUrl: user.avatarUrl,
          avatarEmoji: user.avatarEmoji,
          privacySetting: user.privacySetting,
          createdAt: user.createdAt,
          xp: user.xp,
          level: user.level,
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak,
          totalSessions: user.totalSessions,
          totalFocusTime: user.totalFocusTime,
          publicProfile: user.publicProfile,
          showOnLeaderboard: user.showOnLeaderboard,
          shareFocusStats: user.shareFocusStats,
          friendsCanSeeActivity: user.friendsCanSeeActivity,
        },
      });
    } catch (error) {
      if (handleAuthError(res, error)) return;
      console.error('Get me error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

authRouter.delete('/auth/account', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    await prisma.$transaction(async (tx) => {
      // Hand off any groups this user created before removing them. A study
      // group is shared content — the other members shouldn't lose it because
      // the creator left. The longest-standing remaining member inherits it.
      // Groups with no one else left fall through to the schema's onDelete
      // cascade, which is also the backstop that stops account deletion from
      // ever failing on a foreign key again.
      const createdGroups = await tx.studyGroup.findMany({
        where: { createdBy: userId },
        select: { id: true },
      });

      for (const group of createdGroups) {
        const successor = await tx.studyGroupMember.findFirst({
          where: { groupId: group.id, userId: { not: userId } },
          orderBy: { joinedAt: 'asc' },
          select: { userId: true },
        });
        if (successor) {
          await tx.studyGroup.update({
            where: { id: group.id },
            data: { createdBy: successor.userId },
          });
        }
      }

      // These two tables intentionally carry no foreign keys, so nothing removes
      // their rows automatically. Clean them up explicitly rather than leaving
      // orphaned records pointing at a deleted account.
      await tx.userBlock.deleteMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      });
      await tx.postReport.deleteMany({ where: { reportedBy: userId } });

      // Everything else cascades from the User relations in schema.prisma.
      await tx.user.delete({ where: { id: userId } });
    });

    res.json({ success: true, data: { message: 'Account deleted' } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Delete account error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.patch('/auth/me/profile', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const schema = z.object({
      avatarEmoji: z.string().min(1).max(16),
    });
    const { avatarEmoji } = schema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarEmoji },
    });

    res.json({ success: true, data: { avatarEmoji: user.avatarEmoji } });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Profile update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.patch('/auth/me/privacy', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const schema = z.object({
      privacySetting: z.enum(['public', 'friends_only', 'private']).optional(),
      publicProfile: z.boolean().optional(),
      showOnLeaderboard: z.boolean().optional(),
      shareFocusStats: z.boolean().optional(),
      friendsCanSeeActivity: z.boolean().optional(),
    });
    const data = schema.parse(req.body);

    if (Object.keys(data).length === 0) {
      res.status(400).json({ success: false, error: 'No privacy fields provided' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
    });

    res.json({
      success: true,
      data: {
        privacySetting: user.privacySetting,
        publicProfile: user.publicProfile,
        showOnLeaderboard: user.showOnLeaderboard,
        shareFocusStats: user.shareFocusStats,
        friendsCanSeeActivity: user.friendsCanSeeActivity,
      },
    });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Privacy update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

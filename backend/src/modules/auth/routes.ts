import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyAccessToken,
  authenticate,
} from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { handleAuthError, handleZodError } from '../../lib/errors';
export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

authRouter.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, username, password } = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
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
          privacySetting: user.privacySetting,
          createdAt: user.createdAt,
          xp: user.xp,
          level: user.level,
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak,
          totalSessions: user.totalSessions,
          totalFocusTime: user.totalFocusTime,
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
    await prisma.user.delete({ where: { id: userId } });
    res.json({ success: true, data: { message: 'Account deleted' } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Delete account error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

authRouter.patch('/auth/me/privacy', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const schema = z.object({
      privacySetting: z.enum(['public', 'friends_only', 'private']),
    });
    const { privacySetting } = schema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { privacySetting },
    });

    res.json({
      success: true,
      data: { privacySetting: user.privacySetting },
    });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Privacy update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

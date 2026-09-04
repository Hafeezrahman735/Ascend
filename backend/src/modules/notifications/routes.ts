import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { handleAuthError, handleZodError } from '../../lib/errors';
import { getPreferences, updatePreferences } from './service';

export const notificationsRouter = Router();

notificationsRouter.get('/notifications/preferences', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const prefs = await getPreferences(userId);
    res.json({ success: true, data: prefs });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Get notification prefs error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

notificationsRouter.patch('/notifications/preferences', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const schema = z.object({
      sessions: z.boolean().optional(),
      friends: z.boolean().optional(),
      goals: z.boolean().optional(),
      achievements: z.boolean().optional(),
    });
    const data = schema.parse(req.body);
    const prefs = await updatePreferences(userId, data);
    res.json({ success: true, data: prefs });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Update notification prefs error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

notificationsRouter.get('/notifications', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    // Cursor-paginated. It used to be a bare `take: 50` with no cursor, which
    // meant anything past the newest 50 was permanently unreachable through the
    // API while still sitting in the table forever — stored but unreadable, the
    // worst of both. The response shape gains `cursor` alongside the rows; the
    // client reads `data.notifications`, and older builds that read `data` as an
    // array are not a concern because this endpoint is only called by the app.
    const { cursor, limit } = z
      .object({
        cursor: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(50),
      })
      .parse(req.query);

    const rows = await prisma.notification.findMany({
      where: { userId, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const notifications = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      success: true,
      data: notifications,
      cursor: hasMore ? notifications[notifications.length - 1].createdAt.toISOString() : null,
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

notificationsRouter.post('/notifications/read-all', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    res.json({ success: true, data: { message: 'All notifications marked as read' } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Mark all read error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

notificationsRouter.post('/notifications/push-token', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const schema = z.object({ pushToken: z.string() });
    const { pushToken } = schema.parse(req.body);

    await prisma.user.update({
      where: { id: userId },
      data: { pushToken },
    });

    res.json({ success: true, data: { message: 'Push token updated' } });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Push token error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

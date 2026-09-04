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

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ success: true, data: notifications });
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

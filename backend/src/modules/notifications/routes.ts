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

/**
 * Page cursor: the last row's createdAt and id, as `<ISO>|<uuid>`.
 *
 * createdAt alone is not unique — a fan-out can write several rows in the
 * same millisecond — and a `createdAt < cursor` page boundary silently skipped
 * every row that shared the boundary row's timestamp. The id breaks the tie.
 * A bare ISO timestamp (the old format) is still accepted.
 */
const cursorSchema = z
  .string()
  .transform((raw, ctx) => {
    const [at, id] = raw.split('|');
    const createdAt = new Date(at);
    const isIso = z.string().datetime({ offset: true }).safeParse(at).success;
    const idOk = id === undefined || z.string().uuid().safeParse(id).success;
    if (!isIso || Number.isNaN(createdAt.getTime()) || !idOk) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid cursor' });
      return z.NEVER;
    }
    return { createdAt, id: id ?? null };
  });

notificationsRouter.get('/notifications', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    // `data` stays a bare array so app builds already installed keep working;
    // `cursor` and `unreadCount` ride beside it. The client used to page only
    // its first fetch and count unread within it, so a badge never read above
    // the page size and older notifications could not be reached.
    const { cursor, limit } = z
      .object({
        cursor: cursorSchema.optional(),
        limit: z.coerce.number().int().min(1).max(50).default(50),
      })
      .parse(req.query);

    const before = cursor
      ? cursor.id
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : { createdAt: { lt: cursor.createdAt } }
      : {};

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId, ...before },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    const hasMore = rows.length > limit;
    const notifications = hasMore ? rows.slice(0, limit) : rows;
    const last = notifications[notifications.length - 1];

    res.json({
      success: true,
      data: notifications,
      cursor: hasMore ? `${last.createdAt.toISOString()}|${last.id}` : null,
      unreadCount,
    });
  } catch (error) {
    if (handleZodError(res, error)) return;
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

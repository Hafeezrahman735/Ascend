import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { authenticateMiddleware } from './middleware/auth';
import { Router } from 'express';
import { eventBus, EventTypes } from './middleware/eventBus';
import { authRouter } from './modules/auth/routes';
import { goalsRouter } from './modules/goals/routes';
import { socialRouter } from './modules/social/routes';
import { achievementsRouter } from './modules/achievements/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { analyticsRouter } from './modules/analytics/routes';
import { setupTaskRoutes } from './modules/tasks/routes';
import { taskGoalsRouter } from './modules/taskgoals/routes';
import { setupTimerHandlers } from './modules/timer/handlers';
import { setupTimerRoutes } from './modules/timer/routes';
import { setupSocialSocket } from './modules/social/socket';
import { handleSessionCompleted as handleGoalsSession } from './modules/goals/handler';
import { handleSessionCompleted as handleAchievementsSession, handleGoalCompleted as handleAchievementsGoal, handleFriendGoalCompleted } from './modules/achievements/handler';
import { handleAllNotifications } from './modules/notifications/handler';
import { handleSocialBroadcast, handleFeedCreate } from './modules/social/handler';
import { emitFriendRequestReceived, emitFriendRequestAccepted } from './modules/social/socket';

// CORS allow-list. Native mobile apps send no Origin header (CORS is a browser
// rule) so they are unaffected; this gates browser / Expo-web clients.
// Override in any environment with CORS_ORIGINS (comma-separated).
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : process.env.NODE_ENV === 'production'
    ? ['https://your-app-domain.com'] // update with your real web origin(s)
    : [
        'http://localhost:8081',
        'exp://localhost:8081',
        'http://localhost:19006',
        'http://localhost:3001',
      ];

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});

// Trust the single reverse proxy (Render/Heroku/nginx) so rate-limit and logging
// see the real client IP from X-Forwarded-For instead of the proxy's address.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Throttle credential endpoints against brute-force / enumeration.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please try again later.' },
});
app.use(['/auth/login', '/auth/register', '/auth/refresh'], authLimiter);

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { service: 'ascend-backend', status: 'healthy' } });
});

app.use('/', authRouter);
app.use('/', authenticateMiddleware);
app.use('/', goalsRouter);
app.use('/', socialRouter);
app.use('/', achievementsRouter);
app.use('/', notificationsRouter);
app.use('/', analyticsRouter);

const taskRouter = Router();
setupTaskRoutes(taskRouter);
app.use('/', taskRouter);
app.use('/', taskGoalsRouter);

const timerNamespace = io.of('/timer');
const socialNamespace = io.of('/social');

setupTimerHandlers(timerNamespace);

const timerRouter = Router();
setupTimerRoutes(timerRouter, timerNamespace);
app.use('/', timerRouter);

setupSocialSocket(socialNamespace);

eventBus.on(EventTypes.SESSION_COMPLETED, (payload) => {
  handleGoalsSession(payload).catch((err) => console.error('Goals handler error:', err));
  handleAchievementsSession(payload).catch((err) => console.error('Achievements handler error:', err));
  handleAllNotifications(EventTypes.SESSION_COMPLETED, payload).catch((err) => console.error('Notifications handler error:', err));
  handleSocialBroadcast(io, EventTypes.SESSION_COMPLETED, payload).catch((err) => console.error('Social broadcast error:', err));
});

eventBus.on(EventTypes.GOAL_COMPLETED, (payload) => {
  handleAchievementsGoal(payload).catch((err) => console.error('Achievements goal handler error:', err));
  handleAllNotifications(EventTypes.GOAL_COMPLETED, payload).catch((err) => console.error('Notifications handler error:', err));
});

eventBus.on(EventTypes.ACHIEVEMENT_UNLOCKED, (payload) => {
  handleAllNotifications(EventTypes.ACHIEVEMENT_UNLOCKED, payload).catch((err) => console.error('Notifications handler error:', err));
});

eventBus.on(EventTypes.FRIEND_SESSION_STARTED, (payload) => {
  handleAllNotifications(EventTypes.FRIEND_SESSION_STARTED, payload).catch((err) => console.error('Notifications handler error:', err));
  handleSocialBroadcast(io, EventTypes.FRIEND_SESSION_STARTED, payload).catch((err) => console.error('Social broadcast error:', err));
});

eventBus.on(EventTypes.FRIEND_GOAL_COMPLETED, (payload) => {
  handleFriendGoalCompleted(payload).catch((err) => console.error('Achievements friend goal handler error:', err));
  handleAllNotifications(EventTypes.FRIEND_GOAL_COMPLETED, payload).catch((err) => console.error('Notifications handler error:', err));
  handleSocialBroadcast(io, EventTypes.FRIEND_GOAL_COMPLETED, payload).catch((err) => console.error('Social broadcast error:', err));
});

eventBus.on(EventTypes.FEED_CREATE, (payload) => {
  handleFeedCreate(io, payload as never).catch((err) => console.error('Feed create error:', err));
});

eventBus.on(EventTypes.FRIEND_REQUEST_SENT, (payload) => {
  emitFriendRequestReceived(io, payload as never);
});

eventBus.on(EventTypes.FRIEND_REQUEST_ACCEPTED, (payload) => {
  emitFriendRequestAccepted(io, payload as never);
});

// Centralised error handler — must be registered after all routes. Catches
// errors thrown from any route so a single failure returns 500 instead of
// hanging the connection.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled request error:', err);
  if (res.headersSent) return;
  res.status(500).json({ success: false, error: 'Internal server error' });
});

server.listen(Number(config.PORT), () => {
  console.log(`Ascend backend running on port ${config.PORT}`);
});

// Keep the process alive on unexpected errors instead of letting one rejected
// promise or stray exception take the whole server down.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Graceful shutdown so in-flight requests finish before the process exits
// (Render sends SIGTERM on deploy/restart).
function shutdown(signal: string): void {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;

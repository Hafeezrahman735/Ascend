import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { loadAchievementCatalogue } from './lib/achievementCatalogue';
import { authenticateMiddleware } from './middleware/auth';
import { Router } from 'express';
import { eventBus, EventTypes } from './middleware/eventBus';
import { authRouter } from './modules/auth/routes';
import { socialRouter } from './modules/social/routes';
import { achievementsRouter } from './modules/achievements/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { analyticsRouter } from './modules/analytics/routes';
import { setupTaskRoutes } from './modules/tasks/routes';
import { taskGoalsRouter } from './modules/taskgoals/routes';
import { calendarRouter, calendarPublicRouter } from './modules/calendar/routes';
import { setupTimerHandlers } from './modules/timer/handlers';
import { setupTimerRoutes } from './modules/timer/routes';
import { setupSocialSocket } from './modules/social/socket';
import { handleSessionCompleted as handleAchievementsSession } from './modules/achievements/handler';
import { handleAllNotifications } from './modules/notifications/handler';
import { handleSocialBroadcast, handleFeedCreate } from './modules/social/handler';
import { emitFriendRequestReceived, emitFriendRequestAccepted } from './modules/social/socket';

// CORS allow-list. Native mobile apps send no Origin header (CORS is a browser
// rule) so they are unaffected; this gates browser / Expo-web clients.
// Override in any environment with CORS_ORIGINS (comma-separated).
// In production, an unset CORS_ORIGINS means "no browser origin is allowed"
// rather than a placeholder domain nobody owns. Native clients send no Origin
// header, so they keep working either way; a real web origin is opt-in via the
// env var. The old default silently pointed at your-app-domain.com, which looked
// configured but allowed nothing real.
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : process.env.NODE_ENV === 'production'
    ? []
    : [
        'http://localhost:8081',
        'exp://localhost:8081',
        'http://localhost:19006',
        'http://localhost:3001',
      ];

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.warn(
    '[cors] No CORS_ORIGINS set — browser clients will be blocked. ' +
      'Native mobile apps are unaffected. Set CORS_ORIGINS if you serve a web client.',
  );
}

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
// Verbose per-request logging is a dev aid; skip it in production to save CPU/IO.
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Throttle credential endpoints against brute-force / enumeration.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please try again later.' },
});
app.use(['/auth/login', '/auth/register'], authLimiter);

// /auth/refresh is deliberately NOT on the credential limiter. It is not a
// guessing surface — it requires possession of a valid refresh token — but it IS
// called by every active client roughly every 15 minutes. Sharing the strict
// login bucket meant a handful of users behind one carrier NAT could exhaust it
// and start failing each other's token refreshes.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many refresh attempts. Please try again later.' },
});
app.use('/auth/refresh', refreshLimiter);

// Bounds how much focus time one account can bank per hour. Combined with the
// per-session cap in modules/timer/routes.ts this puts a hard ceiling on XP and
// leaderboard standing, without constraining honest use (a real user completes
// well under 60 sessions an hour). Keyed by user, not IP — mobile clients share
// carrier IPs, so IP-keying would throttle unrelated people together.
const sessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // Always a user id: the limiter is mounted behind authenticateMiddleware, so
  // an unauthenticated request never reaches it. Deliberately not falling back
  // to req.ip — express-rate-limit rejects raw IP keys (IPv6 subnet handling),
  // and IP is the wrong bucket here anyway.
  keyGenerator: (req) => req.userId,
  message: { success: false, error: 'Too many sessions submitted. Please try again later.' },
});

// Broad backstop for everything else. Generous enough that normal use never
// touches it, but it stops a single client hammering post creation, search or
// follow — none of which had any limit at all. Keyed by IP because it also
// covers unauthenticated paths; per-user limits are applied separately where
// they matter (see sessionLimiter).
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' },
});

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { service: 'ascend-backend', status: 'healthy' } });
});

// After /health so uptime checks are never throttled.
app.use(generalLimiter);

app.use('/', authRouter);
// Google redirects a browser to the OAuth callback with no Authorization header,
// so it must be mounted BEFORE the auth middleware. It identifies the user from
// the OAuth `state` parameter instead.
app.use('/', calendarPublicRouter);
app.use('/', authenticateMiddleware);
app.use('/', socialRouter);
app.use('/', achievementsRouter);
app.use('/', notificationsRouter);
app.use('/', analyticsRouter);

const taskRouter = Router();
setupTaskRoutes(taskRouter);
app.use('/', taskRouter);
app.use('/', taskGoalsRouter);
app.use('/', calendarRouter);

const timerNamespace = io.of('/timer');
const socialNamespace = io.of('/social');

setupTimerHandlers(timerNamespace);

const timerRouter = Router();
setupTimerRoutes(timerRouter, timerNamespace);
// Mounted after authenticateMiddleware so the limiter can key on req.userId.
app.use('/timer/complete', sessionLimiter);
app.use('/', timerRouter);

setupSocialSocket(socialNamespace);

eventBus.on(EventTypes.SESSION_COMPLETED, (payload) => {
  handleAchievementsSession(payload).catch((err) => console.error('Achievements handler error:', err));
  handleAllNotifications(EventTypes.SESSION_COMPLETED, payload).catch((err) => console.error('Notifications handler error:', err));
  handleSocialBroadcast(io, EventTypes.SESSION_COMPLETED, payload).catch((err) => console.error('Social broadcast error:', err));
});

// Replaces the removed GOAL_COMPLETED wiring. Same user-facing outcome — a
// "Goal Achieved!" notification — but sourced from TaskGoal, the goal system
// users can actually reach.
eventBus.on(EventTypes.TASK_GOAL_COMPLETED, (payload) => {
  handleAllNotifications(EventTypes.TASK_GOAL_COMPLETED, payload).catch((err) => console.error('Notifications handler error:', err));
});

eventBus.on(EventTypes.ACHIEVEMENT_UNLOCKED, (payload) => {
  handleAllNotifications(EventTypes.ACHIEVEMENT_UNLOCKED, payload).catch((err) => console.error('Notifications handler error:', err));
});

eventBus.on(EventTypes.FRIEND_SESSION_STARTED, (payload) => {
  handleAllNotifications(EventTypes.FRIEND_SESSION_STARTED, payload).catch((err) => console.error('Notifications handler error:', err));
  handleSocialBroadcast(io, EventTypes.FRIEND_SESSION_STARTED, payload).catch((err) => console.error('Social broadcast error:', err));
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

eventBus.on(EventTypes.POST_CREATED, (payload) => {
  handleAllNotifications(EventTypes.POST_CREATED, payload).catch((err) => console.error('Notifications handler error:', err));
});

// Unknown paths. Without this they fall through to authenticateMiddleware's
// mount at '/', so a typo'd URL answered 401 "No token provided" instead of 404
// — confusing to debug and misleading in logs.
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Centralised error handler — must be registered after all routes. Catches
// errors thrown from any route so a single failure returns 500 instead of
// hanging the connection.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled request error:', err);
  if (res.headersSent) return;
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Warm the static achievement catalogue into memory at boot so session/goal
// events serve it from RAM instead of re-querying on every request. Non-fatal:
// the accessor lazy-loads on first use if this fails.
loadAchievementCatalogue().catch((err) => console.error('Achievement catalogue warm-up failed:', err));

server.listen(Number(config.PORT), () => {
  console.log(`Ascend backend running on port ${config.PORT}`);
});

// A rejected promise we forgot to catch is recoverable — log it and carry on.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// An uncaught exception is NOT recoverable. Execution was abandoned partway
// through some unknown call stack, so locks, transactions and in-memory state
// may all be inconsistent. Staying alive here just serves corrupted results
// until someone notices. Log, close the listener so in-flight requests finish,
// then exit non-zero and let Railway restart a clean process.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception — shutting down:', err);
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000).unref();
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

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
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
import { setupTaskRoutes } from './modules/tasks/routes';
import { taskGoalsRouter } from './modules/taskgoals/routes';
import { timeReportRouter } from './modules/timereport/routes';
import { calendarRouter, calendarPublicRouter } from './modules/calendar/routes';
import { setupTimerHandlers } from './modules/timer/handlers';
import { setupTimerRoutes } from './modules/timer/routes';
import { handleSessionCompleted as handleAchievementsSession } from './modules/achievements/handler';
import { handleAllNotifications } from './modules/notifications/handler';
import { recordActivityEvent } from './lib/activityLog';
import { isEmailConfigured } from './lib/email';

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

// The integration suite drives every request from 127.0.0.1, so the whole
// suite shares ONE rate-limit bucket. At 30 registrations per 15 minutes it
// started failing whichever test file happened to run last, which is a
// non-deterministic failure that has nothing to do with the code under test.
// Gated strictly on NODE_ENV === 'test', which only src/test/env.ts sets.
const skipInTests = () => process.env.NODE_ENV === 'test';

// Throttle credential endpoints against brute-force / enumeration.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
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
  skip: skipInTests,
  message: { success: false, error: 'Too many refresh attempts. Please try again later.' },
});
app.use('/auth/refresh', refreshLimiter);

// Password reset request. Two limiters, because they stop different things.
//
// By IP, at the same 30/15min the credential endpoints use: this is the volume
// control, and it is the one that stops a single host firing resets at a list of
// addresses to probe which ones exist.
const resetIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { success: false, error: 'Too many attempts. Please try again later.' },
});

// By EMAIL, much tighter. Without this, the IP limiter alone still allows 30
// reset mails to ONE person's inbox in a quarter of an hour, which is
// harassment rather than enumeration and is a documented abuse of this
// endpoint. Five in fifteen minutes is well past what an honest user retrying a
// slow email needs.
//
// Keyed on the address itself, normalised the same way the route normalises it
// so casing cannot be used to buy extra attempts. Falls back to the IP when the
// body has no usable address, since express-rate-limit requires a key and a
// malformed request must not become the free lane.
const resetEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  keyGenerator: (req) => {
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    return typeof raw === 'string' && raw.trim()
      ? `email:${raw.trim().toLowerCase()}`
      : ipKeyGenerator(req.ip ?? '');
  },
  // Answers with the same shape the route does, so hitting the limit is not
  // itself a signal that the address exists.
  handler: (_req, res) => {
    res.json({
      success: true,
      data: { message: "If an account exists for this email, we've sent a reset link." },
    });
  },
});

app.use('/auth/forgot-password', resetIpLimiter, resetEmailLimiter);

// Redeeming a token is a guessing surface like login, so it gets the credential
// limiter's SHAPE — but its own instance, not authLimiter itself. Sharing that
// instance would share the bucket: someone who just failed login several times,
// which is the exact reason a person reaches for a password reset, could find
// the recovery path already spent. The two budgets have to be independent.
const resetRedeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { success: false, error: 'Too many attempts. Please try again later.' },
});
app.use('/auth/reset-password', resetRedeemLimiter);

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

const taskRouter = Router();
setupTaskRoutes(taskRouter);
app.use('/', taskRouter);
app.use('/', taskGoalsRouter);
app.use('/', timeReportRouter);
app.use('/', calendarRouter);

const timerNamespace = io.of('/timer');

setupTimerHandlers(timerNamespace);

const timerRouter = Router();
setupTimerRoutes(timerRouter, timerNamespace);
// Mounted after authenticateMiddleware so the limiter can key on req.userId.
app.use('/timer/complete', sessionLimiter);
app.use('/', timerRouter);

eventBus.on(EventTypes.SESSION_COMPLETED, (payload) => {
  handleAchievementsSession(payload).catch((err) => console.error('Achievements handler error:', err));
  handleAllNotifications(EventTypes.SESSION_COMPLETED, payload).catch((err) => console.error('Notifications handler error:', err));
});

// Replaces the removed GOAL_COMPLETED wiring. Same user-facing outcome — a
// "Goal Achieved!" notification — but sourced from TaskGoal, the goal system
// users can actually reach.
eventBus.on(EventTypes.TASK_GOAL_COMPLETED, (payload) => {
  handleAllNotifications(EventTypes.TASK_GOAL_COMPLETED, payload).catch((err) => console.error('Notifications handler error:', err));
});

// Persists the personal activity log that GET /activity reads and the Tasks
// tab's Recent Activity card renders. Same table as before; what went away is
// the socket fan-out beside it, which had no listener.
eventBus.on(EventTypes.FEED_CREATE, (payload) => {
  recordActivityEvent(payload as never).catch((err) => console.error('Activity log error:', err));
});

eventBus.on(EventTypes.ACHIEVEMENT_UNLOCKED, (payload) => {
  handleAllNotifications(EventTypes.ACHIEVEMENT_UNLOCKED, payload).catch((err) => console.error('Notifications handler error:', err));
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

// Integration tests import this module for its exported `app` and let supertest
// bind its own ephemeral port. Listening here too would fight for the port and
// leave a live handle open after the suite finishes.
if (process.env.NODE_ENV !== 'test') {
  server.listen(Number(config.PORT), () => {
    console.log(`Ascend backend running on port ${config.PORT}`);

    // Deliberately loud, and deliberately at boot rather than at send time.
    // Unconfigured SMTP is a supported state (see lib/email.ts), but it is a
    // SILENT one: password reset still answers "if that account exists we sent a
    // link" and content-report alerts still resolve, while no mail leaves the
    // building. Two things then fail invisibly — users cannot recover accounts,
    // and the 24-hour moderation commitment in the Terms has nothing behind it.
    // This line is the only chance to notice before a user does.
    if (!isEmailConfigured()) {
      console.warn(
        '[startup] SMTP is NOT configured. Password-reset emails and content-report ' +
          'alerts will be silently dropped. Set SMTP_HOST, SMTP_USER, SMTP_PASS and ' +
          'EMAIL_FROM to enable them.',
      );
    }
  });
}

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

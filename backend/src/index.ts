import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors({
  origin: [
    'http://localhost:8081',
    'exp://localhost:8081',
    'http://localhost:19006',
    'http://localhost:3001',
  ],
  credentials: true,
}));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { service: 'pomodoro-backend', status: 'healthy' } });
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

server.listen(Number(config.PORT), () => {
  console.log(`Pomodoro backend running on port ${config.PORT}`);
});

export default app;

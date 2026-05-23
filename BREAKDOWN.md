# Complete Codebase Breakdown

## WHAT IS BUILT AND WORKING

### Fully Implemented End-to-End Features

1. **User Registration/Login** — Register with email+username+password, login, JWT access token (15m) + refresh token (7d), auto-refresh on 401
2. **Timer Focus Session** — Start/pause/resume/skip/complete a focus session with real-time sync via Socket.IO
3. **Timer Progress Ring** — Animated SVG circle with Reanimated, shows countdown in MM:SS
4. **Break Transitions** — After completing a focus session, auto-transitions to short_break (or long_break every 4th pomodoro). Break can be skipped back to idle
5. **Session Persistence** — Completed focus sessions saved to PostgreSQL with duration, task label, and timestamp
6. **Streak Tracking** — Consecutive day streak automatically incremented on session completion
7. **Daily/Weekly Goals** — Create goals (pomodoro count or hours target), progress auto-incremented per session, goal completion triggered when target met
8. **9 Achievement Checks** — first-tomato, on-fire, century, marathon, social-butterfly, consistency-king, early-bird, night-owl, speed-runner all checked on session completion
9. **In-app Notifications** — Notification records created in DB for session_completed, break_completed, goal_completed, achievement_unlocked, friend_started, friend_goal
10. **Friend Requests** — Send request by username, accept/decline, list pending, remove friend
11. **Social Feed** — Last 50 focus sessions from user + friends, with live `friend:session_started` events prepended via socket
12. **Weekly Leaderboard** — Rank users by pomodoros this week (top 100)
13. **Streak Leaderboard** — Rank users by current streak (top 100)
14. **User Search** — Search users by username (case-insensitive, min 2 chars, max 20 results)
15. **Privacy Settings** — public/friends_only/private, enforced on achievement viewing
16. **Achievement Gallery** — View unlocked+locked achievements for any user (privacy-respecting)
17. **Achievement Sharing** — Toggle `isShared` on individual user achievements
18. **Analytics** — Daily/weekly breakdown, yearly heatmap, peak hours distribution, friend comparison, lifetime summary
19. **Push Token Registration** — POST endpoint to register Expo push token per user
20. **Social Broadcast** — When a friend starts or completes a focus session, live event pushed to friends' sockets
21. **Dark/Light Mode** — Theme-aware styling via `useColorScheme()`, separate color tokens for dark and light

### All REST API Endpoints (34 total)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check |
| POST | `/auth/register` | No | Register new user |
| POST | `/auth/login` | No | Login |
| POST | `/auth/refresh` | No | Refresh access token |
| POST | `/auth/logout` | Yes | Logout (deletes all refresh tokens) |
| GET | `/auth/me` | Yes | Get current user profile |
| PATCH | `/auth/me/privacy` | Yes | Update privacy setting |
| POST | `/goals` | Yes | Create goal (daily/weekly) |
| GET | `/goals` | Yes | List active goals with progress |
| GET | `/goals/progress` | Yes | Aggregated progress (daily count, weekly hours, streak) |
| PUT | `/goals/:id` | Yes | Update goal |
| DELETE | `/goals/:id` | Yes | Soft-delete goal |
| POST | `/social/friends/request` | Yes | Send friend request |
| POST | `/social/friends/accept` | Yes | Accept friend request |
| GET | `/social/friends/requests` | Yes | List pending requests |
| GET | `/social/friends` | Yes | List accepted friends |
| DELETE | `/social/friends/:id` | Yes | Remove friend |
| GET | `/social/feed` | Yes | Recent sessions (user + friends, latest 50) |
| GET | `/social/leaderboard/weekly` | Yes | Weekly pomodoro leaderboard (top 100) |
| GET | `/social/leaderboard/streak` | Yes | Streak leaderboard (top 100) |
| GET | `/social/users/search?q=` | Yes | Search users by username |
| GET | `/achievements/:userId` | Yes | List achievements for user |
| PATCH | `/achievements/:id/share` | Yes | Toggle share on user achievement |
| GET | `/notifications` | Yes | List last 50 notifications |
| PATCH | `/notifications/:id/read` | Yes | Mark notification as read |
| PATCH | `/notifications/read-all` | Yes | Mark all notifications as read |
| GET | `/notifications/unread-count` | Yes | Unread notification count |
| POST | `/notifications/push-token` | Yes | Register Expo push token |
| GET | `/analytics/daily?days=N` | Yes | Daily breakdown (default 7, max 90) |
| GET | `/analytics/weekly` | Yes | Weekly breakdown (last 13 weeks) |
| GET | `/analytics/heatmap` | Yes | Yearly heatmap data |
| GET | `/analytics/peak-hours` | Yes | Hourly distribution |
| GET | `/analytics/comparison` | Yes | User vs friend average (7 days) |
| GET | `/analytics/summary` | Yes | Lifetime stats |

### All Socket.IO Events

#### Client → Server (`/timer` namespace)

| Event | Payload | Triggered by |
|-------|---------|-------------|
| `timer:start` | `{ taskLabel?: string; customDuration?: number }` | TimerScreen: handleStart |
| `timer:pause` | (none) | TimerScreen: handlePause |
| `timer:resume` | (none) | TimerScreen: handleResume |
| `timer:skip` | (none) | TimerScreen: handleSkip |
| `timer:complete` | (none) | TimerScreen — on complete timer flow |

#### Server → Client (`/timer` namespace)

| Event | Payload | When |
|-------|---------|------|
| `timer:sync` | `TimerState` (full state object) | On connect, on every state change |
| `timer:error` | `{ message: string }` | On server-side error |

#### Client → Server (`/social` namespace)

| Event | Payload | Triggered by |
|-------|---------|-------------|
| `social:status` | `{ status: string }` | (Not wired in mobile — dead event) |

#### Server → Client (`/social` namespace)

| Event | Payload | When |
|-------|---------|------|
| `friend:status` | `{ userId: string; status: string }` | On social:status event (dead — no mobile listener) |
| `friend:session_completed` | `{ userId, username, durationSeconds, taskLabel, completedAt }` | On session.completed EventBus event |
| `friend:session_started` | `{ userId, taskLabel, startedAt }` | On friend.session_started EventBus event |

### All Mobile Screens

| Route | Screen | Renders |
|-------|--------|---------|
| `(auth)/login` | LoginScreen | Email + password form, login button, link to register |
| `(auth)/register` | RegisterScreen | Email + username + password + confirm form, register button, link to login |
| `(tabs)/index` | TimerScreen | Animated SVG progress ring, countdown, task input, play/pause/skip buttons, pomodoro dots, today count, friends focusing horizontal list |
| `(tabs)/goals` | GoalsScreen | Today's goal card (sessions/target), weekly card (sessions, hours, target), streak card (current/longest), recent sessions list |
| `(tabs)/social` | SocialScreen | Three tabs: Friends (list with status dots), Feed (session cards), Requests (accept/reject). Add friend modal with search |
| `(tabs)/leaderboard` | LeaderboardScreen | Toggle between Weekly Pomodoros and Streak rankings. Trophy icons for top 3, "You" label on current user |
| `(tabs)/profile` | ProfileScreen | User avatar initial, stats row (sessions/hours/streak), achievement grid (6 unlocked + 3 locked), settings gear, logout |
| `settings` | SettingsScreen | Notification toggles (local state only), timer duration +/- buttons (local state only), privacy display, back button |
| `achievement/[id]` | AchievementDetailScreen | Back button, grouped FlatList: Unlocked items (icon, title, desc, share button), Locked items (dimmed, lock icon) |
| `friend/[id]` | FriendProfileScreen | Friend avatar (static "?"), stats (sessions, hours, streak), back button |

### All Zustand Stores

**useAuthStore** — `{ user, isAuthenticated, isLoading, error }` + `login, register, logout, loadUser, clearError`

**useTimerStore** — `{ userId, phase, phaseType, elapsedSeconds, totalSeconds, isRunning, taskLabel, pomodorosCompleted, startedAt, pausedAt, isConnected, error }` + `connect, disconnect, startTimer, pauseTimer, resumeTimer, skipTimer, completeTimer, setTaskLabel`

**useSocialStore** — `{ friends[], friendRequests[], feed[], weeklyLeaderboard[], streakLeaderboard[], myWeeklyRank, myStreakRank, isLoading, error }` + `connect, disconnect, loadFriends, loadFriendRequests, sendFriendRequest, acceptFriendRequest, removeFriend, searchUsers, loadFeed, loadWeeklyLeaderboard, loadStreakLeaderboard`

### All EventBus Events (Internal)

| Event | Emitted By | Payload | Listeners |
|-------|-----------|---------|-----------|
| `session.completed` | `timer/handlers.ts` → `completeFocusPhase()` | `{ userId, sessionId, type, durationSeconds, taskLabel, completedAt }` | goals, achievements, notifications, social |
| `goal.completed` | `goals/handler.ts` | `{ userId, goalId, goalType, targetValue, period }` | achievements, notifications |
| `achievement.unlocked` | `achievements/handler.ts` | `{ userId, achievementId, slug, title, unlockedAt }` | notifications |
| `friend.session_started` | `timer/handlers.ts` → `timer:start` handler | `{ userId, taskLabel, startedAt }` | notifications, social |
| `friend.goal_completed` | **(NEVER EMITTED)** | `{ userId, goalType }` | notifications |

---

## DATA FLOW

### Pomodoro Session Journey: Start → Notification

```
1. User taps Start on TimerScreen
   └─ Haptics.impactAsync(Medium)
   └─ timerStore.startTimer(taskInput || undefined)
        └─ socket.emit('timer:start', { taskLabel })

2. Backend: timer:start handler (timer/handlers.ts)
   └─ Creates/updates in-memory TimerState (phase='focus', isRunning=true, startedAt=Date.now())
   └─ namespace.to(room).emit('timer:sync', state)

3. Mobile: timer:sync received
   └─ timerStore sets all TimerState fields

4. [User completes session or taps complete/skip]

5. Backend: timer:complete handler → completeFocusPhase()
   └─ Increments pomodorosCompleted
   └─ prisma.session.create({ userId, type:'focus', durationSeconds, taskLabel, completedAt })
   └─ eventBus.emit('session.completed', { userId, sessionId, type, durationSeconds, taskLabel, completedAt })
   └─ Transitions state to break phase
   └─ namespace.to(room).emit('timer:sync', state)

6. EventBus: session.completed has 4 listeners running in parallel:

   a. goals/handler.ts → handleSessionCompleted()
      └─ For each active goal:
           └─ Upserts goalProgress (currentCount++)
           └─ If target met: marks completedAt, emits 'goal.completed'
      └─ Upserts streak (increment if consecutive day, reset if gap)

   b. achievements/handler.ts → handleSessionCompleted()
      └─ Fetches all 9 achievements
      └─ For each unlocked achievement not yet earned: creates userAchievement, emits 'achievement.unlocked'

   c. notifications/handler.ts → handleAllNotifications()
      └─ prisma.notification.create({ userId, type:'session_completed', title, body })
      └─ If user has pushToken: Expo.sendPushNotificationsAsync([{ to, title, body }])

   d. social/handler.ts → handleSocialBroadcast()
      └─ Finds user's accepted friendships
      └─ For each friend: io.of('/social').to(`user:${friendId}`).emit('friend:session_completed', { userId, username, durationSeconds, taskLabel })

7. Mobile SocialScreen: receives friend:session_completed
   └─ (No listener in socialStore for this event — event is not handled client-side)
```

### Friend Request Flow

```
1. User opens Social tab → Friends/Requests tabs
2. User taps "Add Friend" button
   └─ Modal opens with search input
   └─ User types (>= 2 chars) → socialStore.searchUsers(query)
        └─ GET /social/users/search?q={query}
        └─ Returns matching users (excludes self)

3. User taps "Add" on search result
   └─ socialStore.sendFriendRequest(username)
        └─ POST /social/friends/request { username }
        └─ Backend: Creates friendship record (status='pending')

4. Target user opens Social tab → Requests tab
   └─ socialStore.loadFriendRequests()
        └─ GET /social/friends/requests → returns pending requests with requester info

5. Target user taps "Accept"
   └─ socialStore.acceptFriendRequest(requestId)
        └─ POST /social/friends/accept { requestId }
        └─ Backend: Updates friendship status to 'accepted'
        └─ socialStore reloads friends + requests

6. Both users see each other in Friends tab
```

### Achievement Unlock Flow

```
1. User completes a focus session
2. eventBus emits 'session.completed'
3. achievements/handler.ts handleSessionCompleted() runs:
   └─ prisma.achievement.findMany() → all 9 achievements
   └─ prisma.userAchievement.findMany() → already-unlocked set
   └─ prisma.session.count() → totalSessions
   └─ prisma.streak.findUnique() → currentStreak
   └─ prisma.session.findMany({ today }) → today's sessions
   └─ prisma.friendship.findMany() → friendCount
   └─ For each achievement not yet unlocked:
        └─ Checks condition (totalSessions >= N, streak >= N, etc.)
        └─ If met: prisma.userAchievement.create()
        └─ eventBus.emit('achievement.unlocked', { ... })

4. EventBus listener (notifications): Creates DB notification record
```

---

## DATA STORAGE AND STRUCTURE

### Prisma Models (10 tables)

| Model | Table | Key Fields | Relations | Indexes |
|-------|-------|-----------|-----------|---------|
| User | `users` | id (uuid PK), username (unique), email (unique), passwordHash, avatarUrl?, privacySetting (enum), pushToken? | → RefreshToken[], Session[], Goal[], GoalProgress[], Streak[], Friendship[] (x2), UserAchievement[], Notification[] | (PK, unique constraints) |
| RefreshToken | `refresh_tokens` | id (uuid PK), userId (FK), token (unique), expiresAt | → User | — |
| Session | `sessions` | id (uuid PK), userId (FK), type (varchar), durationSeconds, taskLabel?, completedAt | → User | `[userId, completedAt]` |
| Goal | `goals` | id (uuid PK), userId (FK), type ('daily'/'weekly'), targetCount?, targetHours?, isActive | → User, GoalProgress[] | — |
| GoalProgress | `goal_progress` | id (uuid PK), goalId (FK), userId (FK), currentCount, periodStart, periodEnd, completedAt? | → Goal, User | `[userId, periodStart]` |
| Streak | `streaks` | id (uuid PK), userId (FK, unique), currentStreak, longestStreak, lastSessionDate? | → User | (unique userId) |
| Friendship | `friendships` | id (uuid PK), requesterId (FK), addresseeId (FK), status ('pending'/'accepted') | → User (x2) | `[requesterId, status]`, `[addresseeId, status]` |
| Achievement | `achievements` | id (uuid PK), slug (unique), title, description, icon, conditionType, conditionValue | → UserAchievement[] | — |
| UserAchievement | `user_achievements` | id (uuid PK), userId (FK), achievementId (FK), unlockedAt, isShared | → User, Achievement | `@@unique([userId, achievementId])` |
| Notification | `notifications` | id (uuid PK), userId (FK), type, title, body, isRead | → User | `[userId, isRead]` |

### In-Memory Data

| What | Where | Type | Risk |
|------|-------|------|------|
| Timer state | `timer/handlers.ts` → `timerStates` | `Map<string, TimerState>` | **Lost on server restart**. No persistence for active timers. |
| Socket.IO rooms | Socket.IO runtime | Ephemeral room membership | Rebuilt on each socket connect |
| JWT signing keys | `config.ts` → `process.env` | Environment variables | Persists in env, not memory |
| Access/refresh tokens | `services/api.ts` → module-level vars | `string \| null` | **Lost on app restart**. User must re-login. |

### PostgreSQL Data

All persistent data: users, sessions, goals, progress, streaks, friendships, achievements, user achievements, notifications, refresh tokens.

### Index Strategy

| Index | Purpose | Queries Optimized |
|-------|---------|-------------------|
| `sessions(userId, completedAt)` | Analytics lookups (daily/weekly/heatmap), feed queries | `GET /analytics/*`, `GET /social/feed`, `GET /goals/progress` |
| `friendships(requesterId, status)` | Friends list for a user | `GET /social/friends`, `POST /social/friends/request` |
| `friendships(addresseeId, status)` | Pending requests for a user | `GET /social/friends/requests`, `POST /social/friends/accept` |
| `goal_progress(userId, periodStart)` | Goal progress lookups | `GET /goals`, `GET /goals/progress`, goals handler |
| `notifications(userId, isRead)` | Unread count, notification list | `GET /notifications`, `GET /notifications/unread-count` |

---

## WHAT IS NOT YET IMPLEMENTED

### Missing Features (Original Spec Has No Code)

- **No Pomodoro Task Completion** — When a timer completes, the "complete" flow works on the backend but the client-side timer screen only sets up an interval that checks if elapsed >= total seconds. It does not auto-call `completeTimer()` — the user must tap skip or complete (there's no visible "complete" button in the UI, only skip, and skip calls `timer:skip` which calls `completeFocusPhase()` for focus phases).
- **No break timer auto-countdown** — The backend manages break phase state transitions, but the mobile doesn't automatically tick down during breaks. The interval only checks for completion, it doesn't decrement.
- **No goal creation UI** — There's no screen to create a goal. The Goals screen only shows progress from existing goals. Goals must be created via API (curl/Postman).
- **No goal edit/delete UI** — `PUT /goals/:id` and `DELETE /goals/:id` exist on the backend but have no mobile UI.
- **No notification list UI** — The backend has notification endpoints but there's no NotificationScreen. Notification is only used internally.
- **No settings persistence** — Toggles (push, sound, haptic) and timer duration settings on the Settings screen are local state only — not saved to backend or AsyncStorage.
- **No push token registration from app** — `POST /notifications/push-token` exists but the mobile never calls it.
- **No friend profile detail** — The friend profile screen (`friend/[id].tsx`) shows the same stats as the user profile but with a hardcoded "?" avatar.
- **No goal progress update on feed** — `GET /social/feed` only returns sessions, not goal completions or achievement unlocks.
- **`friend.goal_completed` event never emitted** — The EventBus event type exists and is listened for by notifications, but no code ever emits it.

### Deleted UI Components (from Phase 3)

The following component files were deleted during refactoring because they were never imported by any screen:

- `components/achievements/BadgeCard.tsx`
- `components/achievements/Confetti.tsx`
- `components/charts/BarChart.tsx`
- `components/charts/Heatmap.tsx`
- `components/charts/RingChart.tsx`
- `components/social/FeedItem.tsx`
- `components/social/FriendCard.tsx`
- `components/timer/PhaseIndicator.tsx`
- `components/timer/SessionDots.tsx`
- `components/timer/TimerControls.tsx`
- `components/timer/TimerRing.tsx`
- `components/ui/Button.tsx`
- `components/ui/Card.tsx`

### Deleted Hooks (from Phase 3)

- `hooks/useTimer.ts`
- `hooks/useGoals.ts`
- `hooks/useSocial.ts`
- `hooks/useAchievements.ts`

These were never imported by any screen. All state management goes through Zustand stores directly in the screen files.

### Placeholder Screens

- **Settings screen** — No backend integration. Toggle changes and timer duration changes are local-only and have no effect on the timer.
- **Friend profile screen** — Only shows session count, hours, and streak. No friend bio, achievements, or remove friend action.
- **Goals screen** — Shows progress read-only. No create/edit/delete UI for goals.

### Timer Persistence Gap

Timer state (`timerStates` Map in `timer/handlers.ts`) is purely in-memory. If the backend restarts:
1. All active timers are abandoned
2. All users must reconnect and start fresh
3. Completed sessions already saved to DB before the restart are preserved
4. No Redis, database, or file-based fallback exists

### Push Notification Setup Steps Still Needed

1. Create an Expo project at [expo.dev](https://expo.dev)
2. Set `EXPO_PROJECT_ID` in `backend/.env` and `mobile/constants/Config.ts`
3. Wire push token registration flow in mobile Settings screen
4. Test push delivery on a physical device

### Screens That Call Non-Existent or Wrong Endpoints

- **`friend/[id].tsx`** calls `GET /analytics/summary` which returns the *current authenticated user's* summary, not the friend's summary. The friend summary endpoint does not exist on the backend.
- **`goals.tsx`** calls `GET /social/feed` to show "Recent Sessions" — this works but is semantically misplaced (it shows sessions from ALL friends, not goal-specific data).
- **`achievement/[id].tsx`** calls `GET /achievements/:id` where `:id` is a user ID. The route param `id` comes from `useLocalSearchParams<{ id: string }>()`, and the profile screen navigates with `auth.user?.id`. This route name is misleading — `achievement/[id]` is actually a user's achievement gallery, not a single achievement detail.

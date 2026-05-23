# Pomodoro Accountability App

A full-stack Pomodoro timer with social accountability features. Track focus sessions, set goals, compete on leaderboards, earn achievements, and share progress with friends.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile framework | React Native 0.81.5 + Expo SDK 54 |
| Navigation | Expo Router 6 (file-based, React Navigation 7 under the hood) |
| Styling | NativeWind v4 (Tailwind CSS for React Native) |
| Animations | React Native Reanimated 4 with Worklets |
| State (client) | Zustand 4 |
| Icons | @expo/vector-icons (Ionicons) |
| Charts | Inline SVG via react-native-svg |
| Backend runtime | Node.js + Express 4 + tsx (dev) |
| Database ORM | Prisma 5 + PostgreSQL |
| Auth | JWT (access + refresh tokens), bcrypt |
| Real-time | Socket.IO 4 (timer `/timer`, social `/social`) |
| Validation | Zod 3 |
| Push notifications | Expo Notifications + expo-server-sdk |
| Haptics | expo-haptics |
| Bundler (mobile) | Metro |
| Language | TypeScript (strict) |

## Data Flow & State Architecture

The app maintains **two completely separate tracking systems** that never cross-contaminate.

### 1. Global Daily Productivity (timerStore)

Tracks **everything the user focused on today** — sessions with or without a task, quick focus sessions, freeform Pomodoros. Powers the focus page stats, weekly graph, and daily analytics.

**State:** `timerStore.ts`
- `globalSessions: number` — total focus sessions completed today
- `globalTotalTime: number` — total focus seconds accumulated today
- `lastSessionDate: string | null` — YYYY-MM-DD of most recent completion
- `pomodoroRounds: number` — pomodoro round counter within current task selection (NOT daily total)
- `status: TimerStatus` — 'idle' | 'running' | 'paused' | 'break'
- `timeLeft: number` — countdown seconds remaining
- `settings: Settings` — work/break durations

**Persistence rule:** `globalSessions` and `globalTotalTime` survive app restart via AsyncStorage keys `timer:globalSessions` and `timer:globalTotalTime`. If `lastSessionDate` differs from today on hydrate, both reset to 0 (new day).

### 2. Task-Specific Productivity (taskStore)

Tracks **time and sessions attributed to a single task**. Powers task progress bars, estimation accuracy, days worked.

**State:** `taskStore.ts`
- `tasks: Task[]` — full list of user tasks
- `selectedTaskId: string | null` — the task currently selected for *future session attribution* (NOT the source of displayed productivity stats)
- Per-task fields: `sessionsOnTask`, `totalTimeOnTask`, `sessionDates` (string[] of YYYY-MM-DD), `estimatedMinutes`, `priority`

**Persistence rule:** These are **frontend-only** counters incremented by `incrementTaskSession()`. They reset to 0 when `fetchTasks()` runs because the backend Prisma schema has no corresponding columns. They are NOT the source of truth for daily/weekly productivity.

### 3. Local Session History (sync.ts)

A persistent record of every completed focus session, used to compute daily aggregates and the weekly bar graph without waiting for server round-trips.

**Data:** `AsyncStorage` key `session:history` stores `SessionRecord[]` — each record has `completedAt`, `durationSeconds`, `taskLabel`, `taskId`, `type`.

**Daily aggregates** are stored under `session:daily:YYYY-MM-DD` keys with `totalSessions`, `totalMinutes`, `focusMinutes`.

**Merge strategy:** On tasks page load, `mergeWithServerSessions()` fetches from `GET /timer/sessions` and appends any server-only records not already in local history (deduped by `completedAt:durationSeconds:taskId` composite key).

---

## Key Behaviors

### Timer Completion Flow

```
Timer reaches 0
    ↓
complete() fires
    ↓
ALWAYS update global counters:
    globalSessions += 1
    globalTotalTime += sessionDuration
    ↓
ALWAYS persist to AsyncStorage:
    timer:sessions, timer:lastSessionDate,
    timer:globalSessions, timer:globalTotalTime
    ↓
ALWAYS write local SessionRecord (sync.ts):
    recordCompletedSession({...})
    ↓
IF selectedTaskId exists:
    taskStore.incrementTaskSession(id, duration)
    ↓
ALWAYS POST /timer/complete (server sync)
    (sends completedAt, actualElapsedSeconds,
     taskId, plannedDurationSeconds)
```

The order guarantees global counters and local history update **even if** the API call fails. The task update is a guarded side effect.

### Task Change (Timer Reset)

When the user picks a different task from the task picker modal:

```
selectTask(newId) fires
    ↓
timerStore.subscribe detects selectedTaskId change
    ↓
Timer resets:
    status → 'idle'
    timeLeft → workDuration
    sessions → 0
    ↓
globalSessions / globalTotalTime UNCHANGED
```

The daily counters are never affected by task switching. Only the pomodoro round counter (`pomodoroRounds`) resets, so the user starts a fresh focus cycle for the new task.

### Daily Counter Reset

On app start:
1. `hydrate()` reads stored `globalSessions`, `globalTotalTime`, `lastSessionDate` from AsyncStorage
2. Compares `lastSessionDate` against today's date
3. If different day → both counters reset to 0
4. If same day → restored from stored values

### Weekly Bar Graph (tasks.tsx)

The "This Week" section reads from local `sessionHistory` (not from `taskStore`):
- Accumulates `durationSeconds / 3600` per day for `'focus'`-type sessions
- Bars show focus hours (e.g. "2.5" hours), not session count
- Summary cards show total sessions count and total focus hours independently
- Data includes sessions with no task attribution

---

## Zustand Stores Overview

| Store | File | Purpose | Persistence |
|-------|------|---------|-------------|
| `useTimerStore` | `stores/timerStore.ts` | Timer countdown, global daily counters, pomodoro rounds | AsyncStorage (settings, global counters, last session date) |
| `useTaskStore` | `stores/taskStore.ts` | Task CRUD, per-task session stats, selected task ID | AsyncStorage only for local session history (via sync.ts) |
| `useAuthStore` | `stores/authStore.ts` | JWT tokens, user profile, login/logout | SecureStore (tokens) |
| `useSocialStore` | `stores/socialStore.ts` | Friends, feed, leaderboard, friend requests | AsyncStorage (cached friend list) |

---

## System Architecture

**Monolithic backend** on a single Express server (port 3001) with Socket.IO namespaces for real-time features. All data in one PostgreSQL database. The mobile app connects via REST API and WebSocket.

```
Mobile App (Expo)
    │  REST (axios wrapper) ──────────┐
    │  Socket.IO (/timer, /social) ───┤
    ▼                                  ▼
Express Server ── Socket.IO ── PostgreSQL
    │
    └── EventEmitter (internal bus)
         ├── goals/handler.ts (streak + goal progress)
         ├── achievements/handler.ts (achievement checks)
         ├── notifications/handler.ts (DB + push)
         └── social/handler.ts (live broadcast)
```

Timer state lives in a **server-side in-memory Map** (`Map<userId, TimerState>`). On server restart, all active timers are lost.

## Folder Structure

```
.
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # 10 models, 5 composite indexes
│   │   └── seed.ts                # 9 achievement seeds
│   ├── src/
│   │   ├── config.ts              # Zod-validated env config
│   │   ├── index.ts               # Express + Socket.IO server entry
│   │   ├── lib/
│   │   │   ├── prisma.ts          # Singleton PrismaClient
│   │   │   └── errors.ts          # Auth/Zod error response helpers
│   │   ├── middleware/
│   │   │   ├── auth.ts            # JWT verify, sign, auth middleware
│   │   │   └── eventBus.ts        # EventEmitter singleton + types
│   │   └── modules/
│   │       ├── auth/routes.ts     # 6 endpoints (register/login/refresh/logout/me/privacy)
│   │       ├── goals/routes.ts    # 5 endpoints (CRUD + progress)
│   │       ├── goals/handler.ts   # EventBus: session → streak + goal progress
│   │       ├── social/routes.ts   # 9 endpoints (friends, feed, leaderboard, search)
│   │       ├── social/handler.ts  # EventBus: broadcast to friend sockets
│   │       ├── social/socket.ts   # Socket.IO /social namespace
│   │       ├── achievements/routes.ts  # 2 endpoints (list, share)
│   │       ├── achievements/handler.ts # EventBus: check & unlock achievements
│   │       ├── notifications/routes.ts # 5 endpoints (CRUD + push-token)
│   │       ├── notifications/handler.ts# EventBus: store + push notification
│   │       ├── analytics/routes.ts     # 6 endpoints (daily, weekly, heatmap, peak, comparison, summary)
│   │       └── timer/handlers.ts       # Socket.IO /timer namespace (5 events)
│   ├── package.json
│   └── tsconfig.json
│
├── mobile/
│   ├── app/
│   │   ├── _layout.tsx            # Root layout (GestureHandler, Stack)
│   │   ├── (auth)/
│   │   │   ├── _layout.tsx        # Auth stack layout
│   │   │   ├── login.tsx          # Login screen
│   │   │   └── register.tsx       # Register screen
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx        # Tab layout (5 tabs)
│   │   │   ├── index.tsx          # Timer screen (focus countdown, progress ring)
│   │   │   ├── goals.tsx          # Goals screen (daily/weekly/streak cards)
│   │   │   ├── social.tsx         # Social screen (friends, feed, requests, search)
│   │   │   ├── leaderboard.tsx    # Leaderboard (weekly/streak, top 100)
│   │   │   └── profile.tsx        # Profile (stats, achievements, logout)
│   │   ├── settings.tsx           # Settings modal (toggle placeholders)
│   │   ├── friend/[id].tsx        # Friend profile (stats only)
│   │   └── achievement/[id].tsx   # Achievement gallery (unlocked + locked)
│   ├── constants/
│   │   ├── Colors.ts              # Theme colors
│   │   └── Config.ts              # URLs, timer defaults
│   ├── services/
│   │   ├── api.ts                 # REST client (fetch wrapper, auto-refresh tokens)
│   │   └── socket.ts             # Socket.IO client connections
│   ├── stores/
│   │   ├── authStore.ts           # Zustand: user, auth state
│   │   ├── timerStore.ts          # Zustand + Socket.IO: timer sync
│   │   └── socialStore.ts         # Zustand + Socket.IO + API: friends/feed/leaderboard
│   ├── types/
│   │   └── index.ts               # TypeScript interfaces (16 types)
│   ├── babel.config.js            # nativewind jsxImportSource, reanimated plugin
│   ├── metro.config.js            # withNativeWind
│   ├── tailwind.config.js         # Custom colors, nativewind preset
│   ├── global.css                 # Tailwind directives
│   ├── app.config.ts              # Expo config (name, icons, plugins, push)
│   └── package.json
│
├── .eslintrc.js                   # ESLint (TypeScript plugin, no-explicit-any error)
├── .prettierrc                    # Prettier config
├── .gitignore
├── tsconfig.base.json             # Shared TypeScript config
├── turbo.json                     # Turborepo pipeline (unused)
└── package.json                   # Root workspace config (unused, kept for reference)
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Server port |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | **Yes** | — | 32+ char random string for access tokens |
| `JWT_REFRESH_SECRET` | **Yes** | — | 32+ char random string for refresh tokens |
| `DEFAULT_FOCUS_MINUTES` | No | `25` | Default focus session length |
| `DEFAULT_SHORT_BREAK_MINUTES` | No | `5` | Default short break length |
| `DEFAULT_LONG_BREAK_MINUTES` | No | `15` | Default long break length |
| `EXPO_PROJECT_ID` | No | placeholder | Expo project ID for push notifications |

### Mobile (`mobile/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `EXPO_PUBLIC_API_URL` | `http://<lan-ip>:3001` | Backend API URL |
| `EXPO_PUBLIC_WS_URL` | `http://<lan-ip>:3001` | Timer WebSocket URL |
| `EXPO_PUBLIC_SOCIAL_WS_URL` | `http://<lan-ip>:3001` | Social WebSocket URL |
| `EXPO_PUBLIC_EXPO_PROJECT_ID` | placeholder | Expo project ID |

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ running locally
- npm or pnpm
- Expo CLI: `npm install -g expo-cli`
- Expo Go app on phone (for testing)

### Database

```bash
# 1. Create the PostgreSQL database
psql -U postgres -c "CREATE DATABASE pomodoro;"
# or
createdb pomodoro

# 2. Configure backend/.env (copy from backend/.env.example)
#    DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/pomodoro

# 3. Run migrations
cd backend
npx prisma migrate dev --name init

# 4. Seed achievements
npm run db:seed
```

### Backend

```bash
cd backend
cp .env.example .env     # edit with your values
npm install
npm run dev              # starts on port 3001
```

### Mobile

```bash
cd mobile
npm install
npx expo start           # starts Metro bundler
```

Mobile env variables can be set in `mobile/.env` or will default to `http://192.168.1.100:3001` (update `constants/Config.ts` defaults for your LAN IP).

## Placeholders Checklist

Before shipping, replace these values:

- [ ] **`backend/.env`**: Replace `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` with 32+ char random strings
- [ ] **`mobile/app.config.ts`**: Replace `com.yourname.pomodoroapp` with real iOS bundle ID and Android package
- [ ] **`mobile/constants/Config.ts`**: Update `EXPO_PUBLIC_API_URL` defaults to production URLs
- [ ] **`mobile/constants/Config.ts`**: Replace `EXPO_PROJECT_ID` with real ID from [expo.dev](https://expo.dev)
- [ ] **Push notifications**: Sign up at [expo.dev](https://expo.dev), create a project, get the project ID
- [ ] **Seed data**: Run `npm run db:seed` to populate achievement definitions

## Daily Development Workflow

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Mobile
cd mobile
npx expo start --clear

# On code change, the backend auto-restarts via tsx watch.
# The mobile hot-reloads via Metro.
```

### Database changes

```bash
# After modifying prisma/schema.prisma:
cd backend
npx prisma migrate dev --name description_of_change
npx prisma generate
```

## Troubleshooting

### Timer shows "Unable to connect to timer server"

The backend is not running or the mobile can't reach it. Check:
1. `cd backend && npm run dev` is running
2. The IP in `mobile/constants/Config.ts` matches your machine's LAN IP
3. No firewall blocking port 3001
4. Socket.IO connection uses websocket transport only — verify no proxy strips upgrade headers

### Friend requests not showing up

The social socket connects independently. If the backend restarts, reconnect by switching tabs in the Social screen.

### Timer state lost

Timer state (elapsed time, running state) is stored in server memory only. If the backend restarts:
- Active timers are lost
- Completed sessions ARE saved to PostgreSQL via `completeFocusPhase()`
- The in-memory Map is NOT persisted (no Redis or DB fallback)

### Push notifications not arriving

1. Verify `EXPO_PROJECT_ID` is set in `backend/.env` and `mobile/constants/Config.ts`
2. Call `POST /notifications/push-token` from the app (not yet wired in Settings screen)
3. Expo push notifications only work on physical devices, not emulators

### Metro bundling fails after dependency changes

```bash
cd mobile
npx expo start --clear
```

### Turborepo / monorepo config is a stub

The root `package.json`, `turbo.json`, and root `.env.example` reference an older microservices design that was not implemented. The monorepo tooling (turborepo) is not wired to the backend or mobile packages. Run each project independently as shown above.

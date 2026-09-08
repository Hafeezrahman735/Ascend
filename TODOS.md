# TODOS

Deferred work, with the context that produced it. Written by gstack plan reviews.

## From /autoplan CEO review — achievements & rank (2026-08-18)

- [ ] **Backend scheduler + streak-at-risk push.** No scheduled job of any kind exists in
      `backend/src` (verified: zero matches for cron/setInterval/scheduler/bullmq). The
      Expo push pipeline and four notification preference categories are already built
      and nothing ever fires them. Flagged by the CEO voice as plausibly the highest-value
      retention work available. User decision 2026-08-18: noted, not actioned.
- [ ] **Authored `tier` + `criteriaType` columns on Achievement.** Blocked behind the
      `0_init` migration baseline. Phase 2 of the achievements plan.
- [ ] **`AchievementCategory.SOCIAL` enum value.** Needs a migration; required before any
      social-milestone achievements can be seeded.
- [ ] **Product alternatives never compared against the achievements brief:** AI Quick
      Capture (`docs/ascend-ai-quick-capture-plan.md`), Live Activity / lock-screen
      countdown, tag/category time breakdown, search beyond people.
- [ ] **Decide the fate of `mobile/lib/badges.ts`.** Third progression concept alongside
      Level and Rank, computed client-side.
- [ ] **Pivot doc conflict.** `docs/ascend-pivot-ai-organizer-positioning.md` is marked ON
      HOLD as of 2026-08-18. Revisit before starting its Phase 5.

## Carried from the production-readiness plan (eager-tumbling-fog.md)

- [ ] **Supply local Postgres password in `backend/.env.test`.** Blocks the entire backend
      integration suite, and therefore blocks the project's own definition of done
      ("every new route needs an integration test") for all backend work.
- [ ] **Prisma migration baseline (`0_init`) + switch pre-deploy to `migrate deploy`.**
      `_prisma_migrations` does not exist in the Railway database.
- [ ] **Sentry + structured logging.** `morgan` is disabled in production; 84 route-level
      catch blocks swallow errors into `console.error`.

## Carried from the Expo SDK 54 -> 57 upgrade

- [ ] **Fix the 21 React Compiler findings and restore the rules to `error`.**
      `eslint-config-expo@57` (React 19.2) added compiler-aware hook rules that flag
      pre-existing patterns: `set-state-in-effect` (12), `refs` read during render (7),
      `purity` / `Date.now()` during render (1), `immutability` (1). Concentrated in
      `app/(tabs)/tasks.tsx` (10), `app/group/[id].tsx` (4), `app/(tabs)/social.tsx` (2),
      `components/profile/AchievementsRow.tsx` (2). Held at `warn` in
      `mobile/eslint.config.js` so the SDK bump stayed attributable; none are new
      breakage. Restore to `error` once fixed.
- [ ] **Bump Node to >= 24.3.0.** `react-native@0.86.2` and `@react-native/codegen@0.86.2`
      declare `node: ^20.19.4 || ^22.13.0 || ^24.3.0 || >= 25.0.0`; the dev machine is on
      v24.2.0 and npm prints EBADENGINE on every install.
- [ ] **`@expo/vector-icons` is deprecated as of SDK 56.** Still on 15.0.3 and imported in
      27 files. Migrate to the scoped `@react-native-vector-icons/*` packages via the
      codemod. Not urgent — it still resolves on 57 — but it will not survive forever.
- [ ] **iOS minimum is now 16.4** (was 15.1). Anyone still on iOS 15 drops off at the next
      App Store build. Product call, not a technical one.

## Carried from the dev-build migration

- [ ] **Local Android loop is deferred, not rejected.** `npx expo run:android` would give
      free, queue-less, ~2-5 minute native rebuilds, but the machine is not close: `java
      -version` is **14.0.2** (Gradle needs JDK 17+) and both `ANDROID_HOME` and
      `ANDROID_SDK_ROOT` are unset. Realistically Android Studio + JDK + env setup is half
      a day for ~8-12 GB on disk. Worth doing if iOS build-queue waits become the
      bottleneck; it buys nothing for Live Activities, which are iPhone-only.
- [ ] **`docs/README.md` still has stale references** beyond the ones fixed here: it
      mentions `mobile/app.config.ts`, `tsconfig.base.json`, `turbo.json`, a root
      `package.json` and `.eslintrc.js` (none exist), and states the bundle id is
      `com.ascend.app` (actual: `com.hafeezrahman.ascend`). Wrong but inert — a doc audit,
      not part of the build work.
- [ ] **`eas-cli` is 20.3.0 locally; 22.2.0 is current.** `eas.json` only requires
      `>= 20.3.0`, so this is not blocking.

## Deferred from /autoplan — adaptive session duration (2026-08-24)

Full plan: `docs/plans/adaptive-session-plan.md`

### Pre-existing bug, found during review (not caused by this feature)

- **Goals linked to recurring habits under-count sessions and focus time.**
  `backend/src/lib/goalProgress.ts:106` filters `isArchived: false` on the
  SESSION groupBy, and `POST /tasks/spawn-recurring` archives every non-today
  instance (`tasks/routes.ts:288-292`). So such a goal can only ever see today
  instance. Fix: drop `isArchived` from the *session* filter only; keep it on
  the task-count groupBy, where excluding archived instances is correct.
  Time already spent does not become un-spent when a row is archived.

### Deferred scope

- Telemetry on estimate fill-rate. Premise P1 (that enough tasks carry an
  estimate) is unverified, and nothing in the repo measures it. Two queries:
  coverage, and the distribution of actual/estimate.
- Reconcile the two existing estimate-progress bars before adding a third
  representation: `tasks.tsx:388-393` (8px, raised/primary, captioned) vs
  `index.tsx:573-598` (6px, inactive/accent, bare %).
- Verify the contrast ratios flagged in Phase 2 (subtext ~3.5:1 dark /
  ~3.7:1 light; CURRENT TASK eyebrow ~3.4:1 via opacity 0.5). Measured by a
  review agent, NOT independently confirmed.
- jest-expo + AsyncStorage mocks so `timerStore` freeze/persist/reconstruct
  can be tested automatically instead of by hand.

---

## Events (shipped to staging, `e7b5c27`..`acf5a20`)

### Deliberate limits, so they are decisions and not oversights

- **No location, description, or reminders on an Event.** Location is the
  most-expected field on anything called an event; its absence is a choice, not
  an omission. Add it when someone asks.
- **Overnight events are unrepresentable.** `endMinutes` caps at 1439, so
  11pm–1am is rejected rather than clamped to 11pm–11:59pm. Supporting them
  means either a second date or a duration field, and neither is worth it until
  a user hits the wall.
- **Week and Month rows are still read-only.** Only Day view (grid + agenda) and
  the Planning sections can open an item. This is consistent with the rest of
  the calendar, which has never been tappable — but it does mean an event seen
  in Week view has no path to editing except switching views.
- **No unscheduled events or notes from Planning.** The sheets offer the seven
  days of the anchored week, which makes the "created outside the loaded range
  and vanishes on refetch" failure unreachable. An unscheduled note would need
  the `notes` slice broken out of being derived from `items`, plus a
  reconciliation rule between two independent slices.

### Follow-ups

- `mobile/.expo/devices.json` is tracked but is local machine state; it dirties
  `git status` on every run. Should be gitignored and removed from the index.
- Two new `react-hooks/set-state-in-effect` warnings (EventFormSheet,
  NoteFormSheet) — the "reset the form when the sheet opens" pattern, identical
  to the one TaskFormModal already had. Fixing all three means either keying the
  sheets to remount or rendering them conditionally, which costs the dismiss
  animation. Held at `warn` with the other 79.

---

## Goal stats modal (shipped to staging) — deferrals from the /autoplan review

Full review: `docs/plans/goal-stats-modal.md`. Recorded here because each was a
decision, not an oversight.

### F1 — a habit-linked goal reports contradictory numbers

`loadGoalCounts` filters `isArchived: false` for task counts
(`backend/src/lib/goalProgress.ts:95`) but deliberately does NOT for sessions
(`:117-123`, with a comment explaining why: time already spent does not become
un-spent when its row is archived).

A goal linked to a **recurring habit** therefore counts only today's live
instance in `linkedTaskCount` while counting every session ever in
`actualSessions` and `totalFocusSeconds`. It renders as "0/1 tasks · 47 sessions
· 23h focus", and `taskProgress` swings between 0 and 1 as instances spawn and
archive each day.

The stats modal **labels** this ("all time, every instance") rather than fixing
it. The real fix is a decision about what a habit-linked goal's progress should
*mean* — arguably it should be sessions-only, since the task count is
structurally meaningless for a habit — and that changes behaviour for every
existing goal of that shape. Too big to ride along with a display feature.

### Goal completion is logged, never celebrated — the next feature

The strongest finding in the whole review, and mostly already built:

- `goalProgress.ts:196-227` auto-completes a goal, awards `GOAL_COMPLETION_XP`,
  emits `FEED_CREATE`, and emits `TASK_GOAL_COMPLETED` carrying
  `completedTaskCount`, `linkedTaskCount`, `actualSessions`, `targetSessions`,
  `progressMode` — the exact numbers the new modal shows.
- On mobile it surfaces only as a `RecentActivity` row
  (`components/RecentActivity.tsx:22,44`) rendered with `limit={4}` — the same
  visual weight as "Focused 25m", and pushed out of the list by the very
  sessions that completed the goal.
- `components/RewardModal.tsx` is **dead code**, zero call sites.
- `UnlockOverlay` is achievement-only.

**`TASK_GOAL_COMPLETED` has no client transport.** `index.ts:188-190` wires it
to `handleAllNotifications` only — unlike `SESSION_COMPLETED` (`:182`) and
`FRIEND_SESSION_STARTED` (`:199`), it never reaches
`handleSocialBroadcast(io, ...)`. So this is not "just a client subscriber": it
needs the server wiring, a socket handler, and an integration test.

`GoalStatsModal`'s body was built to be reusable as that overlay's content.

### Per-goal charts are possible but would disagree with the headline

`SessionRecord` (`store/sync.ts:6-13`) carries `taskId`, and `Task` carries
`taskGoalId`, so a per-goal time series is a client-side groupBy over data
already in memory — no route needed. But the join runs through the client's
task list, which **excludes archived tasks**, while the server's
`totalFocusSeconds` includes them. A sparkline built this way would undercount
and its total would not equal the number printed above it. Same defect class as
F1. `lastSessionOnGoal` accepts this gap deliberately and is used only to pick a
sentence, never to derive a displayed total.

### Two `StatBox` implementations

`components/SheetPrimitives.tsx` (icon/label/value/sub/big) and
`app/user/[id].tsx:19` (label/value). Different shapes for different surfaces;
unifying them is a separate refactor and was explicitly out of this blast radius.

### Contract coverage is a key-set assertion, not a type check

`stats.integration.test.ts` now asserts the exact key set `serializeGoal`
returns, which catches a field added on one side and not the other. It does not
check types. A shared schema (zod on both sides) would, and is the real fix.

## From /plan-eng-review — goals measured in tasks (2026-09-04)

- [x] **Goal due-date reminders + overdue state (Branch 2).** Shipped 2026-09-05.
      Local reminders fire 09:00 the day before the due date, capped at the 10
      soonest because iOS keeps at most 64 pending local notifications and that
      budget is shared with the daily reminder and the timer alarms. Rules live
      in `mobile/lib/goalReminders.ts`; `syncGoalReminders` reconciles via
      `getAllScheduledNotificationsAsync` (its first use in this codebase) and
      hangs off `persistGoals` so no mutation can forget it. Overdue goals get a
      chip and pin to the top of the list; empty goals say so.
      **Not covered, and the accepted limitation:** reminders are local, so a
      goal created on another device gets one here only after this device
      hydrates. A server-side scheduler would fix that, and would also unblock
      the streak-at-risk push above — still the largest missing piece.

## From /plan-eng-review — month heat map weights (2026-09-06)

- [ ] **Calibrate the four month-view heat map weights against a real month.**
      `UNTIMED_TASK_WEIGHT` (30), `HABIT_WEIGHT` (30), `DEADLINE_WEIGHT` (90) and
      `ALL_DAY_EVENT_WEIGHT` (180) in `mobile/lib/calendarItems.ts` are all
      invented — chosen to make a mockup look right, derived from nothing. They
      are exported constants, so each is a one-line change.
      **The concrete symptom that means they are wrong:** a day whose only item
      is a goal deadline shades DARKER than a day holding two genuine hours of
      work. That is a new lie in the shape of the old one.
      Second thing to watch: a two-hour daily habit weighs the same as a
      five-minute one, because habits are weighted flat to stop projected
      occurrences shading differently from spawned ones. Fine until long habits
      are common.
      Depends on: shipping, plus a month of real data.

## From /plan-ceo-review — App Store rejection fixes (2026-09-08)

- [ ] **Admin moderation panel.** The terms shipped with the 1.2 fix commit us in writing
      to act on reports within 24 hours by removing the content and ejecting the user.
      Nothing in `backend/src` can do either: `PostReport` and `UserBlock` only collect
      data, there is no `isAdmin` field, no admin route, and the sole deletion path is
      self-service `DELETE /auth/account`. Interim mechanism at resubmission is a
      best-effort email to the support address on report creation. Start this branch
      immediately after Apple approval.

      Design settled during the review, so it does not need re-deriving:
      - **Served by the Express backend as a web page, NOT in the app binary.** Moderation
        UI only the developer can reach inside a shipped app is what guideline 2.3.1
        (hidden features) targets; keeping it server-side removes that risk entirely, lets
        it be fixed without an App Store review cycle, and means acting on a report happens
        from a laptop rather than a phone.
      - **Auth reuses the existing JWT** (`/auth/login` + a `requireAdmin` middleware
        checking a new `User.isAdmin`), rather than an `ADMIN_TOKEN` env var. The bcrypt +
        JWT + refresh-rotation path is already built and tested, and per-action
        attribution comes free. `isAdmin` defaults false and gets flipped once by SQL.
      - **Eject is a soft ban (`bannedAt`, `bannedReason`), not a hard delete.** Reversible,
        and it preserves the evidence needed if a user appeals or Apple asks what was done.
        Critical detail: banning must delete the user's refresh tokens and the refresh path
        must reject banned users, or an ejected account keeps working until its access
        token expires.
      - Schema: `User.isAdmin/bannedAt/bannedReason`, `PostReport.status/reviewedAt/reviewedBy`.
        All additive with defaults, so they push ahead of the code safely.
      - Routes: `GET /admin/reports?status=open`, `POST /admin/posts/:id/remove`,
        `POST /admin/users/:id/ban`, `POST /admin/users/:id/unban`,
        `POST /admin/reports/:id/dismiss`. Integration test each, per the Testing Standard.
      - The page is one static HTML file, vanilla fetch and a table. No build step, no
        framework, no new dependency.

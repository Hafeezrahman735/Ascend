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

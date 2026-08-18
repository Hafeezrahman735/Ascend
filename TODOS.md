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

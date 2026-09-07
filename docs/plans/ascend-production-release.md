# Production release runbook — `staging` → `main`

Written 2026-09-06. Status: **NOT STARTED — nothing has been run against production.**

This is the first promotion to `main` since 2026-08-19. `staging` is **112 commits**
ahead, and the release carries a schema transition that cannot be applied in a
single `prisma db push`. Read the next section before running anything.

---

## Why this needs three steps instead of one

`prisma db push` applies the whole schema in one operation. The delta from `main`
to `staging` is **both** additive and destructive:

| Direction | What | Who needs it |
|---|---|---|
| ADD | `password_reset_tokens`, `events` tables | the NEW code (500s without them) |
| ADD | 5 indexes, `sessions`/`tasks` columns, `RANK` enum value | the NEW code |
| DROP | `users.level`, `users.friends_can_see_activity` | the OLD code still reads them |
| DROP | `streaks`, `friendships` tables | the OLD code still reads them |

So a single push breaks whichever side runs first:

- **push, then deploy** → production is still serving `main`'s code, which reads
  `level` and `Friendship`. Every request through those paths 500s until the
  deploy finishes.
- **deploy, then push** → the new code writes to `password_reset_tokens` and
  `events`, which do not exist yet. Password reset and the calendar 500 until the
  push finishes.

Neither window is acceptable, and the second is worse: it is user data failing to
save, not a screen failing to render.

The fix is to split the push. Step 1 applies only the additions, so both the old
and new code can run against the database at once. Step 5 removes the retired
columns once nothing reads them.

---

## The transitional schema

`backend/prisma/schema.transition.prisma` is **generated, not hand-written** (by
`scratchpad/transition.py`, reproducible). It is `schema.prisma` with the four
retired things put back: `users.level`, `users.friends_can_see_activity`,
`model Streak`, `model Friendship`.

Both properties below were **verified by `prisma migrate diff`, not assumed**:

```
main schema        → transition schema :  0 destructive, 14 additive
transition schema  → schema.prisma     :  3 DropForeignKey, 2 DropColumn, 2 DropTable
```

The first is what makes step 1 safe to run against a live production database.
The second is exactly the cleanup and nothing else.

Delete `schema.transition.prisma` after step 5. It must not outlive this release.

---

## The sequence

### Step 0 — before touching anything

- [ ] Confirm `staging` has been exercised on a device. Nothing in this release
      has been verified by a human; tests are green but that is not the same
      thing. **This is the real gate**, not the schema.
- [ ] Take a production database snapshot. Railway → the Postgres service →
      Backups. Step 5 is irreversible without one.
- [ ] Confirm which Railway environment `DATABASE_URL` points at in each shell
      you use. `backend/.env` currently points at **staging**
      (`reseau.proxy.rlwy.net:40366`), and both databases are named `railway`,
      so the URL alone will not tell you them apart. Getting this wrong in step 5
      drops production tables from a shell you thought was staging.

### Step 1 — additive-only push to production

```bash
cd backend
DATABASE_URL="<PRODUCTION_URL>" npx prisma db push \
  --schema=prisma/schema.transition.prisma
```

Adds the two tables, five indexes, new columns and the `RANK` enum value. Drops
nothing. Production keeps serving `main`'s code throughout, unaffected.

- [ ] Confirm it reports the expected additions and no drops.

### Step 2 — verify production is ready for the new code

```bash
DATABASE_URL="<PRODUCTION_URL>" npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.transition.prisma --script
```

- [ ] Empty migration = in sync. Anything else, stop and read it.

### Step 3 — seed the achievement catalogue onto RANK

```bash
DATABASE_URL="<PRODUCTION_URL>" npm run db:seed
```

Re-keys the two `level_5` / `level_10` achievement rows onto `RANK` so existing
unlocks survive. Must happen **after** step 1 (the enum value has to exist) and
**before** the `LEVEL` enum value is removed in step 6.

- [ ] Catalogue is still 26 rows.
- [ ] A user who had `level_5` still has it.

### Step 4 — merge to `main` and deploy

```bash
git checkout main && git merge --ff-only staging && git push origin main
```

Railway builds `prisma generate && tsc` and deploys. It does **not** push schema —
that is why steps 1 and 5 are manual.

- [ ] Deploy is green.
- [ ] Smoke: sign in, complete a session, open the calendar, request a password
      reset. Those four cover every table added in step 1.
- [ ] **Watch for a window before hard-refreshing anything.** Old and new code
      briefly coexist during the rollout; both work against the step-1 schema,
      which is the entire point of splitting the push.

### Step 5 — destructive cleanup (only after step 4 is verified)

Do **not** run this the same minute step 4 goes green. Let production serve real
traffic on the new code first — a day is reasonable. Until this runs, rolling
back to `main`'s previous commit is still possible; after it, it is not.

```bash
cd backend
DATABASE_URL="<PRODUCTION_URL>" npx prisma db push   # real schema.prisma
```

Drops `users.level`, `users.friends_can_see_activity`, `streaks`, `friendships`.

- [ ] `git rm backend/prisma/schema.transition.prisma` and commit.

### Step 6 — retire the `LEVEL` enum value (separate, later)

`schema.prisma` still carries `LEVEL` in `AchievementCategory` on purpose —
Postgres will not drop an enum value while any row is stamped with it. The
comment in the schema records the order. After step 3 has re-keyed those rows and
step 5 has landed, delete `LEVEL` from the enum and push again.

---

## Rollback

| Failed at | Recovery |
|---|---|
| Step 1 | Nothing to undo — it only added. Investigate and re-run. |
| Step 3 | Re-run the seed; it upserts, so it is idempotent. |
| Step 4 | Revert `main` to its previous commit and redeploy. The step-1 schema still serves the old code, because nothing was dropped. **This is why step 5 waits.** |
| Step 5 | Restore from the step-0 snapshot. There is no forward fix — the columns and their data are gone. |

---

## Known issues going into this release

Neither blocks the release; both should be understood before it.

**Integration suite was failing intermittently — believed fixed, not yet proven.**
Three tests in `activityLog.integration.test.ts` failed with `POST /timer/complete`
returning 500, in roughly one full run out of two, while passing in isolation
every time. Traced to `vitest.config.mts` carrying `poolOptions`, which **Vitest 4
removed and silently ignores** — the suite lost single-process execution during the
v4 upgrade and only printed a deprecation line. Combined with the deliberately
unawaited retention prunes in `lib/retention.ts`, a `DELETE` can still be in flight
when the next file's `beforeEach` issues a `TRUNCATE`, which takes an ACCESS
EXCLUSIVE lock.

Fixed by moving to `maxWorkers`/`minWorkers` (commit `2d37490`). Green since, but
**against a ~50% failure rate a couple of green runs is suggestive, not proof.**
If it recurs, the config bug is real and fixed regardless — look at the prunes
next. **Production never issues `TRUNCATE`, so this was a harness problem
throughout** — though the prunes swallow their own errors, so a genuine failure
there would only ever surface as a `console.warn`.

**Notification cursor can skip rows.** `GET /notifications` builds its cursor from
`createdAt.toISOString()`, which truncates Postgres microseconds to milliseconds,
then filters `createdAt < cursor`. Rows created inside the same millisecond as a
page boundary are skipped. Not reachable today — the client never sends a cursor —
but fix it with a composite `(createdAt, id)` cursor before it starts paging.

**Nothing in this release has been verified on a device.** Three days of work,
112 commits, an app rename and a schema transition, all landing at once.

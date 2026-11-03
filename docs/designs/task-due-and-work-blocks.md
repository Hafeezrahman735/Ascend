# Task due dates and work blocks

Status: built 2026-11-03 (T1-T6); staging backfill and push pending the founder's OK on the dry-run counts. Concept mockup: https://claude.ai/artifact/RcrGtNQJRATn8uFfcQTHkw · Screen mockups (reviewed design): https://claude.ai/artifact/PdVwBUbVm9ZHmpGKokfpsH

## Problem

A task has one date, `Task.dueDate`, and it does three jobs:

- **Deadline:** due chips, overdue, hero-card urgency, Today's sort (`mobile/lib/taskMetrics.ts`, `heroCard.ts`, `taskBoard.ts`).
- **Plan:** the calendar day a task sits on, its timeline block via `startMinutes/endMinutes`, the Plan screen's Late and Unscheduled (`backend/src/modules/calendar/routes.ts:156,203`, `mobile/lib/planningTasks.ts:94`, `PlanningView.tsx:519`).
- **Repeat until:** on recurring tasks (labelled so in `TaskFormModal.tsx:271`).

A time needs a due date (`tasks/routes.ts:44`), so "work Monday 9-11" can only be said by making Monday the deadline. Find a slot writes the slot's day into `dueDate` (`calendar.tsx:359`), so planning Monday for a task due Friday moves the deadline and shows the task overdue on Tuesday. A task cannot be planned on more than one day. Calendar events have no task link. No notification reads task due dates (only goal deadlines, `services/notifications.ts:369`).

## Decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| D1 APPROACH (Step 0D) | Separate deadline from plan; user's Mon+Wed / due Fri example | One `dueDate` doing three jobs | Due stays deadline; 0..N work blocks per task, one day each, optional time; Find a slot adds a block | approved | D1 answer "Due + work blocks (recommended)" |
| D2 MODE (0E) | ~20 files estimated (now ~25-30 after outside voice) | — | HOLD SCOPE | approved | D2 answer "Hold scope" (recommended was Scope reduction) |
| D3 MIGRATE (Section 1) | Existing timed one-off tasks are ambiguous | — | One block per timed one-off task on its due day with its times; due date kept | approved | D3 answer "Block + keep due date (recommended)" |
| D4 DUE-DISPLAY (Section 4) | Untimed due tasks currently listed on their due day | Task item on due day | Due day shows a deadline flag; open tasks with no block this week under Unscheduled with due chip; Late from due date only | approved | D4 answer "Flag + Unscheduled (recommended)" |
| D5 CUTOVER-TIMES (Outside voice #1) | PATCH validates the merged row (`tasks/routes.ts:303-312`); stale times read by `taskForm.ts:87`, `planVsActual.ts:83-96` | Times kept on task rows | Backfill clears one-off task times in the same transaction as the block insert; 400 only when the request itself sends times on a one-off task; to-recurring moves first block's time onto the habit and removes blocks; to-one-off turns the habit time into one block today | approved | D5 answer "Clear after copying (recommended)" |
| D6 TODAY-LIST (Outside voice #5) | Today's list keys on priority + due (`taskBoard.ts:50-70`) | Priority + due only | Tasks with a block today lead Today's list in block order, then the existing sort; hero urgency card stays deadline-only | approved | D6 answer "Planned today first (recommended)" |
| D7 SAVE-SHAPE (Outside voice #6) | Multi-request save can half-fail | Separate block routes | `blocks` list on POST/PATCH `/tasks`, replace-all in one `prisma.$transaction`; no separate block routes | approved | D7 answer "Blocks inside task save (recommended)" |

Factual corrections from the outside voice (no behaviour choice; applied within D1/D4 scope): #2 `data.id` rule, #3 Late source, #4 done tasks keep their history, #7 archived filter, #8 schema pattern, #9 Find a slot date and findSlot, #10 seeds and tests, #11 old-build claim, #14 block window. #12 (scope) kept: D1/D2 are the user's explicit choices. #13 noted.

Approval readiness: PASS (D1, D2, D3, D4, D5, D6, D7 each cite the user's actual answer above; corrections stay inside D1/D4's approved behaviour).

## Design

### Data
New table, additive, following `RecurringCompletion` (`schema.prisma:283-297`):

```
model WorkBlock {
  id           String   @id @default(cuid())
  userId       String   @map("user_id") @db.Uuid
  taskId       String   @map("task_id")
  date         String   @db.VarChar(10)          // 'YYYY-MM-DD', as Event.date
  startMinutes Int?     @map("start_minutes")    // both set or both null; null = that day, any time
  endMinutes   Int?     @map("end_minutes")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  task         Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)   // + `blocks WorkBlock[]` on Task and User (O11)
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([taskId, date, startMinutes])         // backfill idempotence; same task, day and start twice is a mistake
  @@index([userId, date])
  @@map("work_blocks")
}
```

Note: Postgres treats NULLs as distinct in a unique key, so two untimed blocks on one day are not blocked by it; the server rejects that case in validation.

- `Task.dueDate` means the deadline on one-off tasks and "repeat until" on recurring ones. Nothing else.
- One-off tasks have no `startMinutes/endMinutes` (D5). A request that sends them on a one-off task is 400 "Times live on work blocks". Recurring templates keep theirs.
- At most 100 blocks per task. Blocks of archived tasks are filtered out everywhere (`task: { isArchived: false }`): DELETE archives (`tasks/routes.ts:405-408`), so the cascade does not fire on delete.

### Routes (D7)
- `POST /tasks` and `PATCH /tasks/:id` accept `blocks: [{ date, startMinutes?, endMinutes? }]`. Present means replace all of that task's blocks inside the same `prisma.$transaction` as the task write; absent means leave them. Time pairs validated by the shared `validateSchedule` rules (`tasks/routes.ts:36`); date `YYYY-MM-DD` and a real calendar day (O11); no duplicate timed blocks (eng finding 5); no two untimed blocks on one day; ≤100. Last save wins across devices (accepted in D7).
- Converting (D5, D14, O5): only when `isRecurring` differs from the stored value. To habit: times sent in the request win, else the earliest block's (date, then start); all blocks deleted. To one-off: the form sends the block for today itself (the server derives no date); the task's times are cleared. `blocks` on a recurring task is 400.
- `GET /tasks`, `POST /tasks` and `PATCH /tasks/:id` all return each task's full `blocks` list (D11, O1). The store keeps its blocks when a response lacks the key. The form sends `blocks` only when the list changed (O10).
- `GET /calendar`:
  - `work_block` items, one per block of a non-archived one-off task. `data.id` is the **task id**; plus title, priority, times, task `isCompleted`. Keyed `taskId:date:startMinutes|anytime` (eng finding 6).
  - `task_due` items, one per non-archived dated one-off task in range, done ones included (drawn struck through, keeps today's history, outside voice #4).
  - No more one-off `task` items.

### Mobile
Every reader of calendar task items handles `work_block` and `task_due` (outside voice #2):
- `lib/calendarItems.ts`: TYPE_META, DAY_GROUP_ORDER (`:24-55`), `isRenderableCalendarItem` (`:71`, `:87`), title, done, time range (`:135`, `:161`, `:195`), `calendarItemKey` adds `blockId` for `work_block` (`:108`), `itemWeight` gives `task_due` the goal-deadline weight and untimed blocks the untimed-task weight (`:337-344`).
- `lib/calendarViews.ts` (Important deadlines from `task_due`; `taskFocusOnDay` handles several blocks), `WeekView.tsx`, `MonthView.tsx`, `DayRows.tsx` (O3; line numbers re-derived after `531bd89`).
- `lib/calendarTask.ts:18-21`, `components/calendar/TimelineView.tsx:281`, `MonthView.tsx:171`, `PlanningView.tsx:245,250`, `shared.tsx:56`, `app/(tabs)/calendar.tsx:247,282`: treat `work_block` as the task (via `data.id`) and `task_due` as a flag.
- `lib/planScreen.ts`: `weekBreakdown` counts `work_block` minutes as tasks (`:34-36`); `nextUp` uses `data.id` (`:44`, `:76`); `findSlot`/`mergedBookings` (`:152`) books blocks via `itemTimeRange`.
- `lib/planningTasks.ts`: day rows from `work_block`; Late = open one-off tasks in the **task store** whose due date is before today (outside voice #3), never from a block's day; Unscheduled = open one-off tasks with no block today or later this week, with their due chip (D4, amended by D13). A task's estimate counts once however many blocks it has; Next up and alsoToday match by task id (O9).
- `lib/planVsActual.ts`: `plannedBlocksFromCalendar` reads `work_block` and `habit_instance`; `plannedBlocksFromTasks` reads `task.blocks` for the day. Matching: task + local date, first timed block filled; a second block of the same task on the same day reads empty (outside voice #13, accepted). An untimed block claims that day's sessions on its task so they are not unplanned, with 0 planned minutes (D12).
- `lib/taskBoard.ts` (D6): `topTasks` puts tasks with a block today first, in block start order (untimed last), then the existing `compareByUrgency`.
- Task form (`TaskFormModal.tsx`, `lib/taskForm.ts`, `hooks/useTaskForm.ts`): "Due" and a "Work blocks" list with "+ Plan a block"; "Pick a due date first" goes; one save sends task + `blocks`.
- Find a slot (`calendar.tsx:359`): opens the form with a new block prefilled; never sets `dueDate`; `handleTaskChanged` (`:336-344`) follows and highlights the block's date; the save path calls `loadVisibleRange()`.
- Week/Month: block pills on work days, a flag on the due day; the flag adds no planned minutes.

### Migration (D3, D5)
Backfill script, `--dry-run` prints counts: for every non-recurring task with `dueDate` and both times, in one transaction, insert one block on the due day with those times (`ON CONFLICT DO NOTHING` on the unique key) and set the task's times to null. Due dates untouched. Re-running finds nothing to do.

Demo and seed data (outside voice #10): `backend/src/lib/demoAccount/seed.ts:231-232`, `plan.ts:321-341`, `prisma/seed-demo-users.ts:751-765` write blocks instead of task times.

## Design (design review 2026-11-03)

Every decision below has its own user answer (D18-D24). Terminology rule: **Due** is the deadline; **Work blocks** are when you plan to work. "Session" stays reserved for focus sessions.

### Wording (D18)
- Task form: `DUE` (deadline) above `WORK BLOCKS · 3h 30m` (total of timed blocks).
- Button: `+ Add work block`. Empty state: `No work blocks yet`.
- Rows: `Mon 2 Nov · 9:00–11:00` or `Mon 2 Nov · Any time`.
- Screen readers: "Work block". Plan screen keeps `Unscheduled` (= no work block ahead, D13).
- The plan-vs-actual line keeps its existing "… of 3h planned" wording.

### Task form editor (D21)
```
 DUE            [📅 Fri 6 Nov  ✕]
 WORK BLOCKS · 3h 30m
 [Mon 2 Nov] [9:00]–[11:00]            ✕
 [Wed 4 Nov] [Any time]                 ✕
 + Add work block
```
- `+ Add work block` adds a row for the next day without a block (today if none) and opens the inline date picker under it.
- Day chip and time chips reuse the form's existing date and TIME pickers; "Any time" until a start is picked; both ends or neither.
- ✕ removes the row (44pt hit area). Rows sort by date, then start. The form scrolls past about 5 rows.
- The "Pick a due date first" rule is gone; blocks need no due date.

### Today (D19)
A task leading Today's list because of a block today shows the block's time where the due chip sits (`9:00–11:00`, or `Today` when untimed), in the primary colour. Its due chip follows only when due within 6 days.

### Calendar due date (D20)
Reuse `CalendarItemRow` exactly as goal deadlines: `flag-outline` icon, `AMBER` stripe (`ROSE` when late), title, right label `Due` or `Late`.
- Day: in the Anytime list.
- Week: in the expanded lane; nothing on the folded lane.
- Month: under Important deadlines (unchanged look) and counted on the grid with the goal-deadline weight.
- Work block rows keep the task's `Colors.primary` stripe and show their start time, or nothing when untimed.

### Task sheet (D24)
Under Due, a read-only row `Work blocks · Mon 9–11, Wed any time · 3h 30m`: upcoming blocks only, at most 3, then `+N more`; hidden when there are none. No editing from the sheet.

### States (D22)
```
 FEATURE              | LOADING                | EMPTY                                 | ERROR                                         | SUCCESS            | PARTIAL
 Form work blocks     | Save spinner, disabled | "No work blocks yet" + "+ Add work block" | 400: reason under WORK BLOCKS in ROSE, bad row outlined; offline: "Not saved. Try again." alert, form stays open with edits | form closes, calendar reloads, row tint | n/a (all-or-nothing, D7)
 Plan Unscheduled     | redesign's             | section hidden                        | redesign's                                    | rows with Due chip | n/a
 Today plan line      | n/a (local)            | existing "nothing planned"            | n/a                                           | counts work blocks | untimed counted as planned (D12)
 Calendar rows        | redesign's             | redesign's                            | redesign's "Focus time unavailable · Retry"   | rows               | n/a
```

### Accessibility (D23)
- Block row: "Work block: Proposal, Monday 2 November, 9 to 11 AM" (or "any time"), plus ", done".
- Due row: "Due: Proposal, Friday 6 November"; late: "Late: Proposal, due Friday 30 October".
- Form: "Add work block"; day chip "Work block day, Monday 2 November, change"; time chips as TIME today; ✕ "Remove work block, Monday 2 November".
- Today chip: "work block today, 9 to 11 AM".
- Every touch target at least 44pt. Unit tests assert the block and due row label strings.

### Journey storyboard
```
STEP | YOU DO                              | YOU FEEL            | PLAN SPECIFIES
1    | Open "Proposal", see DUE Fri        | clear: the deadline | Due row (D1)
2    | + Add work block → Mon 9–11, + Wed  | in control          | inline list (D21)
3    | Monday: open Today                  | "right, that's now" | leads list with 9:00–11:00 (D6, D19)
4    | Focus 1h15                          | progress            | block fills "1h 15m of 2h"
5    | Tuesday: nothing late               | calm                | Late = due date only (D4)
6    | Wednesday: miss it                  | nudged, not scolded | back under Unscheduled (D13)
7    | Friday: Due row, amber              | focus               | deadline row (D20)
```

## Diagrams

```
 BEFORE                                   AFTER
 Task ─ dueDate ─┬─ deadline chips        Task ─ dueDate ── deadline only (chips, urgency, Late, flag)
                 ├─ calendar day          └─< WorkBlock (date, start?, end?)  0..N
                 └─ start/endMinutes
 GET /calendar ─ task by dueDate          GET /calendar ─ work_block (data.id = task id) + task_due
 Find a slot ─ PATCH task date+time       Find a slot ─ PATCH task { blocks: [...existing, new] }
 Today list ─ priority + due              Today list ─ blocked today first, then priority + due
```

```
 Task save: form → zod (task fields, blocks[]) → owned task? → $transaction(task write, replace blocks) → 200 → store + calendar reload
   bad input ─► 400 inline   foreign/missing ─► 404   times on one-off ─► 400   offline ─► "Not saved. Try again."   double tap ─► Save disabled
```

```
 Block state: (none) ─add─► planned ─task completed─► shown done
                                 └─task archived─► hidden (row kept)   └─task made recurring─► deleted, time moved to habit
```

```
 Deploy (staging, then production before main):
   1 schema (additive, pre-deploy db push) → 2 backfill --dry-run, read counts, real run → 3 server + app build together
 Rollback: revert code; table stays; old code shows migrated tasks untimed on their due day (times live in blocks; a reverse script copies them back if needed).
```

## Error & rescue registry

| Codepath | Failure | Rescued | User sees | Test |
|---|---|---|---|---|
| POST/PATCH /tasks with blocks | invalid date/times, two untimed same day, >100 | 400 | inline reason | integration |
| PATCH /tasks/:id | foreign or missing task | 404 | "Task not found" | integration |
| PATCH /tasks/:id one-off | request sends start/end | 400 | "Times live on work blocks" | integration |
| PATCH /tasks/:id | transaction fails midway | rolled back | "Not saved. Try again." | integration (forced failure) |
| GET /calendar | query fails | existing 500 path | calendar error state | existing |
| backfill | rerun / partial run | idempotent | counts printed | unit |
| mobile save | network | api error | "Not saved. Try again." | manual |

## Failure modes

| Codepath | Failure mode | Rescued | Test | User sees | Logged |
|---|---|---|---|---|---|
| calendarItemKey | two blocks same task same day | Y (taskId:date:start key) | unit | correct rows | n/a |
| planningTasks Late | missed block shown as Late | Y (store due date only) | unit | correct Late | n/a |
| planningTasks Late | task due before visible week missing | Y (task store) | unit | shown Late | n/a |
| Plan screen | only block this week already passed | Y (D13: Unscheduled = no block ahead) | unit | task under Unscheduled | n/a |
| editing a migrated task | 400 from stale times | Y (D5 clears times) | integration | save works | n/a |
| task store merge | PATCH response wipes blocks, next save deletes them | Y (responses include blocks; store keeps blocks; O1) | integration + unit | blocks survive | n/a |
| form save | unchanged blocks resent, any stale list deletes | Y (send only when changed; O10) | unit | nothing lost | n/a |
| replace-all | blocks older than a window deleted | Y (D11 full list) | integration | old blocks kept | n/a |
| planVsActual | untimed plan counted as unplanned | Y (D12) | unit | "planned any time" | n/a |
| planVsActual | block and stale task time both counted | Y (D5) | unit | correct minutes | n/a |
| Important deadlines | task deadlines vanish (task items gone) | Y (reads task_due; O3) | unit | deadlines listed | n/a |
| conversion | `isRecurring` resent unchanged triggers conversion | Y (change-only; O5) | integration | no surprise | n/a |
| Find a slot on focused calendar | no refetch | Y (loadVisibleRange) | manual | new block appears | n/a |
| old app build vs new server | drops work_block/task_due silently | Y (server and app ship in one push) | device check | — | n/a |

0 critical gaps remain once this plan is followed.

## Tests to write

- Integration (real DB): task create with blocks returns them; PATCH replace-all with the full list keeps old blocks (D11); PATCH of a title returns the task's blocks (O1); 400 invalid block (bad calendar day, duplicate timed, two untimed same day, >100, blocks on a recurring task); 400 one-off with times in the request; PATCH unrelated field on a migrated task succeeds; 404 cross-user; conversion both ways, and resending an unchanged `isRecurring` converts nothing (O5); forced mid-transaction failure leaves nothing changed; `GET /calendar` returns `work_block` (data.id = task id) and `task_due` (done included), no one-off `task`, nothing for archived tasks; `GET /tasks` includes every block.
- Unit: backfill idempotence and time clearing; `calendarItemKey`; `itemWeight`; `planVsActual` from blocks (focus on due day with no block is unplanned; untimed block claims sessions with 0 planned minutes, D12); `planningTasks` Late from store due date, Unscheduled = no block today or later (D13), estimate once per task (O9); `planScreen` `weekBreakdown`, `findSlot`, alsoToday by task id; `calendarViews` Important deadlines from `task_due`; `taskBoard` blocked-today-first, and its Next up / Focus-target callers (O11); `taskForm` sends `blocks` only when changed; Day "+ Task" prefill = untimed block, no due (D10); store keeps blocks when a response lacks them.
- Rewrite: `backend/src/modules/tasks/scheduling.integration.test.ts`, `mobile/lib/calendarItems.test.ts`, `calendarViews.test.ts`, `planScreen.test.ts`, `planningTasks.test.ts`, `calendarTask.test.ts`, `planVsActual.test.ts`.
- Regression contract (carried, habits unchanged): `backend/src/modules/calendar/routes.integration.test.ts:39`, `mobile/lib/planVsActual.test.ts:102` stay green unchanged.
- Acceptance (device): Mon and Wed blocks, due Fri. Monday: task leads Today's list. Focus Wednesday fills Wednesday only. Tuesday shows nothing late. Friday shows the flag. Day "+ Task" on Thursday then edit the title: the Thursday block is still there.

## Implementation Tasks
Synthesized from the CEO and eng reviews. Effort ratios: features ~30x, tests ~50x, migration ~20x. Build after `531bd89` (calendar redesign, landed). T1-T5 ship to staging as one push.

- [x] **T1 (P1, human: ~1.5d / CC: ~50min)** — backend — WorkBlock schema, blocks on POST/PATCH /tasks returning blocks, D5/D14 rules and change-only conversions, GET /tasks with every block
  - Surfaced by: D1, D5, D7, D11, D14, O1, O5, O11, eng findings 5
  - Files: backend/prisma/schema.prisma, backend/src/modules/tasks/routes.ts, backend/src/modules/tasks/scheduling.integration.test.ts
  - Verify: `npx vitest --project integration` in backend
- [x] **T2 (P1, human: ~4h / CC: ~20min)** — backend — GET /calendar emits work_block and task_due
  - Surfaced by: D4, CEO outside voice #2 #4, eng finding 6
  - Files: backend/src/modules/calendar/routes.ts, backend/src/modules/calendar/routes.integration.test.ts
  - Verify: integration test
- [x] **T3 (P1, human: ~3h / CC: ~15min)** — backend — backfill script and seed data
  - Surfaced by: D3, D5, CEO outside voice #10
  - Files: backend/src/lib/ (new backfill), backend/src/lib/demoAccount/seed.ts, backend/src/lib/demoAccount/plan.ts, backend/prisma/seed-demo-users.ts
  - Verify: unit test; `--dry-run` on staging, read counts
- [x] **T4 (P1, human: ~2d / CC: ~1h)** — mobile — calendar item readers, Plan screen, plan vs actual, Important deadlines
  - Surfaced by: D4, D12, D13, O3, O4, O9, CEO outside voice #2 #3 #9; design D20 (due row look), D23 (row labels)
  - Files: mobile/lib/calendarItems.ts, calendarViews.ts, calendarTask.ts, planScreen.ts, planningTasks.ts, planVsActual.ts, mobile/components/calendar/ (WeekView, MonthView, DayRows, DayView, TimelineView, PlanningView, shared), mobile/app/(tabs)/calendar.tsx, mobile/types/index.ts
  - Verify: `npx vitest run`, tsc, lint in mobile
- [x] **T5 (P1, human: ~1.5d / CC: ~45min)** — mobile — task form Due + Work blocks, Find a slot, Day + Task, Today list, store merge
  - Surfaced by: D1, D6, D7, D10, O1, O10, eng finding 4
  - Design: form editor, wording and states (D18, D21, D22); Today time chip (D19); task sheet line (D24); a11y labels (D23)
  - Files: mobile/components/TaskFormModal.tsx, mobile/components/TaskStatsModal.tsx, mobile/lib/taskForm.ts, mobile/hooks/useTaskForm.ts, mobile/stores/taskStore.ts, mobile/lib/taskBoard.ts, mobile/app/(tabs)/index.tsx, mobile/components/calendar/AddRow.tsx
  - Verify: unit tests; device check of the acceptance case
- [x] **T6 (P2, human: ~1h / CC: ~10min)** — docs — mark this doc built; note in plan-vs-actual-calendar.md that planned blocks now come from work blocks; update the redesign test plan's "Day: + Task" line (D10); memory note
  - Surfaced by: eng Section 2 stale diagram, D10
  - Verify: docs read back

Deploy order: schema (`db push` against staging by hand, additive) → backfill dry run, counts, real run → T1-T5 code and the app build together in one staging push.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1 schema + task routes | backend/prisma, backend/src/modules/tasks | — |
| T2 calendar route | backend/src/modules/calendar | T1 (schema) |
| T3 backfill + seeds | backend/src/lib, backend/prisma | T1 (schema) |
| T4 calendar readers | mobile/lib, mobile/components/calendar, mobile/app | T2 (item shapes) |
| T5 form, store, Today | mobile/components, mobile/lib, mobile/stores, mobile/app | T1 (response shape) |

Parallel lanes: Lane A: T1 → T2 → T3 (backend, shared prisma). Lane B: T4 and T5 after Lane A's contracts are fixed; they share mobile/lib and mobile/app, so run them sequentially.
Execution order: Lane A first. Then T4, then T5. One staging push at the end.
Conflict flags: mobile/lib (planScreen, taskBoard) and mobile/app/(tabs) are touched by both T4 and T5. Sequential implementation is the practical path for one developer.

## NOT in scope

- Drag to move blocks, block reminders, auto-suggested blocks before deadlines: not proposed (HOLD SCOPE).
- Linking calendar events to tasks: not needed once blocks exist.
- Dropping the retired one-off time columns: they are still used by recurring templates; nothing to drop.
- Filling a second same-day block of one task: kept as today's first-block rule (outside voice #13).

## What already exists

- `validateSchedule` time-pair rules (reused).
- `planVsActual` matching and fills (reused; only the block source changes).
- `goal_deadline` calendar item pattern (reused for `task_due`).
- `RecurringCompletion` schema pattern (copied for WorkBlock).

## Dream state delta

Current: one date, three meanings. This plan: Due = deadline, blocks = plan, Today leads with today's plan, plan vs actual measures blocks. 12-month ideal: the week view tells you which deadlines have enough planned time before them. This plan is the data that ideal needs.

## Reality rows

- REALITY: premise-table pass — one field, three jobs, verified in code; unverified=0 — backend/prisma/schema.prisma:219
- REALITY: already-done pass — no task-block or planned-date model exists — backend/prisma/schema.prisma:214-281
- REALITY: surface-check finding — ~25-30 files (outside voice #2 found ~10 unlisted readers, now listed) — mobile/lib/calendarItems.ts:24
- REALITY: binding-decisions pass — D1-D7 cite user answers; no conflict with plan-vs-actual D1-D9 (matching rule kept) — docs/designs/plan-vs-actual-calendar.md
- REALITY: numbers pass — 100-block cap, 30-day window are limits stated here — this doc
- REALITY: deferred-asks pass — no linked issue — TODOS.md
- REALITY: pr-count pass — one staged change set, schema first — backend/railway.json

## Completion Summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | HOLD SCOPE                                  |
  | System Audit         | dueDate = deadline + plan + repeat-until;   |
  |                      | Find a slot overwrites deadlines            |
  | Step 0               | D1 due + work blocks; D2 hold scope         |
  | Section 1  (Arch)    | 4 issues found (key collision, D3)          |
  | Section 2  (Errors)  | 7 error paths mapped, 0 GAPS                |
  | Section 3  (Security)| 1 issue found, 0 High severity              |
  | Section 4  (Data/UX) | 6 edge cases mapped, 0 unhandled (D4)       |
  | Section 5  (Quality) | 2 issues found                              |
  | Section 6  (Tests)   | Diagram produced, 0 gaps                    |
  | Section 7  (Perf)    | 1 issue found (block window)                |
  | Section 8  (Observ)  | 0 gaps found                                |
  | Section 9  (Deploy)  | 2 risks flagged                             |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 0           |
  | Section 11 (Design)  | 2 issues; /plan-design-review recommended   |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                           |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 7 rows, 0 CRITICAL GAPS                     |
  | Failure modes        | 7 total, 0 CRITICAL GAPS                    |
  | TODOS.md updates     | 0 items proposed                            |
  | Scope proposals      | 0 proposed (HOLD SCOPE)                     |
  | CEO plan             | skipped by mode                             |
  | Outside voice        | codex unavailable (not installed);          |
  |                      | native Claude fallback completed, 14 found  |
  | Lake Score           | 2/2 recommendations chose complete option   |
  | Diagrams produced    | 5 (architecture, data flow, state, deploy,  |
  |                      | rollback)                                   |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 0                                           |
  | Reality rows         | 7/7 rows, 0 unverified                      |
  +====================================================================+
```

## Eng review (2026-11-02)

Target: `docs/designs/task-due-and-work-blocks.md` (this plan). Scope record: feature answers: none (no cuts proposed); structure: A (D9 "Original arrangement (recommended)"); accepted scope: the plan as CEO-approved, WorkBlock table; pending remedies: R2, R3.

### Scope Challenge findings
1. [CRITICAL] (confidence: 9/10) working tree — the calendar Day/Week/Month redesign is being built uncommitted (`git status`: M DayView.tsx, WeekView.tsx, MonthView.tsx, PlanningView.tsx, TimelineView.tsx, calendar.tsx, AddRow.tsx; new DayRows.tsx; D ItemRow.tsx). T4/T5 touch the same files. Disposition: dependency, no choice — build this plan only after the redesign is committed, and re-derive T4's file list against DayRows.tsx.
2. [CRITICAL] (confidence: 9/10) redesign test plan (`hafee-staging-eng-review-test-plan-20261102-090000.md`): "Day: + Task opens the task form with this day as the due date". Contradicts D1 once blocks exist. Disposition: R2.
3. [CRITICAL] (confidence: 9/10) this plan, Routes: "`GET /tasks` returns each task's `blocks` dated from 30 days ago onward" with "Present means replace all of that task's blocks". A save from the app would delete every block older than 30 days. Disposition: R3.
4. [INFORMATIONAL] (confidence: 8/10) `mobile/stores/taskStore.ts:33-45` `normalizeTask` defaults fields "cached by an older build". Blocks need `blocks: t.blocks ?? []`, and `plannedBlocksFromTasks` must ignore task times on one-off tasks so a pre-cutover cache doesn't draw an old time. Disposition: required implementation of D5; added to T5.
5. [INFORMATIONAL] (confidence: 7/10) `@@unique([taskId, date, startMinutes])` + replace-all: a request with two identical timed blocks raises P2002 (500). Disposition: required by the approved error map; validation rejects duplicates with 400 first; added to T1.
6. [INFORMATIONAL] (confidence: 7/10) `data.blockId` in calendar items: replace-all gives blocks new ids on every save, so a key on blockId resets row state after each save. Disposition: correction, no behaviour change; key `work_block` as `taskId:date:startMinutes|anytime`, unique by the constraint plus the one-untimed-per-day rule; drop `data.blockId`.

### R2: Day "+ Task" prefill after blocks exist
Finding: 2, CRITICAL, 9/10, redesign test plan "Key Interactions", reviewer: Claude (eng review)
Plan baseline: redesign (eng review 2026-11-02, approved): Day + Task opens the form with this day as the due date. This plan D1: due = deadline, blocks = plan; Find a slot adds a block.
Runtime evidence: redesign in progress in the working tree (AddRow.tsx modified); not yet committed.
Comparison grid:
| Commitment | Current | A | B |
|---|---|---|---|
| Day + Task prefill | due date = that day (redesign) | one untimed work block on that day; due empty | due date = that day |
| Month/Plan + Task | no date (redesign) | unchanged | unchanged |
| R3 block window | pending | pending | pending |
Question D10:
D10 — R2: When blocks exist, what should "+ Task" on a calendar day prefill?
Project: Ascend staging; the calendar redesign is being built now, and this plan follows it.
ELI10: The redesign's Day view has a "+ Task" button that opens a new task already due that day. Once due means only "deadline", pressing + Task on Wednesday would make Wednesday the deadline, which is the confusion we're removing. With blocks, the natural meaning is "I'll work on this Wednesday".
Stakes if we pick wrong: every task added from the Day view gets a fake deadline, and shows "overdue" the next day.
Recommendation: A because adding something to a day in a calendar means planning it for that day, not setting a deadline.
Note: options differ in kind, not coverage — no completeness score.
Net: consistent meaning everywhere, versus keeping the redesign's button exactly as built.
Header: Day + Task
Options:
A) Plan a block that day (recommended)
New task opens with one untimed work block on that day and no due date; you can add a due date in the form. Change lands with this plan's T5, after the redesign. Effort S (human ~1h / CC ~5 min), risk low. ✅ Adding to a day always means planning it, never a deadline. ✅ No task picks up a fake due date and turns overdue the next day. ❌ Changes a behaviour the redesign review just approved; its test plan line needs updating.
B) Keep due date that day
Leave the redesign's behaviour: + Task on a day sets that day as the due date. Effort S (zero implementation work), risk medium. ✅ No change to the redesign or its test plan. ✅ Matches how the button works the moment the redesign ships. ❌ Every task added from Day gets a deadline you didn't mean, so it reads overdue the day after.

State: approved
Actual answer: A) Plan a block that day (recommended), D10 answer
Accepted scope: Day "+ Task" opens a new task with one untimed work block on that day and no due date; lands in T5 after the redesign; the redesign test plan line is updated then.
History: none

### R3: Block window vs replace-all save
Finding: 3, CRITICAL, 9/10, this plan's Routes section, reviewer: Claude (eng review)
Plan baseline: D7 approved replace-all on save; outside voice #14 correction added "`GET /tasks` returns blocks dated from 30 days ago onward" (a correction, not a user answer).
Runtime evidence: none (proposed code). The combination deletes blocks older than 30 days on any app save.
Comparison grid:
| Commitment | Current | A | B |
|---|---|---|---|
| GET /tasks blocks | from 30 days ago | all of the task's blocks | from 30 days ago |
| Replace-all on save (D7) | all blocks | all blocks | only blocks dated within the window; older ones kept |
| Cap | 100 per task | 100 per task | 100 per task |
| R2 Day + Task | approved A | approved A | approved A |
Question D11:
D11 — R3: How do we stop a save from deleting a task's older blocks?
Project: Ascend staging, task due date + work blocks.
ELI10: The app only loads a task's blocks from the last 30 days, but D7 says a save replaces all of a task's blocks with what the app sends. So editing a long-running task would silently delete its blocks from more than a month ago, and the plan-vs-actual history for those days with them.
Stakes if we pick wrong: past plans quietly disappear, and old days lose their planned-vs-focused figures.
Recommendation: A because one simple rule (the app always holds every block) is explicit and easy to test; the 100-per-task cap already bounds the size.
Completeness: A=10/10, B=9/10
Net: one plain rule with a slightly larger download, versus a smaller download with a date rule both sides must agree on.
Header: Old blocks
Options:
A) Send all blocks (recommended)
GET /tasks returns every block of each task (up to 100), so the app always has the full list it saves. Drop the 30-day window. Effort S (human ~30 min / CC ~5 min), risk low. ✅ Nothing a save sends can be missing a block, so nothing is deleted by accident. ✅ One rule, tested with a single integration test. ❌ GET /tasks carries old blocks for long-running tasks (bounded by the 100 cap).
B) Replace only recent ones
Keep the 30-day window; the server's replace-all only touches blocks dated within it and keeps older ones. Effort S (human ~1h / CC ~10 min), risk medium. ✅ Smaller GET /tasks payload for long-running tasks. ✅ Old history stays untouched by edits. ❌ Two places must agree on the same 30-day boundary and time zone; an off-by-one deletes the edge day.

State: approved
Actual answer: A) Send all blocks (recommended), D11 answer
Accepted scope: GET /tasks returns every block of each task (≤100); the 30-day window is dropped; replace-all stays as D7; one integration test proves a PATCH with the full list keeps old blocks.
History: none

Scope Challenge result: scope accepted as-is (structure A).

### Outside voice (eng, Claude subagent; codex not installed) — 11 findings
Factual correction: eng finding 1 is stale. The redesign landed as `531bd89`; T4 re-derives line numbers against it (Find a slot `calendar.tsx:349`, `handleTaskChanged` `:321-329`).
- O1 [CRITICAL] (9/10) `taskStore.ts:354-361` merges a bare PATCH row (`routes.ts:120,334` return no blocks); with `blocks ?? []` the store loses blocks and the next form save deletes them. Disposition: required to hold D7/D11 — POST/PATCH return `include: { blocks: true }`; the store keeps its blocks when a response lacks the key; test "PATCH title, then form save, blocks survive". Added to T1/T5.
- O2 [HIGH] (9/10) `planVsActual.ts:58-59,84` skip untimed items, so D10's untimed block counts as nothing. Disposition: R4.
- O3 [HIGH] (9/10) `mobile/lib/calendarViews.ts:151-168,216-233,124-140`, `WeekView.tsx:253`, `MonthView.tsx:207`, `DayRows.tsx:50,57` read one-off `task` items; Important deadlines would lose task deadlines with tests green (`calendarViews.test.ts:23`). Disposition: correction within D4 — added to T4 and its test rewrites; Important deadlines read `task_due`.
- O4 [HIGH] (8/10) `planScreen.ts:126-127` hides past days, so a task whose only block was earlier this week vanishes from the Plan screen. Disposition: R5.
- O5 [MEDIUM] (8/10) conversion triggers: `taskForm.ts:150-151` sends `isRecurring` on every edit. Disposition: correction within D5 — convert only on a change against the stored value; a sent time/blocks list wins over derived ones; "first block" = earliest date, then start; `blocks` on a recurring task is 400.
- O6 [MEDIUM] (8/10) converting to recurring deletes past blocks and their plan history. Disposition: R6.
- O7 [MEDIUM] (9/10) PATCH has no local date (`routes.ts:71-75`, `taskStore.ts:352`). Disposition: same as eng finding in Section 1 — the form builds today's block and sends it; the server derives no date.
- O8 [MEDIUM] (7/10) a migrated task shows a block and a due flag on the same day. Disposition: kept — both are true (worked and due that day); D4 places the flag on the due day.
- O9 [MEDIUM] (8/10) `planningTasks.ts:154,182-184`, `planScreen.ts:86-88` count a multi-block task's estimate per block and match Next up by item key. Disposition: correction — estimate once per task; skip by task id.
- O10 [MEDIUM] (8/10) form sends `blocks` on every save. Disposition: correction within D7 — `buildSaveData` sends `blocks` only when the list changed (`taskForm.ts:120-153` pattern).
- O11 [LOW] (8/10) missing back-relations; date regex accepts `2026-13-45` (`calendar/routes.ts:86-87`); overlapping blocks double-count (kept, same as events); D6 ripple to Next up fallback (`PlanningView.tsx:334`) and Focus target (`startFocusTarget.ts:31`); T1-T5 ship as one staging push. Disposition: corrections (back-relations, real date check, tests for the D6 ripple, single push); overlap kept.

### R4: Untimed blocks in plan vs actual
Finding: O2, HIGH, 9/10, `mobile/lib/planVsActual.ts:58-59,84`, reviewer: Claude outside voice
Plan baseline: D10 (untimed block from Day + Task); planVsActual matching "unchanged".
Runtime evidence: untimed items are skipped; sessions on that task count as unplanned.
Comparison grid:
| Commitment | Current | A | B |
|---|---|---|---|
| Untimed block claims that day's sessions on its task | no | yes | no |
| Planned minutes from an untimed block | 0 | 0 | 0 |
| Day summary | "focused, nothing planned" | "planned, any time" counted; unplanned excludes those sessions | unchanged |
Question D12: see AskUserQuestion D12 below (same text).
Header: Untimed plan
Options:
A) Untimed counts as planned (recommended)
B) Untimed stays unplanned
State: approved
Actual answer: A) Untimed counts as planned (recommended), D12 answer
Accepted scope: an untimed block claims that day's sessions on its task (not unplanned), adds 0 planned minutes; the day line counts 'planned any time'; planVsActual tests add the case.
History: none

### R5: Plan screen after a missed block
Finding: O4, HIGH, 8/10, `mobile/lib/planScreen.ts:126-127`, reviewer: Claude outside voice
Plan baseline: D4 — Unscheduled = open one-off task with no block this week.
Runtime evidence: current-week rows hide past days.
Comparison grid:
| Commitment | Current (D4) | A | B |
|---|---|---|---|
| Unscheduled | no block this week | no block today or later this week | no block this week |
| Late | due date before today | unchanged | unchanged |
Question D13: see AskUserQuestion D13 below (same text).
Header: Missed block
Options:
A) No block ahead = Unscheduled (recommended)
B) Keep "no block this week"
State: approved
Actual answer: A) No block ahead = Unscheduled (recommended), D13 answer
Accepted scope: Unscheduled = open one-off task with no block today or later this week; Late stays due-date only (amends D4's wording).
History: D4 'no block this week' (superseded by D13).

### R6: Past blocks when a task becomes a habit
Finding: O6, MEDIUM, 8/10, plan Routes "Converting (D5)", reviewer: Claude outside voice
Plan baseline: D5 — to-recurring copies the first block's time onto the habit and removes blocks.
Runtime evidence: none (proposed).
Comparison grid:
| Commitment | Current (D5) | A | B |
|---|---|---|---|
| Blocks dated before today on conversion | deleted | kept (hidden while recurring) | deleted |
| Blocks today or later | deleted | deleted | deleted |
Question D14: see AskUserQuestion D14 below (same text).
Header: Past blocks
Options:
A) Keep D5: delete all (recommended)
B) Keep past blocks
State: approved
Actual answer: A) Keep D5: delete all (recommended), D14 answer
Accepted scope: no change to D5; converting to a habit deletes all its blocks; sessions untouched.
History: none

Approval readiness: PASS (eng: D9 structure A; R2/D10 A; R3/D11 A; R4/D12 A; R5/D13 A; R6/D14 A; corrections cite D4, D5, D7, D11 and the approved error map).

### Eng NOT in scope
- Filling a second same-day block of one task (first-block rule kept).
- Double-counted overlap of overlapping timed blocks (same as events today).
- Keeping past blocks when a task becomes a habit (D14).

### Eng completion summary
- Step 0: Scope Challenge — scope accepted as-is (structure A, D9)
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 2 issues found (PATCH has no local date, deploy window)
- Code Quality Review: 1 issue found (stale diagram in plan-vs-actual-calendar.md)
- Test Review: diagram produced, 13 gaps identified, all assigned to T1-T5
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex unavailable (not installed); native Claude subagent completed, 11 findings
- Parallelization: 2 lanes, 0 parallel / 2 sequential
- Lake Score: 3/3 = D11, D12, D13 picked the 10/10 option

REALITY: premise-table pass — one field three jobs, PATCH bare row, untimed skip all verified; unverified=0 — backend/src/modules/tasks/routes.ts:120
REALITY: already-done pass — no WorkBlock or plannedDate on origin/staging since 2026-11-01 — backend/prisma/schema.prisma:214
REALITY: surface-check pass — routes named (POST/PATCH/GET /tasks, GET /calendar) exist — backend/src/modules/tasks/routes.ts:149
REALITY: binding-decisions finding — redesign's Day "+ Task" due-date prefill superseded by D10 — mobile/components/calendar/AddRow.tsx
REALITY: numbers pass — 100-block cap [estimated bound], ~6 KB/task worst case [estimated] — this doc
REALITY: deferred-asks pass — no linked issue — TODOS.md
REALITY: pr-count pass — one staging push (no ship-policy; default one per wave) — .gstack/ship-policy.json (absent)

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md; UI: form, Day/Week/Month,     |
  |                      | Plan screen, Today, task sheet              |
  | Step 0               | 4/10; all 7 areas (D16)                     |
  | Pass 1  (Info Arch)  | 4/10 → 8/10 after fixes (D18, D19, D20)    |
  | Pass 2  (States)     | 3/10 → 8/10 after fixes (D21, D22)         |
  | Pass 3  (Journey)    | 6/10 → 8/10 (storyboard from decisions)    |
  | Pass 4  (AI Slop)    | 7/10 → 8/10 (icon, not emoji; reuse)       |
  | Pass 5  (Design Sys) | 5/10 → 8/10 (existing tokens named)        |
  | Pass 6  (Responsive) | 4/10 → 8/10 after fixes (D23)              |
  | Pass 7  (Decisions)  | 1 resolved (D24), 0 deferred               |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 1 item proposed, 1 added (D25)              |
  | Approved Mockups     | 0 generated (OpenAI image API declined by   |
  |                      | the founder); HTML mockup updated            |
  | Decisions made       | 7 added to plan (D18-D24)                   |
  | Decisions deferred   | 0                                           |
  | Overall design score | 3/10 → 8/10                                 |
  +====================================================================+
```

Design NOT in scope: a DESIGN.md (TODO, D25); editing blocks from the task sheet or by dragging on the calendar; a due flag on folded Week lanes.

Design — what already exists: `CalendarItemRow` (stripe, title, meta, labels) in `mobile/components/calendar/DayRows.tsx`; goal-deadline row treatment; `AddRow`; the form's date chip and TIME pickers in `TaskFormModal.tsx`; `typeColor` in `components/calendar/shared.tsx`; the redesign's loading and error states.

Unresolved design decisions: none.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 7 | CLEAR | mode: HOLD_SCOPE, 0 critical gaps |
| Outside Review | codex (not installed) → native Claude fallback, CEO + eng | Independent 2nd opinion | 2 | unavailable (native completed) | 25 findings (native, 14 + 11); 25 resolved; 0 unresolved; no completed external review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 for this plan | ISSUES OPEN | 16 issues, 0 critical gaps (all mapped to T1-T6) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 for this plan | CLEAR | score: 3/10 → 8/10, 7 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase (CEO and eng), unavailable (codex CLI not installed); native Claude subagent fallback completed both times (14 and 11 findings), all dispositioned. Design phase: outside voices declined by the user (D17). No external coverage.
- **VERDICT:** CEO + DESIGN CLEARED. Eng review complete with all findings resolved or mapped to tasks; its status is ISSUES OPEN only because findings exist, not because decisions are open. Ready to implement.

**UNRESOLVED DECISIONS:**
- + 1 unresolved from prior reviews

<!-- /autoplan restore point: /c/Users/hafee/.gstack/projects/Hafeezrahman735-pomodoro-app/staging-autoplan-restore-20260818-173721.md -->
# Recurring tasks — always visible in the Tasks tab, projected on the Calendar

Status: DRAFT — under `/autoplan` review. Branch: staging.

## Intent (user, 2026-08-18)

Recurring tasks should be visible in the Tasks tab **every day**, not only on days
they are scheduled. On scheduled days they behave like any other task. On unscheduled
days they still appear in the same list, replacing the separate "Recurring - not due
today" section added earlier today. The Calendar should show every past day a recurring
task occurred and every future day it is scheduled for.

### Premises confirmed by the user (gate, not auto-decided)

1. **One list, inactive sorted to the bottom.** No separate section. Today's actionable
   work stays at the top; unscheduled recurring tasks sort to the end.
2. **Not completable when unscheduled.** Display-only and dimmed. There is no instance
   row for that day, and completing a Tuesday habit on a Monday would silently invent a
   Monday occurrence, corrupting streak and history.

## What already exists (verified, uncommitted on this branch)

The Calendar half of this request is **already built** — from the `/investigate` run
earlier today, currently uncommitted:

- `backend/src/modules/calendar/recurringProjection.ts` — projects every template
  across the requested range, merging real instances where they exist. 13 tests.
- `backend/src/modules/calendar/routes.ts:148-190` — wired in; archived instances are
  now included so past completions reappear.
- `mobile/components/calendar/shared.tsx:36` — label renamed "Habits" ->
  "Recurring tasks".
- `mobile/lib/recurringDisplay.ts` — `dormantTemplates`, `daysUntilNextOccurrence`,
  `nextOccurrenceLabel`. 15 tests.
- `mobile/app/(tabs)/tasks.tsx` — the separate "Recurring - not due today" section,
  plus `fetchRecurringTemplates` on tab focus (it was previously only called after
  editing a recurring task, so the store was empty on cold start).

**So the only new work is the Tasks tab restructure.** The calendar requirement is
satisfied by code already written; this review should confirm that rather than replan it.

## The change

In `mobile/app/(tabs)/tasks.tsx`:

1. Delete the separate "Recurring - not due today" section.
2. Merge dormant templates (from the existing `dormantTemplates` helper) into the
   single task list, sorted after all real tasks.
3. Render them dimmed, with their next-occurrence label, and **without a completion
   control**.
4. Decide filter membership: which of All / Active / Pending / Done include them.

## Constraints carried from CLAUDE.md

- `StyleSheet.create()` via a factory called through `useMemo` inside components.
- Business logic outside UI components where practical — the selection and ordering
  rules belong in `mobile/lib/recurringDisplay.ts`, which is already pure and tested.
- Avoid large files: `tasks.tsx` is ~1830 lines and this change should not grow it much.
- Every new route needs an integration test — no new routes here.

---

# PHASE 1 — CEO REVIEW (via /autoplan, mode: SELECTIVE EXPANSION)

Voices: Claude subagent only. `[codex-unavailable: binary not found]`.

## 0A. Premise Challenge

| Premise | Verdict |
|---|---|
| Recurring tasks should be visible every day | **User-confirmed at the gate.** Accepted. |
| The separate "not due today" section was the wrong shape | **User-confirmed.** It was one hour old and is being replaced, not defended. |
| A template belongs in a list of tasks | **CHALLENGED.** A template is a *definition* ("run 3x a week"), not a task ("run today"). Putting it in the task list conflates two kinds of object, which is why it needs a special non-completable render. The UI is absorbing a data-model seam. |
| The calendar half still needs building | **FALSE.** Already built and uncommitted — `recurringProjection.ts` with 13 tests. This review confirms it rather than replanning it. |

The third premise is the one worth naming out loud: **the awkwardness this plan is
smoothing over comes from the data model, not the UI.** A recurring task has no row on
days it is not scheduled, so the UI has to render something that is not a task and then
suppress the affordances that make it a task. That is a real tension. Whether it justifies
a data-model change is Section 10's question, not this plan's.

## 0B. Existing Code Leverage — the new work is small

| Sub-problem | Already exists | Build or reuse |
|---|---|---|
| Which templates have no instance today | `dormantTemplates()` in `mobile/lib/recurringDisplay.ts` | **Reuse**, tested |
| When is it next due | `nextOccurrenceLabel()`, same file | **Reuse**, tested |
| Templates loaded on cold start | `fetchRecurringTemplates()` on tab focus | **Reuse**, added today |
| Row chrome (tags, priority, goal link) | `TaskRow` at `tasks.tsx:877` | **Extend** with one prop |
| Calendar past + future occurrences | `recurringProjection.ts` | **Already done** |

Net new code: compose the two lists and add one render branch. Everything else exists.

## 0C. Dream State

```
  CURRENT                         THIS PLAN                    12-MONTH IDEAL
  Recurring vanishes on     -->   Always visible in one   -->  Recurring is a real
  unscheduled days; a             list, inactive at the        schedule the whole app
  separate section papers         bottom, not completable      agrees on: tasks,
  over it                                                      calendar, and streaks
                                                               read the same source
```

## 0C-bis. Implementation Alternatives

**APPROACH A — `dormant` prop on the existing `TaskRow`.** One extra prop hides the
completion control and dims the row; dormant templates append to the list.
Effort S (human ~3h / CC ~20m). Risk Low. Completeness 8/10. Reuses all row chrome
(tags, priority, goal link) so a dormant row looks like the task it represents.
Con: `TaskRow` grows a mode flag.

**APPROACH B — separate `DormantRecurringRow` component.** Effort S (human ~4h /
CC ~25m). Risk Low. Completeness 7/10. Cleaner separation of concerns.
Con: duplicates row chrome, and the two rows drift the moment either is styled.

**APPROACH C — spawn instances ahead (backend).** Spawn a rolling window of future
instances so every day has a real row and the "dormant" concept disappears entirely.
Effort L (human ~2d / CC ~2h). Risk Med-High. Completeness 10/10 on the symptom.
Con: multiplies rows per template, changes archive semantics, and makes editing a
schedule require rewriting already-spawned future rows. Solves the data-model seam by
making the data model bigger.

**RECOMMENDATION: A.** Highest completeness per unit of risk, reuses the row chrome so
a recurring task looks the same whether or not it is due, and keeps the seam in one
render branch instead of in the database. `[auto-decided: P3 pragmatic + P4 DRY]`

## 0D. SELECTIVE EXPANSION — cherry-picks

| # | Expansion | Auto-decision | Principle |
|---|---|---|---|
| E1 | Move list composition into `recurringDisplay.ts` so ordering is testable | **ACCEPT** — the only part of this change that can be tested at all | P1 |
| E2 | Filter membership (All / Pending / Done) for dormant rows | **TASTE** — surfaced at gate | P5 |
| E3 | Spawn-ahead window (Approach C) | **DEFER** to TODOS.md — real answer to the seam, wrong size for today | P2 outside radius |
| E4 | Show the schedule ("Mon, Wed, Fri") on the dormant row, not just next due | **ACCEPT** — same render, one extra line, answers "why is this dim?" | P1 |

## 0E. Temporal Interrogation

```
  HOUR 1   Where do dormant rows sort, and does that survive the filter chips?
  HOUR 2-3 What does TaskRow do with a template that has no dueDate and no
           parentTaskId? getDueChip returns null for it — verified, safe.
  HOUR 4-5 Does tapping a dormant row open the template editor or try to open an
           instance that does not exist?
  HOUR 6+  When the user completes today's instance, does the template reappear at
           the bottom as dormant? (It must not — that would double-list it.)
```

The HOUR 6+ case is the sharp one: `dormantTemplates` keys off "has a live instance",
and a completed instance is still live (not archived until the next spawn). Verified
correct by reading the helper — completion does not archive.

## 0F. Mode

**SELECTIVE EXPANSION** with **Approach A**. `[auto-decided per /autoplan override]`

## Step 0.5 — CEO Dual Voices

**CODEX SAYS (CEO):** `[codex-unavailable: binary not found]`

**CLAUDE SUBAGENT (CEO):** 7 findings, 2 critical. Load-bearing claims verified:

| # | Finding | Sev | Verified |
|---|---|---|---|
| CEO1 | Wrong layer: the client infers "dormant" from two endpoints to reconstruct rows the backend deliberately withheld. Server should answer `scheduledToday` directly | CRITICAL | Consistent with `tasks/routes.ts:143` + `:204-219` |
| CEO2 | The heuristic mislabels real states. A due-today template whose spawn failed renders dimmed and uncompletable **while showing "Due today"** | CRITICAL | **YES** — `dormantTemplates` keys off instance absence; `nextOccurrenceLabel` returns "Due today" when today is scheduled. Incoherent row, verified in my own uncommitted code |
| CEO3 | "Not completable" is a product decision dressed as a data constraint | HIGH | Fair. User decided it at the gate; noted, not overridden |
| CEO4 | Schedule logic duplicated in two languages (`isScheduledOn` backend, `daysUntilNextOccurrence` mobile) | HIGH | **YES**, duplicated. They agree in practice (both anchor to the local calendar date) but it is a second source of truth |
| CEO5 | Calendar contract changed shape; "no tests needed" claim is wrong | MEDIUM | Fair — route-level contract untested (blocked on `.env.test`) |
| CEO6 | The dormant section renders in the `task-list` DRILL-DOWN, not the main tab | MEDIUM | **YES — see below. This is the big one.** |
| CEO7 | 6-month regret: a permanent tail of grey untouchable rows | HIGH | Judgment, accepted |

**Zombie case also verified:** delete today's instance and spawn skips the template
(`NOT: { lastSpawnedDate: today }`, `tasks/routes.ts:192`), so it stays dormant and
uncompletable until tomorrow.

### CEO CONSENSUS TABLE
```
  Dimension                             Claude   Codex   Consensus
  ───────────────────────────────────── ──────── ─────── ──────────
  1. Premises valid?                    PARTIAL  N/A     single-voice
  2. Right problem to solve?            NO       N/A     single-voice
  3. Scope calibration correct?         NO       N/A     single-voice
  4. Alternatives explored?             PARTIAL  N/A     single-voice
  5. Competitive/market risks covered?  N/A      N/A     not applicable
  6. 6-month trajectory sound?          NO       N/A     single-voice
```

---

# PHASE 2 — DESIGN REVIEW

**CODEX SAYS (design):** `[codex-unavailable]`

**CLAUDE SUBAGENT (design):** 8 findings, 3 critical. All three criticals verified in code:

| # | Finding | Sev | Verified |
|---|---|---|---|
| D1 | **The row still swipes to complete.** `TaskRow` wraps in `Swipeable`; swipe-left calls `onComplete`. Hiding the checkbox does not stop completion — the plan's entire safety premise is defeated by a gesture | CRITICAL | **YES** — `tasks.tsx:908` Swipeable, `:892` `if (direction === 'left') onComplete()` |
| D2 | Dormant rows lose the recurring badge — it gates on `parentTaskId`, which templates lack. The row reads as a broken task | CRITICAL | **YES** — badge gated on `task.parentTaskId` |
| D3 | Dim collides with done: completed rows already use `opacity: 0.5`. Two meanings in one visual register, and opacity on dark theme drops subtext below 4.5:1 | CRITICAL | **YES** — `tasks.tsx:909` `opacity: isCompleted ? 0.5 : 1` |
| D4 | Counters inflate if dormant enter `nonArchived` — PillStrip shows an unreachable denominator | HIGH | **YES** — `totalActiveTasks = nonArchived.length` |
| D5 | Empty state dies: guard is `filteredTasks.length === 0` | HIGH | **YES** — `tasks.tsx:2057` |
| D6 | Filters: dormant belong under All only, behind a labelled divider so All visibly holds a second class of thing | HIGH | Resolves the open E2 taste decision |
| D7 | No cap on 20 dormant rows | MEDIUM | Accepted |
| D8 | Async pop-in — templates fetch independently of tasks | MEDIUM | **YES** — separate calls in the focus effect |

### DESIGN LITMUS SCORECARD
```
  Dimension                          Claude   Codex   Consensus
  ────────────────────────────────── ──────── ─────── ──────────
  1. Information hierarchy sound?     NO       N/A     single-voice
  2. States specified?                NO       N/A     single-voice
  3. Affordance honest?               NO       N/A     single-voice
  4. Specific (not generic) UI?       PARTIAL  N/A     single-voice
  5. Filter semantics resolved?       NO->YES  N/A     single-voice
  6. Accessibility (contrast)?        NO       N/A     single-voice
  7. Scales to many items?            NO       N/A     single-voice
```

## THE COLLISION (surfaced at the gate)

The main Tasks tab renders `combined = [activeTask, ...pendingTasks].slice(0, 4)`
(`tasks.tsx:2206-2213`) — **capped at four rows**, with a "+N more" link into the
drill-down.

The user's confirmed premise is "inactive recurring at the bottom". On the main tab,
bottom of a four-slot list means **invisible whenever four real tasks exist** — which
is the normal case. The premise and the surface are in direct conflict, and satisfying
the letter of the premise would not satisfy its intent ("recurring should be visible
every day").

---

# PHASE 3 — ENG REVIEW

**CODEX SAYS (eng):** `[codex-unavailable]`

**CLAUDE SUBAGENT (eng):** 8 findings + a clean list. Load-bearing claims verified:

| # | Finding | Sev | Conf | Verified |
|---|---|---|---|---|
| E1 | **Projection back-projects templates before they existed.** No `createdAt` lower bound, so a habit created today renders ~17 phantom "missed" days in the month view, indistinguishable from real misses | HIGH | 9 | **YES** — zero `createdAt` references in `recurringProjection.ts`; `Task.createdAt` exists in schema |
| E2 | Dormant list includes due-today-but-unspawned templates, which then read "Due today" and refuse completion | HIGH | 8 | **YES** — same defect CEO2 found, independently |
| E3 | Hiding the checkbox misses two other completion paths: `Swipeable` swipe-left, and `TaskStatsModal` via `onTap` (which also exposes `onLoadTimer -> selectTask(templateId)`, leaving a dangling `selectedTaskId`) | HIGH | 9 | **YES** — `tasks.tsx:891-894`, `:2062`, `:2094`; `activeTask` resolves against `nonArchived` which never holds templates |
| E4 | Approach A is right-ish for the wrong reason — half of `TaskRow` is inert for a template, and a prop cannot remove the `Swipeable` wrapper cleanly. Extract `TaskRowBody`; `TaskRow = Swipeable + body`, `DormantRow = TouchableOpacity + body` | HIGH | 7 | Accepted — supersedes Approach A |
| E5 | Filter membership is the only real decision and was left open; it breaks the empty state at `:2057` | HIGH | 8 | **YES** — resolved: All only |
| E6 | Tests under-specified. Needs `composeTaskList(...) -> Array<{kind:'task'\|'dormant'}>` so the view is a dumb map; `recurringDisplay.test.ts` has no completed-but-live case | MEDIUM | 9 | **YES** — the HOUR 6+ conclusion was asserted in prose, not tested |
| E7 | Payload unbounded: `MAX_RANGE_DAYS = 400` x N templates; 20 templates over a year = 8000 full spread-clones, plus a `new Date()` parse per pair | MEDIUM | 7 | **YES** — `calendar/routes.ts:84` |
| E8 | Duplicate instances collapse silently — `byTemplateAndDate.set` overwrites; spawn guard is read-then-write, not a DB constraint | MEDIUM | 6 | Accepted |

**Checked and clean (stated, not skipped):** key collisions are a non-issue (`GET /tasks`
excludes templates, and they live in a separate store slice); empty `recurringDays`
behaves consistently in both engines; out-of-order unclaimed instances are safe because
`groupItemsByDate` regroups; 20 dormant rows in a ScrollView is fine.

### ENG CONSENSUS TABLE
```
  Dimension                          Claude   Codex   Consensus
  ────────────────────────────────── ──────── ─────── ──────────
  1. Architecture sound?             NO       N/A     single-voice
  2. Test coverage sufficient?       NO       N/A     single-voice
  3. Performance risks addressed?    NO       N/A     single-voice
  4. Security threats covered?       YES      N/A     single-voice
  5. Error paths handled?            NO       N/A     single-voice
  6. Deployment risk manageable?     YES      N/A     single-voice
```

## Cross-Phase Themes

**Theme 1 — the client is guessing at something the server knows.** CEO1, CEO2, CEO4,
E2 all land here from different directions: dormancy is inferred from the absence of a
row, which is also what a failed spawn, a cold-start race, and a deleted instance look
like. **Resolved by the user at the gate: the server answers it.**

**Theme 2 — "not completable" was specified as one control, but there are three.**
Design D1 and eng E3 independently found `Swipeable` and `TaskStatsModal`. A premise
about safety was one prop away from being false.

**Theme 3 — the already-built calendar work is not actually finished.** The plan claimed
it should be confirmed rather than replanned; two independent voices found real bugs in
it (E1 back-projection, E7 payload). The scope fence was wrong.

---

# APPROVED PLAN (user decisions, 2026-08-18)

**Gate 1 — main tab:** reserve slots in the Tasks zone.
**Gate 2 — dormancy source:** the server answers it.

| # | Task | Pri | human / CC | Files |
|---|---|---|---|---|
| T1 | `GET /tasks` returns each unscheduled template as a row with `scheduledToday: false` and `nextOccurrence`. Server owns dormancy; kills the client heuristic and the duplicated schedule rule | P1 | 4h / 30m | `backend/src/modules/tasks/routes.ts` |
| T2 | Fix back-projection: add `createdAt` to `TemplateLike`, skip dates before it, test it | P1 | 1h / 10m | `backend/src/modules/calendar/recurringProjection.ts` + test |
| T3 | Slim the projected payload (emit a narrow shape, precompute date->dayName once) | P2 | 1h / 10m | same |
| T4 | Extract `TaskRowBody`; `TaskRow = Swipeable + body`, `DormantRow = TouchableOpacity + body`. Closes swipe-to-complete and the stats-modal path | P1 | 4h / 30m | `mobile/app/(tabs)/tasks.tsx` |
| T5 | `composeTaskList({tasks, templates, filter, selectedTaskId, now}) -> Array<{kind}>`, pure and tested; view becomes a dumb map | P1 | 3h / 20m | `mobile/lib/recurringDisplay.ts` + test |
| T6 | Tasks zone: 3 real tasks + up to 2 recurring, always visible on the main tab | P1 | 2h / 15m | `mobile/app/(tabs)/tasks.tsx:2206` |
| T7 | Drill-down list: dormant below a labelled divider ("Not scheduled today · N"), All filter only; keep the empty state keyed on real tasks | P1 | 2h / 15m | `tasks.tsx:2057`, `:1779` |
| T8 | Dormant visual: no opacity (collides with done at `:909`); structural difference + recurring badge gated on `isRecurring \|\| parentTaskId`; second line shows schedule + next due | P1 | 2h / 15m | `tasks.tsx:909`, badge gate |
| T9 | Do NOT let dormant rows enter `nonArchived` — PillStrip denominator would become unreachable | P1 | 30m / 5m | `tasks.tsx:1759`, `:1768` |
| T10 | Cap dormant at 3 by next-occurrence, "Show N more" | P2 | 1h / 10m | `tasks.tsx` |
| T11 | Add the completed-but-live case to `recurringDisplay.test.ts` | P2 | 30m / 5m | test |

**Deferred to TODOS.md:** spawn-ahead window (Approach C); DB unique constraint on
(parentTaskId, dueDate) for E8; surfacing spawn failure to the user instead of
`console.warn`.

## GSTACK REVIEW REPORT

| Run | Status | Findings |
|---|---|---|
| plan-ceo-review (via autoplan) | issues_open | 7 findings, 2 critical, all verified |
| autoplan-voices (ceo) | subagent-only | 0/6 consensus — codex unavailable |
| plan-design-review (via autoplan) | issues_open | 8 findings, 3 critical, all verified |
| autoplan-voices (design) | subagent-only | 0/7 consensus |
| plan-eng-review (via autoplan) | issues_open | 8 findings, 3 high verified + clean list |
| autoplan-voices (eng) | subagent-only | 0/6 consensus |
| plan-devex-review | skipped | No developer-facing scope (0 DX term matches) |

**VERDICT: APPROVED WITH SCOPE CHANGE.** The Tasks-tab request stands but moves from a
client heuristic to a server-owned field, and the main-tab surface gains reserved slots
rather than bottom-sorting into a 4-row cap. The review found **two real bugs in
already-written uncommitted code** (back-projection, dormant-labelled-Due-today) and one
false safety premise (swipe-to-complete). CODEX: unavailable, not absorbed — every
consensus row is single-voice.

**UNRESOLVED DECISIONS:**
- T1 changes the `GET /tasks` response contract, and per CLAUDE.md:321 that needs an
  integration test before it counts as done. The backend integration harness is still
  blocked on the placeholder password in `backend/.env.test`.

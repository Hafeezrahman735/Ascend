# Ascend — Adaptive focus timer duration from task estimated focus time

Status: **draft, under /autoplan review**
Branch: `staging` · Written 2026-08-23

---

## Goal

A task carries an estimated focus time. Selecting that task on the Focus screen
should load a *session plan* derived from the estimate — the right number of
focus blocks, at the right lengths, with breaks between them — instead of the
default/last-used duration.

One pure function produces that plan. Both the task-creation preview and the
Focus screen timer loader call it, so the number the user is promised at
creation time is the number they actually get when they sit down to work.

---

## Audit findings — three brief assumptions corrected

The brief asked for an audit before any code. Done, and it changes the shape of
the work in three places.

### A1 — There is no shared estimate helper to reuse

The brief expected "likely a shared estimate-utils helper" with possible second
copies to reconcile. There is neither. The entire existing calculation is one
inline expression:

```ts
// mobile/app/(tabs)/tasks.tsx:609
const estSessions = estimatedMinutes > 0 && sessionLengthMinutes > 0
  ? Math.max(1, Math.round(estimatedMinutes / sessionLengthMinutes))
  : 0;
```

It has exactly **one** consumer — the `≈ N sessions` preview at line 711.
Nothing else in the app derives a session count from an estimate.

Consequence: this is an extraction, not a reconciliation. There is no drift to
repair and no second implementation to hunt down. Lower risk than the brief
assumed.

Note the existing math also uses `Math.round`, so a 30-minute estimate at a
25-minute session length already renders as "1 session" — coincidentally
matching the new grace-zone rule, while a 40-minute estimate renders as
"2 sessions", also matching. The *counts* mostly agree today; what does not
exist anywhere is the **per-session length**, which is the actual new
information.

### A2 — Break scheduling already exists in `timerStore`

The brief asks to "add break-session scheduling around it." That already ships:

- `type TimerPhase = 'focus' | 'shortBreak' | 'longBreak'` (`timerStore.ts:12`)
- `getPhaseDuration(phase, settings)` (`timerStore.ts:111`)
- `complete()` already selects the next phase and applies the
  long-break-every-Nth rule (`timerStore.ts:208` and `:305`)

Consequence: the real change is **where a duration comes from** — a per-task
plan instead of `settings` — not the introduction of phase chaining. This is a
substitution at `getPhaseDuration`, not new machinery.

### A3 — The circular-import risk is already realised, and already handled

The brief flags cycle risk from wiring `taskStore` into `timerStore`.
`timerStore` already statically imports `useTaskStore` (`timerStore.ts:4`),
alongside `authStore` and `gamificationStore`, and reads through
`useTaskStore.getState()` at call time (e.g. `:245`). The cycle exists today
and is defused by deferring the read to call time rather than module-eval time.

Consequence: no new import risk, provided the new code follows the same
`.getState()`-at-call-time discipline and does not add a top-level read.

---

## The session-splitting algorithm

Naive "one session per 25 min, remainder becomes its own session" produces runt
sessions: 30 min → 25 + 5; 60 min → 25 + 25 + 10.

Rules:

1. Round the estimate to the nearest 5 minutes.
2. **Grace zone** — rounded estimate 25..35 inclusive: do NOT split. One
   continuous session equal to the estimate.
3. **Below 25** — one session equal to the estimate.
4. **Above the grace zone** — split evenly:
   - `numSessions = ceil(estimate / 25)`
   - `sessionLength = round(estimate / numSessions)` to nearest 5 min
   - short break (5 min) between sessions
   - after every 4th focus session, a long break (15–20 min) instead
5. **Minimum session floor** — never below ~15 min. If `sessionLength` would
   fall under the floor, decrement `numSessions` and re-divide, even if the
   sessions land somewhat above 25 as a result.

Worked examples the implementation must match:

| Estimate | Sessions | Breaks |
|---|---|---|
| 20 min | 1 × 20 | none |
| 30 min | 1 × 30 (grace zone) | none |
| 40 min | 2 × 20 | 1 short |
| 50 min | 2 × 25 | 1 short |
| 65 min | 3 × ~22 | 2 short |
| 100 min | 4 × 25 | 3 short, long break after session 4 |

Shape:

```ts
getSessionPlan(estimateMinutes: number): {
  sessions: number[];              // minutes per focus block
  breaks: ('short' | 'long')[];    // length === sessions.length - 1
}
```

One source of truth, called by both the creation preview and the Focus screen
loader.

---

## Focus screen behaviour

1. Selecting a task **with** an estimate loads its plan.
   - Single-session plan → set focus duration to that length.
   - Multi-session plan → set the timer to the FIRST session, and queue the
     remainder to auto-advance.
2. Selecting a task **without** an estimate changes nothing — today's
   default/last-used duration behaviour is preserved exactly.
3. Changing or clearing the selection **before** start updates the duration.
   Once a session has started, changing the selected task must NOT retroactively
   alter the running timer. This boundary is explicit scope.
4. Surface the breakdown when a multi-session task is selected
   ("Session 1 of 2 — 25 min, then a 5 min break"), reusing the existing
   creation-preview treatment rather than a new component style.
5. Decide whether the active index within a plan must survive backgrounding; if
   so, follow the existing user-scoped AsyncStorage key convention
   (`timer:{userId}:...`).

---

## Constraints (load-bearing — do not restructure)

- The timer is frontend-owned and timestamp-based (`startedAt`,
  `elapsedAtPause`, `totalMs`), with fire-and-forget REST. This was a
  deliberate pivot away from a server-tick model that failed over Expo tunnel.
- **Never modify tick logic.** This feature changes only which duration is
  loaded before a session starts, plus break scheduling around it.
- No new backend state.

---

## Open questions for review

- Where does `getSessionPlan` live? (`mobile/utils/` vs `mobile/lib/`)
- Does the plan queue live in `timerStore` state, or is it derived on demand
  from the selected task each time `complete()` fires?
- Does the long-break rule count sessions within the plan, or continue the
  existing global pomodoro count?
- What happens when a task's estimate is edited mid-plan?

---

# GSTACK REVIEW — Phase 1: CEO (strategy & scope)

Mode: SELECTIVE EXPANSION. Codex voice: `[codex-unavailable]` (binary not
installed). Claude CEO subagent: run independently.

## 0A — Premise challenge

Six premises this plan rests on. Only P4 and P6 are actually stated in the
brief; the rest are assumed silently.

| # | Premise | Stated? | Status |
|---|---|---|---|
| P1 | Users fill in `estimatedMinutes` often enough to matter | assumed | **UNVERIFIED — adoption risk** |
| P2 | Entered estimates are roughly accurate | assumed | **Likely false (planning fallacy)** |
| P3 | A task maps to one contiguous sitting | assumed | Questionable |
| P4 | Even splits beat 25-min-plus-remainder | stated | Reasonable |
| P5 | The user wants the app to choose the duration for them | assumed | **Load-bearing, untested** |
| P6 | Timer stays frontend-owned; tick logic untouched | stated | Correct, verified |

P1 is the commercial premise. The estimate field is **optional and defaults to
unset** — `tasks.tsx` renders it as `not set` until the user works a +/- stepper
in 5-minute increments. A feature that only activates on tasks carrying an
estimate is worth exactly as much as the fraction of tasks that carry one, and
nothing in the repo measures that fraction.

P2 matters because the plan hard-codes a consequence of the estimate. If people
under-estimate (they do), the app will confidently schedule 2 × 20 for work that
takes 90 minutes, then end the plan while the user is mid-flow.

P5 is the real product bet: today the duration is the user's choice and it
persists. This plan makes selecting a task silently overwrite it.

## 0B — What already exists (leverage map)

| Sub-problem | Already in the codebase | Verdict |
|---|---|---|
| Estimate → session count | `tasks.tsx:609`, one inline expression, one consumer | Extract, don't rebuild |
| Phase chaining focus→break | `TimerPhase`, `getPhaseDuration` (`timerStore.ts:111`) | **Exists — reuse** |
| Long break every Nth | `complete()` at `timerStore.ts:208`, `:305` | **Exists — reuse** |
| Estimate shown on Focus screen | `index.tsx:573-597` progress bar vs estimate | Existing UI pattern to match |
| Task selection on Focus screen | `selectTask` / `selectedTaskId` (`index.tsx:117-119`) | Hook point |
| Session persistence across kill | `timer:activeSession` + `reconstructSession()` | Extend, don't invent |

Net: roughly 60% of this feature already exists. The genuinely new parts are the
splitting rule and the per-plan duration override.

## 0C-bis — Implementation alternatives

| # | Approach | Effort (human / CC) | Risk | Verdict |
|---|---|---|---|---|
| A | Mutate `settings.workDuration` on task select | 0.5d / 10 min | **HIGH — corrupts a persisted global preference** | **Reject** |
| B | Add optional `activePlan` to timer state; `getPhaseDuration` prefers it, falls back to settings | 1.5d / 40 min | Low — additive, one call site | **Recommended** |
| C | Derive duration on demand from selected task inside `complete()` | 1d / 30 min | Medium — recomputes mid-plan, so editing the estimate mutates a running plan | Fallback |

**Critical finding (severity: critical).** The brief says "set the focus duration
to that session's length." The only existing mechanism for that is
`setWorkDuration` (`timerStore.ts:379`), which writes
`settings.workDuration` — the user's **persisted global default**. Taking the
brief literally means selecting a 40-minute task permanently changes the user's
25-minute default, and deselecting never restores it. Approach B exists to avoid
exactly this: the plan must be an *overlay* that `getPhaseDuration` consults,
never a write to `settings`.

## 0E — Temporal interrogation

- **Hour 1** — user picks a 50-min task, gets 2 × 25. Feels smart.
- **Hour 6** — user picks an un-estimated task; duration silently reverts to
  global default. Two different behaviours with no explanation on screen.
- **Day 2** — user finished session 1 of 3 yesterday, reopens the app. Does the
  plan resume at session 2, or restart at 1? Unspecified in the brief.
- **Week 2** — user edits the estimate of a task mid-plan. Unspecified.
- **Month 2** — user who never fills estimates has seen zero change. The feature
  is invisible to them.

## 0D/0F — Scope decisions

- IN: `getSessionPlan`, extraction of the creation preview onto it, Focus screen
  loading, plan overlay in `timerStore`, breakdown UI, unit tests for all six
  worked examples plus the floor rule.
- IN (blast radius, P2): the `settings`-corruption defect above. It is created
  by this feature; shipping around it is not an option.
- DEFERRED to TODOS.md: telemetry on estimate fill rate (answers P1, but is its
  own scope); re-planning when an estimate is edited mid-plan.
- NOT IN SCOPE: changing the timer tick model; any backend state.

## 0.5 — Dual voices

`[codex-unavailable]` — binary not installed. Single-voice review; the CEO
consensus table below therefore reads N/A in the Codex column rather than
CONFIRMED. Per gstack rules a single critical finding from one voice is flagged
regardless.

### CLAUDE SUBAGENT (CEO — strategic independence)

Three critical findings, all verified against the code before acceptance.

**C1 — Sessions are the app's unit of account, and variable length breaks it.**
VERIFIED:
- `backend/src/lib/goalProgress.ts:52` — `Math.min(counts.actualSessions / targetSessions, 1)`
- `mobile/app/(tabs)/tasks.tsx:945` — `focusHours = targetSessions * sessionLengthMinutes / 60`
- `mobile/app/(tabs)/tasks.tsx:980` — renders "Based on {sessionLengthMinutes}m session length"

Goal progress, and therefore XP, achievements and leaderboard standing, counts
*sessions*. That unit is only fungible because every session is currently
`settings.workDuration`. Make session length vary per task and 100 minutes of
work is worth 1 session or 4 depending on a number the user typed into an
optional field. In a product with a leaderboard, that is a scoring exploit
created by a feature whose stated goal was making the promise match reality.

**C2 — The plan splits the estimate; the user needs the remainder.**
`Task.totalTimeOnTask` already accumulates real time, and `index.tsx:573-598`
already draws a progress bar against the estimate. `getSessionPlan(estimate)`
takes one argument, so a 100-minute task with 80 minutes logged loads a fresh
4-session plan every time it is selected — and again tomorrow. The cheap
correction, `remaining = estimate - totalTimeOnTask`, yields the thing users
actually want: "~2 sessions left, done by 4:15pm."

**C3 — Credit is capped at planned duration.** VERIFIED:
`backend/src/lib/sessionCredit.ts` returns `Math.min(actual, plannedDurationSeconds)`,
and `timerStore.ts:272` sends `plannedDurationSeconds: settings.workDuration`.
Derived 20-minute blocks would credit a 25-minute effort as 20. Same work, less
credit, because of an optional field. Stopwatch mode stays uncapped.

Supporting findings: the 65 min → "3 × ~22" row contradicts the round-to-5 rule
and cannot be implemented as written; the 15-minute floor is unreachable given
`numSessions = ceil(est/25)`; a one-tap stepper move from 35 to 40 halves
session length; 480 min produces a ~10 hour "plan"; auto-advance contradicts the
plan's own "only changes which duration is loaded" constraint, since breaks
require an explicit tap today (`timerStore.ts:129-135`).

Competitive: Focus To-Do, Be Focused, PomoDone and Marinara all model the
estimate as an integer count of FIXED-length pomodoros. Motion and Sunsama map
duration to a projected finish time. Nobody ships variable-length pomodoros.

### CEO DUAL VOICES — CONSENSUS TABLE

```
  Dimension                             Claude   Codex   Consensus
  ------------------------------------- -------- ------- -----------
  1. Premises valid?                    NO       N/A     FLAGGED
  2. Right problem to solve?            NO       N/A     FLAGGED
  3. Scope calibration correct?         PARTIAL  N/A     FLAGGED
  4. Alternatives explored?             NO       N/A     FLAGGED
  5. Competitive risks covered?         NO       N/A     FLAGGED
  6. 6-month trajectory sound?          NO       N/A     FLAGGED
```

### CORRECTION to audit finding A1

A1 claimed the estimate math has "exactly one consumer" and concluded this was
"lower risk than the brief assumed." The narrow claim holds — the `estSessions`
expression at `tasks.tsx:609` does have one consumer. The conclusion was wrong.
`sessionLengthMinutes` is consumed in at least three further places, and session
COUNT is the unit goals and XP are denominated in. Risk is higher than the
brief assumed, not lower, in a place neither the brief nor the first audit
looked.

## Phase 1 status

**HALTED at the User Challenge gate.** Design and Eng review are not run against
a mechanism that is likely to be replaced. Pending the user's decision on
fixed-length vs variable-length sessions.

---

## D2 RESOLVED — user reaffirmed even splits

Challenge raised, user decided: **keep the original spec.** 65 min really does
become 3 sessions, not "4 sessions + 15 min". The concern was surfaced with
verified evidence and overruled. That is the user's call and it is now settled;
this section exists so nobody re-litigates it later.

The fallout is therefore IN SCOPE, not optional. Shipping the splitter without
these is what turns a feature into a scoring exploit.

| # | Required fallout work | File | Why it is not optional |
|---|---|---|---|
| F1 | Weight goal progress by session LENGTH, not count | `backend/src/lib/goalProgress.ts:52` | Otherwise 100 min = 1 session or 4 depending on an optional field, and the leaderboard stops meaning anything |
| F2 | Live goal data migration | goals with `targetSessions` | Existing goals silently change meaning the moment F1 lands |
| F3 | Send plan length as `plannedDurationSeconds`, raise the cap | `mobile/stores/timerStore.ts:272`, `backend/src/lib/sessionCredit.ts` | `creditedSeconds` returns `min(actual, planned)`; 20-min blocks would credit a 25-min effort as 20 |
| F4 | Fix the now-false label | `mobile/app/(tabs)/tasks.tsx:980` | "Based on {sessionLengthMinutes}m session length" stops being true |
| F5 | Plan overlay, never a `settings` write | `mobile/stores/timerStore.ts:111,379` | `setWorkDuration` persists the user's global default; deriving into it corrupts a deliberate setting |

## Algorithm spec — contradiction resolved

The spec as written **cannot be implemented**. Rule 4 says round `sessionLength`
to the nearest 5; the worked-example table says 65 min → "3 × ~22". 22 is not a
multiple of 5, 3 × 20 loses 5 minutes, 3 × 25 invents 10.

Resolved by making the invariant explicit and deriving the table from it, rather
than hand-writing rows:

> **Invariant: `sum(sessions) === roundedEstimate`, and every session is a
> multiple of 5.**

Algorithm:
```
base      = floor(estimate / n / 5) * 5     // largest 5-min block that fits
leftover  = estimate - (base * n)           // always a multiple of 5
// distribute leftover in 5-min increments across the first sessions
```

Regenerated table — every row now sums exactly and every value is a multiple
of 5:

| Estimate | n | Sessions | Sum | Breaks |
|---|---|---|---|---|
| 20 | 1 | [20] | 20 ✓ | none |
| 30 | 1 | [30] | 30 ✓ | none (grace zone) |
| 40 | 2 | [20, 20] | 40 ✓ | 1 short |
| 50 | 2 | [25, 25] | 50 ✓ | 1 short |
| 65 | 3 | [25, 20, 20] | 65 ✓ | 2 short |
| 100 | 4 | [25, 25, 25, 25] | 100 ✓ | 3 short |

Only the 65 row changes from the brief, and only because "~22" was not
implementable under the brief's own rounding rule.

Three further spec defects, auto-decided (P5, explicit over clever):
- **15-min floor is unreachable.** With `n = ceil(est/25)`, `est/n` is bounded
  below by ~17 for any `est > 35`. Keep the guard as an assertion, not a branch.
- **Grace-zone cliff.** 35 → one 35-min block; 40 → two 20s. One stepper tap
  halves session length. Accepted as a known edge; surfaced in the UI copy so
  the user sees the plan change rather than being surprised by it.
- **No day cap.** Max estimate 480 min yields ~10 hours of "plan". Cap the
  rendered plan at a sitting and label the rest.

## Phase status

- Phase 1 (CEO): **COMPLETE.** 1 premise gate passed, 1 user challenge resolved.
- Phase 2 (Design): not started — UI scope confirmed.
- Phase 3 (Eng): not started — F1/F2 migration is the main risk to review.
- Phase 3.5 (DX): skipped, no developer-facing scope.

---

## D3 — Goal accounting clarified (user direction)

User direction: goal progress tracks **tasks** (how many linked, how many
completed). Sessions and time are **stats**, not the progress denominator. Goals
should report how long they took, how many sessions it took — *even when those
sessions were different lengths* — and how many tasks were involved.

Two verifications change the plan materially.

### V1 — Session length is ALREADY variable. C1 overstated the novelty.

`setWorkDuration` (`timerStore.ts:376-383`) accepts **1 to 480 minutes**, exposed
in the Timer Duration modal (`index.tsx:787-788`). Any user can set a 1-minute
focus session today and farm session counts against a session-denominated goal.

The CEO review framed variable session length as *introducing* a scoring
exploit. It does not introduce it — the exploit ships today, through a
deliberate settings control. The adaptive splitter makes non-uniform lengths
**more common**, not newly possible. That is a real but much smaller concern,
and it argues for exactly what the user asked for: stop treating session COUNT
as a proxy for effort, and track time alongside it.

### V2 — Goal progress already defaults to tasks.

`resolveProgressMode` (`goalProgress.ts:32-38`) returns `'tasks'` unless the goal
has `targetSessions > 0`. `computeProgress` then uses `completedTaskCount /
linkedTaskCount`. The session component only engages when a user explicitly sets
a session target.

So the user's stated preference is **already the shipped default**. No formula
change is required for the common case.

### Consequence: F1 and F2 are dropped

| # | Was | Now |
|---|---|---|
| F1 | Weight goal progress by session length | **DROPPED** — progress is task-denominated by default; weighting would change a formula that is already correct for the common case |
| F2 | Live goal data migration | **DROPPED** — no formula change means no migration. This was the highest-risk item in the plan |
| F3 | Credit cap at `sessionCredit.ts` | **STANDS** — a 20-min block still credits a 25-min effort as 20 |
| F4 | Fix the false "Based on {N}m session length" label | **STANDS** — and V1 means it is *already* misleading for anyone who changed their duration |
| F5 | Plan overlay, never a `settings` write | **STANDS** — and is now the single most important fix |

Goals that DO set `targetSessions` keep counting sessions. That is the user's
explicit opt-in, it already tolerates variable lengths because of V1, and the
new time stats give it the honest denominator it was missing.

### New scope — goal stats

`TaskGoalCounts` today carries `linkedTaskCount`, `completedTaskCount`,
`actualSessions`. It has **no time**. Add:

| Stat | Source | Cost |
|---|---|---|
| Total focus time | `_sum: { durationSeconds: true }` on the EXISTING `session.groupBy` in `loadGoalCounts` | ~free, same query |
| Sessions taken | `actualSessions` — already there | none |
| Tasks involved / completed | already there | none |
| Elapsed time to accomplish | `TaskGoal.createdAt` -> `completedAt` — both already stored | none |

`Session.durationSeconds` and `plannedDurationSeconds` both exist on the model,
so honest per-goal time needs no schema change and no new query — one `_sum`
added to a `groupBy` that already runs.

Stat line the goal detail should be able to render:

> **12 of 15 tasks · 34 sessions · 14h 20m focus · 9 days**

That reads correctly whether the sessions were 25 minutes each or a mix of 20s
and 30s, which is exactly the property the user asked for.

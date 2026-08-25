# Ascend — capturing events and notes from the Planning tab

Status: **draft, under /autoplan review**
Branch: `staging` · Written 2026-08-24
Design source: Claude Design project `1a546db5-…`, `Canvas.dc.html` artboard 1A

---

## Goal

The Planning tab shipped in `7f7d761` can only *show* things. It lists what has
no day yet and how loaded each day is. Nothing can be created from it.

This plan adds capture: put an event on a day, and jot a note or to-do, without
leaving Planning.

---

## Audit — three findings, all verified against the schema

### A1 — There is NO Event model. This is a premise question, not a build task.

`backend/prisma/schema.prisma` holds 20 models. None is an event:

```
User, RefreshToken, TimerState, Session, Streak, Friendship, Achievement,
UserAchievement, Task, TaskGoal, FeedEvent, Notification, Follow, StudyGroup,
StudyGroupMember, SocialPost, Note, ExternalCalendarConnection, PostReport,
UserBlock
```

`FeedEvent` is the social feed, not a calendar entry.

What the artboard draws as events — "Design review 12:00–12:45", "Dentist" — map
in this codebase to one of two things that already exist:

1. a **Task** carrying `dueDate` + `startMinutes`/`endMinutes` (shipped earlier
   this session), which is exactly a titled block on a day at a time, or
2. a **read-only external pull** from Google/Apple via
   `ExternalCalendarConnection`, which the user cannot author here at all.

So "add events" is either a new first-class model, or a naming decision about a
capability that already ships. That is the premise gate.

### A2 — Unscheduled notes are ALREADY modelled, and the UI cannot create them

`Note` carries `date String?` with the schema's own comment:

> `'YYYY-MM-DD' when pinned to a day; null for an unscheduled note.`

Full CRUD already exists — `calendar/routes.ts:265` GET, `:290` POST, `:308`
PATCH, `:339` DELETE — and `isTodo` / `isCompleted` are already columns.

But the only place the app creates a note is DayView's composer, which always
passes the day it is showing. **A note with `date: null` is storable, readable
and deletable today, and impossible to create.** The unscheduled note is a
latent capability, not a new one.

Consequence: "add notes/to-do in planning" is mostly wiring, not modelling. The
Planning tab is the natural home for exactly the row the schema already
anticipates and no screen offers.

### A3 — A non-Task schedulable sits outside all goal and XP accounting

Goal progress is `completedTaskCount / linkedTaskCount` (`goalProgress.ts`).
Sessions credit against `taskId`. If an Event is a new model rather than a Task,
then time spent on it counts toward nothing: no goal, no XP, no focus total. It
would be the only thing on the calendar that the rest of the app cannot see.

That is not automatically wrong — a dentist appointment probably *should not*
earn XP — but it must be a decision, not a side effect.

---

## What already exists

| Capability | Where | Verdict |
|---|---|---|
| Titled block on a day, at a time | `Task` + `dueDate` + `startMinutes`/`endMinutes` | Ships today |
| Note pinned to a day | `Note.date` + composer in DayView | Ships today |
| Note with NO day | `Note.date` nullable + full CRUD | **Modelled, unreachable from the UI** |
| To-do vs note | `Note.isTodo` | Ships today |
| Read-only external events | `ExternalCalendarConnection` | Ships today, not authorable |
| Unscheduled task list | Planning tab, `7f7d761` | Ships today, read-only |

---

## Proposed scope (pre-review)

1. A capture control in Planning — one entry point, not three.
2. Unscheduled note/to-do creation (`date: null`), and a place to see them.
3. "Event" resolved per the premise gate below.
4. Integration tests for every route touched, per the Testing Standard.

## Explicitly NOT in scope

- The suggested-placement / auto-place card from the artboard. The user removed
  it by name.
- Any change to timer tick logic.
- Writing back to Google/Apple calendars. The connection is a read-only pull.

---

## Open questions for review

- Is an "event" a Task with a time, or a new model?
- If unscheduled notes become creatable, where do they live in Planning —
  beside unscheduled tasks, or in their own section?
- Does an unscheduled note ever expire, or does it accumulate forever?

---

# GSTACK REVIEW — Phase 1: CEO

Codex: `[codex-unavailable]` (binary not installed). Single voice.

## D1 RESOLVED — user chose a first-class Event model

Premise gate answered: events become their own table, separate from Task.

**My recommendation was the weaker option, and the review proved it.** I had
recommended a `kind` flag on Task. VERIFIED at `backend/src/modules/tasks/routes.ts:628-637`:
completing a Task calls `awardXp` AND emits `FEED_CREATE` with
`eventType: 'task_completed'`. Under a `kind` flag, ticking off a dentist
appointment would award XP and announce "completed a task" to the user's
followers — unless every one of those paths also filtered on `kind`, and missing
a single one ships the bug silently. The separate table cannot have that class
of defect at all. The user's instinct was better than my recommendation.

## 0.5 — Claude CEO subagent (single voice)

### F1 — CRITICAL, VERIFIED: the entire calendar is read-only

```
components/calendar/ItemRow.tsx       0 touch handlers
components/calendar/TimelineView.tsx  0 touch handlers
components/calendar/PlanningView.tsx  7 — the mode toggle and day chips only
```

`ItemRow` is used by every calendar view. **Nothing on any day, in any view, can
be tapped.** The only interaction the calendar tab exposes is `onDayPress`, which
switches `viewMode` to `'day'`, plus the note create/toggle/delete in DayView.

So the Planning tab shows `UNSCHEDULED · 7` and a week of per-day loads, the user
decides "Thursday" — and then has to leave the tab, open Tasks, find the task,
open the form modal and spin a date picker. The screen presents a decision it
cannot execute.

Consequence for THIS plan: adding *capture* to a surface where nothing existing
can be acted on makes the surface worse — more rows you cannot touch. Placement
should land first regardless of what happens with events.

Cost of placement: tap an unscheduled row, tap a day chip,
`taskStore.updateTask(id, { dueDate })`. Existing store method, existing
`PATCH /tasks/:id`, no schema change. `validateSchedule` already allows a
`dueDate` with null start/end, so it is legal today with no backend change.

### F2 — CRITICAL: the review argues for building NO event authoring

Its position is not "use a Task" — it is "neither". The argument: Ascend already
reads Google/Apple via `ExternalCalendarConnection`, and a hand-authored event row
in Postgres is strictly worse than the Google Calendar one — no reminder, no
notification, no watch, no shared invite, no cross-device. A user enters one,
misses the appointment because nothing rang, and stops trusting it.

This contradicts D1 and is surfaced as a User Challenge rather than auto-decided.

### F3 — HIGH, VERIFIED: unscheduled notes are NOT "mostly wiring"

My A2 claimed the null-date note was a latent capability needing only wiring.
Wrong, and verifiably so:

- `calendarStore.ts:149` derives the whole `notes` slice from `items`.
- `items` comes from `GET /calendar`, which filters `date: { gte, lte }`.
- Mobile calls `POST /notes` (`calendarStore.ts:206`) and **never** calls
  `GET /notes` — the only endpoint that returns unscheduled ones.

A `date: null` note would appear optimistically and then vanish on the next
refetch. Shipping it needs a new fetch path, `notes` broken out of being derived
from `items`, and a reconciliation rule between two now-independent slices. That
is architecture, and I sold it as wiring.

The review also asks the question A2 never did: what does an unscheduled NOTE do
that an unscheduled TASK does not? A task already holds a title, sits in the
UNSCHEDULED list, can be timed, and counts toward a goal. The honest deltas are a
longer body and a lighter emotional weight.

### F4 — HIGH: "one entry point" does not resolve the two-sheets risk

`TaskFormModal` already exposes eleven fields. If Planning's capture opens it,
capture is not lighter and the plan is moot. If it opens something new, that is a
second creation path that will drift the first time a field is added to one and
not the other.

Its fix is the consolidation: capture is a single title input calling
`createTask({ title })`, landing in the UNSCHEDULED list two rows above. Tapping
that row opens the existing modal for everything else. One path, two levels of
detail.

### F5 — MEDIUM: the category authors tasks and READS events

Things 3 reads your calendar and cannot create an event. Todoist has no events at
all. Sunsama and Motion *are* placement — drag tasks onto a calendar, events
arrive read-only. TickTick has both and is the messiest of the group.

### F7 — MEDIUM: the plan measures nothing

No metric, no kill criterion. Both are computable from data already stored:
share of active tasks carrying a `dueDate` (primary), and focus sessions started
per scheduled task (guardrail).

### F8: `/notes` has zero integration tests today

`calendar/routes.integration.test.ts` covers only recurring projection. My plan
promised "integration tests for every route touched" without noting that those
routes start from zero.

## CEO CONSENSUS TABLE

```
  Dimension                          Claude   Codex   Consensus
  ---------------------------------- -------- ------- ---------------
  1. Premises valid?                 NO       N/A     FLAGGED
  2. Right problem to solve?         NO       N/A     FLAGGED (F1)
  3. Scope calibration correct?      NO       N/A     FLAGGED
  4. Alternatives explored?          NO       N/A     FLAGGED
  5. Competitive risks covered?      NO       N/A     FLAGGED
  6. 6-month trajectory sound?       NO       N/A     FLAGGED
```

## Corrections to this document

- **A2 was wrong.** "Mostly wiring, not modelling" is false; see F3.
- **A3 had the sign backwards.** It framed "sits outside goal and XP accounting"
  as the cost of a separate Event model. It is the benefit. The cost sits on the
  other side: a Task-shaped event is *inside* accounting when it must not be.
- **My D1 recommendation was weaker than the option the user picked.** See above.

## D2 RESOLVED — Event model, built first

Challenge raised with verified evidence, user decided twice: a first-class
`Event` model, and it lands before placement. Settled; this section exists so
nobody re-opens it.

The consequence the user accepted, stated plainly so it is designed for rather
than discovered: events will be creatable on a calendar where `ItemRow` and
`TimelineView` have zero touch handlers. **An event you can create but cannot
tap is an event you cannot edit, move, or delete.**

That makes one thing non-optional in the design phase: creating an Event must
come with a way to reach it again. Either the create sheet doubles as the edit
sheet reached from somewhere, or `ItemRow` gains an `onPress` as part of this
work. Shipping create-only would produce rows that are permanent by accident.

### Scope, ordered

1. `Event` model + migration
2. Routes: create, update, delete, and inclusion in `GET /calendar`
3. Integration tests against real Postgres for every one of them
4. `CalendarItemType` gains `event`; the six switch surfaces in
   `components/calendar/shared.tsx` each gain a branch
5. Mobile store slice + create sheet in Planning
6. A path back to an existing event (see above)

### Carried forward from Phase 1, not dropped

- **F1** — the read-only calendar. Not fixed by this plan, but item 6 above is
  the minimum that keeps events from being write-once.
- **F7** — no metric. Primary: share of active tasks carrying a `dueDate`.
  Guardrail: focus sessions started per scheduled task.
- **F8** — `/notes` has zero integration tests today; anything touching them
  starts from zero.
- Unscheduled notes (F3) are **deferred**. They are architecture, not wiring,
  and they are not what the user asked to build first.

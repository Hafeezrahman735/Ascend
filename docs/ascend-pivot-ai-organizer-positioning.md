# Repositioning Ascend around an AI organizer — design and system process

> **STATUS: ON HOLD as of 2026-08-18.** Superseded for now by
> `docs/plans/achievements-and-rank.md`, which rebuilds (not just reframes)
> achievements and rank. Revisit this doc before starting its Phase 5 —
> the "reframed, not rebuilt" stance below is currently NOT the active direction.

Scope, per your answers: this is a repositioning, not a rebuild — everything already built (tasks, TaskGoal, recurring habits, social/leaderboards, gamification, the timer itself) stays and stays functional. What changes is what's the *hero* and what the app is *for*. Audience: students, freelancers, and solo operators — the common thread across all three is nobody is telling them what to do next. No manager, no fixed schedule, no built-in structure. AI style: hybrid — conversational for capture and coaching, autonomous underneath for the actual day-planning.

## The positioning gap, grounded in what's actually out there

Two clusters currently split this market, and neither covers your audience well:

**Motion, Reclaim, Sunsama, Akiflow** — mature, well-funded AI schedulers, $15-20/month, built for people whose problem is *calendar density*: too many meetings, too many stakeholders, too little room to think. Motion's whole pitch is "rebuilds your day when meetings run long." That's a professional-with-a-full-calendar problem. None of them have a social or accountability layer — they're solo productivity tools for people who already have external structure (a job, a team, deadlines other people enforce) and just need the *scheduling* automated. That's not your audience's problem. A student, a freelancer, or a solo operator's problem usually isn't "too many meetings" — it's "nothing is making me do this, and nobody notices if I don't."

**StudyStream, Focustown, Habitica** — social accountability apps, mostly student-targeted, built around streaks, study rooms, and light AI (note-taking, quizzes) rather than actual intelligent planning. They solve the motivation problem but not the "what should I actually be doing right now" problem — they're accountability-first, planning-second (often planning-absent).

The gap between them is exactly your audience and exactly what you already have half-built: **an AI that actually decides what you should be doing right now, plus real people who'll notice if you don't do it.** Nobody in either cluster does both. And you already have the accountability half fully built — friendships, leaderboards, streaks, feed. What you don't have yet is the planning half. That's the actual gap to close, not a rebuild.

You also have an asset neither cluster starts with: real historical focus-session data (`peak-hours`, streak history, completion patterns per task). A brand-new AI scheduler has zero data about when you actually focus well. Ascend, for existing users, already knows. That's a personalization moat worth calling out explicitly in positioning once it's wired into the planner (Phase 4 below) — "gets smarter about *you* over time" is a real, defensible claim competitors can't match on day one.

**Positioning statement to build toward:** *Ascend is the AI organizer for people who don't have a boss telling them what to do. It decides what matters right now, and the people around you make sure you actually do it.*

## What the system actually needs to do differently

Today, Ascend's central object is the **focus session** — the timer is the thing you open the app to do, and everything else (tasks, goals, habits, social) hangs off it. The repositioning inverts that: the central object becomes **today's plan** — a continuously maintained, AI-curated answer to "what should I do right now" — and the timer becomes one action you take *from* that plan, not the reason you opened the app.

Concretely, three new system responsibilities, mapped onto what already exists:

**1. Capture** — turning talk into structured data. This is the AI Quick Capture plan already designed (`ascend-ai-quick-capture-plan.md`) — free text in, validated `Task`/`TaskGoal`/habit drafts out, confirmed by the user, written through the existing `POST /tasks`/`POST /task-goals` endpoints. In the repositioned app this isn't a nice-to-have add-on anymore, it's the *primary* way things enter the system — the text box becomes as central as the timer used to be.

**2. Plan** — turning everything the user has (tasks, goal deadlines, recurring habits, calendar items once built, estimated durations) into an actual ranked/time-blocked "today." This is the new piece that doesn't exist yet. It needs:

- A **priority score**, computed server-side, combining: due-date proximity, whether the task is linked to a goal with a near deadline, estimated effort remaining, and how long the item has sat untouched (staleness — the thing that quietly turns into guilt and avoidance if nothing ever surfaces it). None of this needs an LLM to start — it's arithmetic over data you already store (`Task.dueDate`, `Task.priority`, `TaskGoal.deadline`, `Task.estimatedMinutes`, `Task.createdAt`). Ship the ranking as deterministic logic first; layer the LLM on top later for the genuinely ambiguous cases ("I only have 45 minutes and low energy, what should I actually do") rather than starting there.
- **Available time**, which the user needs to tell the system about somehow — the simplest version is a settings addition ("I'm generally free 9-5 on weekdays" or similar), refined later by learning from actual historical session times instead of asking the user to maintain it by hand.
- **Re-planning on change** — completing something early, missing a block, or capturing something new mid-day should silently reshuffle the rest of the day rather than leaving a stale plan. This is the Motion-style behavior your competitors are known for; it's a real engineering piece (a planner service that recomputes on a set of trigger events — task completed, task created, habit instance spawned) but it's additive on top of existing event-emission patterns already in the codebase (`eventBus`), not a rewrite of them.

**3. Coach** — the conversational, proactive half. Morning: "here's your plan and why." Check-ins through the day when something's slipping. Evening: "here's what got done, here's what didn't." This reuses the existing notification infrastructure (`storeAndNotify`, preference categories) plus the conversational surface from Capture — the same chat-style input that captures tasks can also answer "what should I work on next," backed by the Plan engine's current ranking rather than a fresh LLM call each time.

## What gets demoted, not removed

The timer stops being the reason someone opens the app and becomes a **"Focus on this" action available from any item in the plan** — tapping a task in Today starts a session pre-labeled with that task, same underlying timer, same session-completion pipeline (XP, streaks, achievements, task-time-tracking) as today. Nothing about `POST /timer/complete` or the gamification engine changes; only its entry point does. This matters because session data isn't just a feature — it's the fuel for the "gets smarter about when you focus best" differentiator, so the timer needs to stay easy to reach even though it's no longer the front door.

Social and gamification get **reframed, not rebuilt**: instead of a separate Social tab that's disconnected from the planning experience, accountability signals should show up *inside* the plan itself where they're most persuasive — "you're behind Sam on this week's goal," a streak indicator next to today's habit block, a friend's recent completion surfacing right where you're deciding whether to skip your own. The underlying leaderboard/friendship/feed systems don't change; where and when they're surfaced does.

## Phased rollout

**Phase 1 — "Today," rules-based, no AI yet.** Rebuild the Home tab around a ranked agenda computed from existing data (due dates, priorities, goal deadlines, staleness) with zero LLM involvement. This proves the repositioning's core UX cheaply and immediately, and gives you something to test the "does this feel like an organizer now" question against before spending anything on AI.

**Phase 2 — Capture becomes primary.** Build out the AI Quick Capture plan and make the free-text box the main entry point on the new Today screen, not a secondary feature buried in a menu.

**Phase 3 — Autonomous re-planning.** Add the trigger-based recompute (task completed/created/missed → plan updates) and bring in the LLM specifically for the ambiguous prioritization calls the deterministic score in Phase 1 can't resolve well ("what should I do with the 45 minutes I have right now").

**Phase 4 — Personalization from session history.** Feed `peak-hours`-style historical data into the planner so it schedules deep work when the user has actually historically focused well, not just when they say they're "free." This is the differentiator competitors can't fast-follow without years of the same user's data.

**Phase 5 — Accountability surfaced inside the plan.** Move friend/streak signals from the Social tab into the planning experience itself, per the reframing above.

**Phase 6 — Positioning and onboarding rewrite.** Once the above is real, the onboarding flow should ask what kind of work someone does and what "on track" looks like for them, rather than the current habit-selection-first flow — the app should start learning what to plan for from the first session, not after the user's found the goals feature on their own.

## What I'd want to verify before locking this in

This is a real strategic bet, not a small feature — worth pressure-testing before committing engineering time: talk to a handful of actual users (or prospective ones) across the three sub-audiences and see whether "an AI that tells me what to do next" or "people who'll notice if I slip" is the stronger hook for each — freelancers and solo operators may respond much more to the planning half, students more to the social half, and that should shape which phase you front-load. Worth deciding before Phase 1, not after.

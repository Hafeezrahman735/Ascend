# Ascend — Honest Codebase Audit

Read directly from the code in this folder, not from memory of earlier conversations. Where something I flagged before turns out to already be fixed, that's noted explicitly — a lot has clearly happened since. This is organized so you can find your footing: what exists, what it actually does, what personal data it's collecting, and what genuinely needs attention right now.

## The shape of the app

A real, working full-stack product: Node/Express/Prisma/PostgreSQL backend on Railway, React Native/Expo Router mobile app, live on the App Store. The backend is organized into modules — auth, timer, tasks, taskgoals, achievements, notifications, analytics, social, calendar. The mobile app has 5 tabs — Focus, Tasks, Calendar, Social, Profile — plus an auth flow and a handful of detail screens (friend profile, achievement detail, groups, search, settings, account).

This is bigger and further along than "confused and overwhelmed" usually implies. Most of the core is solid. The problems that exist are specific and fixable, not structural.

---

## What's built and actually working

**Auth** — register/login/refresh/logout, JWT access+refresh tokens, account deletion that correctly hands off study groups you created and cleans up block/report records instead of leaving orphans, avatar (emoji or image), four granular privacy toggles plus an overall privacy setting. Solid, no notes.

**Focus Timer** — pomodoro mode with configurable focus/short-break/long-break durations, a separate stopwatch mode, pause/resume, session completion with server-side bounds (can't credit more time than was planned, can't backdate more than 24 hours, duplicate submissions rejected via a client-generated session id). This is the most mature part of the app.

**Tasks** — full CRUD, priority (low/medium/high/urgent), tags, due dates, notes, and a second identity as the habit system: mark a task recurring and it becomes a template that spawns daily instances, tracks its own streak/longest-streak/lifetime completions/lifetime focus time, and resets its streak the moment a scheduled day is missed rather than waiting for you to notice. Tasks can link to goals with real ownership checks (you can't point a task at someone else's goal).

**Goals (TaskGoal)** — a goal's progress is computed live every time it's read, from whichever mix of completed tasks and logged sessions you tell it to track. Goals auto-complete themselves and fire a notification the moment they cross 100%, exactly once. Deadlines are stored as calendar days, not timestamps, so they don't drift across timezones. Archiving a goal actually clears the link on every task that pointed at it.

**Gamification** — this got real depth recently: XP now comes from finishing sessions, finishing tasks (scaled by priority), and finishing goals — not just from logging time, which is a meaningful shift from where this was a couple of iterations ago. Completing and then un-completing a task is a true undo, not a way to farm XP. Levels run Beginner through Grandmaster on an XP curve. 26 achievements are seeded across five categories (streaks, session counts, focus-time totals, levels, and — recently added — task-completion counts), and the achievements endpoint now tells the client how close you are to each locked one, not just locked/unlocked.

**Social** — friend requests, a combined activity feed, four separate leaderboard variants (all-time, weekly, streak, focus-time), posts with reactions, blocking and reporting (App Store moderation requirement, actually implemented), study groups, follow/unfollow independent of friendship. This is comprehensive — more built out than most competitors in this space bother with.

**Notifications** — a real push pipeline (Expo push, dead-token cleanup so it doesn't keep retrying devices that uninstalled), four preference categories a user can toggle, goal-completion and achievement-unlock notifications wired through it.

**Analytics/Statistics** — daily and weekly time series, a full year's heatmap, most-productive-hour, average session length, completion rate, estimation accuracy (planned vs. actual per task), and a friend-comparison endpoint.

**Calendar** — the newest piece: a `Note` model, an `ExternalCalendarConnection` model for Google sync, an aggregation endpoint that merges tasks/habit instances/goal deadlines/notes by date, and Google OAuth config (left optional — the server runs fine with it unset). There are backend tests for this already, which is a good sign, but it's the least battle-tested part of the app simply because it's the newest — worth actually running through the Google-connect flow and the day/week/month views yourself before trusting it the way you trust Tasks or Timer.

---

## What personal data the app actually has on a user

Concretely, this is the dataset behind the app right now:

Account-level: username, email, avatar, four privacy toggles, push token.

Every focus session, individually, kept indefinitely — type, duration, planned duration, which task it was linked to, exact completion time. This is what everything else derives from.

Running totals on the user record: XP, level, current streak, longest streak, last-active date, lifetime session count, lifetime focus time, lifetime tasks completed.

Per task: sessions logged against it, total time on it, the actual dates sessions happened, and for recurring tasks specifically — its own streak, longest streak, lifetime completions, lifetime focus time, independent of the parent user's numbers.

Per goal: how many linked tasks, how many completed, how many sessions logged against them vs. target, and the live-computed progress percentage.

Which of the 26 achievements are unlocked, when, and how close you are to the locked ones.

The social graph: friends, followers, following, blocked users, group memberships.

Derived analytics: daily/weekly totals, a year of heatmap data, which hour of the day you're historically most productive, and how your week compares to your friends'.

That's a genuinely rich, specific dataset — the app knows a lot about how you actually work, not just what you told it to do. Worth knowing that plainly, since it's also the foundation for anything AI-driven you build later (the "gets smarter about when you focus" pitch from an earlier conversation is real and already has data behind it).

---

## What actually needs updating — specific, current, verified by reading the code

**The Profile tab's achievement list doesn't match what the backend can actually award.** `mobile/lib/achievements.ts` has its own hardcoded list of 10 achievements with its own keys and thresholds, separate from the 26 real ones seeded on the backend. Only 3 of the 10 (`streak_30`, `streak_7`, `sessions_500`) share a key with something the backend can actually unlock. The other 7 — including one literally called "Sharpshooter" that references hitting a daily goal streak, from the session-target goal system that was deleted a while back — can never unlock no matter what the user does, while still showing a progress bar that can climb toward 100%. This is very likely the single most confusing thing a real user runs into: an achievement that looks almost finished and never pays off. This needs a decision, not just a fix — either replace this client list with the real backend catalogue (simplest, and it now includes progress data as of the recent achievements update), or deliberately redesign it as its own thing and remove the achievements that can't ever unlock.

**Two separate progression scales exist side by side.** The backend has "Level" (Beginner → Grandmaster, one XP curve). The mobile-only achievement system has "Rank" (Rookie → Champion, a different XP curve, used only by two of the mismatched achievements above). If both are meant to be visible to users, that's two different numbers claiming to represent the same kind of progress — worth a deliberate call on whether Rank is a real second concept or leftover from an earlier design pass.

**Search only searches people.** `search.tsx` calls the social user-search endpoint exclusively. Tasks, goals, and habits have no search path at all, client or server.

**Settings is thinner than it looks like it should be.** Theme is dark/light only, no "follow system." No week-start-day setting. No units/formatting setting.

**Two reminder gaps, still open:** habit reminders are one global daily time, not per-habit; there's no "goal due tomorrow" notification, and no scheduled job of any kind exists anywhere in the backend to ever check deadlines and send one.

**Category/tag time breakdown isn't built.** Nothing sums focus time by task tag, so there's no "here's how your time split across Study/Work/Reading" view even though the underlying tag data exists on every task.

**Live Activity and a real lock-screen countdown don't exist.** What's there is standard local notifications for focus-done/break-done, which do show on the lock screen, but there's no persistent, live-updating countdown visible without unlocking the phone. This is genuine native iOS work (an ActivityKit widget extension), not a quick fix — it needs its own scoped effort.

**Two similarly-named directories on mobile might be worth clarifying, not necessarily fixing:** `mobile/stores/` holds the actual Zustand state (auth, tasks, goals, social, gamification, timer, profile, settings); `mobile/store/` (singular) is a separate layer of hooks and selectors built on top of some of those same stores for the timer/tasks/breaks/analytics. Neither is broken, but if you're ever confused reading this codebase, that naming collision is a likely reason why — worth documenting which one is "the state" and which is "the derived view," or renaming one of them.

## What's simply not built yet — not bugs, just not there

The AI assistant / Quick Capture feature, the AI-organizer repositioning, per-habit and goal-due-tomorrow reminders, Live Activity, and subscription/premium gating are all still at the planning stage from recent conversations — none of that is implemented, so there's nothing broken there, just nothing there yet. Worth saying plainly so it's clear those aren't missing pieces of something that should already exist.

## Where I'd start

Fix the achievement-catalogue mismatch first — it's small, it's confusing to real users right now, and every day it sits there is a day the gamification you already built well is undermining itself. Everything else on this list is real but lower-stakes, and can be picked up in whatever order matches what you're already planning to touch next (Calendar validation and Search both seem like natural next steps given how recently Calendar landed).

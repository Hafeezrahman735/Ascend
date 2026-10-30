# Ascend direction: the daily planner for people who work for themselves

Status: reviewed by /plan-ceo-review (2026-10-29). The review changed no code; the build section below is the plan for the implementer.

## The plan under review (from the founder, 2026-10-29)

Ascend should be the daily planner for freelancers and solo workers: see what to do
today, focus on it, and know where every hour went. The planner is the front door,
the focus timer is how the work gets done, and projects plus time reports are why
people pay. Social features and badges stay as a supporting layer for consistency,
not the headline.

It builds the two missing steps on data the app already collects: planning the day
before the work, and reviewing how it went after. AI sits on top of that data.

Open questions the founder asked:
- Who is this app useful for, what would make them stay?
- Social and gamification become a secondary layer. Where do the feed and leaderboard
  live if the Social tab leaves the bottom bar?
- Would Focus be a better home screen?

Why it is not ready to charge yet (founder's list):
- The home tab is the social feed, so the core promise is not the first thing users see.
- No paid-tier feature exists: projects with clients, billable time export, AI planning.
- No evidence yet that people come back daily.

## Current state (verified)

| Area | Today | Receipt |
|---|---|---|
| Home | `index` = "Ascend": social feed + focus leaderboard | `mobile/app/(tabs)/_layout.tsx:11`, `mobile/app/(tabs)/index.tsx:1228` |
| Tabs | Ascend, Focus, Tasks, Calendar, Profile (`goals.tsx`) | `mobile/app/(tabs)/_layout.tsx:44-87` |
| Planning | Calendar opens on a week Planning view with planned hours | `mobile/app/(tabs)/calendar.tsx:37` |
| Today-ish hub | Tasks tab: hero card (urgency, goal progress, time nudge, momentum), Tasks, Goals, Time zones | `mobile/app/(tabs)/tasks.tsx:1664-1930, 2734-2794` |
| Profile | Rank, XP, streak, achievements, own posts, followers/following | `mobile/app/(tabs)/goals.tsx:478-657, 128` |
| Session data | task, goal, tags, local date/hour/weekday per session | `backend/prisma/schema.prisma:141-171` |
| Projects/clients | None; `TaskGoal` groups tasks and their time | `backend/prisma/schema.prisma:299` |
| Billable export | None | no csv/export/billable route in `backend/src` |
| Calendar sync | Google Calendar connection exists | `backend/prisma/schema.prisma:470` |
| Scheduler / reminders | None ("there is no scheduler") | `backend/src/lib/activityLog.ts:31`, TODOS.md |
| AI | No provider dependency; founder chose deterministic first (2026-08-27) | `backend/package.json`, `mobile/package.json` |

## Premise findings (0A)

1. The planning step is partly built (Calendar Planning view, Tasks urgency card). What is
   missing is a daily ritual: choose today's work, fit it to available hours, review it.
2. Social as home is actively harmful at the current user count: a near-empty feed and a
   leaderboard of a few people reads as a dead app to a new user.
3. Focus as home answers "how", not "what". With no task chosen it is an empty timer.
   Recommendation: Today (the Tasks tab, renamed) is home; its main action starts focus
   on the next task.
4. Projects can likely extend `TaskGoal` (client name, hourly rate) instead of a new model.
5. Pricing data: Tiimo lists ~$6/mo ($47.99/yr), Structured $3.99/mo ($29.99/yr); Sunsama
   $20/mo yearly, $25 monthly matches. Sources conflict; verify before quoting.
6. "AI on top" needs a separate founder decision (provider, cost, data contract).

## Decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| D1-APPROACH (founder) | How much of the plan this review scopes; retention evidence is absent (founder's own list) | C) Nav only: Today becomes home, social moves out of the bottom bar | — | approved | Founder answer to D1, 2026-10-29: "Nav only". Scope: home screen and where social/leaderboard live. Daily plan ritual, weekly review, retention measure, projects/clients, billable export and AI planning are NOT in this plan's scope. |

Review mode: SCOPE EXPANSION (founder's choice at mode selection, 2026-10-29; recommendation was HOLD SCOPE). Expansion applies within navigation; D1's exclusions stand.

| D2-HOME (founder) | What the app opens on. Today = current Tasks tab content (`tasks.tsx:2734-2794`); Focus = timer (`focus.tsx`) | A) Today: the Tasks tab, renamed Today, opens first; its main button starts focus on the top task | — | approved | Founder answer to D2, 2026-10-29: "Today (recommended)". |
| D3-SOCIAL (founder) | Where feed, leaderboard, groups and the notification inbox live. Inbox is inside the social screen (`index.tsx:1280`); Profile already holds posts, followers, rank, streak (`goals.tsx:128, 478-657`) | A) Profile becomes "You" with a Community card (feed, leaderboard, groups) at the top; a bell on Today opens notifications; bar is Today, Focus, Calendar, You (four-tab bar superseded by E1) | — | approved | Founder answer to D3, 2026-10-29: "Community from You (recommended)". Includes repointing the old-home links (`goals.tsx:342`, `group/[id].tsx:458`) to Community. |
| E1-TIME-TAB (founder) | Fourth slot freed by D3; Time report exists (`tasks.tsx:2794`, time-report lenses) | Bar: Today, Focus, Calendar, Time, You; Time opens the existing time report | — | approved | Founder answer to E1, 2026-10-29: "Add to this plan". |
| E2-TIMER-PILL (founder) | No running-timer indicator outside Focus (no pill component found) | none | — | deferred | Founder answer to E2, 2026-10-29: "Defer to TODOS.md". |
| E3-MOVED-TIP (founder) | Existing users lose the feed from the bar | none | — | declined | Founder answer to E3, 2026-10-29: "Skip". |
| E4-SOCIAL-SWITCH (founder) | Only leaderboard opt-out exists (`userSettingsStore.ts:11`) | none | — | deferred | Founder answer to E4, 2026-10-29: "Defer to TODOS.md". |
| E5-COMMUNITY-PREVIEW (founder) | Community card on You | Community card shows unread activity and leaderboard place from already-fetched data | — | approved | Founder answer to E5, 2026-10-29: "Add to this plan". |
| E5-DATA (founder), reopened from E5 by spec review round 2 | Unread count IS already fetched (Today loads notifications for the bell). Leaderboard place is NOT: only the feed screen loads it (`index.tsx:1284-1289`), into shared `socialStore` state (`myFocusEntry`) | A) You fetches the global all-time rank on mount and keeps it on You, not in the shared store; hidden when opted out or no rank | — | approved | Founder answer to E5-DATA, 2026-10-29: "Fetch rank on You (recommended)". Amends E5's "already-fetched" wording for the rank only. |

## How the approved scope is built (spec review round 1 clarifications)

These settle mechanics inside the approved decisions; none changes scope.

- **Routes.** Today's content moves into the `index` route, so every bare `router.replace('/(tabs)')`
  (`app/_layout.tsx:177`, `app/(auth)/onboarding2.tsx:31`) and the cold-launch default
  (`_layout.tsx:11`) land on Today with no further change. The social screen moves out of
  `(tabs)` to a pushed route, `app/community.tsx`. The old `tasks` route is removed; the
  `goal_due` push (`hooks/useNotificationListener.ts:30`) is repointed from `/(tabs)/tasks` to `/(tabs)`.
- **Bottom bar (E1 supersedes D3's four tabs).** `index` "Today" (reuses `TasksTabIcon`),
  `focus` "Focus" (`FocusTabIcon`), `calendar` "Calendar" (`CalendarTabIcon`), `time` "Time"
  (new `TimeTabIcon` in `components/TabIcons`), `goals` "You" (`ProfileTabIcon`).
  `AscendTabIcon` is retired. Each tab gets an accessibility label matching its title.
- **Today's sub-views.** The Tasks screen's in-screen views (`task-list`, `goal-detail`,
  `tasks.tsx:2468-2584`) move with it into `index` unchanged, including their back button and
  Android back behaviour (back returns to Today's main view).
- **Main button on Today (D2).** A new full-width "Start focus" button directly under Today's
  header, above the hero card, labelled with the target ("Start: Write case study"). It starts
  focus on the first task in the "Tasks" zone (`topOpenTasks[0]`, `tasks.tsx:2271-2284`) via
  `selectAndFocus`. With no open task it reads "Start focus" and opens Focus with nothing
  selected (`goToFocus`). A ticked-off recurring row is not open, so it is never the target.
  The hero card (`tasks.tsx:2709-2722`) keeps its own rotating actions unchanged.
- **Time tab (E1).** The report is an in-screen view today (`setActiveView('time-tracker')`,
  `tasks.tsx:2462, 2570`), not a route. It is extracted into `app/(tabs)/time.tsx`, which owns
  `TimeAnalyticsView` with no back button (it is a tab, not a sub-view). [Eng R1, 2026-10-30: the goal
  form is shared through a `GoalEditor` component, not a hook; see the eng decision ledger.] What the view needs
  from Tasks state comes from the shared stores instead: tasks (`useTasksList`), goals
  (`goalStore`) and tag overrides (`tagOverrideStore`); `time.tsx` mounts its own
  `GoalFormModal` and `TagOverrideSheet` with the same save handlers, moved to a shared hook
  rather than copied. The Tasks-local pieces that move into that hook are `handleGoalSave`,
  `handleGoalDelete` (`tasks.tsx:2408`), the goal-form state (`formGoal`, `showGoalForm`),
  `goals`, `existingTags`, `nonArchived` and `overrideTag`. The report period (`reportPeriod`,
  `tasks.tsx:2125`) moves into the same shared hook so Today's Time card and the Time tab show
  the same period. The Time tab takes a `lens` route param, default overview: Today's Time card
  keeps both of its entry points, "See more" (`onOpen('overview')`) and the goals row
  (`onOpen('goals')`, `components/timeReport/TimeCard.tsx:51, 91`), each switching to the Time tab
  on that lens. The unused `'calendar'` member of `ActiveView` (`tasks.tsx:2085`, never set) is
  dropped in the move.
- **Community screen (D3).** A pushed stack screen with a standard header titled "Community" and
  a back arrow to where it was opened from. Keeps everything the feed screen has: group chips and the
  `selectedGroupId` filter, the public/following scope toggle, the feed/leaderboard segment and
  the create-post button. The group screen's "posts" action (`group/[id].tsx:458`) selects the
  group, then goes back if the previous screen is Community (Community already pushes
  `/group/:id`, `index.tsx:1448`), and otherwise navigates to `/community` without stacking a
  second copy. The feed screen's own today-recap card and start-session entry
  (`index.tsx:1300-1310, 1487`) move with it unchanged, as D3 keeps everything the feed screen has.
  The empty-posts message in You (`goals.tsx:339-344`) changes from "Share your progress from
  the Ascend tab / Go to Ascend" to "Share your progress from Community / Open Community".
  Community has no bell of its own: the feed screen's bell and badge (`index.tsx:1656`) are
  removed there, because the inbox now lives on Today.
- **Notifications (D3).** The inbox sheet moves from the feed screen to a bell on Today's header.
  The bell shows a badge from `socialStore.unreadCount`. Today fetches notifications each time it
  gains focus (`useFocusEffect`), because tab screens stay mounted and a mount-only fetch would
  leave the badge stale after the first visit. This keeps the approved bell correct; it is not
  an app-foreground refetch.
- **Community preview (E5, E5-DATA).** "N new" comes from `socialStore.unreadCount`, already
  loaded by Today. "#P on the leaderboard" comes from one direct request each time You gains
  focus: `api.get('/social/focus-leaderboard?scope=global&period=all_time')` (scope `global`,
  `index.tsx:1218`; period `all_time`, `index.tsx:1226`), not `fetchFocusLeaderboard`, which writes
  the shared store (`socialStore.ts:446-462`). P is the response's own entry for the user
  (`myEntry.position`), kept in You's local state so the Community screen's Friends filter cannot
  change it. No rank line when the user opted out
  (`showOnLeaderboard` false) or has no position yet. While loading the card shows its title
  without numbers; on a fetch failure it shows the title only and logs the error.
- **Effort.** Larger than D1's "nav only" estimate once E1 and E5 are in: L (human ~2 days,
  CC ~1-2 hours). Mostly moving existing screens.

Document approval: founder approved the working plan and CEO summary as written, 2026-10-29
("Approve and continue"). Approves these versions only; nothing implemented.

## Build sequence (0I)

```
HOUR 1 (foundations):   rename routes: tasks.tsx content -> (tabs)/index.tsx, feed -> app/community.tsx;
                        tab bar order, labels, icons (TimeTabIcon new, AscendTabIcon retired).
HOUR 2-3 (core logic):  Start-focus button + pure target picker; bell + inbox sheet on Today;
                        extract TimeAnalyticsView into (tabs)/time.tsx with the shared goal/tag hook.
HOUR 4-5 (integration): repoint goal_due push, goals.tsx:342, group/[id].tsx:458; You's Community
                        card with its own global-rank fetch; refetch-on-focus for bell and rank.
HOUR 6+ (polish/tests): unit tests for the two pure functions; empty/loading/error states;
                        accessibility labels; manual staging pass from the verification plan.
```

Effort: human team ~2 days; CC + gstack ~1.5-2 hours. Feasibility blockers: none found.
What the implementer will hit: `tasks.tsx` is 2,821 lines, and moving it to `index` is a file
rename plus import paths, not a rewrite. The Time view's dependencies on Tasks-local state are
the only real untangling.

## Verification plan

No backend route is added or changed, so no new integration test is needed (CLAUDE.md
Testing Standard applies to routes). Mobile checks:

- Unit (vitest, pure logic): the Start-focus target picker (first open task, none, session
  running or paused -> "resume", session on break -> normal start, and a
  recurring row whose `isCompleted` is true because today's log row exists,
  `backend/src/lib/recurringStats.ts:159`) and the Community-card display rules (unread only, opted out, no position,
  error) extracted as pure functions in `mobile/lib/`, following `taskBoard.ts`.
- Manual on staging: tab order and labels; cold launch and post-onboarding land on Today;
  `goal_due` push opens Today; the bell opens the inbox with the right badge; Community keeps
  group filter, scope toggle, segment and create-post; group screen "posts" opens Community on
  that group; the Time tab shows the report and Today's "See more" switches to it; You's empty
  posts message opens Community; the Community card shows "N new" and "#P", and unread only when
  opted out; switching tabs and back refreshes the badge and the rank; the Time tab opens on
  the overview lens from "See more" and on the goals lens from the Time card's goals row; group
  screen -> posts -> back returns to Community without a second copy.

## NOT in scope

- (D1) Daily plan ritual and weekly review.
- (D1) Retention measure.
- (D1) Projects with clients, billable time export, AI planning (AI also needs a provider decision).
- (E2, deferred to TODOS.md) Running-timer pill on every tab.
- (E3, declined) One-time "social moved" tip for existing users.
- (E4, deferred to TODOS.md) "Show Community" switch.

## Review findings needing a decision

| D4-RUNNING-SESSION (founder; Section 4) | A finished session is credited to the task selected AT COMPLETION (`stores/timerStore.ts:317-335`); `selectTask` changes it unconditionally (`stores/taskStore.ts:400`). Tapping Start focus mid-session moves the whole session's time to another task, silently. The hero card already allows this via `selectAndFocus` (`tasks.tsx:2273`) | A) While a session runs (timer status `running` or `paused`, `stores/timerStore.ts:26`; NOT `break`, when picking the next task is the point), Start focus reads "Back to focus: <running task>" and only opens Focus; the same check inside `selectAndFocus` stops the hero card switching tasks; unit test on the picker for the running case | — | approved | Founder answer to D4, 2026-10-29: "Guard selection (recommended)". |

## currentDecision (D4-RUNNING-SESSION)
Commitment comparison:

| Commitment | Source/approval or pending | Current | A | B | C |
|---|---|---|---|---|---|
| Start button while a session runs | D2 approved button | n/a | reads "Back to focus: <running task>", opens Focus only | reads "Back to focus", opens Focus | unchanged: switches task |
| Hero card actions mid-session | existing `selectAndFocus` | switches task | guarded by the same check in `selectAndFocus` | still switches | still switches |
| Session credit | timer contract | goes to whatever is selected at the end | stays with the task it started on | hero card can still move it | button and hero card can move it |
| Test | verification plan | none | unit test on the picker: running session returns "resume" | unit test on the label | none |

Question: D4 — D4-RUNNING-SESSION: What should Start focus do while a session is already running?
Header: Mid-session
A) Guard selection (recommended): while a session runs, the button reads "Back to focus: <task>" and only opens Focus; the same check inside selectAndFocus stops the hero card switching tasks too. Effort S, risk low.
B) Label only: the button reads "Back to focus" and opens Focus; the hero card keeps its current behaviour. Effort S, risk medium.
C) Do nothing: the button switches the selected task like the hero card does today. Effort S, risk high.

## Answered: D1-APPROACH
Commitment comparison:

| Commitment | Source/approval or pending | Current | A | B | C |
|---|---|---|---|---|---|
| Audience: freelancers and solo workers | founder plan | yes | yes | yes | yes (positioning only) |
| Today is home; social moves out of the bottom bar | founder plan | yes | yes | yes | yes |
| Daily plan ritual (pick today, fit to hours) | founder plan | yes | yes | yes | no |
| Weekly review (hours per goal/client, planned vs actual) | founder plan | yes | yes | yes | no |
| Retention measure (do people come back daily) | founder's blocker list | implicit | yes | yes, as the gate for paid work | no |
| Projects with clients, billable export | founder plan | yes | yes | deferred to TODOS until retention shows | no |
| AI planning | founder plan; needs provider decision | yes | yes | deferred | no |

Question: D1 — D1-APPROACH: How much of the plan should this review scope?
Project: Ascend, staging. ELI10: the plan bundles three things: a new front door, a daily
plan-and-review habit, and paid features. Nobody pays for an app they don't open, and
there is no evidence yet that people open it daily. Stakes: building paid features first
spends weeks on a tier no one may reach; building only the nav fixes the first
impression but gives people no reason to return. Recommendation: B, because the founder's
own blocker list puts "no evidence people come back daily" first, and the daily ritual is
what creates that evidence; paid features land on users who already return.
Note: options differ in kind, not coverage — no completeness score.
Header: Scope
A) Full plan
Everything as written: freelancer positioning, Today as home, plan and review rituals,
projects with clients, billable export, AI planning. Effort XL, risk high.
✅ One coherent release that is ready to charge for when done.
✅ Paid features shape the planner from the start, so no rework later.
❌ Weeks of paid-tier work before knowing whether anyone returns daily.
B) Retention first (recommended)
Positioning, Today as home with social moved, daily plan, weekly review, and a simple
measure of daily return. Projects, export and AI wait in TODOS until return shows.
Effort L, risk medium.
✅ Builds exactly the loop that would make people come back, on data already collected.
✅ Produces the retention evidence the founder says is missing before charging.
❌ No paid tier yet, so revenue waits until the loop proves itself.
C) Nav only
Make Today the home and move social into Profile; nothing else. Effort M, risk low.
✅ Fixes the first impression quickly with a small, reversible change.
✅ Lowest risk to existing users and current features.
❌ Adds no new reason to open the app daily, so retention stays unproven.

## Review sections (1-11)

Mode: SCOPE EXPANSION. Governing rows: D1, D2, D3, E1, E5, E5-DATA, D4 (all approved, ledger above).

1. **Architecture.** Client-only restructure; no backend route, schema or endpoint change.
   New coupling: You reads the global rank outside `socialStore`, justified so the Community
   Friends filter cannot overwrite it; implement as a small helper returning the entry without
   storing it. Rollback: revert and ship over the air (`expo-updates`, `mobile/package.json:44`).
2. **Error & rescue.** Rank fetch fails -> card title only, logged. Notification fetch fails ->
   no badge (`socialStore.ts:484` logs and returns). Start focus on a task deleted elsewhere ->
   the server drops unowned task ids (`backend/src/modules/timer/routes.ts:236-260`). Start focus
   mid-session silently moved hours: GAP, resolved by D4.
3. **Security.** No issues found: no new endpoints or inputs; the rank call reuses an existing
   authenticated, user-scoped GET; opted-out users stay off the card.
4. **Data flow & interactions.** Gap D4 (running session) resolved. Double-tap, empty list,
   cross-device inbox reads and overlapping rank fetches (identical query, either result correct) handled.
5. **Code quality.** Rank lookup as a helper beside the store's call, not an inline `api.get`;
   picker and card rules as pure functions in `mobile/lib/` like `taskBoard.ts`.
6. **Tests.** See the Verification plan; the 2am test is the D4 running-session case.
7. **Performance.** No issues found: one GET per You visit; notification fetch rate about
   unchanged; tabs mount lazily.
8. **Observability.** WARNING: no product analytics, so use of Community and Time after the move
   cannot be measured. D1 excluded a retention measure; recorded, not re-pitched.
9. **Deployment.** Mobile-only, no migration; staging dev build, then over the air; older builds unaffected.
10. **Trajectory.** Reversibility 4/5. Debt: `tasks.tsx` stays 2,821 lines (existing);
    `AscendTabIcon` retired. Phase 2 (plan ritual, weekly review) would live on Today and Time.
11. **Design & UX.** User flow and state map below. WARNING: a brand-new user's Today (empty
    Tasks zone, empty hero, "Start focus") needs a deliberate first-task invitation; recommend
    /plan-design-review before implementation.

### Outside voice (native fallback; Codex not installed)

| # | Finding (severity) | Disposition |
|---|---|---|
| OV1 | D4 guard "not idle" blocks picking the next task during a break (High) | Corrected: guard on `running`/`paused` only (`timerStore.ts:26`); break test added. Preserves D4's intent. |
| OV2 | Time tab drops the goals lens from the Time card (High) | Corrected: `lens` route param, both entry points kept (`TimeCard.tsx:51, 91`). |
| OV3 | Shared-hook list incomplete; report period sharing (Medium) | Corrected: list completed; `reportPeriod` in the shared hook. |
| OV4 | Community and group screens can stack in a loop (Medium) | Corrected: go back when the previous screen is Community, else navigate without stacking. |
| OV5 | Feed screen's today-recap card and start-session entry move into Community (Medium) | Kept: covered by D3 ("keeps everything the feed screen has"). Candidate question for /plan-design-review. |
| OV6 | Dead `'calendar'` sub-view (Medium) | Corrected: verified never set; dropped in the move. |
| OV7 | Scope grew to L with no retention measure; cut E5 rank for a daily-open counter (High, strategic) | Not reopened: D1 excluded a retention measure with option B shown; E5-DATA was just answered. Disagreement recorded. |
| OV8 | Round 3 spec fixes not re-verified (Medium) | Acknowledged in CEO plan Reviewer Concerns; OV1-OV4 and OV6 corrections are of that kind. |
| OV9 | No throttle on focus refetches (Low) | No change: one small GET per focus is acceptable at current scale. |
| OV10 | Old deep links to `/(tabs)/tasks` (Low) | Factual correction: none exist; the push listener routes by notification type, not a stored path. |

## What already exists

- Today's content: the Tasks tab (hero card, Tasks/Goals/Time zones), reused whole.
- Feed, leaderboard, groups, inbox: the social screen (`index.tsx`), moved whole to Community.
- Time report: `TimeAnalyticsView` and its lenses, moved into a tab.
- Rank, streak, posts, followers: already on Profile (`goals.tsx`), which becomes You.
- `selectAndFocus` / `goToFocus` (`tasks.tsx:2272-2273`), reused by the Start button.
- `showOnLeaderboard` privacy setting, reused by the Community card.

## Dream state delta

The front door now shows the planner and the loop is named in the bar (Today, Focus, Calendar,
Time, You). Still missing versus the 12-month ideal (all excluded by D1): the daily plan ritual,
the weekly review, any retention evidence, and a paid tier (projects with clients, billable
export, AI planning).

## Error & Rescue Registry

| Capability | Failure | Rescue | User sees |
|---|---|---|---|
| You: global rank fetch | network/5xx | title only, logged | "Community" without numbers |
| Today: notification fetch | network/5xx | logged, return (`socialStore.ts:484`) | bell without badge |
| Start focus | task deleted on another device | server drops unowned id | session saved without a task |
| Start focus | session running or paused | D4 guard: opens Focus only | "Back to focus: <task>" |
| Time tab | unknown lens param | default overview | overview |

## Failure Modes Registry

```
  CODEPATH                 | FAILURE MODE                 | RESCUED? | TEST?  | USER SEES?          | LOGGED?
  -------------------------|------------------------------|----------|--------|---------------------|--------
  Start focus (D4)         | switch task mid-session      | Y (D4)   | Y unit | Back to focus       | n/a
  Start focus              | no open task                 | Y        | Y unit | Start focus (empty) | n/a
  Community card rank      | fetch fails                  | Y        | Y unit | title only          | Y
  Community card rank      | opted out / no position      | Y        | Y unit | unread only         | n/a
  Bell                     | notification fetch fails     | Y        | manual | no badge            | Y
  Time tab                 | wrong/absent lens param      | Y        | manual | overview            | n/a
  Group posts -> Community | stacked screens loop         | Y (OV4)  | manual | back to Community   | n/a
```
No CRITICAL GAPS.

## Scope Expansion Decisions

Full record: CEO plan `~/.gstack/projects/Hafeezrahman735-pomodoro-app/ceo-plans/2026-10-29-today-as-home.md`.
- Accepted: E1 Time tab; E5 Community preview (with E5-DATA rank fetch).
- Deferred: E2 running-timer pill; E4 "Show Community" setting (both in TODOS.md).
- Skipped: E3 one-time "social moved" tip.

## Diagrams

System architecture and user flow:
```
 (tabs): index=Today  focus  calendar  time(lens param)  goals(You)
           |  bell -> inbox sheet          ^                 |  Community card (N new · #P)
           |  Start focus -> FOCUS         | See more/goals  |        |
           |  Time card ------------------+                  |        v
           +-- task-list / goal-detail sub-views             app/community.tsx (pushed, back arrow)
                                                             feed | leaderboard | groups | + post
                                                                    |  /group/:id -> posts -> back
```
Data flow with shadow paths (Community card):
```
 You gains focus -> GET leaderboard(global, all_time) -> myEntry.position -> local state -> "#P"
        | fetch error -> log, title only     | opted out / null position -> unread only
 socialStore.unreadCount (loaded by Today) -> "N new"   | fetch error -> no count
```
State (Start focus button):
```
 timer idle|break --(open task)--> "Start: <task>" --tap--> select + open Focus
 timer idle|break --(none)-------> "Start focus"   --tap--> open Focus empty
 timer running|paused -----------> "Back to focus: <task>" --tap--> open Focus (selection unchanged)
```
Deployment and rollback:
```
 commit -> staging dev build -> manual checks -> over-the-air to production
 broken? -> git revert -> over-the-air again (no data migration; instant, lossless)
```

### Stale Diagram Audit
Files touched by this plan carry no ASCII diagrams describing navigation; none stale.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above.
Assumption: features ~30x, tests ~50x human-to-CC.

- [ ] **T1 (P1, human: ~3h / CC: ~10min)** — mobile/navigation — Move Tasks content to `(tabs)/index`, feed to `app/community.tsx`, set the bar Today, Focus, Calendar, Time, You with icons and labels
  - Surfaced by: D2, D3, E1; build section "Routes", "Bottom bar"
  - Files: `mobile/app/(tabs)/_layout.tsx`, `mobile/app/(tabs)/index.tsx`, `mobile/app/(tabs)/tasks.tsx`, `mobile/app/community.tsx`, `mobile/components/TabIcons.tsx`
  - Verify: cold launch and post-onboarding land on Today; tab order and labels on a staging build
- [ ] **T2 (P1, human: ~2h / CC: ~10min)** — mobile/today — Start-focus button with a pure target picker and the D4 guard in `selectAndFocus`
  - Surfaced by: D2, D4, OV1
  - Files: `mobile/app/(tabs)/index.tsx`, `mobile/lib/` (new picker module and test)
  - Verify: `npx vitest run` covers open task, none, ticked recurring row, running, paused, break
- [ ] **T3 (P1, human: ~2h / CC: ~10min)** — mobile/today — Bell with unread badge and the inbox sheet on Today; refetch on focus; remove Community's bell
  - Surfaced by: D3; build section "Notifications"
  - Files: `mobile/app/(tabs)/index.tsx`, `mobile/app/community.tsx`
  - Verify: badge count and inbox on staging; a fetch failure shows no badge
- [ ] **T4 (P1, human: ~4h / CC: ~15min)** — mobile/time — Extract `TimeAnalyticsView` into `(tabs)/time.tsx` with a `lens` param and the shared goal/tag/period hook
  - Surfaced by: E1, OV2, OV3, round 3 feasibility
  - Files: `mobile/app/(tabs)/time.tsx`, `mobile/app/(tabs)/index.tsx`, `mobile/hooks/` (new shared hook)
  - Verify: Time tab on overview; Time card "See more" and goals row open the right lens; goal edit/delete and tag override work from Time
- [ ] **T5 (P1, human: ~2h / CC: ~10min)** — mobile/you — Rename Profile to You; Community card with unread count and a global rank helper; display rules as a pure function
  - Surfaced by: D3, E5, E5-DATA, Section 5
  - Files: `mobile/app/(tabs)/goals.tsx`, `mobile/stores/socialStore.ts` (rank helper), `mobile/lib/` (card rules and test)
  - Verify: vitest for unread only, opted out, no position, error; manual "N new · #P"
- [ ] **T6 (P1, human: ~1h / CC: ~5min)** — mobile/links — Repoint old-home links and the `goal_due` push; group posts back-or-navigate; You's empty-posts copy
  - Surfaced by: D3, OV4, round 1 completeness
  - Files: `mobile/hooks/useNotificationListener.ts`, `mobile/app/group/[id].tsx`, `mobile/app/(tabs)/goals.tsx`
  - Verify: `goal_due` push opens Today; group -> posts -> back returns to Community once
- [ ] **T7 (P2, human: ~1h / CC: ~10min)** — design — Run /plan-design-review on Today's first-run state and the recap card left on Community
  - Surfaced by: Section 11 WARNING, OV5
  - Files: to be determined
  - Verify: design review report with a decision on both

JSONL task artifact: not written (jq is not installed). Install jq for /autoplan aggregation.

## Reality rows

```
REALITY: premise-table pass 10 claims checked, unverified=1 (pricing: sources conflict) backend/prisma/schema.prisma:131
REALITY: already-done pass no nav change on staging since the ask (git log head 83a6b94) 83a6b94
REALITY: surface-check pass routes and endpoint verified: /social/focus-leaderboard mobile/stores/socialStore.ts:453
REALITY: binding-decisions pass no recorded decision on navigation; AI-provider stance respected mobile/package.json:44
REALITY: numbers pass 2 recurring owners [measured: docs/designs/recurring-tasks-rule-and-log.md:1207]; tasks.tsx 2,821 lines [measured: mobile/app/(tabs)/tasks.tsx:2821]; effort [estimated] docs/designs/ascend-direction-freelancer-planner.md:143
REALITY: deferred-asks pass no linked issue docs/designs/ascend-direction-freelancer-planner.md:5
REALITY: pr-count pass one PR per wave (no ship-policy file) docs/designs/ascend-direction-freelancer-planner.md:143
```
PLAN_REALITY: phase=ceo rows=7/7 missing=none unverified=1 verdict=complete


Approval readiness: PASS — D1 (answer "Nav only"), D2 ("Today"), D3 ("Community from You"),
E1 ("Add"), E2 ("Defer"), E3 ("Skip"), E4 ("Defer"), E5 ("Add"), E5-DATA ("Fetch rank on You"),
D4 ("Guard selection"); document approval ("Approve and continue"). OV1-OV4 and OV6 are factual
corrections inside those answers; OV7 is recorded as disagreement, not a change.

## Completion Summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SCOPE EXPANSION                             |
  | System Audit         | social is home; Today-ish hub and planning  |
  |                      | view exist; no projects/export/AI/analytics |
  | Step 0               | nav only; Today home; Community from You    |
  | Section 1  (Arch)    | 1 issue found (rank helper boundary)        |
  | Section 2  (Errors)  | 5 error paths mapped, 1 GAP (resolved D4)   |
  | Section 3  (Security)| 0 issues found, 0 High severity             |
  | Section 4  (Data/UX) | 6 edge cases mapped, 0 unhandled            |
  | Section 5  (Quality) | 2 issues found                              |
  | Section 6  (Tests)   | Diagram produced, 0 gaps                    |
  | Section 7  (Perf)    | 0 issues found                              |
  | Section 8  (Observ)  | 1 gap found (no analytics; D1 excluded)     |
  | Section 9  (Deploy)  | 0 risks flagged                             |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 2           |
  | Section 11 (Design)  | 1 issue (first-run Today)                   |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                           |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 5 rows, 0 CRITICAL GAPS                     |
  | Failure modes        | 7 total, 0 CRITICAL GAPS                    |
  | TODOS.md updates     | 2 items (E2, E4)                            |
  | Scope proposals      | 5 proposed, 2 accepted                      |
  | CEO plan             | written                                     |
  | Outside voice        | codex unavailable (not installed);          |
  |                      | native fallback completed, 10 findings      |
  | Lake Score           | 1/1 recommendations chose complete option   |
  | Diagrams produced    | 5 (architecture, data flow, state, deploy,  |
  |                      | rollback)                                   |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 0                                           |
  | Reality rows         | 7/7 rows, 1 unverified                      |
  +====================================================================+
```

### Unresolved Decisions
None.

## Eng review (2026-10-30)

Target: docs/designs/ascend-direction-freelancer-planner.md (fixed). Binding decisions: CEO review D1, D2, D3, E1, E5, E5-DATA, D4.

### Scope Challenge

- Reuse: Today = Tasks screen moved whole; Community = social screen moved whole; Time = `TimeAnalyticsView` + `useTimeReport` (owns fetching and `ReportPeriod`, `mobile/hooks/useTimeReport.ts:26`); Start focus = `selectAndFocus`/`goToFocus`; rank = existing `/social/focus-leaderboard`. No backend change.
- Minimum change: the approved scope is already minimal; nothing deferrable without breaking an approved decision.
- Search check: no new architectural pattern; tabs, pushed screen, focus refetch and route params are Expo Router built-ins [Layer 1].
- Complexity [estimated]: ~15 files (6 edited, 3 rewritten/moved, 6 new) and 3 new modules -> gate tripped.
- Scope record: feature answers: none proposed (no cuts); structure: A "Original arrangement" (eng D1, 2026-10-30); accepted scope: CEO-approved scope as written, arranged as `lib/startFocusTarget.ts` + test, `lib/communityCard.ts` + test, `hooks/useGoalForm.ts` (superseded by R1: `components/goals/GoalEditor.tsx`), rank helper in `stores/socialStore.ts`, plus `components/social/NotificationsSheet.tsx` (C2); pending remedies: none.
- Result: scope accepted as-is.

### Section 1 corrections (factual; no behavior change)

- C1 [INFORMATIONAL] (confidence: 9/10) `mobile/app/_layout.tsx:342` — `<Stack screenOptions={{ headerShown: false }}>`: Community needs its own `<Stack.Screen name="community" />` entry, and its "header with a back arrow" is a custom header like the other pushed screens, not the native one.
- C2 [INFORMATIONAL] (confidence: 9/10) `mobile/app/(tabs)/index.tsx:1719` — `<Modal visible={showNotifications} ...>`: the inbox is an inline modal with screen state (`:1280`). It is extracted to `mobile/components/social/NotificationsSheet.tsx` (one more file) so Today can mount it.

### Outside-voice corrections (factual; inside approved decisions)

- OV1 `GoalFormModal` (`tasks.tsx:879`) and `TagOverrideSheet` (`tasks.tsx:2019`) are private to the route file with their helpers (`getStyles`, `plannedHoursText`, `parsePlannedHours`, `TaskMultiSelect`). They move to `mobile/components/goals/GoalFormModal.tsx` and `mobile/components/timeReport/TagOverrideSheet.tsx` with those helpers, so `GoalEditor` (R1) and `time.tsx` can import them. Two more files.
- OV2 `TimeAnalyticsView` sets `useState<Lens>(initialLens)` once (`TimeAnalyticsView.tsx:57`); a mounted tab would ignore later `lens` params. The view re-syncs its lens when the `initialLens` prop changes (effect keyed on the param plus a request nonce so a repeat tap on the same lens still applies).
- OV4 `TimeCard` takes no period and always shows this week (`TimeCard.tsx:27-30`), so there is no period to share. `reportPeriod` and `overrideTag` stay local state in `time.tsx`; the earlier "shared hook" wording for them is withdrawn.
- OV5 `onBack` is a required prop that always renders a back header (`TimeAnalyticsView.tsx:52, 66-74`). It becomes optional; with no `onBack` the header renders without a back button.
- OV6 `today` is read once per mount (`TimeAnalyticsView.tsx:63`, `TimeCard.tsx:29`). As always-mounted tabs, Time and Today's Time card re-read the local day when they gain focus.
- OV7 R2's inputs: `GoalEditor` derives both the picker's `linkableTasks` and `linkedBefore` from the same task list (`useTasksList`) so the delta function never compares two different lists.
- OV8 The group screen's "posts" action uses `router.dismissTo('/community')`, which returns to an existing Community screen or opens one, instead of hand-written back-or-navigate logic.
- OV9 `lib/startFocusTarget.ts` imports `TimerStatus` as a type only; `timerStore` pulls in native modules and vitest runs in plain Node.
- R3 mechanics: `timerStore` already imports `taskStore` (`timerStore.ts:158, 317`), and a reverse import would close a cycle like the one `initTaskStore` exists to avoid (`taskStore.ts`, "circular import crash"). The guard reads the session state through a dependency-free `mobile/stores/sessionLock.ts` (`isSessionActive()`), which `timerStore` updates whenever its status changes; `taskStore.selectTask` reads it. One more file; the store-level test sets the lock directly.

### Decision ledger (eng)

#### R1: How the goal form is shared between Today and Time
Finding: 1, INFORMATIONAL, confidence 9/10, `mobile/app/(tabs)/tasks.tsx:2548, 2578, 2816` (`<GoalFormModal visible={showGoalForm} goal={formGoal} existingTags=...`), reviewer: eng review Section 1 (design-twice, red flag 8 hand-synced list)
Plan baseline: `hooks/useGoalForm.ts` holding the handlers and form state; each screen renders `<GoalFormModal>` with the full prop list (CEO build section "Time tab"; eng D1 "Original arrangement")
Runtime evidence: the modal is already mounted three times in Tasks with the same seven props; the Time tab would add a fourth in another file
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 goal form sharing | 3 identical mounts in tasks.tsx | `GoalEditor` component: owns derived `existingTags`, `nonArchived`, `goals` and the save/delete handlers; screens render `<GoalEditor goal visible onClose />` | `useGoalForm` hook: returns handlers and state; each of 4 mounts passes 7 props |
| Approved features (D2, D3, E1, E5, E5-DATA, D4) | approved | unchanged | unchanged |
| File count | ~16 | ~16 (component replaces hook) | ~16 |
| Tests | approved verification plan | unchanged | unchanged |

Question D2:
D2 — How should Today and the Time tab share the goal-editing form?
Project/branch/task: Ascend staging, eng review of the navigation plan.
ELI10: the form for editing a goal is already placed three times inside the Tasks screen, each time with the same seven settings typed out. The plan adds a fourth copy in the new Time tab. The approved plan shares only the logic (a hook), so each screen still types out all seven settings. A small component that owns the form, its data and its save/delete logic would make each placement one line.
Stakes if we pick wrong: with four hand-typed copies, a future change to the form updates three and misses one, and that screen saves goals differently.
Recommendation: A because one owner for the form removes the hand-synced prop lists (explicit over clever, and fixes three existing copies at the same cost).
Completeness: A=10/10, B=7/10
Pros / cons:
A) Goal editor component (recommended)
  ✅ Each of the four placements becomes one line, so they can never drift apart.
  ✅ Fixes the three existing copies in Tasks at the same time, at no extra file cost.
  ❌ The component reads stores itself, so it is less reusable outside the task screens.
B) Shared hook (as approved)
  ✅ Matches the arrangement already approved, no change to the plan's wording.
  ✅ Keeps the modal a plain prop-driven component that is easy to reason about.
  ❌ Four places still pass the same seven props by hand and can drift apart.
Net: same file count; A removes four hand-synced copies, B keeps them.
Header: Goal form
Options:
A) Goal editor component (recommended)
`components/goals/GoalEditor.tsx` owns the derived data and save/delete handlers; Today's three mounts and the Time tab each render `<GoalEditor goal visible onClose />`. (human: ~2h / CC: ~10 min) ✅ Each of the four placements becomes one line, so they can never drift apart. ✅ Fixes the three existing copies in Tasks at the same time, at no extra file cost. ❌ The component reads stores itself, so it is less reusable outside the task screens.
B) Shared hook (as approved)
`hooks/useGoalForm.ts` returns handlers and state; each of the four mounts passes the seven props. (human: ~2h / CC: ~10 min) ✅ Matches the arrangement already approved, no change to the plan's wording. ✅ Keeps the modal a plain prop-driven component that is easy to reason about. ❌ Four places still pass the same seven props by hand and can drift apart.

State: approved
Actual answer: A) Goal editor component — founder answer to eng D2, 2026-10-30.
Accepted scope: `mobile/components/goals/GoalEditor.tsx` owns the derived `existingTags`, `nonArchived`, `goals` and the save/delete handlers (moved from `tasks.tsx:2256-2258, 2408, 2432`); Today's three mounts (`tasks.tsx:2548, 2578, 2816`) and the Time tab render `<GoalEditor goal visible onClose />`. Replaces `hooks/useGoalForm.ts` in the arrangement; file count unchanged.
History: plan baseline was the shared hook (eng D1 arrangement, CEO build section "Time tab").

#### R2: Regression coverage for the goal link/unlink deltas moving into GoalEditor
Finding: 2, CRITICAL (regression rule), confidence 9/10, `mobile/app/(tabs)/tasks.tsx:2441-2448` (`const before = tasks.filter((t) => t.taskGoalId === formGoal.id).map((t) => t.id); const link = ...; const unlink = ...`), reviewer: eng review Section 3
Plan baseline: R1 moves `handleGoalSave` into `GoalEditor`; no test covers the delta computation (it lives inside a screen component; mobile vitest renders no components)
Runtime evidence: the deltas decide which tasks the server unlinks; the code comment records that sending the whole set "would tell the server to unlink everything absent from it"
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R2 delta coverage | none | extract pure `goalLinkDeltas(linkedBefore, selected)` to `mobile/lib/`, unit-test: add only, remove only, both, unchanged (no request), create path untouched | manual QA on staging only |
| R1 GoalEditor | approved | unchanged | unchanged |
| Behavior to preserve | existing | link = selected minus before; unlink = before minus selected; no request when both empty | same |

Question D3:
D3 — How should the goal link/unlink logic be protected when it moves?
Project/branch/task: Ascend staging, eng review of the navigation plan.
ELI10: when you edit a goal's task list, the app works out which tasks to add and which to remove, instead of sending the whole list. That matters: sending the whole list would quietly unlink finished tasks the picker never showed. This logic moves into the new goal editor and has no test today. Pulling the arithmetic into a tiny function with a test locks the behaviour before it moves.
Stakes if we pick wrong: a slip in the move could unlink a goal's completed tasks, dropping its progress, with nothing to catch it.
Recommendation: A because a pure function with four test rows protects the exact contract cheaply (every behavior tested, no test without a regression it would catch).
Completeness: A=10/10, B=5/10
Pros / cons:
A) Pure function + unit test (recommended)
  ✅ The add/remove rules are locked by a test before and after the move.
  ✅ Tiny function, runs in the existing vitest suite in milliseconds.
  ❌ One more small module and test file in mobile/lib.
B) Manual QA only
  ✅ No new files; the code moves as it is.
  ✅ Staging checks already cover editing a goal by hand.
  ❌ A slip that unlinks completed tasks could pass a quick manual check unnoticed.
Net: one small tested function versus trusting a manual check with goal progress.
Header: Goal deltas
Options:
A) Pure function + unit test (recommended)
`mobile/lib/goalLinkDeltas.ts` + test: add only, remove only, both, unchanged sends nothing; GoalEditor calls it. (human: ~1h / CC: ~5 min) ✅ The add/remove rules are locked by a test before and after the move. ✅ Tiny function, runs in the existing vitest suite in milliseconds. ❌ One more small module and test file in mobile/lib.
B) Manual QA only
Move the code as it is and check goal editing on staging. (human: ~15 min / CC: ~0) ✅ No new files; the code moves as it is. ✅ Staging checks already cover editing a goal by hand. ❌ A slip that unlinks completed tasks could pass a quick manual check unnoticed.

State: approved
Actual answer: A) Pure function + unit test — founder answer to eng D3, 2026-10-30.
Accepted scope: `mobile/lib/goalLinkDeltas.ts` (link = selected minus linked-before; unlink = linked-before minus selected) with `mobile/lib/goalLinkDeltas.test.ts` rows: add only, remove only, both, unchanged (both empty, so GoalEditor sends no link request). GoalEditor calls it; the create path stays as it is.
History: none

#### R3: Where the D4 running-session guard lives (reopened D4 mechanism)
Finding: OV3 (eng outside voice), High, confidence 9/10, `mobile/app/(tabs)/tasks.tsx:2661, 2803` (`onLoadTimer={(id) => { taskActions.selectTask(id); setStatsTask(null); }}`), reviewer: native Claude subagent (outside-voice fallback)
Plan baseline: D4 (CEO review) approved "the same check inside `selectAndFocus` stops the hero card switching tasks"; its stated contract: a running session's time stays with the task it started on
Runtime evidence: the task stats sheet's "load timer" calls `selectTask` directly, bypassing `selectAndFocus`; the Focus screen's task picker also calls `selectTask` mid-session (`focus.tsx:867`), where switching is a deliberate correction in front of the timer
Comparison grid:

| Choice | Current (D4) | A | B | C |
|---|---|---|---|---|
| Today Start button + hero card | guarded | guarded | guarded | guarded |
| Task stats sheet "load timer" (`tasks.tsx:2661, 2803`) | unguarded | guarded (shared helper) | guarded (store) | unguarded |
| Focus screen picker (`focus.tsx:867`) | switches, credit moves | switches, credit moves (deliberate) | blocked while running/paused | switches |
| Guard location | `selectAndFocus` | one shared helper used by every Today path | `taskStore.selectTask` | `selectAndFocus` |
| Test | picker unit test | + stats sheet path uses the helper | + store-level test | unchanged |

Question D4:
D4 — Which paths should the running-session guard cover?
Project/branch/task: Ascend staging, eng review of the navigation plan.
ELI10: the CEO review promised a running session's time always stays with the task it started on, and guarded the new Start button and the hero card. The second-opinion review found a third way to switch: the task details sheet's "load timer" button switches the selected task directly, mid-session. The Focus screen's own picker also switches, but there you're choosing deliberately with the timer in front of you, for example to correct a wrong pick.
Stakes if we pick wrong: leave the details sheet open and hours can still silently move; block everything and you can't fix a wrong pick without stopping the session.
Recommendation: A because it closes every accidental path from Today while keeping the deliberate correction on the Focus screen (explicit over clever: switching happens only where the timer is visible).
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Guard every Today path (recommended)
  ✅ Closes the details-sheet hole, so no Today tap can move a running session's hours.
  ✅ Keeps deliberate switching on the Focus screen, where you can see the timer.
  ❌ The rule lives in a helper, so a future Today button must remember to use it.
B) Guard in the store
  ✅ One guard catches every caller, including future ones, automatically.
  ✅ The promise holds with no exceptions anywhere in the app.
  ❌ You can't correct a wrong pick on the Focus screen without stopping the session.
C) Keep as approved
  ✅ No change to the approved plan or its tests.
  ✅ The two most visible buttons are already guarded.
  ❌ The details sheet can still silently move a running session's hours to another task.
Net: A closes the accidental paths and keeps the deliberate one; B closes all paths at the cost of corrections.
Header: Guard scope
Options:
A) Guard every Today path (recommended)
One helper (`startOrResumeFocus`) used by the Start button, hero card and task details sheet; Focus picker unchanged; unit test extended. (human: ~1h / CC: ~5 min) ✅ Closes the details-sheet hole, so no Today tap can move a running session's hours. ✅ Keeps deliberate switching on the Focus screen, where you can see the timer. ❌ The rule lives in a helper, so a future Today button must remember to use it.
B) Guard in the store
`taskStore.selectTask` refuses to change selection while a session runs or is paused; the Focus picker is disabled then. (human: ~1.5h / CC: ~10 min) ✅ One guard catches every caller, including future ones, automatically. ✅ The promise holds with no exceptions anywhere in the app. ❌ You can't correct a wrong pick on the Focus screen without stopping the session.
C) Keep as approved
Guard only `selectAndFocus`; the details sheet keeps switching mid-session. (human: 0 / CC: 0) ✅ No change to the approved plan or its tests. ✅ The two most visible buttons are already guarded. ❌ The details sheet can still silently move a running session's hours to another task.

State: approved
Actual answer: B) Guard in the store — founder answer to eng D4, 2026-10-30.
Accepted scope: `taskStore.selectTask` refuses to change the selection while the timer status is `running` or `paused` (`timerStore.ts:26`; `break` and `idle` allowed), covering the Start button, hero card, task details sheet (`tasks.tsx:2661, 2803`) and the Focus screen picker (`focus.tsx:867, 909`). The Focus picker is disabled while a session runs or is paused, with a line saying to finish or stop the session to switch. The Start button still reads "Back to focus: <task>" and only opens Focus. Store-level unit test: selectTask during running/paused leaves the selection unchanged; during idle/break it changes. Replaces D4's `selectAndFocus`-only guard.
History: reopens the mechanism of CEO D4 ("Guard selection", 2026-10-29) on new evidence (OV3); D4's contract is unchanged.

### Eng review sections (findings and dispositions)

**1. Architecture** (5 findings)
- [INFORMATIONAL] (confidence: 9/10) `mobile/app/_layout.tsx:342` — C1 global `headerShown: false`; Community needs a `Stack.Screen` entry and a custom header. Accepted (factual).
- [INFORMATIONAL] (confidence: 9/10) `mobile/app/(tabs)/index.tsx:1719` — C2 inline inbox modal; extract `NotificationsSheet`. Accepted (factual).
- [INFORMATIONAL] (confidence: 9/10) `mobile/app/(tabs)/tasks.tsx:2548, 2578, 2816` — three hand-synced `GoalFormModal` mounts. Approved R1 (eng D2): `GoalEditor` component.
- [INFORMATIONAL] (confidence: 8/10) `mobile/app/(tabs)/index.tsx:1217, 1226` — leaderboard scope and period strings would be repeated by the rank helper. Accepted (mechanic of E5-DATA): define once beside the helper.
- [INFORMATIONAL] (confidence: 8/10) `mobile/stores/socialStore.ts:446-462` — two leaderboard parsers. Accepted (mechanic of E5-DATA): `fetchFocusLeaderboard` calls the helper, then stores.

**2. Code quality** (2 findings)
- [INFORMATIONAL] (confidence: 9/10) `mobile/app/(tabs)/tasks.tsx:2444-2445` — comment about "archived recurring instances" is stale after the rule-and-log change; rewrite in the move. Accepted.
- [INFORMATIONAL] (confidence: 7/10) `mobile/lib/taskBoard.ts` — header comments describe day copies; refresh when building on `topTasks`. Accepted.

**3. Tests** (1 gap)
- [CRITICAL] (confidence: 9/10) `mobile/app/(tabs)/tasks.tsx:2441-2448` — untested link/unlink deltas move into `GoalEditor`. Approved R2 (eng D3): `goalLinkDeltas` pure function + unit test.
- Test plan artifact: `~/.gstack/projects/Hafeezrahman735-pomodoro-app/hafee-staging-eng-review-test-plan-20261029-233354.md`.

**4. Performance** (1 finding)
- [INFORMATIONAL] (confidence: 7/10) `GoalEditor` (R1) — derive `existingTags`/`nonArchived` only while visible, not in all four mounts on every render. Accepted (mechanic of R1). Launch gets lighter: the feed's launch-time social fetches move off the cold path.

**Outside voice (native fallback; Codex not installed)** — 9 findings: OV1, OV2, OV4-OV9 applied as factual corrections (see "Outside-voice corrections"); OV3 reopened the D4 mechanism and was resolved as R3 (eng D4: guard in the store).

### What already exists (eng)

- `useTimeReport` owns report fetching and `ReportPeriod`; reused by the Time tab unchanged.
- `TimeAnalyticsView` reused; two small prop changes (optional `onBack`, lens re-sync).
- `GoalFormModal`, `TagOverrideSheet` moved out of the route file, not rewritten.
- `/social/focus-leaderboard` reused; one parser shared by the store and the rank helper.

### Failure modes (eng)

| Path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| `selectTask` guard (R3) | lock out of sync with timer status | store unit test + timerStore updates lock on every status change; manual check | selection refused or allowed wrongly (visible on Focus) |
| `GoalEditor` save (R1/R2) | deltas computed from different lists | `goalLinkDeltas` test + single source (OV7) | goal edit saves correctly |
| Time tab lens (OV2) | stale lens after first visit | re-sync effect; manual tap sequence | correct lens |
| Time tab day (OV6) | stuck on first-opened day | focus re-read; manual past-midnight check | today's data |
| Community route (C1) | missing `Stack.Screen` | manual navigation check | screen opens with header |
No critical gaps (every path has a test or handling, and none is silent).

### Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| A. Route move and tab bar | `mobile/app/(tabs)/`, `mobile/app/` (root layout, community), `mobile/components/social/` | — |
| B. Time tab | `mobile/app/(tabs)/`, `mobile/components/timeReport/`, `mobile/components/goals/`, `mobile/lib/` | A |
| C. Session guard and Start button | `mobile/stores/`, `mobile/lib/`, `mobile/app/(tabs)/` | A |
| D. You and Community card | `mobile/app/(tabs)/`, `mobile/stores/`, `mobile/lib/` | A |

Parallel lanes: Lane A first (it moves the files everyone edits). Then Lane C and Lane D in parallel; Lane B after A.
Execution order: A. Merge. Then C + D in parallel. Merge. Then B.
Conflict flags: `mobile/app/(tabs)/index.tsx` (Today) is edited by B (GoalEditor mounts), C (Start button) and D (bell) — sequence those edits; `mobile/stores/` is shared by C (sessionLock, taskStore) and D (socialStore helper) but in different files.

### Implementation Tasks (eng)

Synthesized from this review's findings; refines the CEO tasks T1-T7 above. Assumption: features ~30x, tests ~50x human-to-CC.

- [ ] **E1 (P1, human: ~2h / CC: ~10min)** — mobile/stores — Add `stores/sessionLock.ts`; timerStore updates it on every status change; `taskStore.selectTask` refuses changes while running/paused; Focus picker disabled then
  - Surfaced by: R3 (eng D4), OV3
  - Files: `mobile/stores/sessionLock.ts`, `mobile/stores/timerStore.ts`, `mobile/stores/taskStore.ts`, `mobile/app/(tabs)/focus.tsx`
  - Verify: vitest store test (running/paused refused, idle/break allowed); manual Focus picker check
- [ ] **E2 (P1, human: ~3h / CC: ~15min)** — mobile/goals — Move `GoalFormModal` and `TagOverrideSheet` (with helpers) out of the route file; add `GoalEditor`; replace the three mounts
  - Surfaced by: R1 (eng D2), OV1, Section 4
  - Files: `mobile/components/goals/GoalFormModal.tsx`, `mobile/components/goals/GoalEditor.tsx`, `mobile/components/timeReport/TagOverrideSheet.tsx`, `mobile/app/(tabs)/index.tsx`
  - Verify: edit, create and delete a goal from Today on staging
- [ ] **E3 (P1, human: ~1h / CC: ~5min)** — mobile/lib — `goalLinkDeltas` pure function and test; GoalEditor derives both lists from one source
  - Surfaced by: R2 (eng D3), OV7
  - Files: `mobile/lib/goalLinkDeltas.ts`, `mobile/lib/goalLinkDeltas.test.ts`
  - Verify: `npx vitest run lib/goalLinkDeltas.test.ts`
- [ ] **E4 (P1, human: ~2h / CC: ~10min)** — mobile/time — `TimeAnalyticsView`: optional `onBack`, lens re-sync, focus re-read of today; `time.tsx` keeps `reportPeriod`/`overrideTag` local
  - Surfaced by: OV2, OV4, OV5, OV6
  - Files: `mobile/components/timeReport/TimeAnalyticsView.tsx`, `mobile/components/timeReport/TimeCard.tsx`, `mobile/app/(tabs)/time.tsx`
  - Verify: manual lens tap sequence and past-midnight check
- [ ] **E5 (P1, human: ~1h / CC: ~5min)** — mobile/navigation — `Stack.Screen` for community with a custom header; `NotificationsSheet` extraction; `router.dismissTo('/community')` from the group screen
  - Surfaced by: C1, C2, OV8
  - Files: `mobile/app/_layout.tsx`, `mobile/components/social/NotificationsSheet.tsx`, `mobile/app/group/[id].tsx`
  - Verify: You -> Community -> group -> posts -> back lands on one Community screen
- [ ] **E6 (P2, human: ~30min / CC: ~5min)** — mobile/social — One leaderboard parser and shared scope/period constants for the store and the rank helper
  - Surfaced by: Section 1 (red flags 2 and 6)
  - Files: `mobile/stores/socialStore.ts`
  - Verify: Community leaderboard and You card show the same position for the global all-time view

_No new tasks from Performance beyond E2's visible-only derivation._

JSONL task artifact: not written (jq is not installed). Install jq for /autoplan aggregation.

### Reality rows (eng)

```
REALITY: premise-table pass 12 code claims re-checked against source, unverified=0 mobile/components/timeReport/TimeAnalyticsView.tsx:57
REALITY: already-done pass no overlapping work on origin/main since 2026-10-29 (git log empty) 83a6b94
REALITY: surface-check pass router.dismissTo and useFocusEffect are expo-router built-ins; endpoint verified mobile/stores/socialStore.ts:453
REALITY: binding-decisions pass CEO D1-D4, E1, E5, E5-DATA honored; D4 mechanism reopened only on new evidence (R3) docs/designs/ascend-direction-freelancer-planner.md:60
REALITY: numbers pass ~20 files [estimated]; three GoalFormModal mounts [measured: mobile/app/(tabs)/tasks.tsx:2548] mobile/app/(tabs)/tasks.tsx:2816
REALITY: deferred-asks pass no linked issue docs/designs/ascend-direction-freelancer-planner.md:5
REALITY: pr-count pass one PR per wave (no ship-policy file) docs/designs/ascend-direction-freelancer-planner.md:143
```

PLAN_REALITY: phase=eng rows=7/7 missing=none unverified=1 verdict=complete

### Decision ledger — approval readiness (eng)

Approval readiness: PASS — structure D1 ("Original arrangement"), R1 (eng D2 "Goal editor component"), R2 (eng D3 "Pure function + unit test"), R3 (eng D4 "Guard in the store"). C1, C2, OV1, OV2, OV4-OV9 and the Section 1/2/4 mechanics are factual corrections or required implementation inside those answers and the CEO decisions.

### Unresolved decisions
None.

### Completion summary (eng)

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted (PLAN_REALITY eng complete), 0 unverified premises
- Architecture Review: 5 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 1 gap identified (resolved R2)
- Performance Review: 1 issue found
- NOT in scope: written (CEO section, unchanged)
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex unavailable (not installed); native Claude fallback completed, 9 findings
- Parallelization: 4 lanes, 2 parallel / 2 sequential
- Lake Score: 2/2

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 6 | CLEAR | 5 proposals, 2 accepted, 2 deferred |
| Outside Review | native Claude subagent (Codex not installed) | Independent 2nd opinion | 4 | unavailable (native fallback) | 9 findings (native); 9 resolved; 0 unresolved; no completed external review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 8 | ISSUES OPEN | 9 issues, 0 critical gaps (all resolved or mapped to tasks) |
| Design Review | `/plan-design-review` | UI/UX gaps | 5 | stale (2026-08-27) | score not recorded |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase (CEO and eng): unavailable (codex CLI not installed). Native Claude fallback completed both times (10 and 9 findings); native findings never count as outside coverage.
- **VERDICT:** CEO CLEARED; eng review ran with every decision resolved, status issues_open because its 9 findings are mapped work (tasks E1-E6), so eng review required before it reads CLEAR.

NO UNRESOLVED DECISIONS

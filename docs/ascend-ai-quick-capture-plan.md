# AI Quick Capture — Plan (text → tasks, goals, schedule)

Your question first, since it decides everything else: **can this be done without paying for an AI, or do you need to buy access to one?**

## Direct answer

For a narrow slice — "Buy milk tomorrow 5pm" style single-item quick-add — you can do this with pure code, no paid API, using a date-parsing library (e.g. `chrono-node`) plus keyword matching for priority words ("urgent," "asap") and tag words. This is genuinely free, fully offline, and worth building regardless of what else you do, because it's instant (no network round trip) for the common case.

For what you actually described — type a paragraph, get multiple tasks, a goal, and a schedule out of it — that requires real language understanding. Regex and keyword rules cannot reliably decompose "I want to get back into shape and finish my chemistry lab report before the weekend, maybe three workouts and one big study session" into a goal, a recurring habit, and two dated tasks with sensible titles. That's not a rules problem, it's a comprehension problem. **This part needs an LLM**, which means a paid API call (or a self-hosted model, addressed below).

The good news: at the volume a personal app produces, "paid" doesn't mean expensive.

## What it actually costs

Checked current pricing (August 2026) across the three realistic options. A typical capture request — system prompt + your task/goal schema + the user's text as input, a structured JSON object as output — runs roughly 1,500 input tokens and 500 output tokens:

- **Claude Haiku 4.5**: $1.00 / $5.00 per million input/output tokens → **~$0.004 per capture**
- **GPT-4o-mini**: $0.15 / $0.60 per million → **~$0.0005 per capture**
- **Gemini 2.5 Flash**: $0.15 / $1.25 per million → **~$0.0009 per capture**

Even a heavy user running 20 captures a day is $2.40/month (Haiku) or under $0.35/month (GPT-4o-mini/Gemini) — worth knowing, but not a budget concern at your scale. It only becomes a real cost line item at real scale, which is a good problem to have and easy to gate behind premium if it ever matters (see Cost Controls below).

**Recommendation: pay for API access, don't self-host.** Self-hosting an open-source model (Llama, Mistral) avoids per-token billing but costs you a GPU instance running continuously — that's a higher *fixed* cost than pay-per-use API billing at anything below heavy sustained volume, plus you take on model-serving infrastructure and generally get worse structured-extraction quality than the commercial small models above. An on-device model (running directly on the phone) avoids server costs entirely but current phone-sized models are meaningfully worse at reliable structured extraction, and bundling model weights into the app bloats the binary and drains battery. Neither is worth it for what you're building. Revisit self-hosting only if you're ever doing enough volume that the API bill becomes a real number — not a near-term concern.

**Provider pick:** any of the three works; this isn't a decision to agonize over since you can swap providers later without touching anything downstream of the "structured JSON in" boundary. Claude and GPT-4o-mini/Gemini Flash are all strong at structured/tool-use output. If you want a default to start with: GPT-4o-mini or Gemini Flash for lowest cost, Claude Haiku if you want to stay in one ecosystem or find it noticeably better at following the schema in testing. Worth a quick side-by-side test with 5-10 real example inputs before committing, since "which one follows the schema most reliably" matters more here than raw price difference at this volume.

---

## Where this plugs into the app

This should not be a special, separate write path with its own logic. It should be a **translator that produces the same payloads your existing endpoints already accept**, then hands off to code you've already built and already trust.

```
User types free text
       ↓
POST /ai/capture  (new, single endpoint)
       ↓
LLM call: system prompt + tool schema (mirrors createTaskSchema / TaskGoal createSchema)
       ↓
Structured JSON back: { tasks: [...], goals: [...], habits: [...] }
       ↓
Validate every item against your EXISTING zod schemas — reject/strip anything
that doesn't pass, exactly like a hand-typed request would be rejected
       ↓
Return the validated draft to the client as a PREVIEW — nothing is written yet
       ↓
User reviews, edits, deselects anything wrong, taps Confirm
       ↓
Client calls your EXISTING POST /tasks / POST /task-goals once per confirmed
item — same ownership checks, same goal-sync logic, same everything
```

The key design decision: **the LLM never writes to the database directly.** It only ever produces a draft that a human confirms, and the actual persistence goes through the same `POST /tasks`/`POST /task-goals` calls a normal user action would make. This matters for three reasons: it means all the validation, ownership checks (`userOwnsGoal`), and goal-sync logic (`syncGoalCompletion`) you already built and already trust get reused for free instead of duplicated in a second code path that could drift out of sync with the first. It means a hallucinated or wrong extraction is always caught by a human before it pollutes real data — LLM output is untrusted input, same as any other external data per your own security standards. And it means you can swap the LLM provider or prompt at any time without touching the parts of the app that actually persist data.

### Backend

New module, `backend/src/modules/aicapture/routes.ts`, one route: `POST /ai/capture`. Takes `{ text: string, localDate: string }` (reuse the existing `resolveLocalDate` pattern so relative dates like "Friday" resolve against the user's actual local day, not the server's). Calls the LLM with a tool/function-calling schema, not free-form prose completion — this is the difference between "usually parses right" and "reliably parses right," since tool-use forces the model into your exact shape instead of you regex-ing prose out of a chat response afterward.

The tool schema should mirror what already exists almost field-for-field: title/priority/tags/dueDate/estimatedMinutes for tasks (same enum values as `createTaskSchema`), title/tag/deadline/targetSessions for goals (same as `taskgoals` `createSchema`), and a `habit` variant for anything phrased as recurring ("start exercising," "read every day") that maps to `isRecurring: true` + `recurringDays`. Whatever the model returns gets run through your actual `createTaskSchema.safeParse`/goal `createSchema.safeParse` before it's ever shown to the user — if a field fails validation, drop that one item from the draft rather than failing the whole capture, so one bad extraction doesn't block the four good ones next to it.

### "Schedule" maps onto Calendar, not a new concept

You don't have a first-class "Schedule" entity, and you shouldn't invent one just for this. When someone says "help me plan my week," the output should be dated `Task`s (using the Calendar work already planned) plus, where the request is genuinely open-ended/reflective rather than a concrete to-do ("think about grad school applications"), a `Note`. This keeps AI Quick Capture a producer of ordinary tasks/goals/notes rather than a parallel scheduling system with its own rules — everything it creates shows up on the Calendar tab exactly like anything created by hand, because it *is* the same data.

### Client

A single entry point — simplest is a text field on the Home tab ("Tell me what's on your mind") — that calls `/ai/capture`, renders the returned draft as a list of editable cards (one per task/goal/habit, each with a checkbox to include/exclude and inline-editable fields, reusing whatever create/edit form components `tasks.tsx` already has rather than building new ones), and on Confirm fires the normal `createTask`/`createGoal` store actions you already have — no new client-side persistence logic at all.

---

## Cost controls

- **Cap input length** server-side (a few thousand characters is plenty for a capture; reject anything absurd before it reaches the LLM).
- **Prompt caching**: the system prompt and tool schema are static across every request — Claude and the other providers offer cached-input pricing (roughly 90% off the cached portion), which matters once volume grows since the schema/instructions are the bulk of the input tokens on every call.
- **Rate-limit per user**, reusing the exact pattern already in `index.ts`'s `sessionLimiter` (keyed on `req.userId`, not IP) — a capture endpoint is a much better target for abuse than a timer-completion endpoint, so this one actually matters more than the ones you already have.
- **Gate behind premium** once you build the subscription tier (already planned — see the Calendar doc's Phase 6 gating, which needs `subscriptionTier` on `User` regardless). A sensible free allowance (e.g., 5 captures/month) plus unlimited on premium turns this from a cost center into an acquisition/upgrade driver, which fits the freemium shape you'd already settled on ("depth" features are premium, the core loop stays free).

## What I'd build, in order

1. **Free, no-AI quick-add**: `chrono-node`-based single-line parsing for one task at a time (date + priority keywords). Ships immediately, costs nothing, and covers the simplest/most common capture case on its own.
2. **Backend `/ai/capture`**: tool-use schema mirroring existing create schemas, validated through your real zod schemas, returns a draft — no persistence in this route at all.
3. **Client draft/review UI**: editable preview cards, wired to existing `createTask`/`createGoal` store actions on confirm. No new persistence path.
4. **Rate limiting + input caps**, before this is ever exposed beyond your own testing.
5. **Premium gating**, once `subscriptionTier` exists (shared prerequisite with the Calendar work's Phase 6).

Steps 1-3 are the real feature; 4-5 are what make it safe to ship broadly. Happy to turn this into a full phased implementation prompt, same format as the Calendar one, once you've picked a provider and confirmed the free-tier quota — those are the two open decisions left.

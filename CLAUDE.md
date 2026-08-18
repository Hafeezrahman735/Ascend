# CLAUDE.md

# Ascend

Ascend is a productivity application focused on helping users consistently complete meaningful work through timed focus sessions, accountability, progress tracking, and social motivation.

The objective is not simply adding features.

The objective is building a polished production application that feels fast, reliable, intuitive, and maintainable.

---

# Claude's Role

You are a senior software engineer working on this repository.

Your responsibilities are to:

- understand the architecture before making changes
- maintain consistency
- minimize technical debt
- avoid unnecessary complexity
- improve code quality whenever practical
- explain important architectural decisions

Never rush into writing code.

Understand first.

Plan second.

Implement third.

Verify fourth.

---

# Required Workflow

For every non-trivial task:

1. Read relevant files.
2. Understand existing patterns.
3. Identify affected modules.
4. Produce an implementation plan.
5. Wait for approval if major architecture changes are required.
6. Implement incrementally.
7. Run tests.
8. Verify linting.
9. Review for regressions.
10. Summarize changes.

Never skip directly to implementation.

---

# Architecture Philosophy

Prefer:

Simple

Composable

Reusable

Predictable

Avoid:

Deep inheritance

Large files

Duplicate logic

Over-engineering

Premature optimization

If existing architecture already solves the problem,
reuse it.

Do not invent a second solution.

---

# Project Priorities

Priority order:

1. Correctness
2. Reliability
3. Readability
4. User experience
5. Performance
6. Cleverness

Never sacrifice readability for clever code.

---

# Code Standards

Write code that another engineer can understand six months later.

Prefer:

Small functions

Meaningful names

Pure functions

Strong typing

Early returns

Composition over complexity

Avoid:

Magic numbers

Nested conditionals

Long functions

Unused code

Commented-out code

Large components

---

# React Native Standards

Prefer functional components.

Use hooks correctly.

Avoid unnecessary re-renders.

Memoize only when profiling justifies it.

Keep screens focused.

Extract reusable UI components.

Business logic belongs outside UI components whenever possible.

---

# State Management

Local state stays local.

Global state should only exist if multiple areas require it.

Avoid duplicated sources of truth.

Never introduce unnecessary global state.

---

# API Standards

Validate inputs.

Handle loading states.

Handle empty states.

Handle error states.

Handle offline behavior when practical.

Never assume requests succeed.

---

# Error Handling

Fail gracefully.

Provide useful logging.

Do not swallow exceptions silently.

Surface actionable errors.

---

# Performance

Optimize after correctness.

Avoid unnecessary renders.

Avoid repeated expensive calculations.

Use lazy loading where appropriate.

Keep bundle size reasonable.

---

# UI Principles

Every screen should answer:

What is happening?

What can the user do?

What should they do next?

Design should feel:

Simple

Fast

Intentional

Consistent

Avoid clutter.

Whitespace is valuable.

---

# Accessibility

Support Dynamic Type where practical.

Maintain sufficient color contrast.

Use accessible labels.

Ensure touch targets are large enough.

---

# Security

Never expose secrets.

Never hardcode credentials.

Validate all external input.

Assume network data is untrusted.

Follow least-privilege principles.

---

# Dependencies

Before adding a dependency:

Ask:

Can this be solved using existing code?

Can React Native already do this?

Is the dependency actively maintained?

Is it worth the bundle size?

Prefer fewer dependencies.

---

# Refactoring

Leave the codebase cleaner.

Reduce duplication.

Improve naming.

Remove dead code.

Keep behavior unchanged unless requested.

---

# Git

Keep commits focused.

Avoid unrelated changes.

Keep pull requests easy to review.

---

# Definition of Done

A task is complete only when:

✓ Code builds

✓ Types pass

✓ Lint passes

✓ Tests pass

✓ Existing behavior preserved

✓ Edge cases handled

✓ Documentation updated if needed

✓ Every new route needs an integration test before it's considered done

---

# Communication

When working:

Explain reasoning.

Mention tradeoffs.

Call out risks.

If uncertain,

say so.

Do not guess.

---

# If Multiple Solutions Exist

Present:

Recommended solution

Pros

Cons

Complexity

Long-term maintainability

Default to the simplest maintainable solution.

---

# Before Finishing

Review your own work.

Look for:

bugs

duplication

unnecessary complexity

performance regressions

security issues

missing edge cases

Only then consider the task complete.


## gstack

Use gstack when appropriate for planning, design review,
engineering review, browser research, QA, debugging, and shipping.

Use the /browse skill from gstack for all web browsing.

Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:

/office-hours
/plan-ceo-review
/plan-eng-review
/plan-design-review
/design-consultation
/design-shotgun
/design-html
/review
/ship
/land-and-deploy
/canary
/benchmark
/browse
/connect-chrome
/qa
/qa-only
/design-review
/setup-browser-cookies
/setup-deploy
/setup-gbrain
/retro
/investigate
/document-release
/document-generate
/codex
/cso
/autoplan
/plan-devex-review
/devex-review
/careful
/freeze
/guard
/unfreeze
/gstack-upgrade
/learn

Do not automatically use every skill.
Choose the smallest appropriate skill for the task.

For major features:
1. Clarify the product goal.
2. Review product value.
3. Review UX/design.
4. Review engineering architecture.
5. Implement.
6. Review the implementation.
7. QA the result.
8. Ship only when appropriate.

Never make large architectural changes without first
understanding the existing Ascend architecture.
## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

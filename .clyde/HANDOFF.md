# Handoff — UI/UX redesign wave (2026-08-18, break-glass session)

One-time primer for the next fresh Clyde session. Read this, then work the task
list. Delete this file once its contents are absorbed (the durable state lives in
tasks.json, DECISIONS.md, and the reviews).

## What just happened

A break-glass session (Claude working outside Clyde) executed the UI/UX redesign
wave against "Clyde UI — Design Vision.md" and left the shell in its intended
shape. Commits `abebca0..` through the README commit. Highlights:

- **Shell**: stable top bar (branch±dirty chip, context gauge, cost, status, Stop,
  New session — all real, per the stretch-real decision), far-left icon rail with
  attention badges, one capability panel at a time, contextual right workbench
  (Goal/Panels), everything resizable + remembered. Semantic design tokens per
  vision §6 (cyan=agent, green=commits, mint=decisions, amber=attention,
  coral=danger, violet=threads).
- **NEW Decisions panel**: DECISIONS.md parsed into ruling cards. The ledger is
  first-class UI now — keep appending rulings; the panel refreshes itself.
- **Tasks v2**: grouped, click-to-expand. **Git**: relative times, colored
  diffstat. **Conversation**: speaker heads on speaker change, quiet user cards,
  document measure caps on composer/workbar.
- **New-session works in-process** (top bar): fresh conversation + event log,
  tasks/decisions/panels/reviews persist. Server: AgentSession.dispose() +
  store rotation in server.ts.
- **QA harness grew**: qa/screenshot.mjs now captures 18 fixture states (rail
  navigation aware); qa/live-drive.mjs drives a REAL session through the real UI
  (send→stream→commit divider, thread flow with reply_in_thread live-fire, new
  session rotation). All passed against a haiku scratch session.
- **README** rewritten with committed screenshots in docs/screenshots/.

## The two rulings that shape upcoming work

1. **Review is an intake ceremony, not a storage noun** (see DECISIONS.md for the
   full flow). The satisfaction to preserve: blab → crisp numbered checklist →
   burn-down. Implementation lands as Tasks with provenance + a Reviews lens.
2. **Chrome is stretch-real**: never ship a dead control. Missing mockup chrome
   (project/branch pickers, ⌘K, tests tile) stays absent until it can be real.

## Suggested order for the task list

1. **#15 AskUserQuestion plumbing** — load-bearing for the ceremony's "I have
   questions" step; full verified SDK contract is in the task + R10.
2. **#19 Review ceremony** — the flagship; depends on #15 for the question step
   and subsumes the data model of **#13**.
3. **#18 Threads metaphor** — start threads anywhere; keep multi-span threads.
4. **#11 / #12** — task editing + goal edit-in-place (both need small wire-protocol
   additions).
5. **#20 responsive pass**, **#17 event-log backfill** as they fit.

Verify the redesign in the browser as you go — the user will be testing it live
and filing feedback; expect a review wave and triage it per protocol.

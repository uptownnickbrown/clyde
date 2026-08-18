# Handoff — end of the questions/threads/backfill/orchestration day (2026-08-18)

One-time primer for the next fresh session. Read this, then work the task list.
Delete this file once absorbed (durable state: tasks.json, DECISIONS.md, CLAUDE.md).

## What landed today (all on main, all gate-verified)

- **#15 Question experience**: real AskUserQuestion via canUseTool (always falls
  through, even under bypassPermissions — no ask rule needed). Amber card in the
  right-workbench Questions tab, blocking, multiSelect + Other, answered history.
  First production use settled the #19 confirm-step design.
- **Attention-surface shell (#21+#12)**: Goal (editable, POST /api/goal, agent
  notified) + Artifacts (amber unseen badge) in the left rail; right workbench is
  attention-only. **#18**: threads off any message incl. the user's own.
- **Resilience**: #17 resume-boot backfill from the CLI transcript (+ whole-
  transcript notification sweep incl. queue-operation lines); #10 auto-resume;
  sdkUuid stamped on all live events. THREE loss mechanisms found+fixed today —
  see DECISIONS + CLAUDE.md § Agent operations choreography rule (restart-
  triggering commands travel ALONE in their message).
- **#23 Agents panel v2**: dispatch_update lifecycle, ticking durations,
  heartbeats, worktree chips, expandable reports. **#22** orchestration doctrine
  in CLAUDE.md § Agent operations — FOLLOW IT TO THE LETTER for subagent waves.

## In flight — finish first

- **#25 model/effort picker**: web+shared half is committed on branch
  `wip-model-picker` (merge it into your tree before starting). The server half
  + gates are fully specified in the task detail. Without the server half the
  picker is dead chrome — do not land the branch on main alone.

## Suggested order

1. **#25** (small, finishes an in-flight unit; server-save choreography applies)
2. **#19 review ceremony** (flagship; spec settled in task detail — question-card
   confirm; subsumes #13; you own it, don't delegate the ceremony judgment)
3. **#11 + #20** as a parallel worktree wave per CLAUDE.md § Agent operations
4. **#24** delta journal when touching the server anyway

## Operating reminders

- The user runs `npm run dev` (tsx watch): ANY packages/server/src save restarts
  the server and cuts your turn. Auto-resume + backfill carry you over; still,
  batch server saves and let prose flush first (doctrine).
- Tasks: edit .clyde/tasks.json directly — the server watches it live.
- QA gates before closing anything: typecheck; qa/screenshot.mjs (23 states);
  live-drive on a scratch project (port 4141, CLYDE_MODEL=haiku) when server
  behavior changed. /tmp/clyde-scratch exists with git configured.
- The user files review waves — #19's ceremony is how they want them eaten.

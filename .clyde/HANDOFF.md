# Handoff — end of the stability/ceremony/picker wave (2026-08-18, evening)

One-time primer for the next fresh session. Read this, then work normally.
Delete this file once absorbed (durable state: tasks.json, DECISIONS.md, CLAUDE.md).

## What landed this wave (break-glass coordinator + 3 worktree agents, one train)

- **#25 model/effort picker** — fully working: chip in the composer, popover opens
  mid-turn, Apply waits for idle; set_model rotates the session in place (same SDK
  conversation, resumed under new settings); {model,effort} persist per session in
  config.json and carry into New-session. Live-fired: rotation kept recall.
- **#19 review ceremony (flagship; subsumed #13)** — ☰ Review in the composer;
  dump saved verbatim at enqueue; injected ceremony script (distill → echo → one
  clarify AskUserQuestion → one multiSelect confirm → tasks.json with
  source/batch/declined+reason → review file annotated). Reviews panel is now a
  batch burn-down lens over Tasks. Live-fired TWICE end-to-end on scratch haiku.
- **#24 delta journal** — the last loss window closed: streamed deltas persist per
  turn, boot recovers a `provisional`-marked message when both events.jsonl and
  the CLI transcript missed it. Plus a lesson the first ceremony run taught:
  **tasks.json shape is normalized at load** and **translate() errors no longer
  kill the SDK stream** (one malformed write used to end the whole session).
- **#11 task editing** — ✎ edit in expanded task cards (subject/detail/status,
  edit_task wire message, one debounced [Tasks edited] agent note). Dispatch
  preview declined under stretch-real (see DECISIONS).
- **#20 responsive pass** — wide/medium(<1280, one aux surface)/narrow(<960,
  drawers+scrim)/phone(<680, condensed chrome) with behavioral QA assertions.

## State

- **The task list is at zero pending.** The next wave starts from user feedback:
  they will drive the polished UI and likely file review batches — which now run
  through YOUR ceremony. Follow the injected script to the letter; tasks.json is
  a TOP-LEVEL ARRAY, string ids, subject/detail field names.
- QA gates: `npm run typecheck`; `npm run qa:backfill` (46 checks);
  `npm run qa:screens` (28 fixture states + behavioral responsive asserts;
  QA_PORT env for parallel runs); `node qa/live-drive.mjs` against a scratch
  project on 4141 (6 sections incl. effort switch) when server behavior changed.
- /tmp/clyde-scratch exists with git + two ceremony batches in its .clyde.
- Operating doctrine unchanged: CLAUDE.md § Agent operations for subagent waves;
  restart-triggering commands travel alone; server saves batched.

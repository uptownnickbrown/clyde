# Handoff — start of the verification & evidence wave (written 2026-08-18, late)

One-time primer for the next fresh session. Read this, then work normally.
Delete this file once absorbed (durable state: SCOPE.md, tasks.json, DECISIONS.md, CLAUDE.md).

## Where the direction came from

An external reviewer assessed the whole project and brainstormed v2 direction
with the user. The FULL conversation — reviewer analysis, the user's commentary,
and a complete draft README the reviewer wrote — is preserved verbatim at:

    .clyde/uploads/2026-08-19T00-27-15-feedback.txt

READ IT before executing this wave; it is the source document for tasks 26–30
(each carries it as `source`). It contains things the distillations can't:
the reviewer's draft README to merge from (task 30), the exact pillar
quotes the user loved ("care more about the product…", "burden of proof gets
higher"), and the user's own words on the critic and needs-my-eyes.

CAVEAT: `.clyde/uploads/` is gitignored, so WORKTREE AGENTS WILL NOT HAVE THIS
FILE in their checkout. The coordinator reads it in the main tree and inlines
the relevant excerpts into each brief. Do not point a worktree brief at the
uploads path.

## What was settled (full rulings in DECISIONS.md, last 7 entries)

- North star: "make it safe and intelligible to build software without needing
  to read the code" — craft + rigor pillars, per-feature confidence test. Now
  the top of SCOPE.md, including the wave's build order (§ Next wave).
- Critic is coordinator-dispatched (NOT server-spawned); quality bar derives
  from the goal doc per project type, never a fixed rubric.
- Needs-my-eyes = the existing right-workbench attention surface, matured via
  blocking exhibits. No catch-me-up blurb feature.
- Asides = composer /btw toggle backed by an ephemeral read-only observer query.
- Intent-level rewind is a won't-do. Provenance stays edges-over-existing-files.
- README: thesis-first but at OUR density — the user called the reviewer's
  draft "way too marketing-y." Keep screenshots, tables, concrete sections.

## The wave (tasks 26–30; user gates dispatch — confirm before spawning agents)

Build order: **26 blocking exhibits → 27 critic** (verdicts ride 26's surface);
**28 /btw asides** is largely severable and can run alongside; **29 provenance
edges** rides 26/27, no standalone infra; **30 README rewrite** last, so it
describes shipped behavior.

## Operating notes

- Task #31 (thread-pill fix) closed late in the prior session: thread
  affordance = icon in a reserved 44px right gutter; selection pill anchors to
  the selection rect via document-level mouseup. Don't regress it.
- QA gates unchanged: `npm run typecheck`; `npm run qa:backfill`;
  `npm run qa:screens` (24 fixture states); `node qa/live-drive.mjs` on a
  scratch project (port 4141) when server behavior changed.
- Doctrine unchanged: CLAUDE.md § Agent operations (worktrees, pinned bases,
  merge train, restart-triggering commands travel alone).

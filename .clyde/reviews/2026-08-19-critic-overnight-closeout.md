# Critic verdict — overnight closeout (#30 README · #34 CSP · #35 left-rail)

**Verdict: REJECT** (commits `8cb04f9..e801041`). The work is largely real and the
density/behavior claims held under attack — the rejection is about **overstated
claims and one genuine security gap**, not vaporware.

## Findings (ranked)

### 1. #34's security claim is false against its own threat model
The CSP `sandbox allow-scripts` header on `/api/project-file` (server.ts:167) is real
and does block same-origin DOM reads. But from the sandboxed opaque origin,
agent-authored script can still:
- **open `ws://localhost:<port>/ws`** — the WebSocketServer (server.ts:263) has **no
  Origin check**, and its hello hands over the session snapshot = the event log —
  the exact "crown jewel" the #34 ruling named. It can also send every
  user-privileged message (`send_message`, `interrupt`, `edit_task`, `exhibit_response`).
- **fire non-preflighted simple POSTs**: `POST /api/goal` (overwrites SCOPE.md *and*
  injects a note into the agent's turn — a prompt-injection channel),
  `POST /api/project-file?path=…` (overwrites any non-`.clyde` file, including
  `packages/server/src/*`, which tsx watch then **executes**), `POST /api/upload`.
  CSP sandbox blocks reading responses, not sending requests.

### 2. The "42 captures" evidence count is fabricated
`qa/screenshot.mjs` has exactly **40** shots at both range boundaries (and one is
optional/live → 39 deterministic). "42 captures green" appears in the ea8765d commit
message, tasks #35/#30, and the shipped README ("capture **42** deterministic UI
states", README.md:120). A wrong evidence count in the README of a project whose
north star is *justified confidence* fails the project's own bar.

### 3. The README hero screenshot contradicts the copy beside it
`docs/screenshots/*.png` predate the workbench restructure and #35 rail reorder:
`workspace.png` shows the old Goal/Panels right rail directly under text describing
the attention-only workbench and the new rail order (README.md:29-31).

### 4. Minor: closeout bookkeeping overclaims
e801041 says "every completed task carries its closing sha" — #26 and #28 have no
`commit` field. (The three tasks under review do carry correct shas.)

## What the critic tried to break and could not
- #30 honors the density ruling: paragraph prose, pillar quotes near-verbatim,
  identity line inside, "Direction from here" fencing, all referenced tables intact;
  every "shipped" claim audited maps to real code (critic/implementer types,
  non-blocking request_review, /btw asides, model picker).
- #35: every commit-message claim maps to the diff; fresh capture 01-overview
  (post-ea8765d) confirms the new rail visually.
- Re-ran gates himself: typecheck clean, qa:backfill all green, all 40 captures
  timestamped after the #35 change.
- #34 logic (iframe sandbox ∪ CSP sandbox) is sound; but the fixture server omits
  the header, so the cited "33x asserts" don't demonstrate the live-header claim.

## Disposition — APPROVED by the user 2026-08-19

Spawned: **task #36** (finding 1 — opaque-origin WS/POST holes + honest fixture
evidence), **task #37** (findings 2+3 — capture count + stale README screenshots).
Finding 4 fixed inline: #26 → `1c2c3c5`, #28 → `2058d08` in tasks.json. The
ea8765d/e801041 commit messages are immutable history; corrections live in the
tasks and README. Tasks #30/#34/#35 stay completed — the work was real; the
claims are what's being repaired.

## Proposed disposition (approve = I file and execute)
1. **New task (meaty): close the opaque-origin holes** — Origin check on the WS
   upgrade + Origin/CSRF guard on state-changing POST routes; extend fixture
   server to serve the CSP header so the evidence tests what it claims.
2. **New task (small): correct the record** — README count 42→40 (or make it 42
   honestly), fix #30/#35 task details; regenerate `docs/screenshots/` (finding 3).
3. **Bookkeeping now**: add closing shas to #26/#28; note that commit messages
   with the wrong count are immutable history — corrections live in tasks/README.

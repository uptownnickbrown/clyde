# Clyde

Clyde = Claude + IDE: a conversation-centric local app for agent-driven builds. **Read SCOPE.md first — it is the north star.** The `.clyde/` directory holds live project state (tasks, decisions, panels, session logs) and is committed.

## Layout

npm-workspaces monorepo, TypeScript throughout:

- `packages/shared` — wire protocol + domain types (server↔UI contract). Change here first.
- `packages/server` — `clyde` CLI: wraps the Claude Agent SDK (streaming-input mode), WS hub, event log, git watcher. `agentSession.ts` is the heart.
- `packages/web` — Vite + React UI. Conversation document at center; panels in rails.

## Commands

- `npm run dev` — server (tsx watch, port 4100) + Vite dev server (port 5173, proxies /ws and /api)
- `npm run build` — all packages; then `node packages/server/dist/index.js <project-root>` serves the built UI
- `npm run typecheck` — strict across all packages

## Conventions

- One linear conversation; threading is presentation only (see SCOPE.md).
- All persistent state is plain files under `.clyde/` — never invent hidden state.
- Commit at logical units of completed work.
- `CLYDE_MODEL` env overrides the agent model (smoke tests use `haiku`); `CLYDE_PORT` overrides the port; `CLYDE_EFFORT` overrides reasoning effort (default xhigh); `CLYDE_STEERING=0` reverts non-urgent messages to queue-at-turn-boundary delivery (default: steer mid-turn).
- The server resumes the latest session (event log + SDK `resume`) on boot — server restarts, including tsx-watch restarts from editing server code, are survivable. Pass `--new` for a fresh session. Resume also backfills events the SDK CLI produced that a dying server never logged, from the CLI's own transcript (`packages/server/src/backfill.ts`; offline check: `npm run qa:backfill`).
- Server diagnostics: structured JSONL at `.clyde/logs/server.jsonl` (gitignored); tail via `GET /api/logs?tail=N`. Commit detail via `GET /api/commit?sha=<sha>`. Read the log when debugging Clyde itself.

## Agent operations (Clyde builds Clyde)

Constraints that shape all multi-agent work here: the dev server runs under tsx
watch, so ANY save under `packages/server/src/` restarts it — killing the
coordinator's turn and every running subagent (they are child processes). And
parallel in-tree agents collide on hotspot files (`App.tsx`, `Sidebars.tsx`,
`agentSession.ts`). Hence:

- **Worktree isolation is standard** for parallel implementation agents; in-tree
  is allowed only for a single web-only/read-only task. Agents never merge; the
  coordinator owns every merge.
- **Pin the base**: harness worktrees may fork from a stale HEAD. Every agent
  brief starts with `git reset --hard <current-HEAD-sha>`, then the node_modules
  recipe: symlink the main tree's entries but point `node_modules/@clyde/*` at
  the worktree's own `packages/*` (otherwise typecheck resolves stale types).
- **Brief contract**: dispatch description = the exact task subject (links the
  Tasks-panel badge); ground rules every time — no `.clyde/` writes, no dev
  ports, typecheck must pass, commit on the worktree branch, report branch/sha/
  decisions/risks as data.
- **Merge train**: never merge while another agent runs. Merge agent branches
  one at a time in a THROWAWAY worktree (`git worktree add /tmp/clyde-merge -b
  merge-train main`) — conflict markers must never touch the watched tree (a
  broken intermediate crash-loops the server with no auto-resume). Typecheck +
  offline checks there, then land with `git merge --ff-only merge-train` in the
  main tree: one atomic restart, backfill + auto-resume carry the turn over.
- **Gate before closing tasks**: typecheck, fixture screenshots
  (`node qa/screenshot.mjs`), and a live-drive pass (`qa/live-drive.mjs` against
  a scratch project on port 4141) whenever server behavior changed.
- **Clean up**: `git worktree remove` agent + merge worktrees, delete merged
  branches. `.claude/worktrees/` is gitignored.

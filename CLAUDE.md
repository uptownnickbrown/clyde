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
- `CLYDE_MODEL` env overrides the agent model (smoke tests use `haiku`); `CLYDE_PORT` overrides the port; `CLYDE_EFFORT` overrides reasoning effort (default xhigh).
- The server resumes the latest session (event log + SDK `resume`) on boot — server restarts, including tsx-watch restarts from editing server code, are survivable. Pass `--new` for a fresh session.
- Server diagnostics: structured JSONL at `.clyde/logs/server.jsonl` (gitignored); tail via `GET /api/logs?tail=N`. Commit detail via `GET /api/commit?sha=<sha>`. Read the log when debugging Clyde itself.

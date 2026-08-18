# Clyde — Scope Document

**Clyde = Claude + IDE.** An opinionated local app for running long, ambitious, agent-driven builds — where the *conversation* is the center document, not the code.

## The problem

Claude Code's terminal transcript is a log. But for a developer who works by (1) handing a frontier model an ambitious scope doc, (2) letting it run in auto mode with aggressive subagent delegation, and (3) shaping the project almost entirely by *reading and responding to what the primary agent says* — the log is the wrong data structure. Real pains, in order:

1. **Backtracking is hostile.** The model fires off 10–15 lengthy messages; you want to push back on something it said five messages ago. Today that means copy-pasting old snippets ("you said this a while ago, I disagree because…") into a context that has already moved on. Repeat five times and the conversation goes schizophrenic for both parties.
2. **Signal buried in noise.** Tool calls, file dumps, and command output interleave with the prose you actually read. The transcript is not readable as a conversation.
3. **Project state is invisible.** The task list, the goal, the QA bar, what's committed, what's in the model's context — all of it lives in scrollback or in the model's head. Re-entering a session cold means archaeology.
4. **Context is a black box.** You can't see what the model still "remembers" raw, what got compacted, what fell out — and you can't cheaply pull things back in.

## The idea

An IDE makes you instantly oriented in a *codebase*: file tree, editor at center, git in the gutter. Clyde makes you instantly oriented in an *agent-driven project*: conversation at center, and the key nouns of the workflow — **tasks, commits, goal, QA artifacts, decisions, context** — promoted to persistent, on-screen, manipulable objects.

**Design principles**

- **Conversation at center.** The main panel is a readable 1:1 dialogue between the user and the primary agent. Everything else supports it.
- **Threading is presentation, not forking.** There is ONE linear conversation from the model's perspective. Sidebar threads are rendered as threads but injected into the main stream with re-anchoring context. No multi-context reconciliation, ever.
- **Files are the database.** All persistent Clyde state lives in plain files under `.clyde/` in the project repo, committed with the work. The model reads/writes them natively; the UI watches them; git versions them. No hidden app state that the model can't see or that dies with a process.
- **The model owns the screen too.** Clyde-the-agent can push panels to the UI (screenshot galleries, metrics, iframes, markdown) via a tool. The UI is malleable from the model side.
- **Honest, not omniscient.** Context accounting is approximate by construction; the UI says so rather than pretending.
- **Orientation in ten seconds.** Reopening a project answers: what's the goal, what happened last, what's next, what needs my eyes.

## The user's workflow (what Clyde optimizes for)

1. Input is an **ambitious scope document** (like this one) produced in a prior brainstorming chat, possibly with reference UI designs. Clyde is not for tickets.
2. A frontier model (Fable-class, xhigh effort) implements in **auto mode**, delegating aggressively to subagents. The user does not talk to subagents; the primary agent does QA, escalation, coordination.
3. The agent makes **git commits at logical units** on a single branch. No worktrees.
4. The user **reads everything the primary agent says** and steers by responding — including to things said long ago.
5. The agent maintains **rigorous QA loops** (Playwright screenshots for UIs, evals/notebooks for ML) and the user periodically judges the output against their bar.
6. Long-running sessions with task lists, planning docs, and deliberate context management.

## Product spec

### Launch model

`clyde .` from a project root — the Jupyter model. The process owns that directory's `.clyde/`, starts the agent backend, serves the UI at `localhost:<port>`, opens the browser. One process = one project. V1: one live session at a time per project; past Clyde sessions are listed and resumable. No import of pre-Clyde transcripts.

### Center panel: the conversation document

- Renders **assistant prose and user messages only**, as markdown, in a clean threaded-document layout. The user reads all of it; nothing prose is hidden.
- **Tool activity is suppressed** into compact inline chips ("⚙ 14 tool calls · 2 subagents · 3m12s" — expandable) at the position where it happened; the full detail lives in the Activity panel. The conversation must read as a conversation.
- **Span comments (the flagship feature).** Select any range of any assistant message — from today or from 400 messages ago — and comment on it, Notion-style. Clyde injects into the main stream a structured message: the quoted excerpt, where it came from, the user's comment, and instructions to reply in a thread-scoped way. The model's tagged reply renders as a threaded response under the anchor, not as a new main-flow message. Threads support back-and-forth; the main flow continues around them.
- **Steering semantics: queue + urgent override.** While the agent is mid-task, comments and messages queue (visible, editable, withdrawable) and deliver at the next turn boundary. Each queued item has an **interrupt now** escalation that stops in-flight work.
- **Resolving a thread distills a decision** (see Decisions ledger).
- **Minimap.** A thin vertical strip: the whole conversation at altitude, colored by context status (raw / compacted / evicted), marked with comment anchors and commit boundaries. Click to jump.
- **Chapters.** Commit boundaries (plus explicit agent-declared milestones) segment the transcript into titled chapters for navigation.

### Panels (all P0)

1. **Tasks.** The live task list mirrored from the agent's todo events into `.clyde/tasks.json` — reorderable and editable from the UI (edits are written to file and surfaced to the agent as a user note). **Dispatch cards:** every subagent dispatch shows the exact prompt passed. An opt-in "review dispatches" toggle (default off — auto mode is sacred) holds each Task dispatch for user edit before launch, via the SDK permission callback's input-rewriting capability.
2. **Git timeline.** Single-branch commit history as cards: message, diffstat, time. **Bidirectionally linked to conversation**: click a commit → jump to the conversation span that produced it; each chapter header shows its commit. The agent commits via normal git in Bash; Clyde's server tags each commit with the current message id to build the link.
3. **Goal & QA.** The scope doc pinned and readable. Success criteria extracted to a checklist the agent updates. **Pushed panels:** the agent calls a `push_panel` tool — `image-gallery` (e.g. watch `qa/screenshots/*.png`), `markdown`, `metrics` (JSON key/values, e.g. eval scores), `iframe` (e.g. Jupyter, dev server) — and the UI renders them. Panel registry persisted in `.clyde/panels.json`.
4. **Decisions ledger.** `.clyde/DECISIONS.md`. When a sidebar thread resolves, the agent appends a decision record ("Decided: X because Y — overrides earlier position Z"). Kept in the agent's context standing orders; the argument may compact away, the ruling survives. This is the anti-re-litigation device.
5. **Context meter (v1: visualize + re-inject).** Per-session token gauge; per-message status in the minimap (raw / compacted / evicted, best-effort); a file list showing which project files the agent has read and their staleness. One-click **"pull back in"**: re-quote a span or queue a file re-read next turn. No true eviction in v1 (v2 spike: transcript-rewrite-and-fork).
6. **Activity feed.** The full tool-call record — every tool call, subagent lifecycle, command output — timestamped and cross-linked to its position in the conversation. This is where the noise went.
7. **File tree.** Standard tree view, decorated with context badges (read by agent / edited by agent / staleness). Not a code editor; clicking a file shows a read-only view. Real editing happens in your real editor.
8. **Reviews.** Batch feedback from a testing wave is a first-class noun: one markdown checklist per wave in `.clyde/reviews/`, items optionally quoting screenshots. The agent triages every item — accept into a task, fix and check off with the commit sha, or push back with reasons — never silently drop. The panel renders each review with a burn-down; the user verifies checked items. (Later: items thread-anchorable into the conversation.)

### Orientation features

- **Catch me up.** Returning to a live/paused session generates a brief: what happened since you last looked, what's in flight, what needs your eyes.
- **Session header.** Goal one-liner · current chapter · task in progress · context gauge · agent status (working / idle / waiting on you), always visible.

## Architecture

```
clyde/                      # npm workspaces monorepo, TypeScript throughout
  packages/shared/          # wire protocol + domain types (events, threads, anchors, tasks, panels)
  packages/server/          # Node: CLI entry, session manager (Agent SDK), WS hub, git + file watchers
  packages/web/             # Vite + React UI
```

- **Agent backend: Claude Agent SDK (TypeScript)** in streaming-input mode — one long-lived `query()` per session against the project cwd, `bypassPermissions` (auto mode) with a `canUseTool` interception path for Task dispatches, in-process MCP server providing Clyde tools (`push_panel`, and later others). Model: Fable-class, xhigh effort.
- **Server** (Node + WebSocket): translates the SDK's typed message stream into Clyde's wire events; appends everything to a session event log (`.clyde/sessions/<id>/events.jsonl`) that the UI renders from and that survives restarts; watches `.clyde/` state files and git; injects queued user messages/thread replies at turn boundaries; handles interrupts.
- **Threads:** `.clyde/sessions/<id>/threads.json`; anchors are `{messageId, startOffset, endOffset, quotedText}` — messages are immutable, so anchors are stable.
- **Commit↔conversation links:** `.clyde/sessions/<id>/commits.json` mapping commit SHA ↔ message id range.
- **Agent standing orders:** a Clyde-managed instructions file (loaded via the SDK's system-prompt/CLAUDE.md mechanism) teaching the agent the Clyde protocol: commit at logical units, maintain DECISIONS.md on thread resolution, use push_panel for QA artifacts, keep tasks current, declare chapters.
- **Compaction:** SDK-managed. Clyde observes compaction boundaries and updates context accounting. Because state lives in files, compaction is survivable by design.

## V1 cut (POC)

**In:** everything under Product spec above, at POC polish: launch CLI, conversation document with span comments/threads/queue+interrupt, tool suppression + activity feed, the seven panels, catch-me-up, event log persistence + session resume.

**Out (v2+):** true context eviction (transcript-rewrite fork — spike first); multi-project daemon; pre-Clyde transcript import; multiple live sessions; collaborative/multi-user; editing code in-app; mobile.

**Spikes to run early** (cheap, de-risk the architecture):
1. SDK streaming-input session: push messages over time, interrupt, resume — confirm auth inherits the local Claude Code login.
2. `canUseTool` input-rewriting on Task dispatches.
3. Compaction observability: what exactly the SDK exposes at a compact boundary.
4. Todo event mirroring.

## Success criteria

1. **The dogfood test (primary):** Clyde v1 is built *by* Clyde as early as possible — bootstrap with Claude Code until the walking skeleton runs, then switch. Every subsequent Clyde feature is implemented through the Clyde UI.
2. A cold reopen of the project answers goal / last events / next task / needs-my-eyes in under ten seconds, without scrolling the transcript.
3. Commenting on a 50-message-old span produces a correctly anchored, contextually sound threaded reply — and a decision record when resolved.
4. The conversation panel reads clean: zero raw tool output in the main flow.
5. QA loop: the agent pushes Playwright screenshots of Clyde itself to a gallery panel, and the user can judge the bar without leaving Clyde.
6. Context meter tracks the session honestly, and "pull back in" visibly re-grounds the model.

## Risks

| Risk | Posture |
|---|---|
| Context accounting is approximate | Accepted for v1; UI is honest about confidence. |
| SDK internals (event shapes, compaction visibility) shift under us | Pin SDK version; isolate in a translation layer in `server/`. |
| Thread-injection prompting doesn't reliably produce scoped replies | Iterate on the injection template; it's prompt engineering, fully in our control. |
| Auto mode + `bypassPermissions` is sharp | Same trust model the user already runs today; scoped to project dir. |
| One user's workflow ≠ general product | Fine. Clyde is deliberately opinionated. Generalize later, maybe never. |

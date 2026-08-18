# Clyde

**Claude + IDE.** An IDE treats your code as a workspace. Claude Code treats your conversation as a log. Clyde treats your conversation as *the* workspace.

Clyde is an opinionated local app for running long, ambitious, agent-driven builds. An IDE's job is: open the project, be oriented in ten seconds. Clyde's job is the same — but the project state it orients you in includes the **conversation**, the **plan**, the **decisions**, and the **context window**, not just the files.

![The Clyde workspace](docs/screenshots/workspace.png)

## Why

When you hand a frontier model an ambitious scope doc and let it run in auto mode, the code stops being the thing you read. The *conversation* is — it's where the agent raises issues, makes calls, and asks for your judgment. A terminal scrollback is the wrong data structure for that:

- You want to push back on something the agent said forty messages ago — but by the time you've copy-pasted the quote, the context has moved on, and after five rounds of this the conversation goes schizophrenic for both of you.
- The prose you actually read is buried in tool calls and command output.
- The task list, the goal, the QA bar, what's committed, what the model still remembers — all invisible, living in scrollback or in the model's head.

A log records what happened. A workspace keeps what matters *at hand*.

## The workspace

The shell is a stable frame around a conversation-first document:

- **Top bar** — project identity, git branch with uncommitted-file count, context gauge, session cost, agent status, **Stop** (interrupt), and **New session**. Everything on it is real; nothing is decorative.
- **Icon rail** (far left) — Clyde's capabilities, one panel at a time: **Tasks · Git timeline · Decisions · Reviews · Agents · Activity · Context · Logs**. Badges mark what needs attention (tasks in progress, running subagents, dirty files). Clicking the active icon collapses the panel.
- **Conversation** (center) — clean 1:1 prose between you and the agent. Speaker marks appear on speaker change; tool noise collapses into expandable chips; commits and compactions annotate the flow as quiet dividers.
- **Workbench** (right) — the goal document (`SCOPE.md`) and whatever the agent pushes: screenshot galleries, metrics, reports. Resizable, collapsible, remembered.

![Tasks expand with full detail and delegation state](docs/screenshots/tasks.png)

## Comment on anything, from any time

Select any span of any agent message — today's or from hours ago — and start a **thread** anchored to it. The agent is re-anchored on the exact excerpt and replies *into the thread card*, mid-task, via a dedicated tool call — even while it keeps working on the main line. Multiple threads can ride one message off different highlighted spans. One linear conversation underneath; threading is presentation.

![A thread anchored to a span, answered mid-turn](docs/screenshots/threads.png)

Composer semantics are Slack's everywhere: **Enter** sends, **Shift+Enter** newlines. While the agent is working, messages steer it **mid-turn** by default; **Stop & send** is the emergency brake that interrupts in-flight work. Queued items deliver strictly in order and survive restarts.

## Resolved arguments become decisions

When a discussion settles, the ruling is distilled into `.clyde/DECISIONS.md` — and the **Decisions** panel renders the ledger as cards. The argument may compact away; the ruling survives, in the agent's context and on your screen.

![The decision ledger as first-class UI](docs/screenshots/decisions.png)

## The agent shows you its work

Clyde's agent runs under standing orders: commit at logical units, keep the task list current, delegate aggressively to subagents, answer mid-turn messages before continuing, and push QA artifacts — Playwright screenshot galleries, metrics, reports — to panels so you judge the bar without leaving the conversation.

![Agent-pushed QA artifacts in the workbench](docs/screenshots/qa-panels.png)

## Sessions

- The server **resumes** the latest session on boot (event log + SDK resume) — restarts, including dev-watch restarts, are survivable; turns cut short mid-flight auto-resume.
- **New session** (top bar) starts a fresh conversation while the project state persists: tasks, decisions, panels, reviews all carry over. Threads and the event log are per-session.
- The **Context** panel shows an approximate gauge of the window, compaction markers, session cost, and files-touched with one-click "pull back in."

## Everything is files

All state lives in plain files under `.clyde/`, committed with the work (machine artifacts are gitignored). Nothing hidden, nothing that dies with a process:

| Path | What |
| --- | --- |
| `.clyde/tasks.json` | The live task list (mirrors the agent's task tools) |
| `.clyde/DECISIONS.md` | The decision ledger — one ruling per line, never re-litigated silently |
| `.clyde/reviews/*.md` | Batch-feedback reviews with burn-down tracking |
| `.clyde/panels.json` | Agent-pushed panels |
| `.clyde/sessions/<id>/` | Per-session event log, threads, queue (gitignored) |
| `.clyde/logs/server.jsonl` | Structured server diagnostics (gitignored; also `GET /api/logs`) |

## Run it

```bash
npm install && npm run dev     # UI at http://localhost:5173 (dev), server on :4100
```

Or the Jupyter model, from any project root:

```bash
npm run build
node packages/server/dist/index.js /path/to/your/project    # add --new for a fresh session
```

One process = one project. Clyde finds or creates `.clyde/` there and serves the UI for that project. Auth inherits your Claude Code CLI login — no API key needed.

| Env var | Default | What |
| --- | --- | --- |
| `CLYDE_MODEL` | `claude-fable-5` | Agent model (smoke tests use `haiku`) |
| `CLYDE_EFFORT` | `xhigh` | Reasoning effort |
| `CLYDE_PORT` | `4100` | Server port |
| `CLYDE_STEERING` | `1` | `0` reverts mid-turn steering to queue-at-turn-boundary |

### QA loop

```bash
npm run qa:screens      # build + capture 18 deterministic UI states via the fixture server
node qa/live-drive.mjs  # drive a live session through the real UI (threads, commits, new-session)
```

## Status

Working POC, built by Clyde inside Clyde. Live Agent SDK session, streamed conversation document, span-anchored threads with tool-call replies, mid-turn steering, FIFO queue, subagent delegation with an Agents panel, commit↔conversation linking, decision ledger, review burn-downs, agent-pushed panels, session resume + in-app new-session, structured logging — all end-to-end. The full product spec is in [SCOPE.md](SCOPE.md); rulings to date are in [.clyde/DECISIONS.md](.clyde/DECISIONS.md).

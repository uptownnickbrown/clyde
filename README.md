# Clyde

**Claude Code treats the transcript as a log. Clyde treats your conversation as a workspace.**

Clyde (Claude + IDE) is an opinionated local app for running long, ambitious, agent-driven builds. An IDE's job is: open the project, be oriented in ten seconds. Clyde's job is the same — but the project state it orients you in includes the **conversation**, the **plan**, the **decisions**, and the **context window**, not just the files.

## Why

When you hand a frontier model an ambitious scope doc and let it run in auto mode, the code stops being the thing you read. The *conversation* is — it's where the agent raises issues, makes calls, and asks for your judgment. A terminal scrollback is the wrong data structure for that:

- You want to push back on something the agent said forty messages ago — but by the time you've copy-pasted the quote, the context has moved on, and after five rounds of this the conversation goes schizophrenic for both of you.
- The prose you actually read is buried in tool calls and command output.
- The task list, the goal, the QA bar, what's committed, what the model still remembers — all invisible, living in scrollback or in the model's head.

A log records what happened. A workspace keeps what matters *at hand*.

## What that means concretely

- **The conversation is the center document.** Clean 1:1 prose between you and the agent; tool noise collapses into expandable chips and a dedicated activity feed.
- **Comment on anything, from any time.** Select any span of any agent message — today's or last week's — and reply to it, Notion-style. The agent gets re-anchored on the excerpt and responds in a thread attached to it. One linear conversation underneath; threading is presentation.
- **Resolved arguments become decisions.** Closing a thread distills it into `.clyde/DECISIONS.md`, which stays in the agent's context. The argument may compact away; the ruling survives.
- **The workflow nouns live on screen.** Tasks (editable, with visible subagent dispatches), a git timeline linked to the conversation spans that produced each commit, the goal doc, and QA artifacts the *agent* pushes to panels — screenshot galleries, metrics, notebooks.
- **The context window is visible.** A gauge of what the model holds, compaction markers in the transcript, files-touched with one-click "pull back in."
- **Everything is files.** All state lives in plain files under `.clyde/`, committed with the work. Nothing hidden, nothing that dies with a process.

## Run it

```bash
npm install && npm run dev     # UI at http://localhost:5173 (dev), server on :4100
```

Or the Jupyter model, from any project root:

```bash
npm run build
node packages/server/dist/index.js /path/to/your/project
```

One process = one project. Clyde finds or creates `.clyde/` there and serves the UI for that project.

## Status

Early POC. The walking skeleton works end-to-end — live Agent SDK session, streamed conversation, span comments, queue + interrupt steering, panels, event-log persistence — and Clyde's first mission is building itself. The full product spec is in [SCOPE.md](SCOPE.md); decisions to date are in [.clyde/DECISIONS.md](.clyde/DECISIONS.md).

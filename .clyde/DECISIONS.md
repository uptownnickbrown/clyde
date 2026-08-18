# Decisions

The distilled rulings from resolved discussions. The argument may compact away; the ruling survives. Never re-litigate an entry without acknowledging it.

- Decided: Clyde's identity line is "Claude Code treats the transcript as a log; Clyde treats your conversation as a workspace" — lead the README with it, because the user confirmed it captures the whole idea (2026-08-18)
- Decided: threading is a presentation layer over one linear conversation, never context forking — because it keeps the model coherent and makes the POC tractable (2026-08-18)
- Decided: backend is the TypeScript Agent SDK, UI is a local web app launched Jupyter-style (`clyde .`), one process per project — because it maximizes leverage from the Claude Code harness and matches how the user works (2026-08-18)
- Decided: all persistent state lives as plain files in `.clyde/`, committed to the repo — because the model reads/writes them natively, git versions them, and nothing dies with a process (2026-08-18)
- Decided: steering is queue-at-turn-boundary with a per-item urgent interrupt — because auto mode must not be blocked, but the user keeps an emergency brake (2026-08-18)
- Decided: context v1 is visualize + re-inject only; true eviction is a v2 spike — because transcript-rewrite forking is the riskiest unknown and shouldn't gate the POC (2026-08-18)
- Decided: first mission is Clyde building Clyde, with Playwright screenshot QA pushed to a gallery panel — because the dogfood loop is the fastest way to hit every UX pain (2026-08-18)
- Decided: reviews are a first-class noun — batch feedback lives in .clyde/reviews/*.md checklists, triaged item-by-item (accept-as-task / fix+sha / push-back), rendered as a burn-down panel — because testing waves are how the user actually steers QA (2026-08-18)
- Decided: commit expansion stays v1-simple — an expandable card fed by GET /api/commit (git show --stat --patch); GitHub diff deep-links wait for push/remote awareness (2026-08-18)
- Decided: non-urgent messages now steer mid-turn by default (CLYDE_STEERING=0 reverts) — supersedes the queue-at-turn-boundary ruling above, because questions stuck behind long working turns broke conversational flow; the urgent interrupt is unchanged (2026-08-18)
- Decided: new nouns face a high bar — not a ban — and the bar is the lifecycle test: an object earns persistence only when it has a lifecycle no existing noun can carry; otherwise build a lens over existing nouns. Agents pass (running/completed + live activity); Reviews and Q&A fail — reviews fold into Tasks (source provenance, declined-with-reasons state, intake-batch grouping; Reviews tab becomes a lens) and answered questions distill into Decisions and/or Tasks (2026-08-18)

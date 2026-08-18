# Review — threads mini (2026-08-18, second hands-on session)

Source: the user's notes on the threads/comments UX after a day of real sidebar use,
with screenshots of the comment box and a full thread card.
Protocol: triage every item — accept into a task (note it), fix directly (check off
with the commit sha), or push back with reasons (never silently drop). The user
verifies checked items.

- [x] T1 — Typing in the comment box feels cramped; the box doesn't resize as you
  type.
  Fixed — the new-thread box now autosizes with the same rule as the main composer
  (grow to 280px, then scroll), with roomier padding and line-height 1.5; the
  thread reply box got the same treatment.

- [x] T2 — Enter / Shift+Enter (Slack semantics) must work in thread boxes exactly
  like the main composer.
  Fixed — both the new-thread box and the thread reply box: Enter sends,
  Shift+Enter inserts a newline (reply box upgraded from a single-line input to a
  textarea to make that possible). Esc cancels the new-thread box.

- [x] T3 — Why different calls to action for interrupt/send in threads
  ("Comment" / "Comment now (interrupt)") vs. the main composer ("Send" /
  "Stop & send")? Unify.
  Fixed — one verb set everywhere: Send ⏎ (primary), Stop & send (danger, shown
  only while the agent is working), Cancel. The protocol already carried `urgent`
  on thread messages, so this was purely presentational drift.

- [ ] T4 — The right metaphor is **Threads**, not Comments: start a thread off any
  top-level message without selecting text, thread off the user's own messages,
  and keep select-text as an entry flow that seeds the thread with the quote —
  one noun, different ways to start the flow.
  Accepted → Task #18 (needs shared ThreadAnchor changes + server compose logic,
  so it's a proper unit, not a quick fix). Down payment in this commit: the
  selection affordance now says "Start thread" and the box says "Start a
  thread…" — the Comment vocabulary is gone from the UI.

- [ ] T5 — Do NOT lose multiple threads per message anchored to different
  highlighted spans — used it today, it was super helpful.
  Accepted → folded into Task #18 as a hard constraint. Already works today
  (threads are stored per-anchor, rendered as a list per message); the metaphor
  work must preserve it.

- [x] T6 — Question: what does Resolve do? It must not implicitly resolve spun-off
  work (Tasks, Decisions). Maybe it's just collapse?
  Answered in the turn summary (short version: presentation + a distillation
  nudge to the agent; it never touches Tasks/Decisions). Improved in this commit:
  resolved threads now collapse to a one-line stub that expands on click.

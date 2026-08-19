# Engineering constitution

The team's standing engineering expectations. Every implementing and reviewing agent
inherits this file; the critic may cite a violation as grounds **not to accept** —
it is binding, not advisory. When a rule blocks something it shouldn't, the remedy
is amending this file (that is why it is a file), never waiving the rule in place.
Keep it short: a constitution agents skim is a constitution that doesn't exist.

## Principles

1. **Boundaries are explicit.** Business policy never lives in transport or
   presentation layers — a rule you'd keep if the HTTP/WS/UI layer were replaced
   belongs where you'd keep it.
2. **Contracts are intentional.** The wire protocol and domain types
   (`packages/shared`) change first, deliberately; a contract change names its
   consumers. Nothing "just happens" to a shape two packages depend on.
3. **Dependencies point one way.** `server` and `web` import `shared`; they never
   import each other — they meet only at the wire (the server ships web's *built*
   assets; no source crosses). A new dependency direction is an architectural
   event, not a convenience.
4. **Duplication beats the wrong abstraction.** Abstractions are earned by a second
   *real* caller, not a hypothetical one. Inline twice, extract on the third —
   unless a recorded posture decision bought the seam early.
5. **Tests assert behavior, not implementation.** A test that breaks under a
   refactor that preserves behavior is coupled wrong. Test names state the
   behavioral claim being protected.
6. **Agent-writable files are untrusted input.** Every load normalizes shape and
   fails survivably; one malformed write must never kill a session. (Ratified from
   the tasks.json live-fire, 2026-08-18.)
7. **Structured signals over conventions.** Agent-to-system communication is a tool
   call or a typed field, never a formatting convention in prose. (Ratified from the
   0/22 sidebar-marker episode, 2026-08-18.)
8. **New nouns face the lifecycle test.** An object earns persistence only with a
   lifecycle no existing noun can carry; otherwise build a lens over existing
   nouns. (Ratified from the lifecycle-test ruling, 2026-08-18.)
9. **State is plain files.** Everything durable lives in files the model can read
   and git can version — no hidden state that dies with a process. (Ratified from
   the files-are-the-database ruling, 2026-08-18.)
10. **Leave it more understandable than you found it.** The measure is a cold
    reader — human or agent, no conversation context — rapidly forming the correct
    mental model of where things live and why.

## Architectural significance

Work is **architecturally significant** when it crosses any trigger below. This is
the one judgment that arms the assurance apparatus (change posture now; maintainer
review and change drills as they land) — ordinary work pays zero ceremony.

- New or changed **public contract**: wire protocol, HTTP/WS endpoint shape, MCP
  tool schema, CLI flags, `.clyde/` file format.
- New **module boundary** — a file or package owning a responsibility that didn't
  exist before.
- New **dependency direction** between existing modules or packages.
- **Schema/persistence change**: event log shapes, session state, anything replayed
  or resumed against.
- **Cross-package change** — one logical change touching `shared` + `server` +
  `web` is a contract change wearing three coats.

**Not significant** (the common case — these carve-outs win over the triggers
above whenever both plainly apply): routine content edits to `.clyde/` files —
task entries, ruling appends, review dumps (only *format* changes trigger); a new
file carved out of an existing responsibility; a purely additive field consumed
the way its siblings are, landed through the normal contract-first workflow;
styling, copy, fixtures, tests.

When a task that should have triggered didn't (or noise-triggers too often), amend
this list — the threshold is versioned here, not vibes. Retro-flags from the user
are the calibration signal.

## Change posture

For significant work: name the plausible axes of change, build **narrow by
default**, and record each considered-and-deferred axis in DECISIONS.md as
`- Deferred: <axis> — revisit when <trigger> (<date>)`. Deliberate narrowness is
recorded option-pricing, not neglect: the trigger clause is what lets the deferral
resurface when its future arrives.

Routing: the **coordinator** records deferrals. Implementing subagents never write
`.clyde/` — they report considered-and-deferred axes as data in their final
report, and the coordinator writes the ledger lines.

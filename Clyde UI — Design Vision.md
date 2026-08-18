# Clyde UI — Design Vision

Clyde should feel like an **IDE for agent-driven work, not a chat app with developer chrome**. The conversation is the center document; everything around it exists to keep the user oriented, make project state tangible, and let them steer the agent without losing their place.

## 1. The shell: stable, calm, instantly orienting

The outer frame should remain stable while the contents change.

**Always visible:**
- Project / workspace identity
- Current git branch
- Agent state: running, idle, waiting, paused
- Current task / chapter
- Global command-jump
- Composer with **Queue / Send now / Interrupt**
- Agent + effort selectors
- Connection / save / repo status

These are the equivalent of an IDE's title bar and status bar: the user should never have to hunt for them.

The goal is the Scope principle of **“orientation in ten seconds”**: what are we doing, what is happening now, and where does my attention belong?

## 2. Left rail: capabilities, not permanent columns

The narrow icon rail on the far left is Clyde's primary navigation system. Each icon represents a **workspace capability**, not merely a page:

**Conversation · Tasks · Git · Decisions · QA · Files · Activity · Context · Settings**

Selecting one opens its panel immediately to the right of the rail. The rail itself never disappears.

A few principles:
- Remember the user's last-open panel and width.
- Clicking the active icon collapses its panel.
- Badges communicate attention: unresolved decisions, failed QA, waiting tasks, etc.
- Icons should have distinct silhouettes and restrained semantic color so Clyde does not become a wall of blue-purple.
- **Tasks, Decisions, and QA are first-class Clyde objects. Files are available, but deliberately less prominent.**

The system should comfortably support more capabilities later without adding more permanent screen regions.

## 3. Conversation owns the center

The center column gets first claim on space. It is a readable document, not a terminal transcript.

Claude and the user should be recognizable at a glance through **avatars / marks, typography, and subtle surface treatment** rather than giant chat bubbles. Claude should use its recognizable mark; the user uses their avatar or a neutral personal glyph.

Tool activity remains compressed into quiet inline summaries. Threads visually attach to the exact passage they discuss. Commit boundaries, decisions, queued steering, and agent progress may annotate the conversation, but should never overwhelm the prose.

This directly supports Clyde's core requirement that raw tool noise disappear while the full activity record remains available elsewhere.

## 4. Right side: contextual workbench

The right region is **contextual, not permanent**.

It is where Clyde displays whichever secondary object deserves attention now: QA artifacts, a decision ledger, a scope document, file preview, activity details, or a pushed agent panel. The user can switch among these, pin one, or collapse the region entirely.

Default emphasis should follow the workflow:

**QA / Decisions → project state → files / activity / context internals**

Context management is important but need not consume persistent real estate. Clyde should surface context only when it becomes actionable: nearing limits, stale important files, compaction, or a useful “pull back in” action. The underlying product spec explicitly treats context accounting as approximate, so the UI should communicate useful confidence rather than fake precision.

## 5. Fluid layout, not fixed three-column UI

Clyde should behave like a professional IDE at different widths.

**Wide:** rail + left panel + conversation + right workbench.  
**Medium:** one auxiliary panel at a time; conversation stays dominant.  
**Narrow:** icon rail remains, auxiliary panels become overlays/drawers.  
**Very narrow:** conversation first; rail may compress into a launcher.

Panels are resizable with sensible min/max widths, and Clyde remembers the user's layout per project.

When space gets constrained, the priority order is:

**Conversation → composer/status → active Clyde object → secondary navigation → diagnostics.**

Never solve responsiveness by squeezing every panel until none are pleasant to use.

## 6. Visual character

Clyde should feel technical, calm, and slightly alive.

Use a near-black/slate foundation, but avoid the generic “AI = purple gradient” palette. Introduce restrained **cyan, mint, green, amber, coral, and violet** as semantic accents: agent activity, success, decisions, QA warnings, interrupts, threads.

Color should identify meaning rather than decorate everything.

The overall feeling should sit somewhere between **IDE, project cockpit, and collaborative document**: dense enough for serious development, but much quieter and more legible than a terminal.

### North star

Opening Clyde after being away for an hour—or a week—should immediately answer:

**What are we trying to accomplish? What is Claude doing? What changed? What needs my judgment?**

Everything else is secondary.
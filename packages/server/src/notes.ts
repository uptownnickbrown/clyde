// Debounced panel notes — the one place that collapses a burst of direct user edits
// into ONE queued message to the agent.
//
// Three panels now write to the agent this way (Tasks, Artifacts, Decisions), which is
// exactly where constitution rule 4 puts the seam: inline twice, extract on the third.
//
// The part worth a module is not the timer, it is WHICH session receives the note. A
// buffer holds items for `delayMs`, and inside that window the session can be replaced:
// New session disposes the old one and installs a fresh conversation that never saw the
// edit. Delivering there hands an agent a report of changes it has no memory of, in a
// context where the note reads as fact. So the buffer snapshots the session that owned
// the burst, re-resolves the getter when it fires, and delivers only if the live session
// is still that same, undisposed one. Otherwise the note is dropped — there is nobody
// left to tell, and the edit itself is on disk where the new session will read it.
//
// Model rotation (set_model) also swaps the session object while RESUMING the same
// conversation, so its in-window notes are dropped too. Accepted: the window is seconds
// wide, the edit is on disk where the resumed session reads it, and telling the two
// swap kinds apart would couple this module to session identity it deliberately
// does not know.

/** What a note needs from a session: somewhere to put it, and whether anyone is home.
 *  Structural on purpose — this module must not depend on AgentSession. */
export interface NoteSink {
  enqueue(text: string): void;
  readonly disposed: boolean;
}

export interface NoteBuffer {
  /** Add one human-readable edit summary to the pending burst. */
  push(item: string): void;
  /** Drop a pending burst without delivering it (session teardown). */
  cancel(): void;
}

/**
 * @param live    resolves the CURRENT session at both push and fire time
 * @param compose turns the burst's summaries into the message the agent receives
 * @param delayMs quiet period before the burst is delivered
 */
export function createNoteBuffer(
  live: () => NoteSink | null,
  compose: (items: string[]) => string,
  delayMs = 5000,
): NoteBuffer {
  let items: string[] = [];
  let owner: NoteSink | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    items = [];
    owner = null;
  };

  return {
    push(item: string) {
      const current = live();
      if (!current || current.disposed) return;
      // A session swap mid-burst orphans what came before it: those edits belong to a
      // conversation that is gone.
      if (owner && owner !== current) items = [];
      owner = current;
      items.push(item);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const pending = items;
        const target = owner;
        cancel();
        if (!pending.length || !target || target.disposed || live() !== target) return;
        target.enqueue(compose(pending));
      }, delayMs);
    },
    cancel,
  };
}

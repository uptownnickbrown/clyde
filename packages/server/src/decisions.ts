// The decision-ledger format policy (#40) — what makes `.clyde/DECISIONS.md` a ledger
// rather than a text file, and therefore what a user edit from the Decisions panel is
// allowed to do to it.
//
// This lives outside the HTTP route on purpose (constitution rule 1): "a ruling is one
// line", "only ruling lines are editable", "an ambiguous target is refused" are rules
// we would keep if the transport were a WS message or a CLI command tomorrow. Keeping
// them pure also makes them checkable offline, with no ports and no session —
// `npm run qa:decisions` imports this module from dist, the same way the origin policy
// is checked.
//
// The load-bearing property, and the reason the payload is one line rather than a
// whole-file replace: the file is AGENT-writable and actively appended to while the
// user reads it (constitution rule 6 — agent-writable files are untrusted input). We
// only ever splice the single line the user acted on. Preamble, headings, blank lines,
// and bullets in a shape nothing parses are never transmitted, never re-serialized, and
// therefore cannot be destroyed by an edit — not even a malformed one.

import type { DecisionEdit } from '@clyde/shared';

/** A ruling line: the ledger's two bullet kinds, both editable. `Decided:` is a
 *  settled ruling; `Deferred:` is a priced-and-parked axis of change (the posture
 *  convention). Anything else in the file is prose the panel does not own. */
export const RULING_LINE = /^-\s+(?:Decided|Deferred):\s*\S/;

export type DecisionEditOutcome =
  | {
      ok: true;
      /** The full file as it should now be written. Identical to the input when
       *  `changed` is false — a no-op save must not touch disk or wake the agent. */
      markdown: string;
      changed: boolean;
      /** Human-readable, for the log and the agent's note ("removed a ruling: …"). */
      summary: string;
    }
  | { ok: false; status: 400 | 409; reason: string };

/**
 * Apply one panel edit to the ledger text. Pure: same inputs, same answer.
 *
 * @param markdown the CURRENT contents of .clyde/DECISIONS.md, re-read at write time
 * @param edit     the user's edit; `text` absent/null means delete the ruling
 */
export function applyDecisionEdit(markdown: string, edit: DecisionEdit): DecisionEditOutcome {
  const original = typeof edit.original === 'string' ? edit.original.trim() : '';
  if (!original) return { ok: false, status: 400, reason: 'no ruling named' };
  // The guard that protects everything else in the file: a target that is not itself a
  // ruling line cannot be reached through this route, so the preamble, the heading and
  // any unparsed bullet are unaddressable — not merely unaddressed.
  if (!RULING_LINE.test(original)) {
    return { ok: false, status: 400, reason: 'not a ruling line — only "- Decided:" / "- Deferred:" bullets are editable' };
  }

  const lines = markdown.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].trim() === original) hits.push(i);
  // Both misses mean the same thing to the user — "your view of the ledger is stale,
  // reload before editing" — and both are safer than guessing which line was meant.
  if (hits.length === 0) return { ok: false, status: 409, reason: 'ruling not found — the ledger changed underneath you' };
  if (hits.length > 1) return { ok: false, status: 409, reason: `ruling is ambiguous — ${hits.length} identical lines` };
  const at = hits[0];

  if (edit.text === undefined || edit.text === null) {
    const next = lines.slice();
    next.splice(at, 1);
    return { ok: true, markdown: next.join('\n'), changed: true, summary: `removed a ruling: "${clip(original, 140)}"` };
  }

  // A ruling is ONE line. A pasted multi-line draft collapses into one rather than
  // being refused — the user's intent is the prose, not the wrapping — but every other
  // byte of their text survives verbatim.
  const replacement = String(edit.text).replace(/\s*\n\s*/g, ' ').trim();
  if (!replacement) return { ok: false, status: 400, reason: 'empty ruling — delete it instead' };
  if (!RULING_LINE.test(replacement)) {
    return { ok: false, status: 400, reason: 'a ruling line must start with "- Decided:" or "- Deferred:"' };
  }
  if (replacement === original) return { ok: true, markdown, changed: false, summary: 'no change' };

  // Preserve the line's own framing (indent, CRLF) so an edit never changes the file's
  // shape beyond the words in it.
  const indent = /^[ \t]*/.exec(lines[at])![0];
  const cr = lines[at].endsWith('\r') ? '\r' : '';
  const next = lines.slice();
  next[at] = indent + replacement + cr;
  return {
    ok: true,
    markdown: next.join('\n'),
    changed: true,
    summary: `edited a ruling: "${clip(original, 90)}" → "${clip(replacement, 90)}"`,
  };
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

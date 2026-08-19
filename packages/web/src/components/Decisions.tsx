import { useEffect, useRef, useState } from 'react';
import type { DecisionEdit } from '@clyde/shared';

// The decision ledger as first-class UI: .clyde/DECISIONS.md parsed into cards, now
// editable in place. The file stays the source of truth (files-as-database); this is a
// lens with a pencil.
//
// The ledger grammar this panel reads is two bullet kinds, both rulings:
//   - Decided: <what> because <why> (<date>)
//   - Deferred: <axis> — revisit when <trigger> (<date>)
// The server's decisions.ts holds its own copy of that grammar (RULING_LINE) and applies
// it to every WRITE, no looser than this parser: anything it accepts, this renders. The
// two regexes are deliberately independent — the client only ever echoes back a line it
// rendered, so drift can cost a card here but can never corrupt the file — but the
// no-looser direction is load-bearing and must be kept if either side moves: a line the
// writer accepts and the reader drops disappears from the panel with no way back.
// Everything else in the file — heading, preamble, blank lines, bullets in a shape this
// parser does not recognize — is prose the panel does not own. It renders none of it and,
// crucially, never round-trips it: a save names ONE ruling line by its exact text, so
// unparsed content cannot be destroyed by an edit.

type RulingKind = 'Decided' | 'Deferred';

interface Decision {
  /** The ruling line exactly as it appears in the file — the save payload's identity. */
  raw: string;
  kind: RulingKind;
  headline: string;
  rest: string;
  date: string | null;
  supersedes: boolean;
}

function parseDecisions(md: string): Decision[] {
  const out: Decision[] = [];
  for (const line of md.split('\n')) {
    const raw = line.trim();
    const m = /^-\s+(Decided|Deferred):\s+(.*)$/.exec(raw);
    if (!m) continue;
    const kind = m[1] as RulingKind;
    let text = m[2].trim();
    const dm = /\s*\((\d{4}-\d{2}-\d{2})\)\s*$/.exec(text);
    const date = dm ? dm[1] : null;
    if (dm) text = text.slice(0, dm.index).trim();
    // Headline = the ruling itself; rest = rationale. Split on the first
    // " — " or " because " — whichever comes first.
    const dash = text.indexOf(' — ');
    const because = text.search(/\sbecause\s/);
    let cut = -1;
    if (dash >= 0 && (because < 0 || dash < because)) cut = dash;
    else if (because >= 0) cut = because;
    const headline = cut >= 0 ? text.slice(0, cut).trim() : text;
    const rest = cut >= 0 ? text.slice(cut).replace(/^\s*—\s*/, '').trim() : '';
    out.push({ raw, kind, headline, rest, date, supersedes: /supersede/i.test(text) });
  }
  return out.reverse(); // newest first
}

/** POST one ruling edit; `text` omitted = delete. On success the server hands back the
 *  ledger as it wrote it — the panel renders THAT, so a save is visible even if this
 *  client's socket (and so the `decisions` broadcast) is down. */
async function saveEdit(edit: DecisionEdit): Promise<{ markdown?: string } | { error: string }> {
  try {
    const r = await fetch('/api/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(edit),
    });
    const body = (await r.json().catch(() => null)) as { markdown?: string; error?: string } | null;
    if (r.ok) return { markdown: body?.markdown };
    return { error: body?.error ?? `save failed (${r.status})` };
  } catch (err) {
    return { error: String(err) };
  }
}

export function DecisionsPanel({ pushed }: { pushed: string | null }) {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  // Edit state is keyed by the ruling's raw line, not its index: a poll or a broadcast
  // that lands mid-edit reorders nothing, and a ruling deleted from under the user
  // simply drops its own open form.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The file's own loader: initial read plus a slow poll, because the AGENT appends
  // rulings too and those writes do not broadcast.
  useEffect(() => {
    const load = () =>
      fetch(`/api/project-file?path=${encodeURIComponent('.clyde/DECISIONS.md')}`)
        .then((r) => (r.ok ? r.text() : ''))
        .then((t) => setDecisions(parseDecisions(t)))
        .catch(() => setDecisions([]));
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  // A save from ANY client (including this one) comes back as the file the server
  // actually wrote — the panel re-parses that rather than trusting its own draft.
  useEffect(() => {
    if (pushed !== null) setDecisions(parseDecisions(pushed));
  }, [pushed]);

  // The delete confirm is a 6s window, like the top bar's New-session button: an
  // unattended armed Delete disarms itself. A refused delete holds the card open
  // instead — the reason has to survive long enough to be read.
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(confirmTimer.current);
    if (confirming === null || error) return;
    confirmTimer.current = setTimeout(() => setConfirming(null), 6000);
    return () => clearTimeout(confirmTimer.current);
  }, [confirming, error]);

  const startEdit = (d: Decision) => {
    setConfirming(null);
    setError(null);
    setDraft(d.raw);
    setEditing(d.raw);
  };
  const cancelEdit = () => {
    setEditing(null);
    setError(null);
  };
  const commit = async (edit: DecisionEdit) => {
    setBusy(true);
    setError(null);
    const result = await saveEdit(edit);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    if (result.markdown !== undefined) setDecisions(parseDecisions(result.markdown));
    setEditing(null);
    setConfirming(null);
  };

  if (decisions === null) return <div className="panel-body empty">loading…</div>;
  return (
    <div className="decisions-panel panel-body">
      <div className="panel-meta">
        {decisions.length} ruling{decisions.length === 1 ? '' : 's'} · .clyde/DECISIONS.md
      </div>
      {decisions.length === 0 && (
        <div className="empty">No decisions recorded yet — settled discussions distill here.</div>
      )}
      {decisions.map((d, i) => (
        <div key={`${i}-${d.raw}`} className={`decision-card${d.kind === 'Deferred' ? ' deferred' : ''}`}>
          {editing === d.raw ? (
            <div className="decision-edit">
              <textarea
                autoFocus
                spellCheck={false}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelEdit();
                }}
              />
              <div className="decision-edit-row">
                <button className="primary" disabled={busy} onClick={() => void commit({ original: d.raw, text: draft })}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button disabled={busy} onClick={cancelEdit}>
                  Cancel
                </button>
                <span className={`decision-edit-note${error ? ' decision-edit-error' : ''}`}>
                  {error ?? 'One line, ledger format — Clyde is told the ruling changed'}
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* The two glyphs are floated so the ruling text keeps the full card
                  width; the confirm is a footer row rather than a second floated
                  strip, which would squeeze the headline into a column. */}
              <div className="decision-actions">
                <button className="linklike decision-btn" title="Edit this ruling" onClick={() => startEdit(d)}>
                  ✎
                </button>
                <button
                  className="linklike decision-btn"
                  title="Delete this ruling — git keeps the history"
                  onClick={() => {
                    setError(null);
                    setConfirming(confirming === d.raw ? null : d.raw);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="decision-headline">
                {d.headline}
                {d.kind === 'Deferred' && <span className="decision-chip deferred">deferred</span>}
                {d.supersedes && <span className="decision-chip">supersedes</span>}
              </div>
              {d.rest && <div className="decision-rest">{d.rest}</div>}
              {d.date && <div className="decision-date">{d.date}</div>}
              {confirming === d.raw && (
                <div className="decision-confirm">
                  <span>Delete this ruling? It leaves the ledger — git keeps the history.</span>
                  <button className="linklike danger" disabled={busy} onClick={() => void commit({ original: d.raw })}>
                    {busy ? 'Deleting…' : 'Delete'}
                  </button>
                  <button className="linklike" disabled={busy} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  {error && <span className="decision-edit-note decision-edit-error">{error}</span>}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

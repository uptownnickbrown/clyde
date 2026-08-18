import { useEffect, useState } from 'react';

// The decision ledger as first-class UI: .clyde/DECISIONS.md parsed into cards.
// The file stays the source of truth (files-as-database); this is a lens.

interface Decision {
  headline: string;
  rest: string;
  date: string | null;
  supersedes: boolean;
}

function parseDecisions(md: string): Decision[] {
  const out: Decision[] = [];
  for (const line of md.split('\n')) {
    const m = /^-\s+Decided:\s+(.*)$/.exec(line.trim());
    if (!m) continue;
    let text = m[1].trim();
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
    out.push({ headline, rest, date, supersedes: /supersede/i.test(text) });
  }
  return out.reverse(); // newest first
}

export function DecisionsPanel() {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
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
        <div key={i} className="decision-card">
          <div className="decision-headline">
            {d.headline}
            {d.supersedes && <span className="decision-chip">supersedes</span>}
          </div>
          {d.rest && <div className="decision-rest">{d.rest}</div>}
          {d.date && <div className="decision-date">{d.date}</div>}
        </div>
      ))}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { PanelContent } from '@clyde/shared';
import { Md } from './Md';

// One renderer per content kind, shared by both tenants of the vocabulary: durable
// pushed panels (left rail) and blocking exhibits (attention surface). The agent
// names a file/glob/URL; the server serves it — nothing is inlined in the event log.
//
// `editable` is the one place the two tenants diverge (#33). A pushed markdown
// ARTIFACT is ambient reference the user may take a pen to — a doc the agent wants
// reviewed and amended — so the left rail passes editable. Markdown inside an
// EXHIBIT stays read-only on purpose: an exhibit is a judgment surface, and its
// feedback channel is the verdict comment (approve / decline + the fix list) that
// returns to the blocked tool call. Two ways to answer the same ask would split the
// response contract the exhibit surface depends on.

export function PanelBody({ content, editable = false }: { content: PanelContent; editable?: boolean }) {
  switch (content.kind) {
    case 'image-gallery':
      return <Gallery glob={content.glob} />;
    case 'markdown':
      return <FileMarkdown path={content.path} editable={editable} />;
    case 'metrics':
      return <Metrics path={content.path} />;
    case 'iframe':
      return <iframe src={content.url} title={content.url} className="panel-iframe" />;
    case 'html':
      return <HtmlFile path={content.path} />;
    case 'table':
      return <DataTable path={content.path} />;
  }
}

const fileUrl = (path: string) => `/api/project-file?path=${encodeURIComponent(path)}`;

export function Gallery({ glob }: { glob: string }) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    fetch(`/api/gallery?glob=${encodeURIComponent(glob)}`)
      .then((r) => r.json())
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [glob]);
  return (
    <div className="gallery">
      {files.map((f) => (
        <a key={f} href={fileUrl(f)} target="_blank" rel="noreferrer">
          <img src={fileUrl(f)} alt={f} />
        </a>
      ))}
      {files.length === 0 && <div className="empty">no matches for {glob}</div>}
    </div>
  );
}

/** A model-AUTHORED html file — a bespoke interactive, an SVG plot, a rich report.
 *  There is deliberately no charting DSL: the model constructs the representation
 *  it wants judged, which is the whole point of the kind.
 *
 *  Sandboxing: `allow-scripts` WITHOUT `allow-same-origin`, so the page runs its own
 *  JS (a static-only frame would make half the kind pointless) from an opaque origin
 *  — no reach into Clyde's DOM, localStorage, or same-origin /api routes. The two
 *  flags together would defeat the sandbox entirely, and agent-written files are
 *  untrusted input (DECISIONS 2026-08-18). For the same reason there is no
 *  open-in-a-new-tab affordance: a top-level load would run the file ON Clyde's
 *  origin with no sandbox at all. */
export function HtmlFile({ path }: { path: string }) {
  return (
    <div className="html-frame">
      <iframe className="html-iframe" src={fileUrl(path)} title={path} sandbox="allow-scripts" />
      <div className="html-frame-note" title={`${path} — rendered sandboxed; drag the corner to resize`}>
        <span className="file-path">{path}</span>
        <span className="html-frame-tag">sandboxed</span>
      </div>
    </div>
  );
}

export interface NormalizedTable {
  columns: string[];
  rows: string[][];
  /** Rows in the file, before the render cap — so truncation can be stated honestly. */
  total: number;
}

const MAX_ROWS = 300;
const MAX_COLS = 40;

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const cellText = (v: unknown): string =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Agent-written JSON is untrusted input (DECISIONS 2026-08-18): normalize on read,
 *  never trust the shape. The contract is `{ columns: string[], rows: (string|number)[][] }`,
 *  but near-misses are coerced rather than dropped — a bare array of rows, rows of
 *  objects keyed by column, columns under `headers`, rows under `data`, cells of any
 *  JSON type. Anything with no usable rows returns null so the caller can render an
 *  honest empty state instead of crashing the panel (and, in an exhibit, the surface
 *  the agent is blocked on). */
export function normalizeTable(raw: unknown): NormalizedTable | null {
  const root = asRecord(raw);
  const rowsRaw: unknown[] | null = Array.isArray(raw)
    ? raw
    : root && Array.isArray(root.rows)
      ? (root.rows as unknown[])
      : root && Array.isArray(root.data)
        ? (root.data as unknown[])
        : null;
  if (!rowsRaw || rowsRaw.length === 0) return null;

  const declaredRaw = root && Array.isArray(root.columns)
    ? (root.columns as unknown[])
    : root && Array.isArray(root.headers)
      ? (root.headers as unknown[])
      : [];
  let columns = declaredRaw.map(cellText).slice(0, MAX_COLS);

  // Rows of objects: their keys carry the column order when none was declared — and
  // override a declared list that shares no key with the data (a mislabeled file
  // would otherwise render as a grid of blanks).
  const keys: string[] = [];
  let keyed = true;
  for (const r of rowsRaw) {
    const o = asRecord(r);
    if (!o) {
      keyed = false;
      continue;
    }
    for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k);
  }
  if (keyed && keys.length && (columns.length === 0 || !columns.some((c) => keys.includes(c)))) {
    columns = keys.slice(0, MAX_COLS);
  }

  let widest = columns.length;
  for (const r of rowsRaw) if (Array.isArray(r) && r.length > widest) widest = r.length;
  while (columns.length < Math.min(widest, MAX_COLS)) columns.push(String(columns.length + 1));
  if (columns.length === 0) return null;

  const rows = rowsRaw.slice(0, MAX_ROWS).map((r) => {
    const o = asRecord(r);
    if (o) return columns.map((c) => cellText(o[c]));
    if (Array.isArray(r)) return columns.map((_, i) => cellText(r[i]));
    // A scalar row (a bare list of values): honest single cell, padded to width.
    return columns.map((_, i) => (i === 0 ? cellText(r) : ''));
  });
  return { columns, rows, total: rowsRaw.length };
}

/** A JSON project file rendered as a real table — the kind for tabular results
 *  (eval sweeps, benchmark runs) that a screenshot would only blur. */
export function DataTable({ path }: { path: string }) {
  const [table, setTable] = useState<NormalizedTable | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(fileUrl(path))
      .then((r) => r.json())
      .then((json) => {
        if (!live) return;
        setTable(normalizeTable(json));
        setLoading(false);
      })
      .catch(() => {
        if (!live) return;
        setTable(null);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path]);

  if (loading) return <div className="empty">loading {path}…</div>;
  if (!table)
    return <div className="empty">no rows in {path} — a table file is {'{ columns: [...], rows: [[...]] }'}</div>;
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.total > table.rows.length && (
        <div className="table-note">
          showing {table.rows.length} of {table.total} rows
        </div>
      )}
    </div>
  );
}

/** Markdown from a project file. When `editable` (pushed artifacts only — see the
 *  note on PanelBody), it carries the Goal panel's edit-in-place flow: edit → save
 *  through POST /api/project-file → the server writes the file and hands the agent a
 *  debounced note, exactly like a SCOPE.md edit. Last-write-wins (v1), as with the
 *  goal doc. */
export function FileMarkdown({ path, editable = false }: { path: string; editable?: boolean }) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch(fileUrl(path))
        .then((r) => r.text())
        .then(setText)
        .catch(() => setText('')),
    [path],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(fileUrl(path), {
        method: 'POST',
        headers: { 'content-type': 'text/markdown' },
        body: draft,
      });
      if (!r.ok) throw new Error(`save failed (${r.status})`);
      setEditing(false);
      await load(); // re-read from disk: what renders is what the file holds
    } catch (err) {
      setError(String(err));
    }
    setSaving(false);
  };

  if (editing) {
    return (
      <div className="md-edit">
        <textarea
          autoFocus
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <div className="md-edit-actions">
          <button className="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </button>
          <span className={`goal-edit-note${error ? ' goal-edit-error' : ''}`}>
            {error ?? `Saving writes ${path} and notifies Clyde`}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="file-md">
      {editable && (
        <div className="md-actions">
          <button
            className="linklike md-edit-btn"
            onClick={() => {
              setDraft(text);
              setError(null);
              setEditing(true);
            }}
          >
            ✎ Edit
          </button>
        </div>
      )}
      <Md>{text}</Md>
    </div>
  );
}

export function Metrics({ path }: { path: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch(fileUrl(path))
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [path]);
  if (!data) return <div className="empty">no data</div>;
  return (
    <table className="metrics">
      <tbody>
        {Object.entries(data).map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td>{String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

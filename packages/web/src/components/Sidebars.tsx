import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import type { ClientMessage, CommitInfo, PanelSpec, SessionEvent, TaskItem } from '@clyde/shared';

// ---------- Left rail ----------

export function TasksPanel({ tasks }: { tasks: TaskItem[] }) {
  const icon = { pending: '○', in_progress: '◐', completed: '●' } as const;
  return (
    <section className="panel">
      <h3>Tasks</h3>
      {tasks.length === 0 && <div className="empty">no tasks yet</div>}
      <ul className="tasks">
        {tasks.map((t) => (
          <li key={t.id} className={`task-${t.status}`}>
            <span className="task-icon">{icon[t.status]}</span> {t.subject}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GitPanel({ commits }: { commits: CommitInfo[] }) {
  return (
    <section className="panel">
      <h3>Git timeline</h3>
      {commits.length === 0 && <div className="empty">no commits yet</div>}
      <ul className="commits">
        {commits.map((c) => (
          <li
            key={c.sha}
            className={c.messageId ? 'linked' : ''}
            title={c.messageId ? 'Jump to conversation' : undefined}
            onClick={() => {
              if (c.messageId) document.getElementById(`msg-${c.messageId}`)?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <div className="commit-line">
              <span className="commit-sha">{c.sha.slice(0, 7)}</span>
              <span className="diffstat">
                +{c.insertions} −{c.deletions}
              </span>
            </div>
            <div className="commit-subject">{c.subject}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Right rail ----------

export function GoalPanel({ markdown }: { markdown: string | null }) {
  return (
    <div className="goal-panel">
      {markdown ? <Markdown>{markdown}</Markdown> : <div className="empty">No SCOPE.md found in project root.</div>}
    </div>
  );
}

export function ActivityPanel({ events }: { events: SessionEvent[] }) {
  const activity = events.filter(
    (e): e is Extract<SessionEvent, { type: 'tool_call' | 'tool_result' | 'dispatch' }> =>
      e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'dispatch',
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="activity-panel">
      {activity.length === 0 && <div className="empty">no activity yet</div>}
      {activity
        .slice(-200)
        .reverse()
        .map((e) => (
          <div key={e.id} className={`act act-${e.type}`} onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
            <span className="act-time">{e.ts.slice(11, 19)}</span>
            {e.type === 'tool_call' && (
              <>
                <code>{e.tool}</code>
                {e.parentToolUseId && <span className="act-sub">sub</span>}
                {expanded === e.id && <pre>{JSON.stringify(e.input, null, 2).slice(0, 2000)}</pre>}
              </>
            )}
            {e.type === 'tool_result' && (
              <>
                <span className={e.ok ? 'ok' : 'err'}>{e.ok ? '✓' : '✗'}</span>
                {expanded === e.id && e.preview && <pre>{e.preview}</pre>}
              </>
            )}
            {e.type === 'dispatch' && (
              <>
                <code>subagent</code> {e.description ?? e.agentType}
                {expanded === e.id && <pre>{e.prompt.slice(0, 3000)}</pre>}
              </>
            )}
          </div>
        ))}
    </div>
  );
}

export function PushedPanels({ panels }: { panels: PanelSpec[] }) {
  return (
    <div className="pushed-panels">
      {panels.length === 0 && (
        <div className="empty">
          Nothing pushed yet — Clyde publishes QA artifacts here via the <code>push_panel</code> tool.
        </div>
      )}
      {panels.map((p) => (
        <section key={p.id} className="panel">
          <h3>{p.title}</h3>
          {p.kind === 'image-gallery' && <Gallery glob={p.glob} />}
          {p.kind === 'markdown' && <FileMarkdown path={p.path} />}
          {p.kind === 'metrics' && <Metrics path={p.path} />}
          {p.kind === 'iframe' && <iframe src={p.url} title={p.title} className="panel-iframe" />}
        </section>
      ))}
    </div>
  );
}

function Gallery({ glob }: { glob: string }) {
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
        <a key={f} href={`/api/project-file?path=${encodeURIComponent(f)}`} target="_blank" rel="noreferrer">
          <img src={`/api/project-file?path=${encodeURIComponent(f)}`} alt={f} />
        </a>
      ))}
      {files.length === 0 && <div className="empty">no matches for {glob}</div>}
    </div>
  );
}

function FileMarkdown({ path }: { path: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    fetch(`/api/project-file?path=${encodeURIComponent(path)}`)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText(''));
  }, [path]);
  return <Markdown>{text}</Markdown>;
}

function Metrics({ path }: { path: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch(`/api/project-file?path=${encodeURIComponent(path)}`)
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

export function ContextPanel({
  events,
  contextTokens,
  costUsd,
  send,
}: {
  events: SessionEvent[];
  contextTokens: number | null;
  costUsd: number | null;
  send: (msg: ClientMessage) => void;
}) {
  const compactions = events.filter((e) => e.type === 'compaction');
  const filesRead = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'tool_call' && (e.tool === 'Read' || e.tool === 'Edit' || e.tool === 'Write')) {
      const p = (e.input as Record<string, unknown>)?.file_path;
      if (typeof p === 'string') filesRead.set(p, (filesRead.get(p) ?? 0) + 1);
    }
  }
  const pct = contextTokens ? Math.min(100, (contextTokens / 1_000_000) * 100) : 0;
  return (
    <div className="context-panel">
      <div className="gauge">
        <div className="gauge-bar">
          <div className="gauge-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="gauge-label">
          {contextTokens ? `~${Math.round(contextTokens / 1000)}k / 1M tokens` : 'no usage data yet'}
          {costUsd != null && ` · $${costUsd.toFixed(2)}`}
        </div>
      </div>
      {compactions.length > 0 && (
        <div className="compactions">
          {compactions.length} compaction{compactions.length === 1 ? '' : 's'} this session — earlier detail is summarized,
          decisions live in .clyde/DECISIONS.md
        </div>
      )}
      <h4>Files touched (approximate context)</h4>
      <ul className="files-touched">
        {[...filesRead.entries()].map(([path, count]) => (
          <li key={path}>
            <span className="file-path">{path.split('/').slice(-2).join('/')}</span>
            <span className="file-count">×{count}</span>
            <button
              title="Ask Clyde to re-read this file next turn"
              onClick={() => send({ type: 'send_message', text: `Please re-read ${path} — I want it fresh in your context.` })}
            >
              ↩ pull back in
            </button>
          </li>
        ))}
        {filesRead.size === 0 && <div className="empty">no files read yet</div>}
      </ul>
    </div>
  );
}

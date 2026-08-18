import { useEffect, useState } from 'react';
import type { ClientMessage, CommitInfo, PanelSpec, SessionEvent, TaskItem } from '@clyde/shared';
import { Md } from './Md';

// ---------- Left rail ----------

export function TasksPanel({ tasks, delegated }: { tasks: TaskItem[]; delegated?: Set<string> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const icon = { pending: '○', in_progress: '◐', completed: '✓' } as const;
  const inProgress = tasks.filter((t) => t.status === 'in_progress');
  const pending = tasks.filter((t) => t.status === 'pending');
  const completed = tasks.filter((t) => t.status === 'completed');

  const Item = ({ t }: { t: TaskItem }) => (
    <li
      className={`task task-${t.status}${openId === t.id ? ' open' : ''}`}
      onClick={() => setOpenId(openId === t.id ? null : t.id)}
    >
      <span className="task-icon">{icon[t.status]}</span>
      <div className="task-main">
        <span className="task-subject">
          {t.status === 'in_progress' ? (t.activeForm ?? t.subject) : t.subject}
          {delegated?.has(t.subject) && <span className="task-delegated">delegated</span>}
        </span>
        {openId === t.id && (
          <div className="task-detail">
            {t.detail ?? <span className="empty">no detail recorded</span>}
            <div className="task-meta">
              #{t.id} · {t.status.replace('_', ' ')}
            </div>
          </div>
        )}
      </div>
    </li>
  );

  return (
    <div className="tasks-panel panel-body">
      {tasks.length === 0 && <div className="empty">no tasks yet</div>}
      {inProgress.length > 0 && (
        <>
          <div className="group-label">In progress</div>
          <ul className="tasks">{inProgress.map((t) => <Item key={t.id} t={t} />)}</ul>
        </>
      )}
      {pending.length > 0 && (
        <>
          <div className="group-label">Up next</div>
          <ul className="tasks">{pending.map((t) => <Item key={t.id} t={t} />)}</ul>
        </>
      )}
      {completed.length > 0 && (
        <>
          <button className="group-toggle" onClick={() => setShowDone(!showDone)}>
            {showDone ? '▾' : '▸'} {completed.length} completed
          </button>
          {showDone && <ul className="tasks">{completed.map((t) => <Item key={t.id} t={t} />)}</ul>}
        </>
      )}
    </div>
  );
}

/** R8: subagents as first-class cards — status, duration, live tool count. */
export function AgentsPanel({ events }: { events: SessionEvent[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const dispatches = events.filter((e): e is Extract<SessionEvent, { type: 'dispatch' }> => e.type === 'dispatch');
  const resultTs = new Map<string, string>();
  const toolCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'tool_result') resultTs.set(e.toolUseId, e.ts);
    if (e.type === 'tool_call' && e.parentToolUseId) {
      toolCounts.set(e.parentToolUseId, (toolCounts.get(e.parentToolUseId) ?? 0) + 1);
    }
  }
  return (
    <div className="agents-panel">
      {dispatches.length === 0 && <div className="empty">no subagents dispatched yet</div>}
      {[...dispatches].reverse().map((d) => {
        const doneTs = resultTs.get(d.toolUseId);
        const secs = Math.max(
          0,
          Math.round(((doneTs ? new Date(doneTs).getTime() : Date.now()) - new Date(d.ts).getTime()) / 1000),
        );
        const dur = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
        const tools = toolCounts.get(d.toolUseId) ?? 0;
        return (
          <section key={d.id} className={`panel agent-card ${doneTs ? 'done' : 'running'}`}>
            <div className="agent-line">
              <span className={`agent-status ${doneTs ? 'done' : 'running'}`}>{doneTs ? '●' : '◐'}</span>
              <strong>{d.description ?? d.agentType ?? 'subagent'}</strong>
              <span className="agent-meta">
                {d.agentType ?? 'agent'} · {dur}
                {tools > 0 && ` · ${tools} tool${tools === 1 ? '' : 's'}`}
              </span>
            </div>
            <button className="linklike" onClick={() => setOpenId(openId === d.id ? null : d.id)}>
              {openId === d.id ? 'hide prompt' : 'show prompt'}
            </button>
            {openId === d.id && <pre className="agent-prompt">{d.prompt.slice(0, 4000)}</pre>}
          </section>
        );
      })}
    </div>
  );
}

function relTime(ts: string): string {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function GitPanel({ commits }: { commits: CommitInfo[] }) {
  const [openSha, setOpenSha] = useState<string | null>(null);
  return (
    <div className="git-panel panel-body">
      {commits.length === 0 && <div className="empty">no commits yet</div>}
      <ul className="commits">
        {commits.map((c) => (
          <li key={c.sha} onClick={() => setOpenSha(openSha === c.sha ? null : c.sha)}>
            <div className="commit-line">
              <span className="commit-sha">{c.sha.slice(0, 7)}</span>
              <span className="commit-time">{relTime(c.ts)}</span>
            </div>
            <div className="commit-subject">{c.subject}</div>
            <div className="diffstat">
              <span className="ins">+{c.insertions}</span> <span className="del">−{c.deletions}</span> ·{' '}
              {c.filesChanged} file{c.filesChanged === 1 ? '' : 's'}
            </div>
            {openSha === c.sha && <CommitDetail commit={c} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CommitDetail({ commit }: { commit: CommitInfo }) {
  const [text, setText] = useState<string | null>(null);
  const [showPatch, setShowPatch] = useState(false);
  useEffect(() => {
    fetch(`/api/commit?sha=${commit.sha}`)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText('failed to load commit'));
  }, [commit.sha]);
  if (text === null) return <div className="commit-detail empty">loading…</div>;
  const patchIdx = text.indexOf('\ndiff --git');
  const stat = patchIdx >= 0 ? text.slice(0, patchIdx) : text;
  const patch = patchIdx >= 0 ? text.slice(patchIdx + 1) : null;
  return (
    <div className="commit-detail" onClick={(e) => e.stopPropagation()}>
      <pre className="commit-stat">{stat.trim()}</pre>
      <div className="commit-detail-actions">
        {commit.messageId && (
          <button
            className="linklike"
            onClick={() =>
              document.getElementById(`msg-${commit.messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          >
            ↷ jump to conversation
          </button>
        )}
        {patch && (
          <button className="linklike" onClick={() => setShowPatch(!showPatch)}>
            {showPatch ? 'hide patch' : 'show patch'}
          </button>
        )}
      </div>
      {showPatch && patch && <pre className="commit-patch">{patch.slice(0, 30000)}</pre>}
    </div>
  );
}

// ---------- Right rail ----------

export function GoalPanel({ markdown }: { markdown: string | null }) {
  return (
    <div className="goal-panel">
      {markdown ? <Md>{markdown}</Md> : <div className="empty">No SCOPE.md found in project root.</div>}
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
                <code>{e.tool.replace(/^mcp__\w+?__/, '')}</code>
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
  return <Md>{text}</Md>;
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

interface LogLine {
  ts?: string;
  level?: string;
  component?: string;
  message?: string;
}

export function LogsPanel() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  useEffect(() => {
    const load = () =>
      fetch('/api/logs?tail=300')
        .then((r) => r.text())
        .then((t) =>
          setLines(
            t
              .split('\n')
              .filter(Boolean)
              .map((l) => {
                try {
                  return JSON.parse(l) as LogLine;
                } catch {
                  return { message: l };
                }
              }),
          ),
        )
        .catch(() => setLines([]));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  const visible = lines.filter((l) => showDebug || l.level !== 'debug');
  return (
    <div className="logs-panel">
      <label className="logs-toggle">
        <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} /> show debug
      </label>
      {visible.length === 0 && <div className="empty">no log lines</div>}
      {visible
        .slice(-200)
        .reverse()
        .map((l, i) => (
          <div key={i} className={`log-row log-${l.level ?? 'info'}`}>
            <span className="act-time">{l.ts?.slice(11, 19) ?? ''}</span>
            <span className="log-component">{l.component ?? ''}</span>
            <span>{l.message ?? ''}</span>
          </div>
        ))}
    </div>
  );
}

export function ReviewsPanel() {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    fetch(`/api/gallery?glob=${encodeURIComponent('.clyde/reviews/*.md')}`)
      .then((r) => r.json())
      .then(setFiles)
      .catch(() => setFiles([]));
  }, []);
  return (
    <div className="reviews-panel">
      {files.length === 0 && (
        <div className="empty">
          No reviews yet — batch feedback lands as markdown checklists in <code>.clyde/reviews/</code>.
        </div>
      )}
      {[...files].reverse().map((f) => (
        <ReviewCard key={f} path={f} />
      ))}
    </div>
  );
}

function ReviewCard({ path }: { path: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    fetch(`/api/project-file?path=${encodeURIComponent(path)}`)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText(''));
  }, [path]);
  const done = (text.match(/^- \[x\]/gim) ?? []).length;
  const total = done + (text.match(/^- \[ \]/gm) ?? []).length;
  return (
    <section className="panel">
      <div className="review-burndown">
        <div className="gauge-bar">
          <div className="gauge-fill" style={{ width: total ? `${(done / total) * 100}%` : '0%' }} />
        </div>
        <div className="gauge-label">
          {done}/{total} addressed · {path.split('/').pop()}
        </div>
      </div>
      <Md>{text}</Md>
    </section>
  );
}

export function ContextPanel({
  events,
  contextTokens,
  costUsd,
  status,
  send,
}: {
  events: SessionEvent[];
  contextTokens: number | null;
  costUsd: number | null;
  status: string;
  send: (msg: ClientMessage) => void;
}) {
  const compactions = events.filter((e) => e.type === 'compaction');
  const compacting = status === 'compacting';
  // Click feedback until the server confirms (status flip or the boundary event landing).
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (compacting || compactions.length) setRequested(false);
  }, [compacting, compactions.length]);
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
          <span title="Cumulative API cost reported by the SDK for this session (all turns + subagents)">
            {contextTokens
              ? `~${Math.round(contextTokens / 1000)}k / 1M tokens`
              : compactions.length
                ? 'compacted — fresh count next turn'
                : 'no usage data yet'}
            {costUsd != null && ` · $${costUsd.toFixed(2)}`}
          </span>
          <button
            className="linklike"
            disabled={compacting || requested}
            title="Summarize older context to free the window (defers to the turn boundary if Clyde is working)"
            onClick={() => {
              send({ type: 'compact' });
              setRequested(true);
            }}
          >
            {compacting ? '⇊ compacting…' : requested ? '⇊ compact queued' : '⇊ compact now'}
          </button>
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
            <span className="file-path">{path.split('/').slice(-3).join('/')}</span>
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

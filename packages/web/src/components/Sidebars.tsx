import { useEffect, useState } from 'react';
import type { ClientMessage, CommitInfo, PanelSpec, SessionEvent, TaskItem } from '@clyde/shared';
import { Md } from './Md';

// ---------- Left rail ----------

const TASK_ICON: Record<TaskItem['status'], string> = { pending: '○', in_progress: '◐', completed: '✓', declined: '✗' };
/** Statuses the edit form offers; 'declined' is ceremony-only (needs a reason). */
const TASK_STATUSES: TaskItem['status'][] = ['pending', 'in_progress', 'completed'];

export function TasksPanel({
  tasks,
  delegated,
  send,
}: {
  tasks: TaskItem[];
  delegated?: Set<string>;
  send: (msg: ClientMessage) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const inProgress = tasks.filter((t) => t.status === 'in_progress');
  const pending = tasks.filter((t) => t.status === 'pending');
  // Closed = completed + declined; declined items stay on the books (review provenance).
  const completed = tasks.filter((t) => t.status === 'completed' || t.status === 'declined');
  const declinedCount = tasks.filter((t) => t.status === 'declined').length;

  const row = (t: TaskItem) => (
    <TaskRow
      key={t.id}
      t={t}
      open={openId === t.id}
      onToggle={() => setOpenId(openId === t.id ? null : t.id)}
      delegated={delegated?.has(t.subject) ?? false}
      send={send}
    />
  );

  return (
    <div className="tasks-panel panel-body">
      {tasks.length === 0 && <div className="empty">no tasks yet</div>}
      {inProgress.length > 0 && (
        <>
          <div className="group-label">In progress</div>
          <ul className="tasks">{inProgress.map(row)}</ul>
        </>
      )}
      {pending.length > 0 && (
        <>
          <div className="group-label">Up next</div>
          <ul className="tasks">{pending.map(row)}</ul>
        </>
      )}
      {completed.length > 0 && (
        <>
          <button className="group-toggle" onClick={() => setShowDone(!showDone)}>
            {showDone ? '▾' : '▸'} {completed.length - declinedCount} completed
            {declinedCount > 0 && ` · ${declinedCount} declined`}
          </button>
          {showDone && <ul className="tasks">{completed.map(row)}</ul>}
        </>
      )}
    </div>
  );
}

/** One task row; expanded cards grow an edit-in-place form (subject / detail /
 *  status). Save sends a single edit_task carrying only the changed fields —
 *  nothing changed, nothing sent. A top-level component (not inline in
 *  TasksPanel) so the form's state and focus survive parent re-renders. */
function TaskRow({
  t,
  open,
  onToggle,
  delegated,
  send,
}: {
  t: TaskItem;
  open: boolean;
  onToggle: () => void;
  delegated: boolean;
  send: (msg: ClientMessage) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState('');
  const [status, setStatus] = useState<TaskItem['status']>(t.status);
  const [detail, setDetail] = useState('');
  useEffect(() => {
    if (!open) setEditing(false); // collapse discards the draft
  }, [open]);

  const startEdit = () => {
    setSubject(t.subject);
    setStatus(t.status);
    setDetail(t.detail ?? '');
    setEditing(true);
  };
  const save = () => {
    const msg: Extract<ClientMessage, { type: 'edit_task' }> = { type: 'edit_task', taskId: t.id };
    const trimmed = subject.trim();
    if (trimmed && trimmed !== t.subject) msg.subject = trimmed;
    if (status !== t.status) msg.status = status;
    if (detail !== (t.detail ?? '')) msg.detail = detail;
    if (msg.subject !== undefined || msg.status !== undefined || msg.detail !== undefined) send(msg);
    setEditing(false);
  };

  // Forward-tolerant: a status outside the editable set (e.g. from a newer
  // server) still renders as the select's current value.
  const statuses = TASK_STATUSES.includes(t.status) ? TASK_STATUSES : [t.status, ...TASK_STATUSES];
  return (
    <li className={`task task-${t.status}${open ? ' open' : ''}`} onClick={onToggle}>
      <span className="task-icon">{TASK_ICON[t.status] ?? '○'}</span>
      <div className="task-main">
        <span className="task-subject">
          {t.status === 'in_progress' ? (t.activeForm ?? t.subject) : t.subject}
          {delegated && <span className="task-delegated">delegated</span>}
        </span>
        {open && !editing && (
          <div className="task-detail">
            {t.status === 'declined' && (
              <div className="task-declined-reason">declined — {t.declineReason ?? 'no reason recorded'}</div>
            )}
            {t.detail ?? <span className="empty">no detail recorded</span>}
            <div className="task-meta">
              #{t.id} · {t.status.replace('_', ' ')}
              {t.source && ` · from ${t.source.review} item ${t.source.item}`}
              <button
                className="linklike task-edit-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit();
                }}
              >
                ✎ edit
              </button>
            </div>
          </div>
        )}
        {open && editing && (
          <div
            className="task-edit"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(false);
              }
            }}
          >
            <input
              autoFocus
              value={subject}
              spellCheck={false}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
              }}
            />
            <textarea
              rows={5}
              value={detail}
              placeholder="detail"
              spellCheck={false}
              onChange={(e) => setDetail(e.target.value)}
            />
            <div className="task-edit-row">
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskItem['status'])}>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
              <button className="primary" onClick={save}>
                Save
              </button>
              <button onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

// ---------- agents (R8: subagents as first-class cards) ----------

type DispatchEvent = Extract<SessionEvent, { type: 'dispatch' }>;
type DispatchUpdateEvent = Extract<SessionEvent, { type: 'dispatch_update' }>;

export interface AgentView {
  dispatch: DispatchEvent;
  running: boolean;
  failed: boolean;
  /** Latest completion notification (background agents; carries summary/report/worktree). */
  update?: DispatchUpdateEvent;
  /** When finished: the notification ts, or the synchronous tool_result ts. */
  finishedTs?: string;
  /** Liveness heartbeat: newest parented tool_call ts, else the dispatch ts. */
  lastActivityTs: string;
  tools: number;
}

/** Background dispatches ack their tool_result instantly with this prefix — that is
 *  a spawn ack, NOT completion. */
const SPAWN_ACK = 'Async agent launched';

/** The one running/finished rule, shared by the panel and the rail badge: a dispatch
 *  is running while it has no dispatch_update AND its tool_result is missing or was
 *  only the background spawn ack. It finishes per dispatch_update (background), or
 *  per its real tool_result (legacy synchronous dispatches). */
export function deriveAgents(events: SessionEvent[]): AgentView[] {
  const dispatches: DispatchEvent[] = [];
  const results = new Map<string, { ts: string; ok: boolean; ack: boolean }>();
  const updates = new Map<string, DispatchUpdateEvent>();
  const lastChild = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'dispatch') dispatches.push(e);
    else if (e.type === 'tool_result' && !results.has(e.toolUseId))
      results.set(e.toolUseId, { ts: e.ts, ok: e.ok, ack: e.preview?.startsWith(SPAWN_ACK) ?? false });
    else if (e.type === 'dispatch_update') updates.set(e.toolUseId, e); // re-notify: latest wins
    else if (e.type === 'tool_call' && e.parentToolUseId) {
      counts.set(e.parentToolUseId, (counts.get(e.parentToolUseId) ?? 0) + 1);
      lastChild.set(e.parentToolUseId, e.ts);
    }
  }
  return dispatches.map((d) => {
    const update = updates.get(d.toolUseId);
    const res = results.get(d.toolUseId);
    const syncResult = res && !res.ack ? res : undefined;
    return {
      dispatch: d,
      running: !update && !syncResult,
      failed: update ? update.status === 'failed' : syncResult ? !syncResult.ok : false,
      update,
      finishedTs: update?.ts ?? syncResult?.ts,
      lastActivityTs: lastChild.get(d.toolUseId) ?? d.ts,
      tools: counts.get(d.toolUseId) ?? 0,
    };
  });
}

const fmtDur = (secs: number) => (secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`);

export function AgentsPanel({ events }: { events: SessionEvent[] }) {
  const agents = deriveAgents(events);
  const anyRunning = agents.some((a) => a.running);
  // Running cards tick live (like the WorkBar) — duration and last-activity age.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);
  return (
    <div className="agents-panel">
      {agents.length === 0 && <div className="empty">no subagents dispatched yet</div>}
      {[...agents].reverse().map((a) => (
        <AgentCard key={a.dispatch.id} agent={a} />
      ))}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentView }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const d = agent.dispatch;
  const endMs = agent.finishedTs ? new Date(agent.finishedTs).getTime() : Date.now();
  const dur = fmtDur(Math.max(0, Math.round((endMs - new Date(d.ts).getTime()) / 1000)));
  const state = agent.running ? 'running' : agent.failed ? 'failed' : 'done';
  const idleSecs = Math.max(0, Math.round((Date.now() - new Date(agent.lastActivityTs).getTime()) / 1000));
  const report = agent.update?.result;
  return (
    <section className={`panel agent-card ${state}`}>
      <div className="agent-line">
        <span className={`agent-status ${state}`}>{agent.running ? '◐' : agent.failed ? '✕' : '●'}</span>
        <strong>{d.description ?? d.agentType ?? 'subagent'}</strong>
        <span className="agent-meta">
          {d.agentType ?? 'agent'} · {dur}
          {agent.tools > 0 && ` · ${agent.tools} tool${agent.tools === 1 ? '' : 's'}`}
        </span>
        {agent.running && (
          <span className={`agent-activity${idleSecs > 120 ? ' stalled' : ''}`}>
            {idleSecs <= 5 ? 'active now' : `last activity ${fmtDur(idleSecs)} ago`}
          </span>
        )}
        {agent.update?.worktreeBranch && (
          <span className="agent-branch" title={agent.update.worktreePath}>
            ⎇ {agent.update.worktreeBranch}
          </span>
        )}
      </div>
      {!agent.running && agent.update?.summary && <div className="agent-summary">{agent.update.summary}</div>}
      <div className="agent-actions">
        <button className="linklike" onClick={() => setShowPrompt(!showPrompt)}>
          {showPrompt ? 'hide prompt' : 'show prompt'}
        </button>
        {report && (
          <button className="linklike" onClick={() => setShowReport(!showReport)}>
            {showReport ? 'hide report' : 'show report'}
          </button>
        )}
      </div>
      {showPrompt && <pre className="agent-prompt">{d.prompt.slice(0, 4000)}</pre>}
      {showReport && report && <pre className="agent-prompt agent-report">{report}</pre>}
    </section>
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

/** The scope doc, readable and editable in place. Save writes SCOPE.md through
 *  the server (POST /api/goal), which broadcasts the fresh text to every client
 *  and hands the agent a user note to re-read it. Last-write-wins (v1). */
export function GoalPanel({ markdown }: { markdown: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(markdown ?? '');
    setError(null);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/goal', {
        method: 'POST',
        headers: { 'content-type': 'text/markdown' },
        body: draft,
      });
      if (!r.ok) throw new Error(`save failed (${r.status})`);
      setEditing(false); // the server's `goal` broadcast refreshes the rendered view
    } catch (err) {
      setError(String(err));
    }
    setSaving(false);
  };

  if (editing) {
    return (
      <div className="goal-panel goal-edit">
        <textarea
          autoFocus
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
          }}
        />
        <div className="goal-edit-actions">
          <button className="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button disabled={saving} onClick={cancel}>
            Cancel
          </button>
          <span className={`goal-edit-note${error ? ' goal-edit-error' : ''}`}>
            {error ?? 'Saving notifies Clyde to re-read the goal'}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="goal-panel">
      <div className="goal-actions">
        <button className="linklike goal-edit-btn" onClick={startEdit}>
          ✎ Edit
        </button>
      </div>
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

/** The Reviews tab is a lens, not a store (intake-ceremony ruling): intake batches
 *  render as burn-downs over Tasks (source/batch provenance); legacy markdown
 *  checklists — review files with no tasks pointing at them — render as before. */
export function ReviewsPanel({ tasks }: { tasks: TaskItem[] }) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    fetch(`/api/gallery?glob=${encodeURIComponent('.clyde/reviews/*.md')}`)
      .then((r) => r.json())
      .then(setFiles)
      .catch(() => setFiles([]));
  }, []);
  const batches = new Map<string, TaskItem[]>();
  for (const t of tasks) if (t.batch) batches.set(t.batch, [...(batches.get(t.batch) ?? []), t]);
  const batchNames = [...batches.keys()].sort().reverse();
  const legacy = files.filter((f) => !batches.has(f.split('/').pop()!.replace(/\.md$/, '')));
  return (
    <div className="reviews-panel">
      {batchNames.length === 0 && legacy.length === 0 && (
        <div className="empty">
          No reviews yet — hit <strong>☰ Review</strong> in the composer to dump batch feedback; Clyde
          distills it into confirmable tasks.
        </div>
      )}
      {batchNames.map((b) => (
        <BatchCard key={b} batch={b} tasks={batches.get(b)!} />
      ))}
      {[...legacy].reverse().map((f) => (
        <ReviewCard key={f} path={f} />
      ))}
    </div>
  );
}

/** Burn-down over one intake batch. Settled = completed + declined — a reasoned
 *  "no" burns down the same as a "done"; only undecided/undone items keep it open. */
function BatchCard({ batch, tasks }: { batch: string; tasks: TaskItem[] }) {
  const [showRaw, setShowRaw] = useState(false);
  const glyph = { pending: '○', in_progress: '◐', completed: '✓', declined: '✗' } as const;
  const settled = tasks.filter((t) => t.status === 'completed' || t.status === 'declined').length;
  const declined = tasks.filter((t) => t.status === 'declined').length;
  const sorted = [...tasks].sort((a, b) => (a.source?.item ?? 0) - (b.source?.item ?? 0));
  return (
    <section className="panel batch-card">
      <div className="review-burndown">
        <div className="gauge-bar">
          <div className="gauge-fill" style={{ width: tasks.length ? `${(settled / tasks.length) * 100}%` : '0%' }} />
        </div>
        <div className="gauge-label">
          {settled}/{tasks.length} settled{declined > 0 && ` · ${declined} declined`} · {batch}
        </div>
      </div>
      <ul className="batch-items">
        {sorted.map((t) => (
          <li key={t.id} className={`batch-item bi-${t.status}`}>
            <span className="task-icon">{glyph[t.status]}</span>
            <span className="bi-subject">
              {t.subject}
              {t.status === 'declined' && t.declineReason && <em className="bi-reason"> — {t.declineReason}</em>}
            </span>
            <span className="bi-id">#{t.id}</span>
          </li>
        ))}
      </ul>
      <button className="linklike" onClick={() => setShowRaw(!showRaw)}>
        {showRaw ? 'hide raw dump' : 'show raw dump'}
      </button>
      {showRaw && <FileMarkdown path={`.clyde/reviews/${batch}.md`} />}
    </section>
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

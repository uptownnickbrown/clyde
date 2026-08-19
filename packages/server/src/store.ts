import fs from 'node:fs';
import path from 'node:path';
import type { SessionEvent, SessionEventBody, Thread, TaskItem, PanelSpec, QueuedItem } from '@clyde/shared';

/** Per-session agent settings (the model/effort picker). Absent file = env defaults. */
export interface SessionConfig {
  model?: string;
  effort?: string;
}

/** All Clyde state lives as plain files under <project>/.clyde/ — committed with
 *  the work, readable and writable by the agent, watched by the UI. */
export class ClydeStore {
  readonly clydeDir: string;
  readonly sessionId: string;
  readonly sessionDir: string;
  private eventsPath: string;
  private threadsPath: string;
  private tasksPath: string;
  private panelsPath: string;

  /** Most recent session with an event log, or null — the resume target. */
  static latestSessionId(projectRoot: string): string | null {
    const dir = path.join(projectRoot, '.clyde', 'sessions');
    if (!fs.existsSync(dir)) return null;
    const ids = fs
      .readdirSync(dir)
      .filter((d) => fs.existsSync(path.join(dir, d, 'events.jsonl')))
      .sort();
    return ids[ids.length - 1] ?? null;
  }

  /** The SDK's session id, recovered from the event log for `resume`. */
  findSdkSessionId(): string | null {
    for (const e of this.loadEvents().reverse()) {
      if (e.type === 'session_started' && e.sdkSessionId) return e.sdkSessionId;
    }
    return null;
  }

  constructor(readonly projectRoot: string, sessionId?: string) {
    this.clydeDir = path.join(projectRoot, '.clyde');
    this.sessionId = sessionId ?? new Date().toISOString().replace(/[:.]/g, '-');
    this.sessionDir = path.join(this.clydeDir, 'sessions', this.sessionId);
    fs.mkdirSync(this.sessionDir, { recursive: true });
    this.eventsPath = path.join(this.sessionDir, 'events.jsonl');
    this.threadsPath = path.join(this.sessionDir, 'threads.json');
    this.tasksPath = path.join(this.clydeDir, 'tasks.json');
    this.panelsPath = path.join(this.clydeDir, 'panels.json');
  }

  appendEvent(body: SessionEventBody, meta?: { ts?: string; sdkUuid?: string }): SessionEvent {
    const event: SessionEvent = {
      id: crypto.randomUUID(),
      ts: meta?.ts ?? new Date().toISOString(),
      ...(meta?.sdkUuid ? { sdkUuid: meta.sdkUuid } : {}),
      ...body,
    };
    fs.appendFileSync(this.eventsPath, JSON.stringify(event) + '\n');
    return event;
  }

  loadEvents(): SessionEvent[] {
    if (!fs.existsSync(this.eventsPath)) return [];
    return fs
      .readFileSync(this.eventsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SessionEvent);
  }

  // ---------- delta journal (last-resort crash recovery for streamed prose) ----------
  // Streamed text deltas already on the user's screen are appended here as they
  // arrive; the file is deleted the moment the finished block lands durably in
  // events.jsonl. A journal that survives to boot therefore marks prose that died
  // in BOTH the event log and the SDK CLI's unflushed transcript — the one loss
  // window resume-boot backfill cannot repair (verified loss 2026-08-18).

  /** Best-effort append — plain appendFileSync, no fsync (cheap is the point), and
   *  never throws: the journal must never break live streaming. */
  appendDelta(turnId: string, text: string) {
    try {
      fs.appendFileSync(this.deltaPath(turnId), text);
    } catch {
      /* best-effort by design */
    }
  }

  /** The turn's streamed text is durable (or the turn ended) — drop its journal. */
  clearDeltas(turnId: string) {
    try {
      fs.rmSync(this.deltaPath(turnId), { force: true });
    } catch {
      /* best-effort by design */
    }
  }

  /** Leftover journals from a crashed process — boot-time recovery input. */
  listDeltaJournals(): { turnId: string; text: string }[] {
    const out: { turnId: string; text: string }[] = [];
    for (const f of fs.readdirSync(this.sessionDir)) {
      const m = /^deltas-(.+)\.log$/.exec(f);
      if (!m) continue;
      try {
        out.push({ turnId: m[1], text: fs.readFileSync(path.join(this.sessionDir, f), 'utf8') });
      } catch {
        /* unreadable journal — recovery is best-effort */
      }
    }
    return out;
  }

  private deltaPath(turnId: string): string {
    // turnId is a uuid or 'unattributed', but it becomes a filename — sanitize anyway.
    return path.join(this.sessionDir, `deltas-${turnId.replace(/[^a-zA-Z0-9-]/g, '_')}.log`);
  }

  loadQueue(): QueuedItem[] {
    return this.readJson<QueuedItem[]>(path.join(this.sessionDir, 'queue.json')) ?? [];
  }

  saveQueue(items: QueuedItem[]) {
    fs.writeFileSync(path.join(this.sessionDir, 'queue.json'), JSON.stringify(items, null, 2));
  }

  loadConfig(): SessionConfig | null {
    return this.readJson<SessionConfig>(path.join(this.sessionDir, 'config.json'));
  }

  saveConfig(config: SessionConfig) {
    fs.writeFileSync(path.join(this.sessionDir, 'config.json'), JSON.stringify(config, null, 2));
  }

  loadThreads(): Thread[] {
    return this.readJson<Thread[]>(this.threadsPath) ?? [];
  }

  saveThreads(threads: Thread[]) {
    fs.writeFileSync(this.threadsPath, JSON.stringify(threads, null, 2));
  }

  loadTasks(): TaskItem[] {
    return normalizeTasks(this.readJson<unknown>(this.tasksPath));
  }

  saveTasks(tasks: TaskItem[]) {
    fs.writeFileSync(this.tasksPath, JSON.stringify(tasks, null, 2));
  }

  loadPanels(): PanelSpec[] {
    return this.readJson<PanelSpec[]>(this.panelsPath) ?? [];
  }

  savePanels(panels: PanelSpec[]) {
    fs.writeFileSync(this.panelsPath, JSON.stringify(panels, null, 2));
  }

  readGoal(): string | null {
    const goalPath = path.join(this.projectRoot, 'SCOPE.md');
    return fs.existsSync(goalPath) ? fs.readFileSync(goalPath, 'utf8') : null;
  }

  /** Save a review-intake dump verbatim as provenance. Returns the batch id
   *  (filename without .md); the file is never edited by the UI — the agent
   *  appends an "## Intake result" section after the ceremony. */
  saveReviewDump(text: string): string {
    const dir = path.join(this.clydeDir, 'reviews');
    fs.mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const slug =
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join('-') || 'review';
    let batch = `${date}-${slug}`;
    for (let n = 2; fs.existsSync(path.join(dir, `${batch}.md`)); n++) batch = `${date}-${slug}-${n}`;
    const header =
      `# Review intake — ${batch}\n\n` +
      `Raw dump from the composer's Review mode, saved verbatim as provenance.\n` +
      `Triage lives in Tasks (source/batch fields); the Reviews panel renders the\n` +
      `burn-down. The agent appends an "## Intake result" section after the ceremony.\n\n` +
      `## Raw dump\n\n`;
    fs.writeFileSync(path.join(dir, `${batch}.md`), header + text + '\n');
    return batch;
  }

  private readJson<T>(p: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
    } catch {
      return null;
    }
  }
}

/** tasks.json is agent-edited (and, via the review ceremony, LLM-edited on
 *  instruction), so its shape is untrusted: accept a bare array or a
 *  {tasks: [...]} wrapper, stringify ids, map title/description LLM-isms onto
 *  subject/detail, drop entries with no id/subject, and default unknown
 *  statuses to pending. A malformed file must degrade quietly, never take the
 *  session down (observed 2026-08-18: an object-shaped tasks.json made
 *  this.tasks.find throw inside the stream loop and killed the SDK stream). */
export function normalizeTasks(raw: unknown): TaskItem[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)
      ? (raw as { tasks: unknown[] }).tasks
      : null;
  if (!arr) return [];
  const STATUSES = new Set<TaskItem['status']>(['pending', 'in_progress', 'completed', 'declined']);
  const tasks: TaskItem[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const subject = o.subject ?? o.title ?? o.content;
    if (o.id == null || subject == null) continue;
    const task: TaskItem = {
      id: String(o.id),
      subject: String(subject),
      status: STATUSES.has(o.status as TaskItem['status']) ? (o.status as TaskItem['status']) : 'pending',
    };
    const detail = o.detail ?? o.description;
    if (detail != null) task.detail = String(detail);
    if (typeof o.activeForm === 'string') task.activeForm = o.activeForm;
    if (o.source && typeof o.source === 'object') {
      const s = o.source as Record<string, unknown>;
      if (s.review != null && s.item != null) task.source = { review: String(s.review), item: Number(s.item) };
    }
    if (o.batch != null) task.batch = String(o.batch);
    if (o.declineReason != null) task.declineReason = String(o.declineReason);
    if (o.commit != null) task.commit = String(o.commit);
    tasks.push(task);
  }
  return tasks;
}

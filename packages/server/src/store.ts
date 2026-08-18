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
    return this.readJson<TaskItem[]>(this.tasksPath) ?? [];
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

  private readJson<T>(p: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
    } catch {
      return null;
    }
  }
}

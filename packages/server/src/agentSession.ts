import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type {
  AgentStatus,
  PanelSpec,
  QueuedItem,
  SessionEvent,
  SessionEventBody,
  TaskItem,
  Thread,
  ThreadAnchor,
} from '@clyde/shared';
import { ClydeStore } from './store.js';
import { GitWatcher } from './git.js';
import { slog } from './log.js';

/** Standing orders appended to the system prompt: the Clyde protocol. */
const CLYDE_PROTOCOL = `
## Clyde protocol
You are running inside Clyde, a UI where the user reads your prose as a document and
project state lives in on-screen panels. Follow these standing orders:

- **Commits**: commit at logical units of completed work on the current branch. Never
  leave finished work uncommitted for long.
- **Decisions**: maintain .clyde/DECISIONS.md. Whenever a discussion (especially a
  sidebar thread) changes a plan or settles a disagreement, append one line:
  "- Decided: <what> because <why> (<date>)". Never re-litigate a recorded decision
  without acknowledging it.
- **Tasks**: keep your task list current using the task tools; the user sees it live
  in a panel and may edit it.
- **QA panels**: when you produce visual QA artifacts (screenshots, plots, reports,
  metrics), publish them to the UI with the push_panel tool so the user can judge
  them without digging through files.
- **Reviews**: batch feedback lives in .clyde/reviews/*.md checklists. Triage every
  item — accept it into a task, fix it and check it off with the commit sha, or push
  back with reasons. Never silently drop one; the user verifies checked items.
- **Delegate aggressively**: hand substantial, well-scoped implementation work to
  subagents via the Task tool while you coordinate, review their output, and stay
  responsive in the conversation. When delegating a task-list item, put its exact
  subject in the Task description and mark it in_progress — the UI links them.
- **Mid-turn messages**: when user messages arrive while you are working, answer
  each one before continuing the work — sidebar comments FIRST, via the
  reply_in_thread tool. Filing a task is in addition to replying, never instead of
  it. Prefer ending turns at logical checkpoints over marathon turns; queued
  follow-ups deliver in order.
- **Sidebar replies**: when a user message is marked as a sidebar comment on an
  earlier excerpt, it carries a sidebar id. Reply by CALLING THE reply_in_thread
  TOOL with that id — immediately, even mid-task; a brief direct answer beats a
  delayed thorough one, and you can call it again to add more. Multiple sidebars can
  be in flight at once; the id says which thread each reply belongs to. Never answer
  a sidebar comment only in main-flow prose — the user is looking at the thread
  card, and prose elsewhere reads as silence.
`;

/** Per-thread reply token; the id tells the server which thread to route to. */
const sidebarToken = (threadId: string) => `[[sidebar:${threadId.slice(0, 8)}]]`;
const SIDEBAR_RE = /^\s*\[\[sidebar(?::([a-zA-Z0-9-]{1,36}))?\]\]\s*/;

interface Delivery {
  turnId: string;
  threadId?: string;
}

export interface Broadcast {
  event(e: SessionEvent): void;
  delta(turnId: string, text: string): void;
  queue(items: QueuedItem[]): void;
  threads(threads: Thread[]): void;
}

export class AgentSession {
  status: AgentStatus = 'idle';
  threads: Thread[];
  tasks: TaskItem[];
  panels: PanelSpec[];
  userQueue: QueuedItem[] = [];
  lastAssistantMessageId: string | null = null;

  private q: ReturnType<typeof query> | null = null;
  private pending: any[] = [];
  private waiters: ((m: any) => void)[] = [];
  private currentDelivery: Delivery | null = null;
  private threadReplyPending = false;
  private git: GitWatcher;
  /** TaskCreate tool_use ids awaiting their result, mapped to provisional task ids. */
  private pendingTaskCreates = new Map<string, string>();
  private pendingCompact = false;
  private costBaseline = 0;

  constructor(
    readonly store: ClydeStore,
    private bus: Broadcast,
    private model = process.env.CLYDE_MODEL ?? 'claude-fable-5',
  ) {
    this.threads = store.loadThreads();
    this.tasks = store.loadTasks();
    this.panels = store.loadPanels();
    this.userQueue = store.loadQueue();
    this.git = new GitWatcher(store.projectRoot, (commit) => {
      commit.messageId = this.lastAssistantMessageId ?? undefined;
      slog('git', 'info', 'new commit', { sha: commit.sha.slice(0, 7), subject: commit.subject });
      this.emit({ type: 'commit', commit });
    });
  }

  start(resumeSdkSessionId?: string) {
    void this.git.start();
    // SDK total_cost_usd resets every process; seed from the log so $ stays session-cumulative.
    for (const e of [...this.store.loadEvents()].reverse()) {
      if (e.type === 'usage' && typeof e.costUsd === 'number') { this.costBaseline = e.costUsd; break; }
    }
    const clydeTools = createSdkMcpServer({
      name: 'clyde',
      version: '0.1.0',
      tools: [
        tool(
          'push_panel',
          'Publish or update a panel in the Clyde UI so the user can see an artifact without digging through files. Panels persist across the session.',
          {
            id: z.string().describe('Stable panel id; pushing the same id updates the panel'),
            kind: z.enum(['image-gallery', 'markdown', 'metrics', 'iframe']),
            title: z.string(),
            source: z
              .string()
              .describe(
                'image-gallery: a glob relative to the project root (e.g. "qa/screenshots/*.png"). markdown/metrics: a file path. iframe: a URL.',
              ),
          },
          async (args) => {
            this.upsertPanel(args as { id: string; kind: PanelSpec['kind']; title: string; source: string });
            return { content: [{ type: 'text' as const, text: `Panel "${args.title}" published.` }] };
          },
        ),
        tool(
          'reply_in_thread',
          'Reply inside a sidebar thread. This is THE way to answer a sidebar comment — call it immediately when one arrives, even mid-task. The reply renders as a threaded card attached to the quoted excerpt, not in the main conversation.',
          {
            thread_id: z
              .string()
              .describe('The sidebar id given in the comment (8 chars, e.g. "ab12cd34"), or the full thread id'),
            text: z.string().describe('Your reply — markdown supported; brief and direct beats delayed and thorough'),
          },
          async (args) => {
            const ok = this.replyInThread(args.thread_id, args.text);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: ok
                    ? 'Reply posted to the thread.'
                    : `No thread matches id "${args.thread_id}" — nothing was posted. Re-check the sidebar id from the comment.`,
                },
              ],
              isError: !ok,
            };
          },
        ),
      ],
    });

    this.q = query({
      prompt: this.input(),
      options: {
        model: this.model,
        effort: process.env.CLYDE_EFFORT ?? 'xhigh',
        ...(resumeSdkSessionId ? { resume: resumeSdkSessionId } : {}),
        cwd: this.store.projectRoot,
        permissionMode: 'bypassPermissions',
        includePartialMessages: true,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: CLYDE_PROTOCOL },
        settingSources: ['project'],
        // Only the servers named here — account-level claude.ai connectors otherwise
        // ride in on the user's login and nag the agent about OAuth.
        strictMcpConfig: true,
        mcpServers: { clyde: clydeTools },
        env: { ...process.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' },
      } as any,
    });
    void this.consume();
    // Persisted leftovers (e.g. queued across a restart) deliver first, in order.
    this.drainNext();
    if (resumeSdkSessionId) this.maybeAutoResume();
  }

  /** Dev restarts are constant when Clyde builds Clyde, so a turn cut short by a
   *  restart continues automatically — visibly, at most once per boot, only when
   *  nothing else is queued, and never chained off a previous auto-resume. */
  private maybeAutoResume() {
    if (this.status === 'working' || this.userQueue.length) return;
    const events = this.store.loadEvents();
    const last = events[events.length - 1];
    if (!last) return;
    if (Date.now() - new Date(last.ts).getTime() > 30 * 60_000) {
      slog('session', 'info', 'auto-resume skipped: log is stale');
      return;
    }
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'turn_complete') return; // last turn finished cleanly
      if (e.type === 'user_message') {
        if (e.text.startsWith('[Auto-resume]')) {
          slog('session', 'warn', 'auto-resume skipped: previous auto-resume never completed (crash loop?)');
          return;
        }
        slog('session', 'info', 'auto-resume: last turn was cut short, continuing');
        this.enqueue(
          '[Auto-resume] The server restarted mid-turn. Review the transcript tail and continue your ' +
            'in-progress work from where it leaves off — re-verify any half-applied or uncommitted changes ' +
            'before building on them. If nothing remains, say so briefly and go idle.',
        );
        return;
      }
    }
  }

  // ---------- user input: strict FIFO + urgent override ----------

  enqueue(
    text: string,
    opts: { urgent?: boolean; threadId?: string; newThreadAnchor?: ThreadAnchor; attachments?: string[] } = {},
  ) {
    let threadId = opts.threadId;
    if (opts.newThreadAnchor) {
      const thread: Thread = {
        id: crypto.randomUUID(),
        anchor: opts.newThreadAnchor,
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      this.threads.push(thread);
      this.store.saveThreads(this.threads);
      this.bus.threads(this.threads);
      threadId = thread.id;
    }
    const item: QueuedItem = {
      id: crypto.randomUUID(),
      text,
      threadId,
      attachments: opts.attachments,
      urgent: opts.urgent ?? false,
      queuedAt: new Date().toISOString(),
    };
    if (item.urgent) {
      // Urgent deliberately jumps the queue: stop in-flight work, deliver immediately.
      if (this.status === 'working') {
        slog('session', 'info', 'urgent: interrupting in-flight turn');
        void this.q?.interrupt().catch((err) => slog('session', 'warn', 'interrupt failed', { err: String(err) }));
      }
      this.deliver(item);
      return;
    }
    if (this.status === 'working') {
      if (process.env.CLYDE_STEERING !== '0') {
        // FIFO: flush anything already queued before steering the newest in.
        while (this.userQueue.length) this.deliverMidTurn(this.userQueue.shift()!);
        this.saveQueue();
        this.deliverMidTurn(item);
        return;
      }
      slog('session', 'info', 'queued (agent working)', { queueLen: this.userQueue.length + 1, threadId: item.threadId });
      this.userQueue.push(item);
      this.saveQueue();
      return;
    }
    // Idle: join the back of the line, deliver from the front — leftovers first.
    this.userQueue.push(item);
    this.saveQueue();
    this.drainNext();
  }

  withdraw(queuedId: string) {
    this.userQueue = this.userQueue.filter((i) => i.id !== queuedId);
    this.saveQueue();
  }

  private saveQueue() {
    this.store.saveQueue(this.userQueue);
    this.bus.queue(this.userQueue);
  }

  /** Deliver the queue head if we're not mid-turn — keeps ordering strictly FIFO. */
  private drainNext() {
    if (this.status === 'working') return;
    const next = this.userQueue.shift();
    if (!next) return;
    this.saveQueue();
    this.deliver(next);
  }

  /** Steering: push into the in-flight turn — the harness surfaces it to the model
   *  alongside its next tool result, so answers don't wait for the turn boundary. */
  private deliverMidTurn(item: QueuedItem) {
    slog('session', 'info', 'steering: delivered mid-turn', { threadId: item.threadId });
    this.emit({ type: 'user_message', text: item.text, threadId: item.threadId, attachments: item.attachments });
    const content = withAttachments(item.threadId ? this.composeThreadMessage(item) : item.text, item.attachments);
    this.pushInput({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
  }

  interrupt() {
    void this.q?.interrupt().catch(() => {});
  }

  /** User-requested compaction: immediate when idle, deferred to the turn boundary
   *  while working. Silent plumbing — no user_message event; the compact_boundary
   *  divider is the visible confirmation. */
  requestCompact() {
    if (this.status === 'compacting' || this.pendingCompact) return; // one at a time
    if (this.status === 'working') {
      slog('session', 'info', 'compact requested — deferred to turn boundary');
      this.pendingCompact = true;
      return;
    }
    this.sendCompact();
  }

  private sendCompact() {
    slog('session', 'info', 'sending /compact');
    this.pushInput({ type: 'user', message: { role: 'user', content: '/compact' }, parent_tool_use_id: null });
    this.setStatus('compacting');
  }

  resolveThread(threadId: string) {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) return;
    thread.status = 'resolved';
    this.store.saveThreads(this.threads);
    this.bus.threads(this.threads);
    this.enqueue(
      `[Sidebar resolved] The user marked the sidebar thread on «${truncate(thread.anchor.quote, 120)}» as resolved. ` +
        `If it settled or changed a decision, append it to .clyde/DECISIONS.md now; otherwise no action needed. ` +
        `Reply briefly via the reply_in_thread tool (thread_id "${thread.id.slice(0, 8)}"), then continue your work.`,
      { threadId },
    );
  }

  private deliver(item: QueuedItem) {
    const turnId = crypto.randomUUID();
    slog('session', 'info', 'delivering turn', { turnId: turnId.slice(0, 8), threadId: item.threadId, urgent: item.urgent });
    this.currentDelivery = { turnId, threadId: item.threadId };
    this.threadReplyPending = Boolean(item.threadId);
    this.setStatus('working');
    this.emit({ type: 'user_message', text: item.text, threadId: item.threadId, attachments: item.attachments });
    const content = withAttachments(item.threadId ? this.composeThreadMessage(item) : item.text, item.attachments);
    this.pushInput({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    });
  }

  private composeThreadMessage(item: QueuedItem): string {
    const thread = this.threads.find((t) => t.id === item.threadId);
    if (!thread) return item.text;
    if (item.text.startsWith('[Sidebar resolved]')) return item.text;
    return (
      `[Sidebar comment — threaded reply requested]\n` +
      `The user selected this excerpt from one of your earlier messages:\n` +
      `"""\n${thread.anchor.quote}\n"""\n` +
      `Their comment:\n${item.text}\n\n` +
      `Reply NOW by calling the reply_in_thread tool with thread_id "${thread.id.slice(0, 8)}". ` +
      `Answer directly and self-containedly — a brief first reply beats a delayed thorough one, and ` +
      `you can call the tool again to add more. Do NOT answer only in main-flow prose; the user is ` +
      `watching the thread card. If your reply changes a prior decision or plan, say so explicitly ` +
      `and record it in .clyde/DECISIONS.md. Afterwards, continue any in-progress main-line work.`
    );
  }

  // ---------- SDK stream consumption ----------

  private async consume() {
    if (!this.q) return;
    try {
      for await (const raw of this.q) {
        this.translate(raw as any);
      }
    } catch (err) {
      slog('session', 'error', 'SDK stream threw', { err: String(err) });
      this.emit({ type: 'error', message: String(err) });
    }
    slog('session', 'warn', 'SDK stream ended');
    this.setStatus('disconnected');
  }

  private translate(msg: any) {
    const turnId = this.currentDelivery?.turnId ?? 'unattributed';
    slog('sdk', 'debug', `message: ${msg.type}${msg.subtype ? `/${msg.subtype}` : ''}`, {
      parent: msg.parent_tool_use_id ?? undefined,
    });
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          this.emit({
            type: 'session_started',
            sdkSessionId: msg.session_id,
            model: msg.model ?? this.model,
            cwd: this.store.projectRoot,
          });
        } else if (msg.subtype === 'compact_boundary') {
          this.emit({
            type: 'compaction',
            preTokens: msg.compact_metadata?.pre_tokens ?? msg.pre_tokens,
            trigger: msg.compact_metadata?.trigger ?? msg.trigger,
          });
          if (this.status === 'compacting') this.setStatus('idle');
        }
        break;
      }
      case 'stream_event': {
        if (msg.parent_tool_use_id) break; // subagent chatter never streams to the doc
        const ev = msg.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          this.bus.delta(turnId, ev.delta.text);
        }
        break;
      }
      case 'assistant': {
        const parent = msg.parent_tool_use_id ?? null;
        const content = msg.message?.content ?? [];
        for (const block of content) {
          if (block.type === 'text' && !parent && block.text.trim()) {
            let markdown: string = block.text;
            let threadId: string | undefined;
            const marker = SIDEBAR_RE.exec(markdown);
            if (marker) {
              markdown = markdown.slice(marker[0].length);
              const shortId = marker[1];
              threadId = shortId
                ? (this.threads.find((t) => t.id.startsWith(shortId))?.id ?? this.currentDelivery?.threadId)
                : this.currentDelivery?.threadId;
              slog('session', 'info', 'sidebar-marked message routed to thread', { shortId, threadId });
            }
            const e = this.emit({ type: 'assistant_message', markdown, turnId, threadId });
            this.lastAssistantMessageId = e.id;
          } else if (block.type === 'tool_use') {
            this.emit({
              type: 'tool_call',
              toolUseId: block.id,
              tool: block.name,
              input: block.input,
              turnId,
              parentToolUseId: parent ?? undefined,
            });
            this.observeToolCall(block.id, block.name, block.input);
          }
        }
        const usage = msg.message?.usage;
        if (usage && !parent) {
          const contextTokens =
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.output_tokens ?? 0);
          this.emit({ type: 'usage', contextTokens });
        }
        break;
      }
      case 'user': {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              this.emit({
                type: 'tool_result',
                toolUseId: block.tool_use_id,
                ok: !block.is_error,
                preview: previewOf(block.content),
              });
              this.resolveTaskCreate(block.tool_use_id, previewOf(block.content));
            }
          }
        }
        break;
      }
      case 'result': {
        slog('session', 'info', 'turn complete', {
          turnId: turnId.slice(0, 8),
          subtype: msg.subtype,
          costUsd: msg.total_cost_usd,
          queued: this.userQueue.length,
        });
        this.emit({ type: 'turn_complete', turnId });
        if (typeof msg.total_cost_usd === 'number') {
          // Baseline + per-process cumulative = true session total across restarts.
          this.emit({ type: 'usage', costUsd: this.costBaseline + msg.total_cost_usd });
        }
        this.currentDelivery = null;
        void this.git.poll();
        if (this.userQueue.length) {
          const next = this.userQueue.shift()!;
          this.saveQueue();
          this.deliver(next);
        } else {
          this.setStatus('idle');
          if (this.pendingCompact) {
            this.pendingCompact = false;
            this.sendCompact();
          }
        }
        break;
      }
    }
  }

  /** Derive Clyde-level events from meaningful tool calls. */
  private observeToolCall(toolUseId: string, name: string, input: any) {
    if (name === 'Task' || name === 'Agent') {
      // Real block id so dispatch ↔ tool_result ↔ subagent activity correlate (R8).
      this.emit({
        type: 'dispatch',
        toolUseId,
        agentType: input?.subagent_type,
        description: input?.description,
        prompt: input?.prompt ?? JSON.stringify(input),
      });
    }
    if (name === 'TaskCreate') {
      const provisional = crypto.randomUUID();
      this.tasks.push({
        id: provisional,
        subject: input?.subject ?? input?.content ?? input?.description ?? 'task',
        status: 'pending',
        detail: input?.description,
        activeForm: input?.activeForm,
      });
      // The harness assigns the real id ("Task #N created") in the tool result.
      this.pendingTaskCreates.set(toolUseId, provisional);
      this.tasksChanged();
    }
    if (name === 'TaskUpdate') {
      const task = this.tasks.find((t) => t.id === (input?.taskId ?? input?.id));
      if (task) {
        if (input?.status === 'deleted') {
          this.tasks = this.tasks.filter((t) => t !== task);
        } else {
          if (input?.status) task.status = input.status;
          if (input?.subject) task.subject = input.subject;
          if (input?.activeForm) task.activeForm = input.activeForm;
        }
        this.tasksChanged();
      }
    }
    if (name === 'TodoWrite' && Array.isArray(input?.todos)) {
      this.tasks = input.todos.map((t: any, i: number) => ({
        id: String(i),
        subject: t.content ?? '',
        status: t.status ?? 'pending',
        activeForm: t.activeForm,
      }));
      this.tasksChanged();
    }
  }

  /** Post an assistant reply into a sidebar thread (the reply_in_thread tool). */
  private replyInThread(threadRef: string, text: string): boolean {
    const thread = this.threads.find((t) => t.id === threadRef || t.id.startsWith(threadRef));
    if (!thread) {
      slog('session', 'warn', 'reply_in_thread: unknown thread', { threadRef });
      return false;
    }
    slog('session', 'info', 'reply_in_thread posted', { threadId: thread.id });
    const e = this.emit({
      type: 'assistant_message',
      markdown: text,
      turnId: this.currentDelivery?.turnId ?? 'unattributed',
      threadId: thread.id,
    });
    this.lastAssistantMessageId = e.id;
    return true;
  }

  /** Swap a provisional TaskCreate id for the harness-assigned "#N" from the result. */
  private resolveTaskCreate(toolUseId: string, preview?: string) {
    const provisional = this.pendingTaskCreates.get(toolUseId);
    if (!provisional) return;
    this.pendingTaskCreates.delete(toolUseId);
    const m = /#(\d+)/.exec(preview ?? '');
    const task = this.tasks.find((t) => t.id === provisional);
    if (m && task) {
      task.id = m[1];
      this.tasksChanged();
    }
  }

  private tasksChanged() {
    this.store.saveTasks(this.tasks);
    this.emit({ type: 'tasks_updated', tasks: this.tasks });
  }

  private upsertPanel(args: { id: string; kind: PanelSpec['kind']; title: string; source: string }) {
    const spec =
      args.kind === 'image-gallery'
        ? ({ id: args.id, kind: 'image-gallery', title: args.title, glob: args.source } as PanelSpec)
        : args.kind === 'iframe'
          ? ({ id: args.id, kind: 'iframe', title: args.title, url: args.source } as PanelSpec)
          : ({ id: args.id, kind: args.kind, title: args.title, path: args.source } as PanelSpec);
    this.panels = [...this.panels.filter((p) => p.id !== spec.id), spec];
    this.store.savePanels(this.panels);
    this.emit({ type: 'panels_updated', panels: this.panels });
  }

  // ---------- plumbing ----------

  private emit(body: SessionEventBody): SessionEvent {
    const event = this.store.appendEvent(body);
    this.bus.event(event);
    return event;
  }

  private setStatus(status: AgentStatus) {
    if (this.status === status) return;
    this.status = status;
    this.emit({ type: 'status', status });
  }

  private async *input(): AsyncGenerator<any> {
    while (true) {
      const next = this.pending.shift();
      if (next !== undefined) {
        yield next;
      } else {
        yield await new Promise<any>((res) => this.waiters.push(res));
      }
    }
  }

  private pushInput(m: any) {
    const w = this.waiters.shift();
    if (w) w(m);
    else this.pending.push(m);
  }
}

function withAttachments(text: string, attachments?: string[]): string {
  return attachments?.length
    ? `${text}\n\n[Attached files — read them with the Read tool: ${attachments.join(', ')}]`
    : text;
}

function previewOf(content: unknown): string | undefined {
  if (typeof content === 'string') return truncate(content, 400);
  if (Array.isArray(content)) {
    const text = content
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
    return text ? truncate(text, 400) : undefined;
  }
  return undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

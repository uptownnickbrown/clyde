// Clyde wire protocol + domain types — the contract between server and web UI.
// Everything persisted to .clyde/ or sent over the WebSocket is defined here.

export type AgentStatus = 'idle' | 'working' | 'awaiting_input' | 'compacting' | 'disconnected';

// ---------- Threads ----------

/** Anchors are stable because messages are immutable. Two shapes share one type:
 *  a span anchor carries {start, end, quote} — offsets index into the final
 *  markdown of the anchored message — while a message-level anchor is just
 *  {messageId}: the thread hangs off the whole message, no quote. The span
 *  fields travel together; `quote` present ⇔ span thread. Existing threads.json
 *  files (all span anchors) parse unchanged. */
export interface ThreadAnchor {
  messageId: string;
  start?: number;
  end?: number;
  quote?: string;
}

export interface Thread {
  id: string;
  anchor: ThreadAnchor;
  status: 'open' | 'resolved';
  createdAt: string;
}

// ---------- Tasks ----------

export interface TaskItem {
  id: string;
  subject: string;
  /** 'declined' is a terminal state from the review-intake ceremony: the user chose
   *  not to do this item; declineReason says why. Declined items stay on the books
   *  so review burn-downs count them and nothing is silently dropped. */
  status: 'pending' | 'in_progress' | 'completed' | 'declined';
  detail?: string;
  /** Present-continuous label shown while in_progress ("Building the QA harness"). */
  activeForm?: string;
  /** Review-intake provenance: the review file (basename under .clyde/reviews/)
   *  and the distilled item number that produced this task. */
  source?: { review: string; item: number };
  /** Intake batch id (the review file's basename without .md) — the Reviews panel
   *  renders a burn-down per batch. */
  batch?: string;
  /** Why the user declined this item (status 'declined'). */
  declineReason?: string;
}

// ---------- Questions (AskUserQuestion interception) ----------

/** One option of a structured question. `preview` is an optional HTML fragment
 *  (toolConfig previewFormat "html"); the SDK strips script/style before it
 *  reaches Clyde. */
export interface QuestionOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface Question {
  /** Full question text — also the key answers are returned under. */
  question: string;
  /** Short label (≤12 chars). */
  header?: string;
  /** 2–4 choices; the UI adds its own "Other" free-text entry. */
  options: QuestionOption[];
  multiSelect?: boolean;
}

/** Keyed by exact question text; arrays for multiSelect; free text allowed. */
export type QuestionAnswers = Record<string, string | string[]>;

// ---------- Panels (agent-pushed UI) ----------

/** What the agent can put on screen, independent of where it lands. One vocabulary,
 *  two tenants: durable panels (push_panel → left-rail Artifacts) and blocking
 *  exhibits (request_review → the attention surface). Renderers switch on `kind`. */
export type PanelContent =
  | { kind: 'image-gallery'; glob: string }
  | { kind: 'markdown'; path: string }
  | { kind: 'metrics'; path: string }
  | { kind: 'iframe'; url: string };

/** A durable pushed panel: content plus its registry identity. */
export type PanelSpec = PanelContent & { id: string; title: string };

// ---------- Exhibits (blocking evidence pushed for approval) ----------

export type ExhibitVerdict = 'approved' | 'declined';

/** pending — the agent's request_review call is still blocked on the user.
 *  approved/declined — the user ruled; the verdict went back as the tool result.
 *  expired — logged but no live resolver: the blocked call died with a server
 *  restart (or an interrupt), so ruling on it now would reach nobody. */
export type ExhibitStatus = 'pending' | ExhibitVerdict | 'expired';

export interface Exhibit {
  id: string;
  title: string;
  content: PanelContent;
  /** The task this evidence is offered against — the acceptance gate it feeds. */
  taskId?: string;
  /** What the agent wants judged, in a sentence or two. */
  detail?: string;
  /** When the exhibit was pushed. */
  ts: string;
  status: ExhibitStatus;
  /** The user's optional note; on a decline it is the fix list. */
  comment?: string;
  /** When the verdict landed (status approved | declined). */
  settledTs?: string;
}

// ---------- Git ----------

/** Live repo state for the shell chrome (top bar): branch + working-tree dirt. */
export interface GitStatus {
  branch: string;
  dirtyFiles: number;
}

export interface CommitInfo {
  sha: string;
  subject: string;
  ts: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  /** Last assistant message id at commit time — the commit↔conversation link. */
  messageId?: string;
}

// ---------- Session events (append-only log; the UI renders from these) ----------

export type SessionEventBody =
  | { type: 'session_started'; sdkSessionId?: string; model: string; cwd: string }
  | {
      type: 'user_message';
      text: string;
      threadId?: string;
      attachments?: string[];
      /** Set when this message was a review-intake dump: the batch id whose raw
       *  text was saved verbatim under .clyde/reviews/. The document badges it. */
      reviewBatch?: string;
    }
  | {
      type: 'assistant_message';
      markdown: string;
      turnId: string;
      threadId?: string;
      /** Recovered from the stream-delta journal after a crash: the prose streamed
       *  to the user but never landed in events.jsonl or the CLI transcript. May be
       *  missing its tail. */
      provisional?: boolean;
    }
  | {
      type: 'tool_call';
      toolUseId: string;
      tool: string;
      input: unknown;
      turnId: string;
      parentToolUseId?: string;
    }
  | { type: 'tool_result'; toolUseId: string; ok: boolean; preview?: string }
  | {
      type: 'dispatch';
      toolUseId: string;
      agentType?: string;
      description?: string;
      prompt: string;
    }
  /** A background agent finished. Background dispatches resolve their tool_result
   *  within ~1s with a spawn ack ("Async agent launched…"); real completion arrives
   *  later as a harness-injected <task-notification> user message, translated into
   *  this event. toolUseId matches the dispatch (it can also name a background Bash
   *  task — consumers join against dispatches). The same id can update more than
   *  once (a notified agent can be resumed); the latest update wins. */
  | {
      type: 'dispatch_update';
      toolUseId: string;
      status: 'completed' | 'failed';
      summary?: string;
      /** The agent's final report (truncated server-side). */
      result?: string;
      worktreeBranch?: string;
      worktreePath?: string;
    }
  | { type: 'question'; questionId: string; questions: Question[]; turnId: string }
  | { type: 'question_answered'; questionId: string; answers: QuestionAnswers; response?: string }
  /** The agent pushed evidence and blocked on a verdict (request_review). */
  | {
      type: 'exhibit';
      exhibitId: string;
      title: string;
      content: PanelContent;
      taskId?: string;
      detail?: string;
      turnId: string;
    }
  /** The user ruled; the verdict is already on its way back as the tool result. */
  | { type: 'exhibit_settled'; exhibitId: string; verdict: ExhibitVerdict; comment?: string }
  | { type: 'tasks_updated'; tasks: TaskItem[] }
  | { type: 'commit'; commit: CommitInfo }
  | { type: 'compaction'; preTokens?: number; trigger?: string }
  | { type: 'usage'; contextTokens?: number; costUsd?: number }
  | { type: 'panels_updated'; panels: PanelSpec[] }
  | { type: 'turn_complete'; turnId: string }
  | { type: 'status'; status: AgentStatus }
  | { type: 'error'; message: string };

/** sdkUuid: wire uuid of the SDK/CLI transcript entry that produced this event.
 *  Stamped by the live translation path so resume-boot backfill can correlate the
 *  log against the CLI's own transcript exactly. Optional — absent on events that
 *  originate in Clyde itself (user_message, status, …) and on pre-field logs. */
export type SessionEvent = { id: string; ts: string; sdkUuid?: string } & SessionEventBody;

// ---------- Queued user input (queue + urgent override) ----------

export interface QueuedItem {
  id: string;
  text: string;
  threadId?: string;
  /** Present when this item creates a new thread on delivery. */
  newThreadAnchor?: ThreadAnchor;
  /** Project-root-relative paths of uploaded files (see POST /api/upload). */
  attachments?: string[];
  /** Review-intake batch id: the dump was saved verbatim at enqueue time (so it
   *  survives restarts) and delivery injects the ceremony instructions. */
  reviewBatch?: string;
  urgent: boolean;
  queuedAt: string;
}

// ---------- WebSocket protocol ----------

export type ClientMessage =
  | {
      type: 'send_message';
      text: string;
      urgent?: boolean;
      attachments?: string[];
      /** Review-intake mode: save the dump verbatim as a review batch and run the
       *  intake ceremony (distill → clarify → confirm → tasks with provenance). */
      reviewIntake?: boolean;
    }
  | { type: 'create_thread'; anchor: ThreadAnchor; text: string; urgent?: boolean }
  | { type: 'thread_reply'; threadId: string; text: string; urgent?: boolean }
  | { type: 'resolve_thread'; threadId: string }
  | { type: 'answer_question'; questionId: string; answers: QuestionAnswers; response?: string }
  /** The user's verdict on a blocking exhibit; the comment rides back to the agent
   *  as part of the request_review tool result (on a decline it is the fix list). */
  | { type: 'exhibit_response'; exhibitId: string; verdict: ExhibitVerdict; comment?: string }
  | { type: 'withdraw_queued'; queuedId: string }
  | { type: 'interrupt' }
  | { type: 'compact' }
  | { type: 'new_session' }
  /** Switch the agent's model/effort: the server rotates the session in place
   *  (dispose + resume same SDK conversation under the new settings). Idle only. */
  | { type: 'set_model'; model: string; effort: string }
  /** User-edited a task from the Tasks panel. Only the provided fields change;
   *  the server applies + persists them and notifies the agent (debounced into
   *  one note per editing burst, like the Goal panel's save). */
  | { type: 'edit_task'; taskId: string; subject?: string; status?: TaskItem['status']; detail?: string }
  /** An aside (composer /btw toggle): a question answered by an ephemeral
   *  read-only observer query over the workspace. It NEVER enters the agent's
   *  context, the queue, or the conversation document — asideId only correlates
   *  the transient aside_started/aside_result broadcasts below. */
  | { type: 'aside'; asideId: string; text: string };

export interface Snapshot {
  projectName: string;
  goalMarkdown: string | null;
  events: SessionEvent[];
  threads: Thread[];
  queue: QueuedItem[];
  panels: PanelSpec[];
  /** Every exhibit this session pushed, with live status — a reload must still
   *  show a pending card (and must not offer actions on an expired one). */
  exhibits: Exhibit[];
  tasks: TaskItem[];
  commits: CommitInfo[];
  status: AgentStatus;
  gitStatus?: GitStatus | null;
  /** Model the agent session runs on (e.g. "claude-fable-5"). */
  model?: string;
  /** Reasoning effort the session runs at (low | medium | high | xhigh | max). */
  effort?: string;
}

export type ServerMessage =
  | { type: 'hello'; snapshot: Snapshot }
  | { type: 'event'; event: SessionEvent }
  | { type: 'delta'; turnId: string; text: string }
  | { type: 'queue'; items: QueuedItem[] }
  | { type: 'threads'; threads: Thread[] }
  | { type: 'git_status'; status: GitStatus }
  /** SCOPE.md changed on disk (the user saved it from the Goal panel). */
  | { type: 'goal'; markdown: string }
  /** Aside lifecycle — TRANSIENT by design. Like delta/queue/threads these are
   *  broadcasts, not SessionEvents: nothing is appended to events.jsonl and no
   *  snapshot replays them, so a reload drops aside cards (v1 ruling: an aside
   *  is a question you asked the workspace, not a part of the record). */
  | { type: 'aside_started'; asideId: string; question: string; model: string; ts: string }
  | {
      type: 'aside_result';
      asideId: string;
      /** The observer's answer as markdown; absent when the query failed. */
      text?: string;
      error?: string;
      /** Cost of THIS aside — never folded into the session cost gauge. */
      costUsd?: number;
      durationMs: number;
      model: string;
      ts: string;
    };

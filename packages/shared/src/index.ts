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
  status: 'pending' | 'in_progress' | 'completed';
  detail?: string;
  /** Present-continuous label shown while in_progress ("Building the QA harness"). */
  activeForm?: string;
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

export type PanelSpec =
  | { id: string; kind: 'image-gallery'; title: string; glob: string }
  | { id: string; kind: 'markdown'; title: string; path: string }
  | { id: string; kind: 'metrics'; title: string; path: string }
  | { id: string; kind: 'iframe'; title: string; url: string };

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
  | { type: 'user_message'; text: string; threadId?: string; attachments?: string[] }
  | { type: 'assistant_message'; markdown: string; turnId: string; threadId?: string }
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
  | { type: 'question'; questionId: string; questions: Question[]; turnId: string }
  | { type: 'question_answered'; questionId: string; answers: QuestionAnswers; response?: string }
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
  urgent: boolean;
  queuedAt: string;
}

// ---------- WebSocket protocol ----------

export type ClientMessage =
  | { type: 'send_message'; text: string; urgent?: boolean; attachments?: string[] }
  | { type: 'create_thread'; anchor: ThreadAnchor; text: string; urgent?: boolean }
  | { type: 'thread_reply'; threadId: string; text: string; urgent?: boolean }
  | { type: 'resolve_thread'; threadId: string }
  | { type: 'answer_question'; questionId: string; answers: QuestionAnswers; response?: string }
  | { type: 'withdraw_queued'; queuedId: string }
  | { type: 'interrupt' }
  | { type: 'compact' }
  | { type: 'new_session' };

export interface Snapshot {
  projectName: string;
  goalMarkdown: string | null;
  events: SessionEvent[];
  threads: Thread[];
  queue: QueuedItem[];
  panels: PanelSpec[];
  tasks: TaskItem[];
  commits: CommitInfo[];
  status: AgentStatus;
  gitStatus?: GitStatus | null;
  /** Model the agent session runs on (e.g. "claude-fable-5"). */
  model?: string;
}

export type ServerMessage =
  | { type: 'hello'; snapshot: Snapshot }
  | { type: 'event'; event: SessionEvent }
  | { type: 'delta'; turnId: string; text: string }
  | { type: 'queue'; items: QueuedItem[] }
  | { type: 'threads'; threads: Thread[] }
  | { type: 'git_status'; status: GitStatus }
  /** SCOPE.md changed on disk (the user saved it from the Goal panel). */
  | { type: 'goal'; markdown: string };

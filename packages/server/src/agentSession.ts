import fs from 'node:fs';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type {
  AgentStatus,
  Exhibit,
  ExhibitVerdict,
  PanelContent,
  PanelSpec,
  Question,
  QuestionAnswers,
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
import { createNoteBuffer } from './notes.js';
import {
  dispatchUpdateFromSystemNotification,
  parseSidebarMarker,
  planBackfill,
  planJournalRecovery,
  previewOf,
  readTaskOutputReport,
  scanTaskNotifications,
  transcriptPathFor,
  truncate,
} from './backfill.js';

/** Standing orders appended to the system prompt: the Clyde protocol. */
const CLYDE_PROTOCOL = `
## Clyde protocol
You are running inside Clyde, a UI where the user reads your prose as a document and
project state lives in on-screen panels. Follow these standing orders:

- **Orientation**: SCOPE.md at the project root is the goal document — the north
  star. Read it before your first unit of work in a fresh session, along with
  .clyde/ENGINEERING.md — the engineering constitution, binding at the critic
  gate. Three docs, three lanes: README.md (humans using the repo), SCOPE.md
  (direction and cut lines), CLAUDE.md (agent operating instructions) —
  cross-reference, never duplicate; move misplaced content instead of copying it.
- **Commits**: commit at logical units of completed work on the current branch. Never
  leave finished work uncommitted for long.
- **Decisions**: maintain .clyde/DECISIONS.md. Whenever a discussion (especially a
  sidebar thread) changes a plan or settles a disagreement, append one line:
  "- Decided: <what> because <why> (<date>)". Posture deferrals use the ledger's
  second line kind: "- Deferred: <axis> — revisit when <trigger> (<date>)". Never
  re-litigate a recorded decision without acknowledging it.
- **Questions**: when a fork is ambiguous, taste-dependent, or expensive to redo,
  ask BEFORE building — call AskUserQuestion with 1–4 crisp questions and 2–4
  concrete options each, your recommendation first. The card renders in the user's
  workbench and blocks the turn until answered, so batch related questions into one
  call and never ask what you can safely decide yourself. Distill answers into
  DECISIONS.md and/or tasks.
- **Tasks**: keep your task list current; the user sees it live in a panel. The task
  tools work, and editing .clyde/tasks.json directly is equivalent — the server
  watches the file.
- **Evidence — the response contract**: two lanes, routed by what you need back.
  push_panel is AMBIENT REFERENCE (left rail): standing surfaces the user consults
  but never answers — a QA gallery tracking every run, a metrics dashboard, a report
  kept at hand. request_review is JUDGMENT (right attention surface): anything that
  should not count as done until a human rules. Default to asking at judgment-worthy
  checkpoints; never route "I finished something" into the skippable ambient lane.
- **Author the evidence**: choose the representation that makes judgment easiest and
  BUILD it — training/eval curves → write a self-contained HTML/SVG plot file and
  push kind "html"; comparisons or results → a JSON table file, kind "table"; visual
  work → a screenshot set; a doc that needs the user's pen → kind "markdown" (pushed
  markdown panels are editable in place; you are notified on save). Never dump a raw
  artifact when a clearer representation is one authored file away, and never narrate
  evidence you could show. An artifact without framing is not evidence: title + detail
  must say what it is and exactly what judgment you want.
- **Verdicts gate acceptance**: request_review blocks by default — approved means the
  task can close; declined comes with a comment, so fix exactly that and push a fresh
  review. Never mark work accepted on your own say-so. Pass blocking:false only when
  you have other non-gated work to continue; the verdict arrives as a message when
  the user rules, and the gate still applies.
- **Change posture**: when work crosses a significance trigger from
  .clyde/ENGINEERING.md (the trigger list lives there alone — never duplicate it),
  name the plausible axes of future change before building. Default NARROW: state
  the posture in one prose line ("Posture: tenant variation treated as
  plausible-but-not-built-for; going narrow — recorded.") and keep moving. Record
  every considered-and-deferred axis in DECISIONS.md as "- Deferred: <axis> —
  revisit when <trigger> (<date>)" — the trigger clause is mandatory; it is what
  lets the deferral resurface when its future arrives. Delegated work: implementers
  never write .clyde/ — they report deferred axes as data in their final report,
  and YOU record them. Ask via a blocking AskUserQuestion ONLY when buying an
  extension point would change what you build TODAY, and price the seam concretely
  ("buying this now costs ~one extra module + a contract"). This deliberately
  narrows the Questions order for posture forks: going narrow with a recorded
  trigger is cheap to redo, so only a seam purchase clears the ask-before-building
  bar. Never ask the user to distinguish "not anticipated" from "plausible but
  don't build for it" — those produce identical builds.
- **Verify before closing**: substantial work faces the critic before you mark it
  completed — dispatch a Task with subagent_type "critic", briefed with the goal +
  success criteria (SCOPE.md), the engineering constitution (.clyde/ENGINEERING.md
  — violations are citable grounds to reject), the exact diff or commits under
  review, and where the QA evidence lives. The critic hunts for reasons NOT to
  accept; it never fixes.
  Surface its verdict via request_review with the taskId attached when the bar looks
  met or the call needs human judgment. When you complete a task, record the closing
  commit sha in its tasks.json entry ("commit": "<sha>") so done work carries its
  proof chain.
- **Reviews**: batch feedback runs the intake ceremony. Messages tagged
  [Review intake] arrive with the full script — follow it exactly (distill to
  numbered items → echo them → clarify ambiguities in one AskUserQuestion →
  confirm scope in one multiSelect AskUserQuestion → file every item as a task
  with source/batch provenance, declined ones with reasons → annotate the review
  file). When the user dumps unprompted multi-item feedback WITHOUT review mode,
  offer the same ceremony (or run it outright when it is unmistakably a batch
  dump) before diving into fixes. Legacy checklist reviews in .clyde/reviews/*.md
  still get triaged item-by-item; nothing is ever silently dropped.
- **Delegate aggressively**: hand substantial, well-scoped implementation work to
  subagents via the Task tool — subagent_type "implementer" for building (it runs
  the configured subagent model), "critic" for verification — while you coordinate,
  review their output, and stay responsive in the conversation. When delegating a
  task-list item, put its exact subject in the Task description and mark it
  in_progress — the UI links them. Worktree briefs, base pinning, merge trains, and
  QA gates: follow CLAUDE.md § Agent operations to the letter.
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

/** System prompt for the "implementer" agent type — the default vehicle for
 *  delegated builds. Kept generic: the dispatch brief carries the specifics. */
const IMPLEMENTER_PROMPT = `You are a Clyde implementation subagent. Execute the brief you were
dispatched with exactly: honor its pinned base, scope boundaries, ground rules, and gates. Read
.clyde/ENGINEERING.md — the engineering constitution — before building; it is part of every
brief's bar and the critic gate enforces it. Never merge branches, never write under .clyde/,
never start dev servers. Commit completed work as the brief directs. Your final message is a
report consumed by the coordinator — return data (what you did, files touched, decisions made,
deferred posture axes, risks, gate evidence), not prose for a human audience.`;

/** System prompt for the "critic" agent type — adversarial verification (#27).
 *  Read-only by construction (no Write/Edit/Task); Bash is for inspection and for
 *  RUNNING the evidence (tests, checks, builds), never mutation. */
const CRITIC_PROMPT = `You are the CRITIC — a read-only verification agent. Your only job is to
find reasons NOT to accept the work under review. You never fix, improve, or implement anything;
if you catch yourself planning a change, stop — report the finding instead.

Your dispatch brief gives you: the goal and success criteria, the diff or commits under review,
and where the QA evidence lives. Judge the work against the GOAL DOCUMENT'S bar for this project
— what quality means here derives from the goal doc, never from a generic rubric — AND against
.clyde/ENGINEERING.md, the ratified engineering constitution. The constitution is BINDING: a
violation is a legitimate, citable reason not to accept. If a rule itself seems wrong for this
work, say so in the verdict — the remedy is amending the file, never waiving it in place.

Method:
- Read the diff/commits yourself; do not trust the implementer's summary of them.
- Re-run the evidence where possible (test suites, checks, builds) instead of trusting reports;
  Bash is available for exactly this and for git inspection — never for mutation. Do not write
  files, do not commit, do not touch .clyde/, do not delegate.
- Hunt specifically: success criteria not actually met; claims without evidence; evidence that
  does not support the claim it decorates; regressions in behavior the goal cares about; quality
  below the goal's bar even where tests pass; constitution violations (policy in the wrong
  layer, unearned abstraction, implementation-coupled tests, contract changes that never touched
  packages/shared or named their consumers).

Verdict — your final message, as data:
  verdict: accept | reject | needs-human-judgment
  reasons: each one concrete and checkable (file, criterion, observed vs claimed)
  examined: what you actually read and ran
Reject needs at least one concrete reason. Accept means you tried to break the claim and failed.`;

/** Silent plumbing prepended to a brand-new session's first message. */
const NEW_SESSION_PRIME =
  '[New session] Orient before working: read SCOPE.md (the goal document) and the .clyde/ state ' +
  '(tasks.json, DECISIONS.md, ENGINEERING.md, reviews/) so standing work, rulings, and the ' +
  'engineering constitution carry forward. Then handle the message below.';

/** Per-thread reply token; the id tells the server which thread to route to.
 *  (Parsing lives in backfill.ts — shared with the resume-boot backfill path.) */
const sidebarToken = (threadId: string) => `[[sidebar:${threadId.slice(0, 8)}]]`;

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
  /** Harness task id → the dispatch's tool_use id, learned from task_started /
   *  task_progress. A task_notification that omits tool_use_id correlates through
   *  this; process-local by design (a dispatch outlives the map only across a
   *  restart, and by then the transcript sweep in backfill is the recovery path). */
  private taskIdToToolUseId = new Map<string, string>();
  /** Blocking AskUserQuestion calls awaiting a user answer, keyed by question id. */
  private pendingQuestions = new Map<string, { questions: Question[]; resolve: (r: unknown) => void }>();
  /** Blocking request_review calls awaiting a verdict, keyed by exhibit id. Live
   *  resolvers are the ONLY thing that makes an exhibit pending — they die with the
   *  process, which is exactly why a restart leaves the card 'expired'. */
  private pendingExhibits = new Map<
    string,
    /** resolve present = a blocking request_review holds the turn. Absent = a
     *  non-blocking post: the verdict is DELIVERED as a message instead, and the
     *  entry survives turn boundaries (only ruling or dispose clears it). */
    { title: string; resolve?: (r: ExhibitDecision) => void }
  >();
  private tasksWatcher: fs.FSWatcher | null = null;
  private tasksWatchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Tasks-panel edits awaiting their debounced [Tasks edited] note. */
  private taskNotes = createNoteBuffer(
    () => this,
    (edits) =>
      `[Tasks edited] The user edited the task list directly: ${edits.join('; ')}. ` +
      `Take these as user intent — adjust your plan if it changes anything.`,
  );
  private needsPrime = false;
  private pendingCompact = false;
  private costBaseline = 0;
  private abort = new AbortController();
  private retired = false;
  /** True once dispose() ran — this session emits nothing further. Public because
   *  anything holding a deferred delivery for it (see notes.ts) has to be able to ask
   *  whether the conversation it was addressed to still exists. */
  get disposed(): boolean {
    return this.retired;
  }

  constructor(
    readonly store: ClydeStore,
    private bus: Broadcast,
    readonly model = process.env.CLYDE_MODEL ?? 'claude-fable-5',
    readonly effort = process.env.CLYDE_EFFORT ?? 'xhigh',
    /** What "implementer" subagents run on. Encoded, not inherited: implementation
     *  grunt work burns most tokens and doesn't need the frontier model — the
     *  critic does, and deliberately inherits `model` instead (#32). */
    readonly subagentModel = process.env.CLYDE_SUBAGENT_MODEL ?? 'claude-opus-5',
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

  /** Mid-turn includes blocking on a question — both hold the turn open. */
  private get busy(): boolean {
    return this.status === 'working' || this.status === 'awaiting_input';
  }

  start(resumeSdkSessionId?: string) {
    // Repair the crash window FIRST: events the CLI produced that a dying server
    // never consumed get appended from the CLI's own transcript, so the snapshot is
    // whole and maybeAutoResume below judges the true tail.
    if (resumeSdkSessionId) this.backfillFromTranscript(resumeSdkSessionId);
    // Then the delta journal — the layer under backfill. Runs on every boot, not
    // just resumes: a crash before session_started was ever logged leaves the same
    // session dir with journals but no sdk id to resume by.
    this.recoverDeltaJournals();
    void this.git.start();
    this.watchTasksFile();
    const bootEvents = this.store.loadEvents();
    // A brand-new session gets a one-line orientation prime with its first message.
    this.needsPrime = !resumeSdkSessionId && bootEvents.length === 0;
    // SDK total_cost_usd resets every process; seed from the log so $ stays session-cumulative.
    for (const e of [...bootEvents].reverse()) {
      if (e.type === 'usage' && typeof e.costUsd === 'number') { this.costBaseline = e.costUsd; break; }
    }
    const clydeTools = createSdkMcpServer({
      name: 'clyde',
      version: '0.1.0',
      tools: [
        tool(
          'push_panel',
          'Publish or update an AMBIENT reference panel in the left rail — a standing surface the user consults but never has to answer: a QA gallery tracking every run, a metrics dashboard, a report kept at hand. No response comes back; for finished work that needs judgment use request_review instead. AUTHOR the representation: for curves write a self-contained HTML/SVG plot file (kind "html"); for results write a JSON table file (kind "table"); pushed markdown is user-editable in place and you are notified on save. Panels persist across the session.',
          {
            id: z.string().describe('Stable panel id; pushing the same id updates the panel'),
            kind: z.enum(['image-gallery', 'markdown', 'metrics', 'iframe', 'html', 'table']),
            title: z.string(),
            source: z
              .string()
              .describe(
                'image-gallery: a glob relative to the project root (e.g. "qa/screenshots/*.png"). markdown/metrics: a file path. iframe: a URL. html: path to a self-contained HTML file YOU author (plot, report, interactive — rendered in a sandboxed iframe). table: path to a JSON file {"columns": string[], "rows": (string|number)[][]}.',
              ),
          },
          async (args) => {
            this.upsertPanel(args as { id: string; kind: PanelContent['kind']; title: string; source: string });
            return { content: [{ type: 'text' as const, text: `Panel "${args.title}" published.` }] };
          },
        ),
        tool(
          'request_review',
          'Put evidence in front of the user for a verdict. Use this whenever work needs human judgment before it counts as done — QA screenshots, an HTML plot or interactive you authored, a data table, metrics, a doc. Choose the representation that makes judgment easiest, and say specifically what you want judged (detail). The card renders on the workbench attention surface. By default this call BLOCKS until the user rules and the verdict (with their comment) is the result. Pass blocking:false only when you have other non-gated work: the call returns "posted" immediately and the verdict arrives later as a user message — the acceptance gate still applies. push_panel is the ambient sibling for reference artifacts nobody has to judge.',
          {
            title: z.string().describe('What the user is being asked to judge, e.g. "Responsive pass — 4 viewports"'),
            content: z
              .object({
                kind: z.enum(['image-gallery', 'markdown', 'metrics', 'iframe', 'html', 'table']),
                source: z
                  .string()
                  .describe(
                    'image-gallery: a glob relative to the project root (e.g. "qa/screenshots/*.png"). markdown/metrics: a file path. iframe: a URL. html: path to a self-contained HTML file YOU author (plot, report, interactive — rendered in a sandboxed iframe). table: path to a JSON file {"columns": string[], "rows": (string|number)[][]}.',
                  ),
              })
              .describe('The evidence itself — same content vocabulary as push_panel'),
            taskId: z
              .string()
              .optional()
              .describe('The task this evidence gates, if any — the card links it and the verdict is its acceptance gate'),
            detail: z.string().optional().describe('What specifically you want judged, in a sentence or two'),
            blocking: z
              .boolean()
              .optional()
              .describe('Default true (wait for the verdict). false = post the card and continue non-gated work; the verdict arrives as a message when the user rules'),
          },
          async (args) => {
            const req = {
              title: args.title,
              content: panelContentOf(args.content.kind, args.content.source),
              taskId: args.taskId,
              detail: args.detail,
            };
            if (args.blocking === false) {
              const exhibitId = this.postReviewAsync(req);
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      posted: true,
                      exhibitId,
                      note: 'The user will rule asynchronously; continue non-gated work. Their verdict arrives as a message.',
                    }),
                  },
                ],
              };
            }
            const decision = await this.requestReview(req);
            // Structured so the agent branches on the outcome, not on prose.
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ verdict: decision.verdict, comment: decision.comment ?? '' }),
                },
              ],
            };
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
        effort: this.effort,
        ...(resumeSdkSessionId ? { resume: resumeSdkSessionId } : {}),
        cwd: this.store.projectRoot,
        abortController: this.abort,
        permissionMode: 'bypassPermissions',
        includePartialMessages: true,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: CLYDE_PROTOCOL },
        settingSources: ['project'],
        // Only the servers named here — account-level claude.ai connectors otherwise
        // ride in on the user's login and nag the agent about OAuth.
        strictMcpConfig: true,
        mcpServers: { clyde: clydeTools },
        // Named agent types make model choice and tool surfaces STRUCTURAL — the
        // standing orders route dispatches through them rather than asking nicely.
        agents: {
          implementer: {
            description:
              'Briefed implementation work: a self-contained build/fix/refactor task with explicit ' +
              'scope, ground rules, and gates. The default agent type for delegated implementation.',
            prompt: IMPLEMENTER_PROMPT,
            model: this.subagentModel,
          },
          critic: {
            description:
              'Adversarial verification before acceptance: reviews completed work against the goal ' +
              'and its evidence, hunting for reasons NOT to accept. Read-only by construction — it ' +
              'can run tests and inspect git but cannot write, edit, or delegate. Dispatch at ' +
              'task-close and merge gates, or whenever a claim of "done" needs challenging.',
            prompt: CRITIC_PROMPT,
            tools: ['Read', 'Glob', 'Grep', 'Bash'],
            // model omitted on purpose: the critic inherits the MAIN model —
            // adversarial judgment is what the frontier model is for.
          },
        },
        // AskUserQuestion always falls through to canUseTool, even under
        // bypassPermissions — that fallthrough is the question-card pipeline.
        canUseTool: (toolName: string, input: any) => this.onCanUseTool(toolName, input),
        toolConfig: { askUserQuestion: { previewFormat: 'html' } },
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
    if (this.busy || this.userQueue.length) return;
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

  /** Recover events lost in the restart crash window from the SDK CLI's own
   *  transcript on disk (see backfill.ts for format + correlation). Backfilled
   *  events flow through the normal append path — fresh Clyde ids, original
   *  timestamps, sdkUuid stamped — and replay the same side effects the live
   *  translation would have had (task mirroring, dispatch cards). Never lets a
   *  bad transcript take the boot down. */
  private backfillFromTranscript(sdkSessionId: string) {
    try {
      const file = transcriptPathFor(this.store.projectRoot, sdkSessionId);
      if (!fs.existsSync(file)) {
        slog('session', 'warn', 'backfill: no SDK transcript on disk', { file });
        return;
      }
      const events = this.store.loadEvents();
      if (!events.length) return; // nothing logged yet — nothing can be missing from it
      const plan = planBackfill({ events, transcript: fs.readFileSync(file, 'utf8'), threads: this.threads });
      if (plan.skippedLines) slog('session', 'warn', 'backfill: skipped unparseable transcript lines', { count: plan.skippedLines });
      if (plan.bailed) {
        slog('session', 'warn', `backfill: ${plan.bailed}`, { file });
        return;
      }
      if (!plan.planned.length) return;
      if (plan.planned.length > 2000) {
        // A real crash window is one turn's tail — even a marathon turn stays far
        // under this; thousands means correlation broke and we'd flood the document.
        slog('session', 'warn', 'backfill: implausibly large plan — refusing', { count: plan.planned.length });
        return;
      }
      slog('session', 'info', 'backfill: recovering events lost to a mid-stream restart', {
        count: plan.planned.length,
        sawTurnEnd: plan.sawTurnEnd,
      });
      for (const p of plan.planned) {
        const e = this.emit(p.body, { ts: p.ts, sdkUuid: p.sdkUuid });
        if (p.body.type === 'assistant_message') this.lastAssistantMessageId = e.id;
        else if (p.body.type === 'tool_call')
          this.observeToolCall(p.body.toolUseId, p.body.tool, p.body.input, { ts: p.ts, sdkUuid: p.sdkUuid });
        else if (p.body.type === 'tool_result') this.resolveTaskCreate(p.body.toolUseId, p.body.preview);
      }
    } catch (err) {
      slog('session', 'error', 'backfill failed — continuing boot without it', { err: String(err) });
    }
  }

  /** The layer under backfill: streamed prose journaled per-delta (see
   *  ClydeStore.appendDelta) that BOTH the event log and the CLI transcript
   *  missed gets emitted as a provisional assistant_message — better a tail-less
   *  recovery than prose the user watched stream and then lost. Never lets a bad
   *  journal take the boot down. */
  private recoverDeltaJournals() {
    try {
      const journals = this.store.listDeltaJournals();
      if (!journals.length) return;
      const plan = planJournalRecovery({ events: this.store.loadEvents(), journals });
      for (const p of plan.emit) {
        slog('session', 'warn', 'journal recovery: provisional message emitted', {
          turnId: p.turnId.slice(0, 8),
          chars: p.markdown.length,
        });
        const e = this.emit({
          type: 'assistant_message',
          markdown: p.markdown,
          turnId: p.turnId,
          provisional: true,
        });
        this.lastAssistantMessageId = e.id;
      }
      // Covered or emitted, every journal is now spent — one recovery per crash.
      for (const j of journals) this.store.clearDeltas(j.turnId);
    } catch (err) {
      slog('session', 'error', 'journal recovery failed — continuing boot without it', { err: String(err) });
    }
  }

  // ---------- user input: strict FIFO + urgent override ----------

  enqueue(
    text: string,
    opts: {
      urgent?: boolean;
      threadId?: string;
      newThreadAnchor?: ThreadAnchor;
      attachments?: string[];
      reviewIntake?: boolean;
    } = {},
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
    // Review intake: the dump is provenance — save it verbatim NOW, before any
    // queueing/delivery/restart can lose it. The batch id rides with the item.
    let reviewBatch: string | undefined;
    if (opts.reviewIntake && text.trim()) {
      reviewBatch = this.store.saveReviewDump(text);
      slog('session', 'info', 'review intake — dump saved', { batch: reviewBatch });
    }
    const item: QueuedItem = {
      id: crypto.randomUUID(),
      text,
      threadId,
      attachments: opts.attachments,
      reviewBatch,
      urgent: opts.urgent ?? false,
      queuedAt: new Date().toISOString(),
    };
    if (item.urgent) {
      // Urgent deliberately jumps the queue: stop in-flight work, deliver immediately.
      if (this.busy) {
        slog('session', 'info', 'urgent: interrupting in-flight turn');
        void this.q?.interrupt().catch((err) => slog('session', 'warn', 'interrupt failed', { err: String(err) }));
      }
      this.deliver(item);
      return;
    }
    if (this.busy) {
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
    if (this.busy) return;
    const next = this.userQueue.shift();
    if (!next) return;
    this.saveQueue();
    this.deliver(next);
  }

  /** Steering: push into the in-flight turn — the harness surfaces it to the model
   *  alongside its next tool result, so answers don't wait for the turn boundary. */
  private deliverMidTurn(item: QueuedItem) {
    slog('session', 'info', 'steering: delivered mid-turn', { threadId: item.threadId });
    this.emit({
      type: 'user_message',
      text: item.text,
      threadId: item.threadId,
      attachments: item.attachments,
      reviewBatch: item.reviewBatch,
    });
    const content = withAttachments(this.composeOutbound(item), item.attachments);
    this.pushInput({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
  }

  /** The message as the model sees it: thread and review-intake deliveries carry
   *  injected instructions; plain messages pass through. */
  private composeOutbound(item: QueuedItem): string {
    if (item.threadId) return this.composeThreadMessage(item);
    if (item.reviewBatch) return this.composeReviewIntake(item);
    return item.text;
  }

  interrupt() {
    void this.q?.interrupt().catch(() => {});
  }

  /** Retire this session so a fresh one can take over (the New-session action).
   *  Aborts the SDK query and stops emitting — the store stays intact on disk. */
  dispose() {
    if (this.retired) return;
    this.retired = true;
    slog('session', 'info', 'session disposed', { sessionId: this.store.sessionId });
    this.git.stop();
    this.tasksWatcher?.close();
    this.taskNotes.cancel();
    this.pendingQuestions.clear();
    this.pendingExhibits.clear();
    this.abort.abort();
  }

  /** User-requested compaction: immediate when idle, deferred to the turn boundary
   *  while working. Silent plumbing — no user_message event; the compact_boundary
   *  divider is the visible confirmation. */
  requestCompact() {
    if (this.status === 'compacting' || this.pendingCompact) return; // one at a time
    if (this.busy) {
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

  /** Silent by design: resolve is the user's presentation action (collapse), never
   *  an agent turn — decisions get recorded when they settle mid-thread. */
  resolveThread(threadId: string) {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) return;
    thread.status = 'resolved';
    this.store.saveThreads(this.threads);
    this.bus.threads(this.threads);
    slog('session', 'info', 'thread resolved', { threadId: threadId.slice(0, 8) });
  }

  private deliver(item: QueuedItem) {
    const turnId = crypto.randomUUID();
    slog('session', 'info', 'delivering turn', { turnId: turnId.slice(0, 8), threadId: item.threadId, urgent: item.urgent });
    this.currentDelivery = { turnId, threadId: item.threadId };
    this.threadReplyPending = Boolean(item.threadId);
    this.setStatus('working');
    this.emit({
      type: 'user_message',
      text: item.text,
      threadId: item.threadId,
      attachments: item.attachments,
      reviewBatch: item.reviewBatch,
    });
    let text = this.composeOutbound(item);
    if (this.needsPrime) {
      // Orientation prime rides with the first message only — silent plumbing,
      // like auto-resume: logged input, not conversation prose.
      this.needsPrime = false;
      text = `${NEW_SESSION_PRIME}\n\n${text}`;
    }
    const content = withAttachments(text, item.attachments);
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
    const instructions =
      `Reply NOW by calling the reply_in_thread tool with thread_id "${thread.id.slice(0, 8)}". ` +
      `Answer directly and self-containedly — a brief first reply beats a delayed thorough one, and ` +
      `you can call the tool again to add more. Do NOT answer only in main-flow prose; the user is ` +
      `watching the thread card. If your reply changes a prior decision or plan, say so explicitly ` +
      `and record it in .clyde/DECISIONS.md. Afterwards, continue any in-progress main-line work.`;
    if (thread.anchor.quote) {
      return (
        `[Sidebar comment — threaded reply requested]\n` +
        `The user selected this excerpt from one of your earlier messages:\n` +
        `"""\n${thread.anchor.quote}\n"""\n` +
        `Their comment:\n${item.text}\n\n` +
        instructions
      );
    }
    // Message-level thread: no highlighted span — the anchor is a whole message,
    // which can be one of the user's own as easily as one of the assistant's.
    const anchored = this.store.loadEvents().find((e) => e.id === thread.anchor.messageId);
    const excerpt =
      anchored?.type === 'assistant_message'
        ? truncate(anchored.markdown, 200)
        : anchored?.type === 'user_message'
          ? truncate(anchored.text, 200)
          : null;
    const intro =
      anchored?.type === 'user_message'
        ? `The user started a thread on this earlier message of their own (no specific excerpt highlighted):`
        : `The user started a thread on this earlier message of yours (no specific excerpt highlighted):`;
    return (
      `[Sidebar comment — threaded reply requested]\n` +
      (excerpt !== null
        ? `${intro}\n"""\n${excerpt}\n"""\n`
        : `The user started a thread on an earlier message in the conversation.\n`) +
      `Their comment:\n${item.text}\n\n` +
      instructions
    );
  }

  /** The intake ceremony (see the intake-ceremony + question-card-confirm rulings
   *  in DECISIONS.md): the dump is already on disk as provenance; the delivered
   *  message carries the dump plus the ceremony script. */
  private composeReviewIntake(item: QueuedItem): string {
    const batch = item.reviewBatch!;
    return (
      `[Review intake — batch "${batch}"]\n` +
      `The user submitted a batch-feedback dump in Review mode. The raw text is already saved ` +
      `verbatim at .clyde/reviews/${batch}.md — that file is provenance; never edit its Raw dump section.\n\n` +
      `The dump:\n"""\n${item.text}\n"""\n\n` +
      `Run the intake ceremony now, before any other work:\n` +
      `1. Distill the dump into crisp numbered items — split independent points, merge duplicates, ` +
      `keep the user's sharpest phrasing. Echo the full numbered list as conversation prose so the ` +
      `user sees the decomposition.\n` +
      `2. Only if items are genuinely ambiguous (unclear target, two readings, a taste fork): batch ` +
      `the clarifications into ONE AskUserQuestion call. Skip when nothing is ambiguous.\n` +
      `3. Confirm scope with ONE AskUserQuestion call: a single multiSelect question listing every ` +
      `numbered item as an option ("Which items should I take on?"). Unselected items are declined — ` +
      `capture a short reason for each from the user's phrasing or a follow-up option, never invent one.\n` +
      `4. File EVERY item by editing .clyde/tasks.json directly (the server watches it live). The file ` +
      `is a TOP-LEVEL JSON ARRAY of task objects — {id: string, subject: string, status, detail?, ` +
      `source?, batch?, declineReason?} — keep the existing tasks and append yours with string ids and ` +
      `these exact field names (subject/detail, never title/description; no wrapper object). Accepted ` +
      `items get source: {review: "${batch}.md", item: <n>}, batch: "${batch}", status "pending"; ` +
      `declined items get the same provenance with status "declined" and declineReason. Nothing is ` +
      `silently dropped — the Reviews panel burn-down counts both.\n` +
      `5. Append an "## Intake result" section to .clyde/reviews/${batch}.md: each numbered item with ` +
      `→ task #<id>, or → declined: <reason>. If the ceremony settled any ruling (a clarifying answer ` +
      `that changes standing direction), record it in DECISIONS.md as usual AND list it here as ` +
      `→ decision: <first words of the ruling> — the review file must name everything it spawned.\n` +
      `Then continue normal work, taking up accepted items by priority.`
    );
  }

  // ---------- questions (AskUserQuestion via canUseTool) ----------

  /** Permission fallthrough. AskUserQuestion ALWAYS lands here (even under
   *  bypassPermissions): surface it as a question card in the workbench and hold
   *  the turn open until the user answers — blocking is the point. Anything else
   *  reaching this callback was refused auto-approval by the mode itself (e.g.
   *  critical-path deletions), so deny it explicitly rather than widen bypass. */
  private async onCanUseTool(toolName: string, input: any): Promise<unknown> {
    if (toolName !== 'AskUserQuestion') {
      slog('session', 'warn', 'canUseTool: denied non-question fallthrough', { toolName });
      return {
        behavior: 'deny',
        message:
          `${toolName} was not auto-approved by bypassPermissions (usually a critical-path ` +
          `deletion or an org ask rule). Clyde declines these calls; adjust and continue.`,
      };
    }
    const questionId = crypto.randomUUID();
    const questions: Question[] = Array.isArray(input?.questions) ? input.questions : [];
    slog('session', 'info', 'question posted — turn blocked on the user', {
      questionId: questionId.slice(0, 8),
      count: questions.length,
    });
    this.emit({
      type: 'question',
      questionId,
      questions,
      turnId: this.currentDelivery?.turnId ?? 'unattributed',
    });
    this.setStatus('awaiting_input');
    return new Promise((resolve) => {
      this.pendingQuestions.set(questionId, { questions, resolve });
    });
  }

  /** The user answered a question card (WS answer_question). */
  answerQuestion(questionId: string, answers: QuestionAnswers, response?: string) {
    const pending = this.pendingQuestions.get(questionId);
    if (!pending) {
      slog('session', 'warn', 'answer for unknown or expired question — ignored', { questionId });
      return;
    }
    this.pendingQuestions.delete(questionId);
    slog('session', 'info', 'question answered', { questionId: questionId.slice(0, 8) });
    this.emit({ type: 'question_answered', questionId, answers, ...(response ? { response } : {}) });
    this.setStatus('working');
    pending.resolve({
      behavior: 'allow',
      updatedInput: { questions: pending.questions, answers, ...(response ? { response } : {}) },
    });
  }

  // ---------- exhibits (blocking evidence via the request_review tool) ----------

  /** The blocking half of request_review: log the exhibit, hold the turn open, and
   *  wait — with no timeout, exactly like the question hold. Verification is the
   *  point; a review that times out into an assumed pass would be worse than none. */
  private requestReview(req: { title: string; content: PanelContent; taskId?: string; detail?: string }): Promise<ExhibitDecision> {
    const exhibitId = this.emitExhibit(req, true);
    slog('session', 'info', 'exhibit pushed — turn blocked on a verdict', {
      exhibitId: exhibitId.slice(0, 8),
      kind: req.content.kind,
      taskId: req.taskId,
    });
    this.setStatus('awaiting_input');
    return new Promise<ExhibitDecision>((resolve) => {
      this.pendingExhibits.set(exhibitId, { title: req.title, resolve });
    });
  }

  /** The non-blocking half: post the card and return immediately — the turn keeps
   *  working, and the verdict is delivered to the agent as a message on settle. */
  private postReviewAsync(req: { title: string; content: PanelContent; taskId?: string; detail?: string }): string {
    const exhibitId = this.emitExhibit(req, false);
    slog('session', 'info', 'exhibit posted non-blocking — verdict will deliver as a message', {
      exhibitId: exhibitId.slice(0, 8),
      kind: req.content.kind,
      taskId: req.taskId,
    });
    this.pendingExhibits.set(exhibitId, { title: req.title });
    return exhibitId;
  }

  private emitExhibit(req: { title: string; content: PanelContent; taskId?: string; detail?: string }, blocking: boolean): string {
    const exhibitId = crypto.randomUUID();
    this.emit({
      type: 'exhibit',
      exhibitId,
      title: req.title,
      content: req.content,
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.detail ? { detail: req.detail } : {}),
      ...(blocking ? {} : { blocking: false }),
      turnId: this.currentDelivery?.turnId ?? 'unattributed',
    });
    return exhibitId;
  }

  /** The user ruled from the workbench (WS exhibit_response). The verdict returns to
   *  the agent as the tool result — nothing is injected into the conversation or the
   *  queue; exhibit_settled is the record. */
  respondToExhibit(exhibitId: string, verdict: ExhibitVerdict, comment?: string) {
    const pending = this.pendingExhibits.get(exhibitId);
    if (!pending) {
      slog('session', 'warn', 'verdict for unknown or expired exhibit — ignored', { exhibitId });
      return;
    }
    if (verdict !== 'approved' && verdict !== 'declined') {
      slog('session', 'warn', 'exhibit_response with an unknown verdict — ignored', { exhibitId, verdict });
      return;
    }
    this.pendingExhibits.delete(exhibitId);
    const trimmed = comment?.trim();
    slog('session', 'info', 'exhibit settled', { exhibitId: exhibitId.slice(0, 8), verdict, commented: Boolean(trimmed) });
    this.emit({ type: 'exhibit_settled', exhibitId, verdict, ...(trimmed ? { comment: trimmed } : {}) });
    if (pending.resolve) {
      // Blocking: the verdict goes back as the tool result. Back to working only
      // when nothing else still holds the turn (an agent can push more than one
      // blocking call in a single assistant message).
      if (![...this.pendingExhibits.values()].some((p) => p.resolve) && !this.pendingQuestions.size) {
        this.setStatus('working');
      }
      pending.resolve({ verdict, comment: trimmed });
    } else {
      // Non-blocking: nobody is awaiting — deliver the verdict as a message (it
      // steers mid-turn or starts a turn from idle, like any user note).
      this.enqueue(
        `[Exhibit verdict] "${pending.title}": ${verdict}${trimmed ? ` — ${trimmed}` : ''} (exhibit ${exhibitId.slice(0, 8)})`,
      );
    }
  }

  /** Snapshot view: every exhibit in the log, with status from the live resolvers.
   *  Takes the already-loaded event log so a snapshot never re-reads the file. */
  exhibitsFrom(events: SessionEvent[]): Exhibit[] {
    const byId = new Map<string, Exhibit>();
    for (const e of events) {
      if (e.type === 'exhibit') {
        byId.set(e.exhibitId, {
          id: e.exhibitId,
          title: e.title,
          content: e.content,
          ...(e.taskId ? { taskId: e.taskId } : {}),
          ...(e.detail ? { detail: e.detail } : {}),
          ...(e.blocking === false ? { blocking: false } : {}),
          ts: e.ts,
          // Unsettled and unheld = the call (or the non-blocking entry) died with a
          // restart or an interrupt.
          status: this.pendingExhibits.has(e.exhibitId) ? 'pending' : 'expired',
        });
      } else if (e.type === 'exhibit_settled') {
        const x = byId.get(e.exhibitId);
        if (x) {
          x.status = e.verdict;
          x.settledTs = e.ts;
          if (e.comment) x.comment = e.comment;
        }
      }
    }
    return [...byId.values()];
  }

  // ---------- SDK stream consumption ----------

  private async consume() {
    if (!this.q) return;
    try {
      for await (const raw of this.q) {
        if (this.retired) break;
        try {
          this.translate(raw as any);
        } catch (err) {
          // A translation bug must degrade to a logged error, never a dead
          // session — the stream is the session (observed 2026-08-18: a
          // malformed tasks.json shape threw in observeToolCall and killed the
          // stream mid-ceremony; the outer catch treats a throw as stream death).
          slog('session', 'error', 'translate failed — event skipped', {
            err: String(err),
            msgType: (raw as any)?.type,
          });
          this.emit({ type: 'error', message: `translate failed (event skipped): ${String(err)}` });
        }
      }
    } catch (err) {
      if (this.retired) return; // aborted on purpose — a fresh session owns the bus now
      slog('session', 'error', 'SDK stream threw', { err: String(err) });
      this.emit({ type: 'error', message: String(err) });
    }
    if (this.retired) return;
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
          this.emit(
            {
              type: 'session_started',
              sdkSessionId: msg.session_id,
              model: msg.model ?? this.model,
              cwd: this.store.projectRoot,
            },
            { sdkUuid: msg.uuid },
          );
        } else if (msg.subtype === 'compact_boundary') {
          this.emit(
            {
              type: 'compaction',
              preTokens: msg.compact_metadata?.pre_tokens ?? msg.pre_tokens,
              trigger: msg.compact_metadata?.trigger ?? msg.trigger,
            },
            { sdkUuid: msg.uuid },
          );
          if (this.status === 'compacting') this.setStatus('idle');
        } else if (msg.subtype === 'task_started' || msg.subtype === 'task_progress') {
          // Bookends that name both ids — the only place the task-id → tool-use-id
          // mapping can be learned before a notification needs it.
          if (typeof msg.task_id === 'string' && typeof msg.tool_use_id === 'string') {
            this.taskIdToToolUseId.set(msg.task_id, msg.tool_use_id);
          }
        } else if (msg.subtype === 'task_notification') {
          // THE live completion signal for a background dispatch (task #38). Before
          // this, only the transcript's user-message form was handled — which the
          // running server never receives — so every background card ticked forever.
          this.handleTaskNotification(msg);
        }
        break;
      }
      case 'stream_event': {
        if (msg.parent_tool_use_id) break; // subagent chatter never streams to the doc
        const ev = msg.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          this.bus.delta(turnId, ev.delta.text);
          // Journal every delta as it arrives (deltas come at human reading speed —
          // per-delta appendFileSync is cheap and simple beats buffered): if this
          // process dies before the block lands in events.jsonl AND the CLI never
          // flushed its transcript, boot recovers the prose from this journal.
          this.store.appendDelta(turnId, ev.delta.text);
        }
        break;
      }
      case 'assistant': {
        const parent = msg.parent_tool_use_id ?? null;
        const content = msg.message?.content ?? [];
        for (const block of content) {
          if (block.type === 'text' && !parent && block.text.trim()) {
            const { markdown, threadId, hadMarker } = parseSidebarMarker(
              block.text,
              this.threads,
              this.currentDelivery?.threadId,
            );
            if (hadMarker) slog('session', 'info', 'sidebar-marked message routed to thread', { threadId });
            const e = this.emit({ type: 'assistant_message', markdown, turnId, threadId }, { sdkUuid: msg.uuid });
            this.lastAssistantMessageId = e.id;
            // The streamed text is durable in events.jsonl now — reset the turn's
            // delta journal (later blocks in this turn re-accumulate).
            this.store.clearDeltas(turnId);
          } else if (block.type === 'tool_use') {
            this.emit(
              {
                type: 'tool_call',
                toolUseId: block.id,
                tool: block.name,
                input: block.input,
                turnId,
                parentToolUseId: parent ?? undefined,
              },
              { sdkUuid: msg.uuid },
            );
            this.observeToolCall(block.id, block.name, block.input, { sdkUuid: msg.uuid });
          }
        }
        const usage = msg.message?.usage;
        if (usage && !parent) {
          const contextTokens =
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.output_tokens ?? 0);
          this.emit({ type: 'usage', contextTokens }, { sdkUuid: msg.uuid });
        }
        break;
      }
      case 'user': {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              this.emit(
                {
                  type: 'tool_result',
                  toolUseId: block.tool_use_id,
                  ok: !block.is_error,
                  preview: previewOf(block.content),
                },
                { sdkUuid: msg.uuid },
              );
              this.resolveTaskCreate(block.tool_use_id, previewOf(block.content));
            }
          }
        }
        // Background-agent completions, TEXT form: the harness injects a user message
        // whose text carries a <task-notification> block (string content on the
        // wire). Current CLIs deliver the completion as system/task_notification
        // instead and this never fires, but it stays as the belt to that braces —
        // dispatch_update is idempotent (exact toolUseId, latest wins), so handling
        // both forms costs nothing and losing the signal costs a card that ticks
        // forever. These never leak into the document as user_message events:
        // translate() only emits user_message from Clyde's own queue
        // (deliver/deliverMidTurn), never from the SDK stream, so no suppression is
        // needed.
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content
                  .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
                  .map((b: any) => b.text)
                  .join('\n')
              : '';
        for (const n of scanTaskNotifications(text)) {
          if (n.taskId) this.taskIdToToolUseId.set(n.taskId, n.body.toolUseId);
          if (n.degraded) {
            slog('session', 'warn', 'task-notification block only partly parsed — completing anyway', {
              toolUseId: n.body.toolUseId,
              taskId: n.taskId,
            });
          }
          slog('session', 'info', 'task-notification (text) → dispatch_update', {
            toolUseId: n.body.toolUseId,
            status: n.body.status,
          });
          this.emit(n.body, { sdkUuid: msg.uuid });
        }
        break;
      }
      case 'result': {
        // A turn that ends with a question still open (interrupt, error) leaves a
        // dangling resolver — drop it so a late answer can't flip status.
        if (this.pendingQuestions.size) {
          slog('session', 'warn', 'turn ended with unanswered question(s) — expiring', {
            count: this.pendingQuestions.size,
          });
          this.pendingQuestions.clear();
        }
        // Same for BLOCKING exhibits: one can only outlive its turn if the turn was
        // interrupted or aborted, and a verdict nobody is waiting for is a lie.
        // Non-blocking posts are the opposite: outliving the turn is their design —
        // the verdict delivers as a message — so they survive until ruled or dispose.
        const blocked = [...this.pendingExhibits.entries()].filter(([, p]) => p.resolve);
        if (blocked.length) {
          slog('session', 'warn', 'turn ended with unsettled blocking exhibit(s) — expiring', {
            count: blocked.length,
          });
          for (const [id] of blocked) this.pendingExhibits.delete(id);
        }
        slog('session', 'info', 'turn complete', {
          turnId: turnId.slice(0, 8),
          subtype: msg.subtype,
          costUsd: msg.total_cost_usd,
          queued: this.userQueue.length,
        });
        this.emit({ type: 'turn_complete', turnId }, { sdkUuid: msg.uuid });
        // Turn over — any journaled deltas that never became a block (interrupt,
        // error) are not recoverable prose worth resurrecting on the next boot.
        this.store.clearDeltas(turnId);
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

  /** Derive Clyde-level events from meaningful tool calls (live and backfilled). */
  /** Live system/task_notification → dispatch_update. The message carries only a
   *  summary; the agent's actual report lives in output_file, so we read it back
   *  (best effort) to give the Agents card the same final report the transcript form
   *  carries in <result>. */
  private handleTaskNotification(msg: any) {
    if (typeof msg?.task_id === 'string' && typeof msg?.tool_use_id === 'string') {
      this.taskIdToToolUseId.set(msg.task_id, msg.tool_use_id);
    }
    const parsed = dispatchUpdateFromSystemNotification(msg, (taskId) => this.taskIdToToolUseId.get(taskId));
    if (!parsed) {
      // Nothing to join on. The card keeps ticking, and this line is why.
      slog('session', 'warn', 'task-notification with no correlatable id — dispatch left running', {
        taskId: typeof msg?.task_id === 'string' ? msg.task_id : undefined,
        status: msg?.status,
      });
      return;
    }
    if (parsed.degraded) {
      slog('session', 'warn', 'task-notification correlated by task id, not tool_use_id', {
        taskId: parsed.taskId,
        toolUseId: parsed.body.toolUseId,
      });
    }
    const result = readTaskOutputReport(typeof msg?.output_file === 'string' ? msg.output_file : undefined);
    const body = result ? { ...parsed.body, result } : parsed.body;
    slog('session', 'info', 'task-notification → dispatch_update', {
      toolUseId: body.toolUseId,
      taskId: parsed.taskId,
      status: body.status,
      durationMs: body.durationMs,
      report: result ? result.length : 0,
    });
    this.emit(body, { sdkUuid: msg.uuid });
  }

  private observeToolCall(toolUseId: string, name: string, input: any, meta?: { ts?: string; sdkUuid?: string }) {
    if (name === 'Task' || name === 'Agent') {
      // Real block id so dispatch ↔ tool_result ↔ subagent activity correlate (R8).
      this.emit(
        {
          type: 'dispatch',
          toolUseId,
          agentType: input?.subagent_type,
          description: input?.description,
          prompt: input?.prompt ?? JSON.stringify(input),
        },
        meta,
      );
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

  /** External edits to .clyde/tasks.json go live without a restart — the agent
   *  (or the user) can edit the file directly and the panel follows. Watches the
   *  directory (file watches drop on atomic replaces); self-writes no-op via
   *  deep-equal. */
  private watchTasksFile() {
    try {
      this.tasksWatcher = fs.watch(this.store.clydeDir, (_event, filename) => {
        if (filename !== 'tasks.json') return;
        clearTimeout(this.tasksWatchTimer);
        this.tasksWatchTimer = setTimeout(() => {
          if (this.retired) return;
          const fresh = this.store.loadTasks();
          if (JSON.stringify(fresh) === JSON.stringify(this.tasks)) return;
          slog('session', 'info', 'tasks.json changed on disk — reloading', { count: fresh.length });
          this.tasks = fresh;
          this.emit({ type: 'tasks_updated', tasks: this.tasks });
        }, 150);
      });
    } catch (err) {
      slog('session', 'warn', 'tasks.json watch unavailable', { err: String(err) });
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

  /** A user edit from the Tasks panel (WS edit_task): apply only the provided
   *  fields, persist + broadcast, and tell the agent — edits within a burst
   *  debounce into ONE queued note (see notes.ts, shared with the Artifacts and
   *  Decisions panels), so direct panel edits never spam the conversation. The
   *  tasks.json write re-fires the file watcher, whose deep-equal guard no-ops it. */
  editTask({ taskId, subject, status, detail }: { taskId: string; subject?: string; status?: TaskItem['status']; detail?: string }) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) {
      slog('session', 'warn', 'edit_task: unknown task — ignored', { taskId });
      return;
    }
    const edits: string[] = [];
    if (subject !== undefined && subject !== task.subject) {
      task.subject = subject;
      edits.push(`#${task.id} subject → "${truncate(subject, 80)}"`);
    }
    if (status !== undefined && status !== task.status) {
      task.status = status;
      edits.push(`#${task.id} status → ${status}`);
    }
    if (detail !== undefined && detail !== (task.detail ?? '')) {
      task.detail = detail || undefined;
      edits.push(detail ? `#${task.id} detail updated` : `#${task.id} detail cleared`);
    }
    if (!edits.length) return;
    slog('session', 'info', 'task edited from the panel', { taskId, edits });
    this.tasksChanged();
    for (const e of edits) this.taskNotes.push(e);
  }

  private tasksChanged() {
    this.store.saveTasks(this.tasks);
    this.emit({ type: 'tasks_updated', tasks: this.tasks });
  }

  private upsertPanel(args: { id: string; kind: PanelContent['kind']; title: string; source: string }) {
    const spec: PanelSpec = { id: args.id, title: args.title, ...panelContentOf(args.kind, args.source) };
    this.panels = [...this.panels.filter((p) => p.id !== spec.id), spec];
    this.store.savePanels(this.panels);
    this.emit({ type: 'panels_updated', panels: this.panels });
  }

  // ---------- plumbing ----------

  private emit(body: SessionEventBody, meta?: { ts?: string; sdkUuid?: string }): SessionEvent {
    const event = this.store.appendEvent(body, meta);
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

/** The user's ruling on one exhibit, as it goes back to the blocked tool call. */
interface ExhibitDecision {
  verdict: ExhibitVerdict;
  comment?: string;
}

/** The one place the agent-facing (kind, source) pair becomes typed content — shared
 *  by push_panel and request_review so the two tools can never drift apart. */
function panelContentOf(kind: PanelContent['kind'], source: string): PanelContent {
  switch (kind) {
    case 'image-gallery':
      return { kind, glob: source };
    case 'iframe':
      return { kind, url: source };
    default:
      return { kind, path: source };
  }
}

function withAttachments(text: string, attachments?: string[]): string {
  return attachments?.length
    ? `${text}\n\n[Attached files — read them with the Read tool: ${attachments.join(', ')}]`
    : text;
}

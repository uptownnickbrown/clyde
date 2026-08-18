// Resume-boot backfill: repair the crash window between the SDK subprocess and the
// event log.
//
// Under tsx watch the server restarts constantly (Clyde builds Clyde). A restart can
// kill the server AFTER the Claude CLI subprocess produced messages but BEFORE the
// server consumed and appended them to events.jsonl — the user watches prose stream
// live, then it vanishes on reload. The CLI, however, writes its own transcript to
// ~/.claude/projects/<munged-cwd>/<sdkSessionId>.jsonl, and the sdk session id stays
// stable across resumes, so that file is a superset timeline of the conversation.
// On resume boot we read it, find the entries newer than what events.jsonl already
// has, and translate them into Clyde events so the document is whole again.
//
// Transcript line shapes this understands (learned from real files, not guessed):
//   {type:'user'|'assistant', uuid, timestamp, isSidechain, isMeta?, message:{...}}
//     assistant message.content blocks: text | thinking | tool_use — the CLI writes
//     one entry per completed content block; entries of one API response share
//     message.id and the final ones carry message.stop_reason 'end_turn'. There is
//     NO 'result' entry in transcripts — stop_reason is the turn-completion signal.
//   {type:'system', subtype:'compact_boundary', compactMetadata:{preTokens,trigger}}
//   {type:'user', message:{content:'<task-notification>…'}} — harness-injected
//     background-agent completion notice (string content, no isMeta); becomes a
//     dispatch_update event, exactly as the live translation path does.
//   metadata lines (queue-operation, attachment, ai-title, last-prompt, mode, …) are
//   ignored, as are sidechain (subagent) and isMeta (harness-injected) entries.
//
// Correlation: every live event now stamps the SDK wire uuid (SessionEvent.sdkUuid),
// making "already logged" an exact uuid match going forward. For logs from before
// that field existed, we fall back to content identity: tool_use ids, tool_result
// ids, assistant markdown, and user text. The watermark is the LAST transcript entry
// already represented in the log; everything after it is the lost tail.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionEvent, SessionEventBody, Thread } from '@clyde/shared';

/** Per-thread reply marker the agent prefixes sidebar replies with. */
export const SIDEBAR_RE = /^\s*\[\[sidebar(?::([a-zA-Z0-9-]{1,36}))?\]\]\s*/;

/** Strip a leading sidebar marker and resolve which thread it addresses. */
export function parseSidebarMarker(
  text: string,
  threads: Thread[],
  fallbackThreadId?: string,
): { markdown: string; threadId?: string; hadMarker: boolean } {
  const marker = SIDEBAR_RE.exec(text);
  if (!marker) return { markdown: text, hadMarker: false };
  const shortId = marker[1];
  const threadId = shortId
    ? (threads.find((t) => t.id.startsWith(shortId))?.id ?? fallbackThreadId)
    : fallbackThreadId;
  return { markdown: text.slice(marker[0].length), threadId, hadMarker: true };
}

export function previewOf(content: unknown): string | undefined {
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

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ---------- task-notification parsing (background-agent completions) ----------
//
// When a background agent (Task/Agent with run_in_background) finishes, the harness
// injects a user message whose text carries a <task-notification> block. Real shape,
// verified against ~/.claude/projects/<munged-cwd>/*.jsonl:
//   <task-notification>
//   <task-id>ade4f42…</task-id>
//   <tool-use-id>toolu_01WCmTu…</tool-use-id>        ← matches the dispatch
//   <output-file>/tmp/…/tasks/….output</output-file>
//   <status>completed|failed</status>
//   <summary>Agent "…" finished</summary>
//   <note>…may notify more than once…</note>          ← optional
//   <result>…full agent report…</result>              ← optional (absent on failures)
//   <worktree><worktreePath>…</worktreePath><worktreeBranch>…</worktreeBranch></worktree>
//   </task-notification>
// The harness HTML-escapes instruction-shaped content inside <result> (&lt; &amp; …);
// we decode after extraction for display. Failed notifications also fire for
// background Bash tasks — consumers join on dispatch toolUseIds.

/** Max chars of a notification <result> report carried on a dispatch_update. */
const DISPATCH_RESULT_MAX = 4000;

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export type DispatchUpdateBody = Extract<SessionEventBody, { type: 'dispatch_update' }>;

/** Parse every <task-notification> block in a user-message text into dispatch_update
 *  bodies. Tolerant: missing close tag reads to end of text; blocks without a
 *  tool-use-id (nothing to correlate) are dropped; unknown statuses read as
 *  'completed' (the agent did stop). Shared by live translation and backfill. */
export function parseTaskNotifications(text: string): DispatchUpdateBody[] {
  if (!text.includes('<task-notification>')) return [];
  const out: DispatchUpdateBody[] = [];
  const blockRe = /<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/g;
  for (let m = blockRe.exec(text); m; m = blockRe.exec(text)) {
    const inner = m[1];
    const tag = (name: string): string | undefined => {
      const t = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(inner);
      const v = t?.[1].trim();
      return v ? decodeEntities(v) : undefined;
    };
    const toolUseId = tag('tool-use-id');
    if (!toolUseId) continue;
    const summary = tag('summary');
    const result = tag('result');
    const worktreeBranch = tag('worktreeBranch');
    const worktreePath = tag('worktreePath');
    out.push({
      type: 'dispatch_update',
      toolUseId,
      status: tag('status') === 'failed' ? 'failed' : 'completed',
      ...(summary ? { summary } : {}),
      ...(result ? { result: truncate(result, DISPATCH_RESULT_MAX) } : {}),
      ...(worktreeBranch ? { worktreeBranch } : {}),
      ...(worktreePath ? { worktreePath } : {}),
    });
  }
  return out;
}

/** Where the Claude CLI keeps this project's transcript for a given sdk session.
 *  The cwd is munged with every non-alphanumeric char replaced by '-'
 *  (/Users/nb/Desktop/clyde → -Users-nb-Desktop-clyde), verified against real dirs. */
export function transcriptPathFor(projectRoot: string, sdkSessionId: string): string {
  const base =
    process.env.CLYDE_SDK_PROJECTS_DIR ??
    path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
  const munged = projectRoot.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(base, munged, `${sdkSessionId}.jsonl`);
}

/** Filler text the CLI writes on resume-after-interrupt; never a real reply. */
const SYNTHETIC_ASSISTANT_TEXTS = new Set(['No response requested.']);

export interface PlannedEvent {
  body: SessionEventBody;
  /** Original-ish timestamp recovered from the transcript entry. */
  ts: string;
  /** The transcript entry's wire uuid — stamped so future correlation is exact. */
  sdkUuid?: string;
}

export interface BackfillPlan {
  planned: PlannedEvent[];
  /** True when the recovered tail shows the turn actually completed. */
  sawTurnEnd: boolean;
  skippedLines: number;
  /** Set when correlation failed and the planner refused to guess. */
  bailed?: string;
}

// ---------- delta-journal recovery (the last loss window) ----------
//
// Streamed text deltas are journaled to <sessionDir>/deltas-<turnId>.log as they
// arrive (ClydeStore.appendDelta) and the journal is cleared the moment the
// finished block lands in events.jsonl. A journal that survives to boot marks
// prose the user watched stream that BOTH the event log and the CLI transcript
// missed — verified loss 2026-08-18: an API response sharing a message with a
// restart-triggering call dies unflushed everywhere. Coverage rule: the CLI-
// transcript backfill may already have recovered the real message, and journal
// text is always a prefix of the completed block (a finished block clears its
// journal), so an assistant_message whose markdown contains the journal's first
// 80 trimmed characters counts as covered. Anything uncovered is emitted as a
// provisional assistant_message — better a tail-less recovery than silence.

export interface JournalRecoveryPlan {
  emit: { turnId: string; markdown: string }[];
}

export function planJournalRecovery(opts: {
  events: SessionEvent[];
  journals: { turnId: string; text: string }[];
}): JournalRecoveryPlan {
  const plan: JournalRecoveryPlan = { emit: [] };
  for (const j of opts.journals) {
    // Sidebar plumbing never renders: logged replies are stored marker-stripped,
    // so strip before probing (and never show the marker in recovered prose).
    const text = j.text.replace(SIDEBAR_RE, '').trim();
    if (!text) continue;
    const probe = text.slice(0, 80);
    const covered = opts.events.some((e) => e.type === 'assistant_message' && e.markdown.includes(probe));
    if (!covered) plan.emit.push({ turnId: j.turnId, markdown: text });
  }
  return plan;
}

export function planBackfill(opts: {
  events: SessionEvent[];
  /** Raw contents of the CLI transcript .jsonl. */
  transcript: string;
  threads: Thread[];
}): BackfillPlan {
  const { events, threads } = opts;
  const plan: BackfillPlan = { planned: [], sawTurnEnd: false, skippedLines: 0 };

  const entries: any[] = [];
  for (const line of opts.transcript.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      plan.skippedLines++;
    }
  }
  if (!entries.length) return plan;

  // ---- what the log already holds
  const loggedUuids = new Set<string>();
  const loggedToolCalls = new Set<string>();
  const loggedToolResults = new Set<string>();
  const loggedDispatchUpdates = new Set<string>();
  const loggedAssistantTexts = new Set<string>();
  const loggedUserTexts: string[] = [];
  let loggedCompactions = 0;
  for (const e of events) {
    if (e.sdkUuid) loggedUuids.add(e.sdkUuid);
    if (e.type === 'tool_call') loggedToolCalls.add(e.toolUseId);
    else if (e.type === 'tool_result') loggedToolResults.add(e.toolUseId);
    else if (e.type === 'dispatch_update') loggedDispatchUpdates.add(e.toolUseId);
    else if (e.type === 'assistant_message') loggedAssistantTexts.add(e.markdown.trim());
    else if (e.type === 'user_message') loggedUserTexts.push(e.text.trim());
    else if (e.type === 'compaction') loggedCompactions++;
  }

  const userEntryText = (o: any): string | null => {
    const c = o?.message?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      const t = c
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
      return t || null;
    }
    return null;
  };

  /** true = already in the log · false = a lost candidate · null = not ours to judge. */
  const represented = (o: any): boolean | null => {
    if (typeof o?.uuid === 'string' && loggedUuids.has(o.uuid)) return true;
    if (o?.isSidechain) return null;
    const content = o?.message?.content;
    if (o?.type === 'assistant') {
      if (!Array.isArray(content)) return null;
      let verdict: boolean | null = null;
      for (const b of content) {
        if (b?.type === 'tool_use') {
          if (loggedToolCalls.has(b.id)) return true;
          verdict = false;
        } else if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          if (SYNTHETIC_ASSISTANT_TEXTS.has(b.text.trim())) continue;
          const { markdown } = parseSidebarMarker(b.text, threads);
          if (loggedAssistantTexts.has(markdown.trim())) return true;
          verdict = false;
        }
      }
      return verdict;
    }
    if (o?.type === 'user') {
      if (o.isMeta) return null;
      if (Array.isArray(content)) {
        let verdict: boolean | null = null;
        for (const b of content) {
          if (b?.type === 'tool_result') {
            if (loggedToolResults.has(b.tool_use_id)) return true;
            verdict = false;
          }
        }
        if (verdict !== null) return verdict;
      }
      const text = userEntryText(o)?.trim();
      if (!text) return null;
      // Task-notification entries ARE planned (as dispatch_updates), so they count
      // toward correlation — before the plain-text check, whose containment match
      // could false-positive on a short logged user text inside a long report.
      const notifications = parseTaskNotifications(text);
      if (notifications.length) return notifications.every((n) => loggedDispatchUpdates.has(n.toolUseId));
      // Delivered prompts are logged verbatim before they reach the CLI; sidebar
      // comments are logged raw but sent wrapped — containment covers both. Other
      // user-typed entries (skill loads, interrupt notices) match nothing → null,
      // and user text is never backfilled anyway.
      if (loggedUserTexts.some((t) => t && (t === text || text.includes(t)))) return true;
      return null;
    }
    return null;
  };

  // Notifications are idempotent (exact toolUseId, latest wins), so unlike prose
  // they can be healed from ANYWHERE in the transcript, not just the lost tail —
  // a completion that arrived before the parser existed, or while a server was
  // down, otherwise leaves its dispatch "running" forever in the Agents panel.
  // This sweep is the single place notifications are planned.
  const latestNotification = new Map<string, PlannedEvent>();
  const noteNotifications = (text: string | null, ts: string, sdkUuid?: string) => {
    for (const body of parseTaskNotifications(text ?? '')) {
      if (loggedDispatchUpdates.has(body.toolUseId)) continue;
      latestNotification.set(body.toolUseId, { body, ts, sdkUuid });
    }
  };
  for (const o of entries) {
    const ts = typeof o?.timestamp === 'string' ? o.timestamp : new Date().toISOString();
    if (o?.type === 'user' && !o.isSidechain && !o.isMeta) {
      noteNotifications(userEntryText(o), ts, o.uuid);
    } else if (o?.type === 'queue-operation' && typeof o?.content === 'string') {
      // Real transcripts record notifications as queue-operation metadata lines
      // ({operation, content}) — often WITHOUT any user entry (verified against
      // this project's own transcript: 10 queue-op lines, 1 user entry). The
      // enqueue/dequeue pair repeats each notification; latest-per-id dedupes.
      noteNotifications(o.content, ts);
    }
  }
  plan.planned.push(...latestNotification.values());

  let watermark = -1;
  for (let i = 0; i < entries.length; i++) if (represented(entries[i]) === true) watermark = i;
  if (watermark === -1) {
    // A log with content but zero overlap means our correlation is broken — appending
    // the whole transcript would flood the document. Refuse and say so.
    if (entries.some((o) => represented(o) === false)) {
      plan.bailed = 'no overlap between events.jsonl and the SDK transcript — refusing to guess';
    }
    return plan;
  }
  if (watermark === entries.length - 1) return plan; // log is already whole

  // The lost tail belongs to the last in-flight turn — unless that turn completed,
  // in which case whatever follows is a fresh, unattributable one.
  let turnId = 'unattributed';
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'turn_complete') break;
    if (e.type === 'assistant_message' || e.type === 'tool_call') {
      turnId = e.turnId;
      break;
    }
  }

  const totalCompacts = entries.filter((o) => o?.type === 'system' && o?.subtype === 'compact_boundary').length;
  let unloggedCompacts = totalCompacts - loggedCompactions;

  // The CLI writes one assistant entry per content block, and every entry of the
  // final API response repeats stop_reason 'end_turn' — collapse the run into a
  // single turn_complete, flushed when the message id changes (or at EOF).
  const TERMINAL_STOP = new Set(['end_turn', 'stop_sequence']);
  let pendingTurnEnd: { msgId: string; ts: string; sdkUuid?: string } | null = null;
  const flushTurnEnd = () => {
    if (!pendingTurnEnd) return;
    plan.planned.push({
      body: { type: 'turn_complete', turnId },
      ts: pendingTurnEnd.ts,
      sdkUuid: pendingTurnEnd.sdkUuid,
    });
    plan.sawTurnEnd = true;
    pendingTurnEnd = null;
  };

  for (let i = watermark + 1; i < entries.length; i++) {
    const o = entries[i];
    const ts = typeof o?.timestamp === 'string' ? o.timestamp : new Date().toISOString();
    const msgId: string | undefined = o?.message?.id;
    if (pendingTurnEnd && msgId !== pendingTurnEnd.msgId) flushTurnEnd();
    if (represented(o) === true) continue; // e.g. the delivered prompt that outlived the crash

    if (o?.type === 'assistant' && !o.isSidechain && Array.isArray(o?.message?.content)) {
      const blocks: any[] = o.message.content;
      const syntheticOnly =
        blocks.length > 0 &&
        blocks.every((b) => b?.type === 'text' && SYNTHETIC_ASSISTANT_TEXTS.has(String(b.text ?? '').trim()));
      if (syntheticOnly) continue; // CLI resume filler, not a real reply — no turn end either
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          if (SYNTHETIC_ASSISTANT_TEXTS.has(b.text.trim())) continue;
          const { markdown, threadId } = parseSidebarMarker(b.text, threads);
          plan.planned.push({ body: { type: 'assistant_message', markdown, turnId, threadId }, ts, sdkUuid: o.uuid });
        } else if (b?.type === 'tool_use') {
          plan.planned.push({
            body: { type: 'tool_call', toolUseId: b.id, tool: b.name, input: b.input, turnId },
            ts,
            sdkUuid: o.uuid,
          });
        }
      }
      const usage = o.message.usage;
      if (usage) {
        const contextTokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.output_tokens ?? 0);
        if (contextTokens > 0) plan.planned.push({ body: { type: 'usage', contextTokens }, ts, sdkUuid: o.uuid });
      }
      if (TERMINAL_STOP.has(o.message.stop_reason)) pendingTurnEnd = { msgId: msgId ?? '', ts, sdkUuid: o.uuid };
    } else if (o?.type === 'user' && !o.isSidechain && !o.isMeta) {
      if (Array.isArray(o?.message?.content)) {
        for (const b of o.message.content) {
          if (b?.type === 'tool_result') {
            plan.planned.push({
              body: { type: 'tool_result', toolUseId: b.tool_use_id, ok: !b.is_error, preview: previewOf(b.content) },
              ts,
              sdkUuid: o.uuid,
            });
          }
        }
      }
      // User text is never backfilled: deliver() logs it before the CLI ever sees
      // it, so unmatched user text here is harness-injected, not a loss. Task
      // notifications are handled by the whole-transcript sweep above — the
      // single place dispatch_updates are planned.
    } else if (o?.type === 'system' && o?.subtype === 'compact_boundary' && unloggedCompacts > 0) {
      plan.planned.push({
        body: { type: 'compaction', preTokens: o.compactMetadata?.preTokens, trigger: o.compactMetadata?.trigger },
        ts,
        sdkUuid: o.uuid,
      });
      unloggedCompacts--;
    }
  }
  flushTurnEnd();
  return plan;
}

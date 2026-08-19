// Ephemeral read-only observer — the engine behind the composer's /btw toggle.
//
// An aside lets the user interrogate the workspace without steering it: the
// question is answered by a ONE-SHOT query() that never touches the primary
// agent session, never enters its context, and never lands in events.jsonl.
// Everything here is deliberately isolated from agentSession.ts:
//
//   - its own query() with a plain string prompt (no streaming-input session)
//   - a read-only tool surface: Read, Glob, Grep — no Bash, no Write/Edit, no Task
//   - `settingSources: []` + `strictMcpConfig` with no MCP servers, so no project
//     settings, plugins, skills or account-level connectors ride along
//   - a cheap model (Haiku by default) at low effort — asides are lookups
//
// The server gathers the expensive-to-discover context itself (git, .clyde/)
// so the observer spends its turns answering rather than orienting.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { slog } from './log.js';

const run = promisify(execFile);

/** Cheap by design; CLYDE_ASIDE_MODEL overrides (smoke tests, experiments). */
export const ASIDE_MODEL = process.env.CLYDE_ASIDE_MODEL ?? 'claude-haiku-4-5';
/** An aside the user is waiting on must fail fast rather than hang the card. */
const ASIDE_TIMEOUT_MS = Number(process.env.CLYDE_ASIDE_TIMEOUT_MS ?? 120_000);

const OBSERVER_TOOLS = ['Read', 'Glob', 'Grep'];

const OBSERVER_SYSTEM = `You are a read-only OBSERVER attached to a project built with Clyde
(a conversation-centric IDE for agent-driven builds). You answer exactly one question about the
current state of this project and then stop.

You are NOT the project's agent. You do not plan, build, fix, refactor, or advise on next steps
unless the question asks for it. You take no actions: you have Read, Glob and Grep and nothing
else — no writing, no shell, no delegation. Nothing you say reaches the project's agent or its
conversation; this exchange is ephemeral and disappears when the user dismisses it.

How to answer:
- Ground every claim in something you actually read. Cite concrete references — file paths,
  commit shas, task ids, decision lines — so the user can verify without asking again.
- The context block below is already gathered for you. Read further only when the question needs
  detail it does not contain.
- Be brief and direct: a couple of sentences or a short list. Markdown is rendered. No preamble,
  no "let me look", no offers to do follow-up work.
- If the workspace does not answer the question, say exactly that and say what you checked.`;

export interface AsideOutcome {
  /** The observer's answer as markdown. Absent when the query failed. */
  text?: string;
  error?: string;
  costUsd?: number;
  durationMs: number;
  model: string;
}

/** Best-effort shell capture — an aside must never fail because git is unhappy. */
async function capture(cmd: string, args: string[], cwd: string, limit = 4000): Promise<string> {
  try {
    const { stdout } = await run(cmd, args, { cwd, timeout: 5000, maxBuffer: 2_000_000 });
    return stdout.trim().slice(0, limit);
  } catch (err) {
    return `(unavailable: ${String(err).slice(0, 120)})`;
  }
}

function readFileTail(file: string, maxChars: number): string {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.length > maxChars ? `…(truncated)…\n${text.slice(-maxChars)}` : text.trim();
  } catch {
    return '(not present)';
  }
}

function readFileHead(file: string, maxChars: number): string {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(truncated)…` : text.trim();
  } catch {
    return '(not present)';
  }
}

/** Context the SERVER gathers cheaply, so the observer does not burn turns on it. */
async function gatherContext(projectRoot: string, sessionId?: string): Promise<string> {
  const clyde = path.join(projectRoot, '.clyde');
  const [log, status] = await Promise.all([
    capture('git', ['log', '--oneline', '-15'], projectRoot),
    capture('git', ['status', '--short'], projectRoot, 2000),
  ]);
  const eventsPath = sessionId
    ? path.posix.join('.clyde', 'sessions', sessionId, 'events.jsonl')
    : '.clyde/sessions/<id>/events.jsonl';
  return [
    '## Workspace context (gathered for you)',
    '',
    `Project root: ${projectRoot}`,
    '',
    '### git log --oneline -15',
    '```',
    log || '(no commits)',
    '```',
    '',
    '### git status --short',
    '```',
    status || '(clean working tree)',
    '```',
    '',
    '### .clyde/tasks.json',
    '```json',
    readFileHead(path.join(clyde, 'tasks.json'), 6000),
    '```',
    '',
    '### .clyde/DECISIONS.md (tail)',
    '```md',
    readFileTail(path.join(clyde, 'DECISIONS.md'), 4000),
    '```',
    '',
    '### Where else to look',
    '- `SCOPE.md` — the goal document; the north star for what this project is and is not.',
    '- `CLAUDE.md` — the agent operating instructions for this repo.',
    `- \`${eventsPath}\` — the conversation event log: one JSON event per line (user_message,`,
    '  assistant_message, tool_call, dispatch, commit, tasks_updated, usage, …). Grep it for the',
    '  history of what was said and done; it is the record of the conversation itself.',
    '- `.clyde/reviews/*.md` — review batches; `.clyde/panels.json` — pushed UI panels.',
    '- Any project file is fair game via Read / Glob / Grep.',
  ].join('\n');
}

/**
 * Run one aside. Resolves with an outcome either way — a failed observer query
 * is a card that says so, never a thrown error into the WS handler.
 */
export async function runAside(
  projectRoot: string,
  question: string,
  opts: { sessionId?: string; model?: string } = {},
): Promise<AsideOutcome> {
  const model = opts.model ?? ASIDE_MODEL;
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ASIDE_TIMEOUT_MS);
  try {
    const context = await gatherContext(projectRoot, opts.sessionId);
    const prompt = `${context}\n\n## The user's question\n\n${question}\n\nAnswer it now, concisely, with concrete references.`;
    let text = '';
    let costUsd: number | undefined;
    let error: string | undefined;

    const q = query({
      prompt,
      options: {
        model,
        effort: 'low',
        cwd: projectRoot,
        abortController: abort,
        maxTurns: 10,
        systemPrompt: OBSERVER_SYSTEM,
        // Read-only by construction: `tools` is the base set the observer gets at
        // all, `allowedTools` pre-approves exactly those (so 'dontAsk' never has to
        // deny), and `disallowedTools` is belt-and-braces against harness-internal
        // paths. No Bash, no Write/Edit, no Task — an aside cannot change anything.
        tools: OBSERVER_TOOLS,
        allowedTools: OBSERVER_TOOLS,
        disallowedTools: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'Task', 'WebFetch', 'WebSearch'],
        permissionMode: 'dontAsk',
        // Isolation: no project/user settings, no CLAUDE.md, no plugins or skills,
        // and no MCP servers — only the servers named here, and none are.
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: {},
      } as any,
    });

    for await (const msg of q as AsyncIterable<any>) {
      if (msg.type === 'assistant') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text' && block.text.trim()) text = block.text.trim();
        }
      } else if (msg.type === 'result') {
        if (typeof msg.total_cost_usd === 'number') costUsd = msg.total_cost_usd;
        if (msg.subtype === 'success' && typeof msg.result === 'string' && msg.result.trim()) {
          text = msg.result.trim();
        } else if (msg.subtype !== 'success') {
          error = `observer ended: ${msg.subtype}`;
        }
      }
    }

    const durationMs = Date.now() - started;
    if (!text && !error) error = 'observer returned nothing';
    slog('aside', error ? 'warn' : 'info', 'aside complete', {
      model,
      durationMs,
      costUsd,
      chars: text.length,
      ...(error ? { error } : {}),
    });
    return text ? { text, costUsd, durationMs, model } : { error, costUsd, durationMs, model };
  } catch (err) {
    const durationMs = Date.now() - started;
    const error = abort.signal.aborted
      ? `observer timed out after ${Math.round(ASIDE_TIMEOUT_MS / 1000)}s`
      : String(err);
    slog('aside', 'error', 'aside failed', { model, durationMs, error });
    return { error, durationMs, model };
  } finally {
    clearTimeout(timer);
  }
}

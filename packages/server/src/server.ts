import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, GitStatus, ServerMessage, SessionEvent, Snapshot } from '@clyde/shared';
import { AgentSession, type Broadcast } from './agentSession.js';
import { ClydeStore } from './store.js';
import { listCommits, repoStatus, showCommit } from './git.js';
import { initLogger, slog, tailLog } from './log.js';
import { ASIDE_MODEL, runAside } from './observer.js';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.md': 'text/markdown',
};

export async function startServer(projectRoot: string, port: number, freshSession = false) {
  const resumeId = freshSession ? null : ClydeStore.latestSessionId(projectRoot);
  let store = new ClydeStore(projectRoot, resumeId ?? undefined);
  initLogger(store.clydeDir);
  slog('server', 'info', 'starting', { projectRoot, port, resumed: resumeId ?? false });
  const clients = new Set<WebSocket>();

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcastAll = (msg: ServerMessage) => {
    for (const ws of clients) send(ws, msg);
  };

  const bus: Broadcast = {
    event: (event: SessionEvent) => broadcastAll({ type: 'event', event }),
    delta: (turnId, text) => broadcastAll({ type: 'delta', turnId, text }),
    queue: (items) => broadcastAll({ type: 'queue', items }),
    threads: (threads) => broadcastAll({ type: 'threads', threads }),
  };

  // Session config (model/effort picker) survives restarts alongside the event log.
  const bootConfig = store.loadConfig();
  let session = new AgentSession(store, bus, bootConfig?.model, bootConfig?.effort, bootConfig?.subagentModel);
  const sdkSessionId = resumeId ? store.findSdkSessionId() : null;
  session.start(sdkSessionId ?? undefined);

  // Branch + working-tree state for the shell chrome; broadcast on change.
  let gitStatus: GitStatus | null = null;
  const pollGitStatus = async () => {
    const s = await repoStatus(projectRoot);
    if (s && (s.branch !== gitStatus?.branch || s.dirtyFiles !== gitStatus?.dirtyFiles)) {
      gitStatus = s;
      broadcastAll({ type: 'git_status', status: s });
    }
  };
  void pollGitStatus();
  setInterval(() => void pollGitStatus(), 5000);

  const buildSnapshot = async (): Promise<Snapshot> => {
    const events = store.loadEvents();
    return {
      projectName: path.basename(projectRoot),
      goalMarkdown: store.readGoal(),
      events,
      threads: session.threads,
      queue: session.userQueue,
      panels: session.panels,
      // Status comes from the live resolvers, so a reload shows a pending card as
      // pending — and a card the restart killed as expired, not falsely actionable.
      exhibits: session.exhibitsFrom(events),
      tasks: session.tasks,
      commits: await listCommits(projectRoot),
      status: session.status,
      gitStatus,
      model: session.model,
      effort: session.effort,
      subagentModel: session.subagentModel,
    };
  };

  const webDist = findWebDist();

  // Edits to pushed markdown artifacts, debounced into ONE agent note per burst
  // (same shape as the Tasks panel's [Tasks edited] note) so a save-happy user never
  // spams the conversation.
  const fileEdits: string[] = [];
  let fileEditTimer: NodeJS.Timeout | undefined;
  const noteFileEdit = (rel: string, summary: string) => {
    fileEdits.push(`${rel} ${summary}`);
    clearTimeout(fileEditTimer);
    fileEditTimer = setTimeout(() => {
      const edits = fileEdits.splice(0);
      const one = edits.length === 1;
      session.enqueue(
        `[${one ? rel : `${edits.length} files`} edited] The user edited ${edits.join('; ')} in place ` +
          `from the Artifacts panel. Re-read ${one ? 'it' : 'them'} before acting — the edit is user intent.`,
      );
    }, 5000);
  };

  const projectReal = fs.realpathSync(path.resolve(projectRoot));
  const clydePrefix = path.join(projectReal, '.clyde') + path.sep;
  /** Resolve a project-relative path for WRITING: the real path of an existing file
   *  inside the project root, or null. Traversal, absolute paths and symlinks pointing
   *  out are all caught by resolving links first and testing containment after. */
  const resolveWritableFile = (rel: string): string | null => {
    const abs = path.resolve(projectReal, rel);
    if (!abs.startsWith(projectReal + path.sep)) return null;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    const real = fs.realpathSync(abs);
    return real.startsWith(projectReal + path.sep) ? real : null;
  };

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // Write back a project file the user edited in place (markdown artifacts today).
    // Confined to the project root, existing files only — this is an edit affordance,
    // not a file-creation API — and .clyde/ is off limits: that state is the agent's
    // own ledger, edited through its own affordances (tasks panel, goal panel).
    if (url.pathname === '/api/project-file' && req.method === 'POST') {
      const rel = url.searchParams.get('path') ?? '';
      const abs = resolveWritableFile(rel);
      if (!abs || abs.startsWith(clydePrefix)) {
        slog('server', 'warn', 'project-file write refused', { path: rel });
        res.writeHead(400).end('bad path');
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 2_000_000) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const before = fs.readFileSync(abs, 'utf8');
        fs.writeFileSync(abs, text);
        const summary = lineDiffSummary(before, text);
        slog('server', 'info', 'project file saved from a panel', { path: rel, bytes: text.length, summary });
        noteFileEdit(rel, summary);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, summary }));
      });
      return;
    }

    // Project-file access for panels (images, markdown, metrics JSON, html, tables).
    if (url.pathname === '/api/project-file') {
      const rel = url.searchParams.get('path') ?? '';
      const abs = path.resolve(projectRoot, rel);
      if (!abs.startsWith(path.resolve(projectRoot)) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] ?? 'application/octet-stream' });
      fs.createReadStream(abs).pipe(res);
      return;
    }

    // Attachment uploads: raw body → .clyde/uploads/, returns the project-relative path.
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      const name = (url.searchParams.get('name') ?? 'file').replace(/[^\w.-]+/g, '_').slice(-80);
      const dir = path.join(projectRoot, '.clyde', 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const rel = path.posix.join('.clyde', 'uploads', `${stamp}-${name}`);
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 30_000_000) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        fs.writeFileSync(path.join(projectRoot, rel), Buffer.concat(chunks));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ path: rel }));
      });
      return;
    }

    // Goal edits from the workbench: write SCOPE.md, broadcast the fresh text to
    // every client, and hand the agent a visible user note so it re-orients.
    // Last-write-wins by design (v1) — no conflict detection.
    if (url.pathname === '/api/goal' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 2_000_000) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        const markdown = Buffer.concat(chunks).toString('utf8');
        const before = store.readGoal() ?? '';
        fs.writeFileSync(path.join(projectRoot, 'SCOPE.md'), markdown);
        broadcastAll({ type: 'goal', markdown });
        const summary = lineDiffSummary(before, markdown);
        slog('server', 'info', 'goal saved from workbench', { bytes: markdown.length, summary });
        session.enqueue(
          `[Goal updated] The user edited SCOPE.md in the workbench. Re-read it before your next unit of work. ` +
            `Change size: ${summary}.`,
        );
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (url.pathname === '/api/logs') {
      const n = Math.min(Number(url.searchParams.get('tail') ?? 200) || 200, 2000);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(tailLog(n));
      return;
    }

    if (url.pathname === '/api/commit') {
      const sha = url.searchParams.get('sha') ?? '';
      if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
        res.writeHead(400).end('bad sha');
        return;
      }
      void showCommit(projectRoot, sha).then((out) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(out);
      });
      return;
    }

    if (url.pathname === '/api/gallery') {
      const glob = url.searchParams.get('glob') ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(expandGlob(projectRoot, glob)));
      return;
    }

    // Static UI (production build).
    if (webDist) {
      const file = url.pathname === '/' ? '/index.html' : url.pathname;
      const abs = path.join(webDist, file);
      if (abs.startsWith(webDist) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(abs)] ?? 'application/octet-stream' });
        fs.createReadStream(abs).pipe(res);
        return;
      }
    }
    res.writeHead(404).end('Clyde server: UI build not found — run `npm run dev` for the Vite dev server.');
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', async (ws) => {
    clients.add(ws);
    send(ws, { type: 'hello', snapshot: await buildSnapshot() });

    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      slog('ws', 'info', `client message: ${msg.type}`);
      switch (msg.type) {
        case 'send_message':
          session.enqueue(msg.text, {
            urgent: msg.urgent,
            attachments: msg.attachments,
            reviewIntake: msg.reviewIntake,
          });
          break;
        case 'create_thread':
          session.enqueue(msg.text, { urgent: msg.urgent, newThreadAnchor: msg.anchor });
          break;
        case 'thread_reply':
          session.enqueue(msg.text, { urgent: msg.urgent, threadId: msg.threadId });
          break;
        case 'resolve_thread':
          session.resolveThread(msg.threadId);
          break;
        case 'answer_question':
          session.answerQuestion(msg.questionId, msg.answers, msg.response);
          break;
        case 'exhibit_response':
          session.respondToExhibit(msg.exhibitId, msg.verdict, msg.comment);
          break;
        case 'withdraw_queued':
          session.withdraw(msg.queuedId);
          break;
        case 'interrupt':
          session.interrupt();
          break;
        case 'edit_task':
          session.editTask(msg);
          break;
        case 'aside': {
          // Asides bypass the session entirely: nothing is enqueued, nothing is
          // appended to the event log — just two transient broadcasts around an
          // independent read-only observer query. Concurrent asides are fine;
          // asideId keys each one.
          const question = msg.text.trim();
          if (!question) break;
          const asideId = msg.asideId;
          slog('aside', 'info', 'aside asked', { asideId, model: ASIDE_MODEL, chars: question.length });
          broadcastAll({
            type: 'aside_started',
            asideId,
            question,
            model: ASIDE_MODEL,
            ts: new Date().toISOString(),
          });
          void runAside(projectRoot, question, { sessionId: store.sessionId }).then((r) =>
            broadcastAll({ type: 'aside_result', asideId, ...r, ts: new Date().toISOString() }),
          );
          break;
        }
        case 'compact':
          session.requestCompact();
          break;
        case 'new_session': {
          // Retire the current session in place; the store on disk stays intact
          // and the fresh session starts with a clean event log + SDK conversation.
          // Model/effort carry forward — the chip the user sees must not silently revert.
          slog('server', 'info', 'new session requested', { previous: store.sessionId });
          const carry = { model: session.model, effort: session.effort, subagentModel: session.subagentModel };
          session.dispose();
          store = new ClydeStore(projectRoot);
          store.saveConfig(carry);
          session = new AgentSession(store, bus, carry.model, carry.effort, carry.subagentModel);
          session.start();
          void buildSnapshot().then((snapshot) => {
            for (const c of clients) send(c, { type: 'hello', snapshot });
          });
          break;
        }
        case 'set_model': {
          // Rotate the session in place under new settings: same store, same SDK
          // conversation (resume), fresh query loop. Idle-only — rotation aborts
          // whatever the query stream is doing ('disconnected' allowed: rotation
          // doubles as recovery when the stream died).
          const MODELS = ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
          const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
          const subagent = msg.subagentModel ?? session.subagentModel;
          if ((!MODELS.includes(msg.model) && msg.model !== session.model) || !EFFORTS.includes(msg.effort)) {
            slog('server', 'warn', 'set_model refused: unknown model/effort', { model: msg.model, effort: msg.effort });
            break;
          }
          if (!MODELS.includes(subagent) && subagent !== session.subagentModel) {
            slog('server', 'warn', 'set_model refused: unknown subagent model', { subagentModel: subagent });
            break;
          }
          if (session.status !== 'idle' && session.status !== 'disconnected') {
            slog('server', 'warn', 'set_model refused: session not idle', { status: session.status });
            break;
          }
          if (msg.model === session.model && msg.effort === session.effort && subagent === session.subagentModel) break;
          slog('server', 'info', 'model/effort switch — rotating session', {
            from: `${session.model}/${session.effort} (agents ${session.subagentModel})`,
            to: `${msg.model}/${msg.effort} (agents ${subagent})`,
          });
          store.saveConfig({ model: msg.model, effort: msg.effort, subagentModel: subagent });
          const sdk = store.findSdkSessionId();
          session.dispose();
          session = new AgentSession(store, bus, msg.model, msg.effort, subagent);
          session.start(sdk ?? undefined);
          void buildSnapshot().then((snapshot) => {
            for (const c of clients) send(c, { type: 'hello', snapshot });
          });
          break;
        }
      }
    });
    ws.on('close', () => clients.delete(ws));
  });

  httpServer.listen(port, () => {
    console.log(`\n  Clyde — ${path.basename(projectRoot)}`);
    console.log(`  UI:      http://localhost:${port}${webDist ? '' : '  (no build; use Vite dev server)'}`);
    console.log(`  Project: ${projectRoot}`);
    console.log(
      resumeId
        ? `  Session: resumed ${resumeId}${sdkSessionId ? ` (sdk ${sdkSessionId.slice(0, 8)})` : ' (no sdk session to resume)'}\n`
        : `  Session: new ${store.sessionId}\n`,
    );
  });
}

function findWebDist(): string | null {
  const here = path.dirname(new URL(import.meta.url).pathname);
  for (const candidate of [
    path.resolve(here, '../../web/dist'),
    path.resolve(here, '../../../web/dist'),
  ]) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

/** Tiny order-insensitive line diff — "+N/-M lines" for the goal-updated note.
 *  A multiset comparison, not an LCS: lines present in the new text but not the
 *  old count as added, and vice versa. Compact and honest enough for a summary. */
function lineDiffSummary(before: string, after: string): string {
  const counts = new Map<string, number>();
  for (const line of before.split('\n')) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after.split('\n')) {
    const n = counts.get(line) ?? 0;
    if (n > 0) counts.set(line, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;
  return `+${added}/-${removed} lines`;
}

/** Minimal glob: supports "dir/**" + "*.ext" patterns well enough for QA galleries. */
function expandGlob(root: string, glob: string): string[] {
  const safe = glob.replace(/\.\./g, '');
  const starIdx = safe.indexOf('*');
  const baseDir = starIdx === -1 ? path.dirname(safe) : path.dirname(safe.slice(0, starIdx) + 'x');
  const absBase = path.resolve(root, baseDir);
  if (!absBase.startsWith(path.resolve(root)) || !fs.existsSync(absBase)) return [];
  const regex = new RegExp(
    '^' + safe.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*').replace(/\[\^\/\]\*\[\^\/\]\*/g, '.*') + '$',
  );
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) walk(abs);
      else if (regex.test(rel)) results.push(rel);
    }
  };
  walk(absBase);
  // Ascending by name — numbered QA captures read in order (matches the fixture server).
  return results.sort().slice(0, 50);
}

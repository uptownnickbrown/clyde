import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, GitStatus, ServerMessage, SessionEvent, Snapshot } from '@clyde/shared';
import { AgentSession, type Broadcast } from './agentSession.js';
import { ClydeStore } from './store.js';
import { listCommits, repoStatus, showCommit } from './git.js';
import { initLogger, slog, tailLog } from './log.js';

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

  let session = new AgentSession(store, bus);
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

  const buildSnapshot = async (): Promise<Snapshot> => ({
    projectName: path.basename(projectRoot),
    goalMarkdown: store.readGoal(),
    events: store.loadEvents(),
    threads: session.threads,
    queue: session.userQueue,
    panels: session.panels,
    tasks: session.tasks,
    commits: await listCommits(projectRoot),
    status: session.status,
    gitStatus,
    model: session.model,
  });

  const webDist = findWebDist();

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // Project-file access for panels (images, markdown, metrics JSON).
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
          session.enqueue(msg.text, { urgent: msg.urgent, attachments: msg.attachments });
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
        case 'withdraw_queued':
          session.withdraw(msg.queuedId);
          break;
        case 'interrupt':
          session.interrupt();
          break;
        case 'compact':
          session.requestCompact();
          break;
        case 'new_session': {
          // Retire the current session in place; the store on disk stays intact
          // and the fresh session starts with a clean event log + SDK conversation.
          slog('server', 'info', 'new session requested', { previous: store.sessionId });
          session.dispose();
          store = new ClydeStore(projectRoot);
          session = new AgentSession(store, bus);
          session.start();
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

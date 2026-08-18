import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, SessionEvent, Snapshot } from '@clyde/shared';
import { AgentSession, type Broadcast } from './agentSession.js';
import { ClydeStore } from './store.js';
import { listCommits } from './git.js';

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

export async function startServer(projectRoot: string, port: number) {
  const store = new ClydeStore(projectRoot);
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

  const session = new AgentSession(store, bus);
  session.start();

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
    const snapshot: Snapshot = {
      projectName: path.basename(projectRoot),
      goalMarkdown: store.readGoal(),
      events: store.loadEvents(),
      threads: session.threads,
      queue: session.userQueue,
      panels: session.panels,
      tasks: session.tasks,
      commits: await listCommits(projectRoot),
      status: session.status,
    };
    send(ws, { type: 'hello', snapshot });

    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      switch (msg.type) {
        case 'send_message':
          session.enqueue(msg.text, { urgent: msg.urgent });
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
        case 'withdraw_queued':
          session.withdraw(msg.queuedId);
          break;
        case 'interrupt':
          session.interrupt();
          break;
      }
    });
    ws.on('close', () => clients.delete(ws));
  });

  httpServer.listen(port, () => {
    console.log(`\n  Clyde — ${path.basename(projectRoot)}`);
    console.log(`  UI:      http://localhost:${port}${webDist ? '' : '  (no build; use Vite dev server)'}`);
    console.log(`  Project: ${projectRoot}\n`);
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
  return results.sort().reverse().slice(0, 50);
}

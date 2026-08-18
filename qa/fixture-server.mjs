// Serves the built web UI against a canned snapshot — a deterministic stand-in for
// the real Clyde server, so screenshot QA never depends on a live agent session.
// Usage: node qa/fixture-server.mjs [port]   (default 4123)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { buildSnapshot, DELTA_TEXT } from './fixture.mjs';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');
const WEB_DIST = path.join(PROJECT_ROOT, 'packages/web/dist');

export function startFixtureServer(port = 4123) {
  if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    throw new Error(`No web build at ${WEB_DIST} — run: npm run build --workspace=@clyde/web`);
  }
  const snapshot = buildSnapshot(PROJECT_ROOT);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === '/api/project-file') {
      const rel = url.searchParams.get('path') ?? '';
      const abs = path.resolve(PROJECT_ROOT, rel);
      if (!abs.startsWith(PROJECT_ROOT) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] ?? 'application/octet-stream' });
      fs.createReadStream(abs).pipe(res);
      return;
    }

    if (url.pathname === '/api/upload' && req.method === 'POST') {
      const name = (url.searchParams.get('name') ?? 'file').replace(/[^\w.-]+/g, '_');
      const dir = path.join(PROJECT_ROOT, '.clyde', 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rel = path.posix.join('.clyde', 'uploads', `qa-${name}`);
        fs.writeFileSync(path.join(PROJECT_ROOT, rel), Buffer.concat(chunks));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ path: rel }));
      });
      return;
    }

    // QA trigger: push a live AskUserQuestion to connected clients (screenshot.mjs
    // calls this so earlier captures aren't disturbed by the auto-flipping card).
    if (url.pathname === '/fixture/ask') {
      const question = {
        id: 'q-live', ts: new Date().toISOString(), type: 'question', questionId: 'qlive1', turnId: 't5',
        questions: [
          {
            question: 'Two option-card densities survived review — which reads better in the workbench?',
            header: 'Density',
            options: [
              {
                label: 'Cozy',
                description: 'Tight 8px rhythm — more options above the fold',
                preview: '<div style="padding:7px 10px;border:1px solid #3a4150;border-radius:8px;font-size:12px">Cozy option row</div>',
              },
              {
                label: 'Comfortable',
                description: '14px rhythm — easier scanning under load',
                preview: '<div style="padding:14px 12px;border:1px solid #3a4150;border-radius:8px;font-size:12px">Comfortable option row</div>',
              },
            ],
            multiSelect: false,
          },
          {
            question: 'Which answered questions should persist in the history stack?',
            header: 'History',
            options: [
              { label: 'All of them', description: 'Every card, newest first' },
              { label: 'Decision-producing only', description: 'Only the ones distilled into DECISIONS.md' },
              { label: 'None', description: 'The event log is record enough' },
            ],
            multiSelect: true,
          },
        ],
      };
      const status = { id: 'q-live-status', ts: new Date().toISOString(), type: 'status', status: 'awaiting_input' };
      for (const ws of sockets) {
        ws.send(JSON.stringify({ type: 'event', event: question }));
        ws.send(JSON.stringify({ type: 'event', event: status }));
      }
      res.writeHead(200).end('ok');
      return;
    }

    if (url.pathname === '/api/logs') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(FIXTURE_LOGS);
      return;
    }

    if (url.pathname === '/api/commit') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(FIXTURE_COMMIT);
      return;
    }

    if (url.pathname === '/api/gallery') {
      const glob = url.searchParams.get('glob') ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(expandGlob(PROJECT_ROOT, glob)));
      return;
    }

    const file = url.pathname === '/' ? '/index.html' : url.pathname;
    const abs = path.join(WEB_DIST, file);
    if (abs.startsWith(WEB_DIST) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] ?? 'application/octet-stream' });
      fs.createReadStream(abs).pipe(res);
      return;
    }
    res.writeHead(404).end('not found');
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  const sockets = new Set();
  wss.on('connection', (ws) => {
    sockets.add(ws);
    // Echo answer_question like the real server: answered event + back to working.
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type !== 'answer_question') return;
      const answered = {
        id: 'q-live-a', ts: new Date().toISOString(), type: 'question_answered',
        questionId: msg.questionId, answers: msg.answers, ...(msg.response ? { response: msg.response } : {}),
      };
      const status = { id: 'q-live-w', ts: new Date().toISOString(), type: 'status', status: 'working' };
      for (const s of sockets) {
        s.send(JSON.stringify({ type: 'event', event: answered }));
        s.send(JSON.stringify({ type: 'event', event: status }));
      }
    });
    ws.send(JSON.stringify({ type: 'hello', snapshot }));
    // Fresh working-status event so the work-bar timer starts near zero at capture time.
    ws.send(
      JSON.stringify({
        type: 'event',
        event: { id: 'e-live-status', ts: new Date().toISOString(), type: 'status', status: 'working' },
      }),
    );
    // Stream a live turn so screenshots capture the in-flight state.
    let i = 0;
    const words = DELTA_TEXT.split(' ');
    const timer = setInterval(() => {
      if (i >= words.length) return clearInterval(timer);
      ws.send(JSON.stringify({ type: 'delta', turnId: 't5', text: (i ? ' ' : '') + words[i++] }));
    }, 30);
    ws.on('close', () => {
      sockets.delete(ws);
      clearInterval(timer);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        port,
        close: () =>
          new Promise((r) => {
            wss.close();
            server.close(() => r());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

const FIXTURE_LOGS = [
  '{"ts":"2026-08-18T14:03:12.100Z","level":"info","component":"session","message":"session started (resume)"}',
  '{"ts":"2026-08-18T14:03:12.140Z","level":"debug","component":"sdk","message":"message: system/init"}',
  '{"ts":"2026-08-18T14:04:02.310Z","level":"info","component":"git","message":"new commit c5fcbbe linked to message a2"}',
  '{"ts":"2026-08-18T14:05:41.002Z","level":"warn","component":"ws","message":"client reconnected after 1.5s"}',
  '{"ts":"2026-08-18T14:06:12.550Z","level":"debug","component":"sdk","message":"message: stream_event"}',
  '{"ts":"2026-08-18T14:07:09.912Z","level":"error","component":"store","message":"events.jsonl append retried (EBUSY)"}',
  '{"ts":"2026-08-18T14:08:00.001Z","level":"info","component":"panels","message":"panel qa-screenshots updated"}',
].join('\n');

const FIXTURE_COMMIT = `commit c5fcbbe41d2a
Author: Nicholas Brown <nicholas.tyler.brown@gmail.com>
Date:   Tue Aug 18 14:06:00 2026 -0700

    Walking skeleton: Agent SDK session streaming end-to-end to React UI

    One long-lived query() in streaming-input mode; server translates the
    SDK stream into Clyde wire events and appends to events.jsonl.

 packages/server/src/agentSession.ts | 402 ++++++++++++++++++++
 packages/shared/src/index.ts        | 126 +++++++
 packages/web/src/App.tsx            |  73 ++++
 3 files changed, 601 insertions(+)

diff --git a/packages/shared/src/index.ts b/packages/shared/src/index.ts
new file mode 100644
--- /dev/null
+++ b/packages/shared/src/index.ts
@@ -0,0 +1,126 @@
+// Clyde wire protocol + domain types
+export type AgentStatus = 'idle' | 'working' | 'disconnected';
`;

/** Same minimal glob the real server supports: "dir/*.ext"-style, sorted by name. */
function expandGlob(root, glob) {
  const safe = glob.replace(/\.\./g, '');
  const starIdx = safe.indexOf('*');
  const baseDir = starIdx === -1 ? path.dirname(safe) : path.dirname(safe.slice(0, starIdx) + 'x');
  const absBase = path.resolve(root, baseDir);
  if (!absBase.startsWith(root) || !fs.existsSync(absBase)) return [];
  const regex = new RegExp(
    '^' + safe.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*').replace(/\[\^\/\]\*\[\^\/\]\*/g, '.*') + '$',
  );
  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) walk(abs);
      else if (regex.test(rel)) results.push(rel);
    }
  };
  walk(absBase);
  return results.sort().slice(0, 50);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 4123);
  startFixtureServer(port).then(() => console.log(`fixture server → http://localhost:${port}`));
}

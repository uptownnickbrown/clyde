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
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', snapshot }));
    // Stream a live turn so screenshots capture the in-flight state.
    let i = 0;
    const words = DELTA_TEXT.split(' ');
    const timer = setInterval(() => {
      if (i >= words.length) return clearInterval(timer);
      ws.send(JSON.stringify({ type: 'delta', turnId: 't5', text: (i ? ' ' : '') + words[i++] }));
    }, 30);
    ws.on('close', () => clearInterval(timer));
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

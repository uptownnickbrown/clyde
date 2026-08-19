// Offline check for the origin policy (task #36): the pure decision function behind
// the WS-upgrade gate and the state-changing-HTTP gate in packages/server/src/server.ts.
// Deterministic; no live session, no ports, no writes.
//
// Usage:  npm run qa:origin        (typecheck/build first — it imports from dist)
//
// The cases that matter are the ones a browser can actually produce. The header a
// browser sends is not attacker-controlled, so the whole policy rests on: `null` (the
// CSP-sandboxed opaque origin serving agent-authored HTML) is PRESENT and therefore
// must fail the allowlist, while an ABSENT header (curl, node, the qa harnesses) is
// the local-tool case and passes.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '../packages/server/dist/origin.js');

let isOriginAllowed, isStateChanging, allowedOrigins, VITE_DEV_PORT;
try {
  ({ isOriginAllowed, isStateChanging, allowedOrigins, VITE_DEV_PORT } = await import(DIST));
} catch (err) {
  console.error(`Cannot import ${DIST} — build first: npm run typecheck (or npm run build)`);
  console.error(String(err));
  process.exit(2);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

const PORT = 4100; // the default bound port; 4141 (live QA) is exercised below too

// ---------- 1. absent Origin: local tools keep working ----------
console.log('\n1. absent Origin → allowed (local-tool trust model)');
check('undefined (curl, node, ws client)', isOriginAllowed(undefined, PORT) === true);
check('empty string (hand-rolled client)', isOriginAllowed('', PORT) === true);
check('whitespace-only', isOriginAllowed('   ', PORT) === true);

// ---------- 2. the attack path ----------
console.log('\n2. opaque / hostile origins → rejected');
check('"null" — CSP-sandboxed agent HTML', isOriginAllowed('null', PORT) === false);
check('"NULL" — case cannot smuggle it through', isOriginAllowed('NULL', PORT) === false);
check('http://attacker.example', isOriginAllowed('http://attacker.example', PORT) === false);
check('https://evil.example', isOriginAllowed('https://evil.example', PORT) === false);
check('file:// document', isOriginAllowed('file://', PORT) === false);

// ---------- 3. Clyde's own page ----------
console.log("\n3. Clyde's own origins → allowed");
check('http://localhost:4100', isOriginAllowed(`http://localhost:${PORT}`, PORT) === true);
check('http://127.0.0.1:4100', isOriginAllowed(`http://127.0.0.1:${PORT}`, PORT) === true);
check('http://[::1]:4100 (IPv6 loopback)', isOriginAllowed(`http://[::1]:${PORT}`, PORT) === true);
check('uppercased host', isOriginAllowed(`HTTP://LOCALHOST:${PORT}`, PORT) === true);
check('trailing slash tolerated', isOriginAllowed(`http://localhost:${PORT}/`, PORT) === true);

// ---------- 4. the Vite dev proxy ----------
// vite.config.ts proxies /api and /ws to the server and forwards Origin unchanged,
// so the dev page's own origin is what arrives. Without this, `npm run dev` breaks.
console.log('\n4. Vite dev server origins → allowed');
check('http://localhost:5173', isOriginAllowed(`http://localhost:${VITE_DEV_PORT}`, PORT) === true);
check('http://127.0.0.1:5173', isOriginAllowed(`http://127.0.0.1:${VITE_DEV_PORT}`, PORT) === true);

// ---------- 5. the allowlist tracks the ACTUAL bound port ----------
console.log('\n5. allowlist follows the port the server bound');
check('4141 (live QA) allowed when bound to 4141', isOriginAllowed('http://localhost:4141', 4141) === true);
check('4100 rejected when bound to 4141', isOriginAllowed('http://localhost:4100', 4141) === false);
check('4141 rejected when bound to 4100', isOriginAllowed('http://localhost:4141', PORT) === false);
check('CLYDE_PORT=9999 honored', isOriginAllowed('http://localhost:9999', 9999) === true);
check(
  'no duplicate entries when bound to 5173',
  new Set(allowedOrigins(VITE_DEV_PORT)).size === allowedOrigins(VITE_DEV_PORT).length,
  allowedOrigins(VITE_DEV_PORT),
);

// ---------- 6. near-misses that must NOT pass ----------
// A same-prefix hostname is the classic allowlist bypass; so is a bare port swap.
console.log('\n6. near-miss origins → rejected');
check('http://localhost.evil.example:4100', isOriginAllowed(`http://localhost.evil.example:${PORT}`, PORT) === false);
check('http://evil.example#http://localhost:4100', isOriginAllowed(`http://evil.example#http://localhost:${PORT}`, PORT) === false);
check('https://localhost:4100 (wrong scheme)', isOriginAllowed(`https://localhost:${PORT}`, PORT) === false);
check('http://localhost (no port)', isOriginAllowed('http://localhost', PORT) === false);
check('http://127.0.0.2:4100 (not loopback we serve)', isOriginAllowed(`http://127.0.0.2:${PORT}`, PORT) === false);

// ---------- 7. which methods the gate covers ----------
// GET/HEAD stay open on purpose: the sandboxed exhibit iframe legitimately loads
// /api/project-file, and a read cannot be a confused-deputy write.
console.log('\n7. gated methods');
for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete']) {
  check(`${m} is gated`, isStateChanging(m) === true);
}
for (const m of ['GET', 'HEAD', 'OPTIONS', undefined]) {
  check(`${m} is not gated`, isStateChanging(m) === false);
}

console.log(
  failures === 0
    ? '\nORIGIN POLICY: all checks passed'
    : `\nORIGIN POLICY: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);

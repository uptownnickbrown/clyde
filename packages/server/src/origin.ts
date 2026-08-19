// Origin policy (#36) — the one place that decides whether a browser context is
// allowed to change Clyde's state.
//
// Why this exists: /api/project-file serves agent-authored HTML under
// `content-security-policy: sandbox allow-scripts` (#34). That gives the document an
// OPAQUE origin, which stops it reading Clyde's DOM/localStorage — but an opaque
// origin can still *send*. Without a check it could open ws://localhost:<port>/ws
// (whose hello hands over the whole event log, and which accepts send_message,
// interrupt, edit_task, exhibit_response) and fire non-preflighted "simple" POSTs at
// /api/goal (rewrites SCOPE.md + injects a note into the agent's turn — prompt
// injection), /api/project-file (rewrites any non-.clyde file, including
// packages/server/src/* which tsx watch then executes) and /api/upload. CSP sandbox
// blocks reading the response, not making the request.
//
// The rule, and the trust model behind it:
//   - Origin header ABSENT  → allow. curl, node scripts, the qa harnesses and the
//     `ws` client all send no Origin. Clyde is a local tool; local processes already
//     have the filesystem. Nothing is gained by locking them out.
//   - Origin header PRESENT → must be on the allowlist. This is the browser case, and
//     browsers cannot be talked out of sending it. A sandboxed/opaque document sends
//     the literal `null`, which is present-and-not-allowlisted → rejected. That is the
//     attack path this module closes.
//
// Kept in its own dependency-free module so the offline check (qa/origin-check.mjs)
// can import the real decision function from dist without dragging in the Agent SDK.

/** Vite dev server (packages/web/vite.config.ts) — proxies /api and /ws to us and
 *  forwards the browser's Origin unchanged, so the page's own origin is what arrives. */
export const VITE_DEV_PORT = 5173;

/** Loopback hosts a user can legitimately have in the address bar. `[::1]` is here
 *  because a browser pointed at http://[::1]:4100 sends exactly that as its Origin. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Every origin allowed to change state on a server bound to `port`. */
export function allowedOrigins(port: number): string[] {
  const ports = port === VITE_DEV_PORT ? [port] : [port, VITE_DEV_PORT];
  return ports.flatMap((p) => LOOPBACK_HOSTS.map((h) => `http://${h}:${p}`));
}

/**
 * The policy. Pure: no I/O, no globals — same inputs, same answer, which is what
 * makes it checkable offline.
 *
 * @param origin the raw `Origin` request header (`undefined` when absent)
 * @param port   the port this server actually bound
 */
export function isOriginAllowed(origin: string | undefined, port: number): boolean {
  // Absent (or present-but-empty, which no browser sends) → local tool, allowed.
  if (origin === undefined || origin.trim() === '') return true;
  // Origins are case-insensitive in scheme/host and carry no path; normalize the
  // shapes a hand-rolled client might send so only the host:port decides.
  const normalized = origin.trim().toLowerCase().replace(/\/+$/, '');
  return allowedOrigins(port).includes(normalized);
}

/** HTTP methods that can change state — the ones the Origin gate applies to.
 *  GET/HEAD stay open: the sandboxed exhibit iframe legitimately loads
 *  /api/project-file, and a read cannot be a confused-deputy write. */
export const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** True when this request would change state and must therefore pass the gate. */
export function isStateChanging(method: string | undefined): boolean {
  return STATE_CHANGING_METHODS.has((method ?? 'GET').toUpperCase());
}

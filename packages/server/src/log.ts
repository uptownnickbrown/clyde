import fs from 'node:fs';
import path from 'node:path';

// Structured server log: JSONL in .clyde/logs/server.jsonl (gitignored), mirrored
// to stdout. File-based so the agent can read its own server's diagnostics.

type Level = 'debug' | 'info' | 'warn' | 'error';

let logPath: string | null = null;

export function initLogger(clydeDir: string) {
  const dir = path.join(clydeDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  logPath = path.join(dir, 'server.jsonl');
  slog('log', 'info', 'logger initialized', { logPath });
}

export function slog(component: string, level: Level, message: string, data?: unknown) {
  const entry = { ts: new Date().toISOString(), level, component, message, ...(data !== undefined ? { data } : {}) };
  const line = JSON.stringify(entry);
  if (logPath) {
    try {
      fs.appendFileSync(logPath, line + '\n');
    } catch {
      // never let logging take the server down
    }
  }
  if (level !== 'debug') console.log(`[${component}] ${level}: ${message}`);
}

export function tailLog(lines: number): string {
  if (!logPath || !fs.existsSync(logPath)) return '';
  const all = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  return all.slice(-lines).join('\n');
}

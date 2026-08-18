import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CommitInfo } from '@clyde/shared';

const run = promisify(execFile);

export async function listCommits(projectRoot: string, limit = 100): Promise<CommitInfo[]> {
  try {
    const { stdout } = await run(
      'git',
      ['log', `-n${limit}`, '--format=%H%x1f%s%x1f%cI', '--shortstat'],
      { cwd: projectRoot },
    );
    return parseLog(stdout);
  } catch {
    return [];
  }
}

function parseLog(stdout: string): CommitInfo[] {
  const commits: CommitInfo[] = [];
  let current: CommitInfo | null = null;
  for (const line of stdout.split('\n')) {
    if (line.includes('\x1f')) {
      const [sha, subject, ts] = line.split('\x1f');
      current = { sha, subject, ts, filesChanged: 0, insertions: 0, deletions: 0 };
      commits.push(current);
    } else if (current && line.trim()) {
      const files = /(\d+) files? changed/.exec(line);
      const ins = /(\d+) insertions?/.exec(line);
      const del = /(\d+) deletions?/.exec(line);
      if (files) current.filesChanged = Number(files[1]);
      if (ins) current.insertions = Number(ins[1]);
      if (del) current.deletions = Number(del[1]);
    }
  }
  return commits;
}

/** Full detail for one commit (message, stat, patch) for the UI's expand view. */
export async function showCommit(projectRoot: string, sha: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['show', sha, '--stat', '--patch', '--no-color'], {
      cwd: projectRoot,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.length > 200_000 ? stdout.slice(0, 200_000) + '\n… (truncated)' : stdout;
  } catch (err) {
    return `error: ${String(err)}`;
  }
}

/** Polls git for new commits and reports them, so the server can link each new
 *  commit to the conversation position that produced it. */
export class GitWatcher {
  private known = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private projectRoot: string,
    private onNewCommit: (commit: CommitInfo) => void,
  ) {}

  async start(intervalMs = 4000) {
    for (const c of await listCommits(this.projectRoot)) this.known.add(c.sha);
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }

  async poll() {
    const commits = await listCommits(this.projectRoot, 20);
    // Oldest-first so multiple new commits arrive in order.
    for (const c of commits.reverse()) {
      if (!this.known.has(c.sha)) {
        this.known.add(c.sha);
        this.onNewCommit(c);
      }
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

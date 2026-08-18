// Canned session snapshot for screenshot QA — deterministic, covers every UI state:
// rich markdown, tool chips, dispatches, commits, open + resolved span threads plus
// a message-level thread on a user message, queue, compaction, usage gauge, tasks
// in all three states, pushed panels.
import fs from 'node:fs';
import path from 'node:path';

const T = (m) => `2026-08-18T14:${String(m).padStart(2, '0')}:00.000Z`;

const A1 = `SCOPE.md read — the north star is clear: **conversation at center, panels for state, files as the database**.

My plan for the walking skeleton:

1. \`packages/shared\` — wire protocol first (events, threads, anchors, panels)
2. \`packages/server\` — wrap the Agent SDK in streaming-input mode, translate its stream into Clyde events
3. \`packages/web\` — React UI rendering the event log as a conversation document

Starting with the protocol so both sides have a contract.`;

const A2 = `The skeleton streams end-to-end now. Three notes on the architecture:

- **One linear conversation** — sidebar threads are re-anchored into the main stream, exactly as scoped.
- I chose to append every SDK message to \`events.jsonl\` before broadcasting, so a UI refresh replays the identical document.
- Tool noise is suppressed into chips; the full record lives in the Activity panel.

Next: the QA loop — Playwright screenshots pushed to a gallery panel.`;

const A3 = `QA loop underway. The harness has two parts:

\`\`\`ts
// qa/screenshot.mjs — capture every UI state
const states = ['overview', 'thread', 'comment', 'activity', 'context', 'panels'];
for (const s of states) await capture(page, s);
\`\`\`

Screenshots land in \`qa/screenshots/\` and the gallery panel watches that glob — you judge the bar without leaving Clyde.`;

const A4 = `Captured the screenshot set across the main states — pushing them to the gallery panel now. I will flag anything that looks below the bar, with a fix list ordered by how much each defect hurts readability.`;

export const DELTA_TEXT =
  'Now judging the screenshots against the bar: checking the conversation column measure, chip alignment, thread indentation, and every empty state…';

export function buildSnapshot(projectRoot) {
  let goalMarkdown = null;
  try {
    goalMarkdown = fs.readFileSync(path.join(projectRoot, 'SCOPE.md'), 'utf8');
  } catch {
    goalMarkdown = null;
  }

  const events = [
    { id: 'e-sess', ts: T(0), type: 'session_started', model: 'claude-fable-5', cwd: projectRoot },
    { id: 'e-st1', ts: T(0), type: 'status', status: 'working' },
    { id: 'u1', ts: T(1), type: 'user_message', text: 'Read SCOPE.md. Build the walking skeleton: Agent SDK session streaming end-to-end to a React UI.' },
    { id: 'a1', ts: T(2), type: 'assistant_message', turnId: 't1', markdown: A1 },
    { id: 'tc1', ts: T(3), type: 'tool_call', toolUseId: 'tu1', tool: 'Read', input: { file_path: `${projectRoot}/SCOPE.md` }, turnId: 't1' },
    { id: 'tr1', ts: T(3), type: 'tool_result', toolUseId: 'tu1', ok: true, preview: '# Clyde — Scope Document …' },
    { id: 'tc2', ts: T(3), type: 'tool_call', toolUseId: 'tu2', tool: 'Write', input: { file_path: `${projectRoot}/packages/shared/src/index.ts` }, turnId: 't1' },
    { id: 'tr2', ts: T(3), type: 'tool_result', toolUseId: 'tu2', ok: true },
    { id: 'tc3', ts: T(4), type: 'tool_call', toolUseId: 'tu3', tool: 'Bash', input: { command: 'npm install && npm run typecheck' }, turnId: 't1' },
    { id: 'tr3', ts: T(4), type: 'tool_result', toolUseId: 'tu3', ok: false, preview: 'error TS2345: Argument of type …' },
    { id: 'd1', ts: T(4), type: 'dispatch', toolUseId: 'tu4', agentType: 'Explore', description: 'Survey Agent SDK streaming API', prompt: 'Read the @anthropic-ai/claude-agent-sdk types and document the streaming-input query() contract: message shapes, interrupt, partial messages.' },
    { id: 'tc-s1', ts: T(4), type: 'tool_call', toolUseId: 'tu4a', tool: 'Read', input: { file_path: `${projectRoot}/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` }, turnId: 't1', parentToolUseId: 'tu4' },
    { id: 'tc-s2', ts: T(5), type: 'tool_call', toolUseId: 'tu4b', tool: 'Bash', input: { command: 'grep -rn "interrupt" node_modules/@anthropic-ai/claude-agent-sdk' }, turnId: 't1', parentToolUseId: 'tu4' },
    { id: 'tr-d1', ts: T(5), type: 'tool_result', toolUseId: 'tu4', ok: true, preview: 'Documented the streaming contract: push user messages over an async generator…' },
    { id: 'tc4', ts: T(5), type: 'tool_call', toolUseId: 'tu5', tool: 'Edit', input: { file_path: `${projectRoot}/packages/server/src/agentSession.ts` }, turnId: 't1' },
    { id: 'tr4', ts: T(5), type: 'tool_result', toolUseId: 'tu5', ok: true },
    { id: 'a2', ts: T(6), type: 'assistant_message', turnId: 't1', markdown: A2 },
    {
      id: 'ev-c1', ts: T(6), type: 'commit',
      commit: { sha: 'c5fcbbe41d2a', subject: 'Walking skeleton: Agent SDK session streaming end-to-end to React UI', ts: T(6), filesChanged: 14, insertions: 1204, deletions: 3, messageId: 'a2' },
    },
    // Open sidebar thread anchored on a2
    { id: 'u-th1', ts: T(7), type: 'user_message', threadId: 'th1', text: 'Why append before broadcasting? If the write fails we drop the turn on the floor.' },
    { id: 'a-th1', ts: T(8), type: 'assistant_message', turnId: 't2', threadId: 'th1', markdown: 'Deliberate: the log is the source of truth — if it cannot be written, showing the message anyway would make the UI and the file disagree. I would rather surface the write error loudly. Happy to add retry-with-backoff as belt and suspenders.' },
    { id: 'u2', ts: T(9), type: 'user_message', text: 'Looks right. Now set up the QA loop from the scope — Playwright screenshots, pushed to a gallery panel. Match the reference design attached.', attachments: ['qa/fixtures/attachment-sample.png'] },
    { id: 'a3', ts: T(10), type: 'assistant_message', turnId: 't3', markdown: A3 },
    // Resolved thread anchored on a3
    { id: 'u-th2', ts: T(11), type: 'user_message', threadId: 'th2', text: 'This is the success criterion I care most about — make the gallery dense.' },
    { id: 'a-th2', ts: T(11), type: 'assistant_message', turnId: 't3b', threadId: 'th2', markdown: 'Noted — recorded in DECISIONS.md: the gallery is the primary QA surface, density over chrome.' },
    { id: 'd2', ts: T(12), type: 'dispatch', toolUseId: 'tu8', agentType: 'general-purpose', description: 'Playwright screenshot QA harness', prompt: 'Build qa/screenshot.mjs: launch the fixture server, capture every UI state with Playwright at 1440x900@2x into qa/screenshots/, and report what you captured.' },
    { id: 'tc-s3', ts: T(12), type: 'tool_call', toolUseId: 'tu8a', tool: 'Write', input: { file_path: `${projectRoot}/qa/screenshot.mjs` }, turnId: 't3', parentToolUseId: 'tu8' },
    { id: 'tc-s4', ts: T(13), type: 'tool_call', toolUseId: 'tu8b', tool: 'Bash', input: { command: 'node qa/screenshot.mjs' }, turnId: 't3', parentToolUseId: 'tu8' },
    { id: 'tc5', ts: T(12), type: 'tool_call', toolUseId: 'tu6', tool: 'Bash', input: { command: 'node qa/screenshot.mjs' }, turnId: 't3' },
    { id: 'tr5', ts: T(12), type: 'tool_result', toolUseId: 'tu6', ok: true, preview: 'captured 8 screenshots → qa/screenshots/' },
    { id: 'tc6', ts: T(12), type: 'tool_call', toolUseId: 'tu7', tool: 'Read', input: { file_path: `${projectRoot}/qa/screenshots/01-overview.png` }, turnId: 't3' },
    { id: 'tr6', ts: T(12), type: 'tool_result', toolUseId: 'tu7', ok: true },
    { id: 'e-use1', ts: T(12), type: 'usage', contextTokens: 214000 },
    // Message-level thread (no span) anchored on the USER's own message u2
    { id: 'u-th3', ts: T(12), type: 'user_message', threadId: 'th3', text: 'Threading off my own message: the reference design I attached also has a dark-mode variant — is that in scope for the gallery?' },
    { id: 'a-th3', ts: T(13), type: 'assistant_message', turnId: 't3c', threadId: 'th3', markdown: 'Yes — the capture matrix runs every state in both variants, so the gallery will show dark mode side by side with light.' },
    { id: 'e-cmp', ts: T(13), type: 'compaction', preTokens: 214000, trigger: 'auto' },
    { id: 'e-use2', ts: T(13), type: 'usage', contextTokens: 96000, costUsd: 4.18 },
    { id: 'a4', ts: T(14), type: 'assistant_message', turnId: 't4', markdown: A4 },
  ];

  return {
    projectName: 'clyde',
    goalMarkdown,
    events,
    threads: [
      {
        id: 'th1',
        anchor: { messageId: 'a2', start: A2.indexOf('append every SDK message'), end: A2.indexOf('append every SDK message') + 62, quote: 'append every SDK message to `events.jsonl` before broadcasting' },
        status: 'open',
        createdAt: T(7),
      },
      {
        id: 'th2',
        anchor: { messageId: 'a3', start: A3.indexOf('you judge'), end: A3.indexOf('you judge') + 38, quote: 'you judge the bar without leaving Clyde' },
        status: 'resolved',
        createdAt: T(11),
      },
      // Message-level: anchored to the whole user message u2, no span/quote.
      {
        id: 'th3',
        anchor: { messageId: 'u2' },
        status: 'open',
        createdAt: T(12),
      },
    ],
    queue: [
      { id: 'q1', text: 'Also: the composer textarea should grow with content', attachments: ['.clyde/uploads/minimap-sketch.png'], urgent: false, queuedAt: T(14) },
      { id: 'q2', text: 'Can we get commit markers on the minimap?', urgent: false, queuedAt: T(14) },
    ],
    panels: [
      { id: 'qa-screenshots', kind: 'image-gallery', title: 'QA screenshots', glob: 'qa/screenshots/*.png' },
      { id: 'build-health', kind: 'metrics', title: 'Build health', path: 'qa/fixtures/metrics.json' },
    ],
    tasks: [
      { id: '1', subject: 'Wire protocol + event log', status: 'completed' },
      { id: '2', subject: 'Conversation document with span comments', status: 'completed' },
      { id: '3', subject: 'Playwright screenshot QA harness', status: 'in_progress', activeForm: 'Building the QA harness', detail: 'qa/fixture-server.mjs serves the built UI over a canned snapshot; qa/screenshot.mjs captures every state at 1440x900@2x into qa/screenshots/.' },
      { id: '4', subject: 'Context meter: pull-back-in affordance', status: 'pending', detail: 'Files-touched list with a per-file re-read action so stale context can be pulled back in after compaction.' },
    ],
    commits: [
      { sha: '1931addf00aa', subject: 'Default agent effort to xhigh (CLYDE_EFFORT to override)', ts: T(13), filesChanged: 1, insertions: 2, deletions: 1, messageId: 'a3' },
      { sha: '63c1bed77c21', subject: 'Tighten README tagline into the log/workspace syllogism', ts: T(9), filesChanged: 1, insertions: 4, deletions: 4, messageId: 'a2' },
      { sha: 'c5fcbbe41d2a', subject: 'Walking skeleton: Agent SDK session streaming end-to-end to React UI', ts: T(6), filesChanged: 14, insertions: 1204, deletions: 3, messageId: 'a2' },
      { sha: '556de1928cc0', subject: 'Scope document: Clyde — conversation-centric IDE for agent-driven builds', ts: T(1), filesChanged: 1, insertions: 113, deletions: 0 },
    ],
    status: 'working',
    gitStatus: { branch: 'main', dirtyFiles: 3 },
    model: 'claude-fable-5',
  };
}

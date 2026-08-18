// Offline check for the resume-boot backfill planner (task #17): given an events
// log with a hole at the tail and the SDK CLI's own transcript, the planner must
// recover exactly the lost events — and nothing else. Also covers the delta-journal
// recovery planner (task #24), the layer under backfill. Deterministic; no live
// session, no ports, no writes outside a temp dir (none at all, in fact).
//
// Usage:  npm run typecheck && node qa/backfill-check.mjs
//
// Fixture entries mirror the REAL transcript line shapes observed in
// ~/.claude/projects/-Users-nbrown-Desktop-clyde/*.jsonl (per-block assistant
// entries sharing message.id, stop_reason as the turn signal, isMeta resume
// filler, compactMetadata on compact_boundary).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '../packages/server/dist/backfill.js');

let planBackfill, planJournalRecovery, transcriptPathFor, parseSidebarMarker, parseTaskNotifications;
try {
  ({ planBackfill, planJournalRecovery, transcriptPathFor, parseSidebarMarker, parseTaskNotifications } = await import(DIST));
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

// ---------- fixture builders (shapes copied from real transcripts) ----------

let n = 0;
const uid = (tag) => `${tag}-${String(++n).padStart(3, '0')}`;
const T = (s) => `2026-08-18T18:0${s}.000Z`;

const USAGE = { input_tokens: 2, cache_read_input_tokens: 24650, cache_creation_input_tokens: 1392, output_tokens: 482 };
const CONTEXT_TOKENS = 2 + 24650 + 1392 + 482;

const asst = (uuid, ts, block, stopReason, msgId, extra = {}) => ({
  parentUuid: 'p',
  isSidechain: false,
  type: 'assistant',
  message: { model: 'claude-fable-5', id: msgId, type: 'message', role: 'assistant', content: [block], stop_reason: stopReason, usage: USAGE },
  uuid,
  timestamp: ts,
  entrypoint: 'sdk-cli',
  cwd: '/tmp/proj',
  sessionId: 'sdk-1',
  ...extra,
});
const userPrompt = (uuid, ts, text, extra = {}) => ({
  parentUuid: null,
  isSidechain: false,
  type: 'user',
  message: { role: 'user', content: text },
  uuid,
  timestamp: ts,
  entrypoint: 'sdk-cli',
  ...extra,
});
const toolResult = (uuid, ts, toolUseId, content, isError = false) => ({
  parentUuid: 'p',
  isSidechain: false,
  type: 'user',
  message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content, is_error: isError }] },
  uuid,
  timestamp: ts,
});
const meta = (type, rest = {}) => ({ type, sessionId: 'sdk-1', ...rest });

const ev = (body, ts, sdkUuid) => ({ id: uid('ev'), ts, ...(sdkUuid ? { sdkUuid } : {}), ...body });
const lines = (entries) => entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n';

// ---------- shared fixture: a turn cut in half by a restart ----------

const TURN = 'turn-aaaa';
const baseEvents = [
  ev({ type: 'session_started', sdkSessionId: 'sdk-1', model: 'claude-fable-5', cwd: '/tmp/proj' }, T('0:00')),
  ev({ type: 'user_message', text: 'Fix the flaky test' }, T('0:01')),
  ev({ type: 'assistant_message', markdown: 'Looking at the test now.', turnId: TURN }, T('0:02')),
  ev({ type: 'tool_call', toolUseId: 'toolu_1', tool: 'Read', input: { file_path: '/tmp/proj/x.ts' }, turnId: TURN }, T('0:03')),
  ev({ type: 'tool_result', toolUseId: 'toolu_1', ok: true }, T('0:04')),
];

const consumedEntries = [
  meta('queue-operation', { operation: 'enqueue', content: 'Fix the flaky test' }),
  userPrompt('u-prompt', T('0:01'), 'Fix the flaky test'),
  meta('attachment', { attachment: { type: 'deferred_tools_delta' } }),
  asst('u-ack', T('0:02'), { type: 'text', text: 'Looking at the test now.' }, 'tool_use', 'msg_1'),
  asst('u-read', T('0:03'), { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/proj/x.ts' } }, 'tool_use', 'msg_1'),
  toolResult('u-read-r', T('0:04'), 'toolu_1', '1\tconst x = 1;'),
];
const lostEntries = [
  asst('u-lost-1', T('0:05'), { type: 'text', text: 'Found it — the timeout is racy. Filing a task.' }, 'tool_use', 'msg_2'),
  asst('u-lost-2', T('0:06'), { type: 'tool_use', id: 'toolu_2', name: 'TaskCreate', input: { subject: 'Deflake the timeout test' } }, 'tool_use', 'msg_2'),
  toolResult('u-lost-3', T('0:07'), 'toolu_2', 'Task #7 created'),
  asst('u-lost-4', T('0:08'), { type: 'thinking', thinking: 'wrapping up' }, 'end_turn', 'msg_3'),
  asst('u-lost-5', T('0:09'), { type: 'text', text: 'Done — task #7 filed.' }, 'end_turn', 'msg_3'),
];

// ---------- 1. crash-tail recovery on a legacy log (no sdkUuid anywhere) ----------
console.log('1. crash-tail recovery (content correlation, legacy log)');
{
  const plan = planBackfill({ events: baseEvents, transcript: lines([...consumedEntries, ...lostEntries]), threads: [] });
  const bodies = plan.planned.map((p) => p.body);
  const texts = bodies.filter((b) => b.type === 'assistant_message').map((b) => b.markdown);
  check('recovers both lost assistant messages', JSON.stringify(texts) === JSON.stringify(['Found it — the timeout is racy. Filing a task.', 'Done — task #7 filed.']), texts);
  check('recovers the lost TaskCreate tool_call', bodies.some((b) => b.type === 'tool_call' && b.toolUseId === 'toolu_2' && b.tool === 'TaskCreate'));
  check('recovers the lost tool_result with preview', bodies.some((b) => b.type === 'tool_result' && b.toolUseId === 'toolu_2' && b.ok === true && b.preview === 'Task #7 created'));
  check('exactly one turn_complete despite two end_turn entries', bodies.filter((b) => b.type === 'turn_complete').length === 1);
  check('turn_complete is last', bodies[bodies.length - 1].type === 'turn_complete');
  check('sawTurnEnd reported', plan.sawTurnEnd === true);
  check('nothing already-logged is replanned', !bodies.some((b) => b.type === 'assistant_message' && b.markdown === 'Looking at the test now.') && !bodies.some((b) => b.type === 'tool_call' && b.toolUseId === 'toolu_1'));
  check('turnId carried over from the cut turn', bodies.filter((b) => 'turnId' in b).every((b) => b.turnId === TURN));
  check('timestamps recovered from the transcript', plan.planned.every((p) => p.ts >= T('0:05') && p.ts <= T('0:09')));
  check('sdkUuid stamped from transcript uuids', plan.planned.every((p) => String(p.sdkUuid).startsWith('u-lost-')));
  check('usage backfilled with the live formula', bodies.some((b) => b.type === 'usage' && b.contextTokens === CONTEXT_TOKENS));

  // ---------- 2. idempotency: appending the plan and re-planning yields nothing ----------
  console.log('2. idempotency (uuid correlation)');
  const events2 = [...baseEvents, ...plan.planned.map((p) => ev(p.body, p.ts, p.sdkUuid))];
  const plan2 = planBackfill({ events: events2, transcript: lines([...consumedEntries, ...lostEntries]), threads: [] });
  check('re-plan is empty', plan2.planned.length === 0, plan2.planned.map((p) => p.body.type));

  // ---------- 3. resume filler is never backfilled ----------
  console.log('3. synthetic resume filler skipped');
  const fillerTail = [
    userPrompt('u-cont', T('0:10'), null, { isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'Continue from where you left off.' }] } }),
    asst('u-noresp', T('0:10'), { type: 'text', text: 'No response requested.' }, 'stop_sequence', 'msg_4'),
  ];
  const plan3 = planBackfill({ events: events2, transcript: lines([...consumedEntries, ...lostEntries, ...fillerTail]), threads: [] });
  check('filler produces no events and no turn_complete', plan3.planned.length === 0, plan3.planned.map((p) => p.body));
}

// ---------- 4. tail without end_turn -> no turn_complete (auto-resume must fire) ----------
console.log('4. incomplete turn stays incomplete');
{
  const plan = planBackfill({ events: baseEvents, transcript: lines([...consumedEntries, ...lostEntries.slice(0, 3)]), threads: [] });
  check('no turn_complete planned', !plan.planned.some((p) => p.body.type === 'turn_complete') && plan.sawTurnEnd === false);
  check('lost prefix still recovered', plan.planned.some((p) => p.body.type === 'tool_call' && p.body.toolUseId === 'toolu_2'));
}

// ---------- 5. unparseable lines are skipped, not fatal ----------
console.log('5. unparseable transcript lines');
{
  const raw = lines([...consumedEntries, 'this is not json {', ...lostEntries]);
  const plan = planBackfill({ events: baseEvents, transcript: raw, threads: [] });
  check('one skipped line counted', plan.skippedLines === 1, plan.skippedLines);
  check('recovery still works around it', plan.planned.some((p) => p.body.type === 'tool_call' && p.body.toolUseId === 'toolu_2'));
}

// ---------- 6. zero overlap -> bail rather than flood the document ----------
console.log('6. no-overlap bail');
{
  const strangerLog = [ev({ type: 'session_started', sdkSessionId: 'sdk-1', model: 'm', cwd: '/tmp/proj' }, T('0:00'))];
  const plan = planBackfill({ events: strangerLog, transcript: lines([...consumedEntries, ...lostEntries]), threads: [] });
  check('bailed with no planned events', Boolean(plan.bailed) && plan.planned.length === 0, plan);
}

// ---------- 7. sidebar-marked lost reply routes to its thread ----------
console.log('7. sidebar marker routing');
{
  const thread = { id: 'ab12cd34-0000-4000-8000-000000000000', anchor: { messageId: 'm', start: 0, end: 4, quote: 'quo' }, status: 'open', createdAt: T('0:00') };
  const tail = [asst('u-side', T('0:05'), { type: 'text', text: '[[sidebar:ab12cd34]] Good catch — fixed.' }, 'tool_use', 'msg_9')];
  const plan = planBackfill({ events: baseEvents, transcript: lines([...consumedEntries, ...tail]), threads: [thread] });
  const m = plan.planned.find((p) => p.body.type === 'assistant_message');
  check('marker stripped and thread resolved', m && m.body.markdown === 'Good catch — fixed.' && m.body.threadId === thread.id, m?.body);
  const parsed = parseSidebarMarker('[[sidebar:ab12cd34]] hi', [thread]);
  check('parseSidebarMarker shared helper agrees', parsed.markdown === 'hi' && parsed.threadId === thread.id && parsed.hadMarker === true);
}

// ---------- 8. compact_boundary backfilled only when the log missed it ----------
console.log('8. compact boundary');
{
  const boundary = {
    type: 'system',
    subtype: 'compact_boundary',
    isSidechain: false,
    isMeta: false,
    uuid: 'u-compact',
    timestamp: T('0:05'),
    compactMetadata: { trigger: 'manual', preTokens: 338731, postTokens: 8980 },
  };
  const plan = planBackfill({ events: baseEvents, transcript: lines([...consumedEntries, boundary]), threads: [] });
  const c = plan.planned.find((p) => p.body.type === 'compaction');
  check('missed boundary backfilled with metadata', c && c.body.preTokens === 338731 && c.body.trigger === 'manual', c?.body);
  const loggedLog = [...baseEvents, ev({ type: 'compaction', preTokens: 338731, trigger: 'manual' }, T('0:05'))];
  const plan2 = planBackfill({ events: loggedLog, transcript: lines([...consumedEntries, boundary]), threads: [] });
  check('already-logged boundary not duplicated', !plan2.planned.some((p) => p.body.type === 'compaction'));
}

// ---------- 9. transcript path derivation ----------
console.log('9. transcript path');
{
  const p = transcriptPathFor('/Users/nb/Desktop/clyde', 'abc-123');
  check('cwd munged like the CLI does', p.endsWith(path.join('.claude', 'projects', '-Users-nb-Desktop-clyde', 'abc-123.jsonl')), p);
  process.env.CLYDE_SDK_PROJECTS_DIR = '/tmp/fake-projects';
  const q = transcriptPathFor('/Users/nb/Desktop/clyde', 'abc-123');
  delete process.env.CLYDE_SDK_PROJECTS_DIR;
  check('CLYDE_SDK_PROJECTS_DIR override respected', q === '/tmp/fake-projects/-Users-nb-Desktop-clyde/abc-123.jsonl', q);
}

// ---------- 10. sidechain and meta entries never leak into the document ----------
console.log('10. sidechain/meta hygiene');
{
  const noise = [
    asst('u-sub', T('0:05'), { type: 'text', text: 'subagent chatter' }, 'end_turn', 'msg_s', { isSidechain: true }),
    userPrompt('u-int', T('0:06'), null, { message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
  ];
  const plan = planBackfill({ events: baseEvents, transcript: lines([...consumedEntries, ...noise]), threads: [] });
  check('no events from sidechain or user text entries', plan.planned.length === 0, plan.planned.map((p) => p.body));
}

// ---------- 11. background-agent task-notification -> dispatch_update ----------
// Shape mirrors real injected notifications (string user content, escaped entities,
// nested worktree tags) from ~/.claude/projects/-Users-nbrown-Desktop-clyde/*.jsonl.
console.log('11. task-notification backfill');
{
  const NOTIF =
    '<task-notification>\n<task-id>a9f2c3d4e</task-id>\n<tool-use-id>toolu_bg1</tool-use-id>\n' +
    '<output-file>/tmp/tasks/a9f2c3d4e.output</output-file>\n<status>completed</status>\n' +
    '<summary>Agent "Minimap markers" finished</summary>\n' +
    '<note>A task-notification fires each time this agent stops.</note>\n' +
    '<result>Done. Escaped tags survive: &lt;task-notification&gt; &amp; friends.</result>\n' +
    '<worktree><worktreePath>/tmp/wt</worktreePath><worktreeBranch>worktree-agent-a9f2c3d4e</worktreeBranch></worktree>\n' +
    '</task-notification>';
  const tail = [
    asst('u-bg-1', T('0:05'), { type: 'tool_use', id: 'toolu_bg1', name: 'Agent', input: { description: 'Minimap markers', run_in_background: true } }, 'end_turn', 'msg_bg'),
    toolResult('u-bg-2', T('0:05'), 'toolu_bg1', 'Async agent launched successfully. (This tool result is internal metadata.)\nagentId: a9f2c3d4e'),
    userPrompt('u-bg-3', T('0:06'), NOTIF),
  ];
  const plan = planBackfill({ events: baseEvents, transcript: lines([...consumedEntries, ...tail]), threads: [] });
  const du = plan.planned.find((p) => p.body.type === 'dispatch_update');
  check('dispatch_update planned from the notification', Boolean(du), plan.planned.map((p) => p.body.type));
  check(
    'notification fields parsed',
    du && du.body.toolUseId === 'toolu_bg1' && du.body.status === 'completed' &&
      du.body.summary === 'Agent "Minimap markers" finished' &&
      du.body.worktreeBranch === 'worktree-agent-a9f2c3d4e' && du.body.worktreePath === '/tmp/wt',
    du?.body,
  );
  check('entities decoded in the report', du && du.body.result.includes('<task-notification> & friends'), du?.body.result);
  check('spawn ack backfilled as a plain tool_result', plan.planned.some((p) => p.body.type === 'tool_result' && p.body.toolUseId === 'toolu_bg1'));
  check('sdkUuid stamped from the notification entry', du && du.sdkUuid === 'u-bg-3');

  const withUpdate = [...baseEvents, ...plan.planned.map((p) => ev(p.body, p.ts, p.sdkUuid))];
  const replan = planBackfill({ events: withUpdate, transcript: lines([...consumedEntries, ...tail]), threads: [] });
  check('re-plan is empty (uuid correlation)', replan.planned.length === 0, replan.planned.map((p) => p.body.type));
  const legacyLog = [...baseEvents, ...plan.planned.map((p) => ev(p.body, p.ts))]; // no sdkUuid anywhere
  const replan2 = planBackfill({ events: legacyLog, transcript: lines([...consumedEntries, ...tail]), threads: [] });
  check('re-plan is empty (content correlation, legacy log)', replan2.planned.length === 0, replan2.planned.map((p) => p.body.type));

  check('parseTaskNotifications: plain text -> none', parseTaskNotifications('no notification here').length === 0);
  const failed = parseTaskNotifications(
    '<task-notification>\n<task-id>bzwpqdsy2</task-id>\n<tool-use-id>toolu_x</tool-use-id>\n<status>failed</status>\n<summary>Background command failed with exit code 144</summary>\n</task-notification>',
  );
  check('failed notification parsed without a result', failed.length === 1 && failed[0].status === 'failed' && failed[0].result === undefined, failed);
  check('missing tool-use-id -> dropped', parseTaskNotifications('<task-notification>\n<status>completed</status>').length === 0);
}

// ---------- 12. delta-journal recovery (task #24 — the last loss window) ----------
// Streamed deltas journaled to deltas-<turnId>.log that survive to boot are prose
// the user watched stream but BOTH events.jsonl and the CLI transcript missed —
// unless the CLI-transcript backfill already recovered the real message, detected
// by its first 80 trimmed characters appearing in a logged assistant_message.
console.log('12. delta-journal recovery');
{
  const J = (turnId, text) => ({ turnId, text });
  const LOST =
    'This prose streamed to the screen but never reached events.jsonl or the CLI transcript — the verified last loss window.';

  // (a) no covering event -> provisional emit, verbatim, on the journal's turn
  let plan = planJournalRecovery({ events: baseEvents, journals: [J(TURN, LOST)] });
  check(
    'uncovered journal -> emit on its turn',
    plan.emit.length === 1 && plan.emit[0].turnId === TURN && plan.emit[0].markdown === LOST,
    plan.emit,
  );

  // (b) covered: a logged assistant_message contains the journal's first 80 chars
  // (the backfilled real message has the tail the journal never saw) -> no emit
  const recovered = ev(
    { type: 'assistant_message', markdown: LOST + ' Plus the tail only the completed block carries.', turnId: TURN },
    T('0:05'),
  );
  plan = planJournalRecovery({ events: [...baseEvents, recovered], journals: [J(TURN, LOST)] });
  check('covered journal (80-char prefix in logged markdown) -> no emit', plan.emit.length === 0, plan.emit);

  // (c) empty or whitespace-only journal -> nothing worth resurrecting
  plan = planJournalRecovery({ events: baseEvents, journals: [J(TURN, '  \n\t  '), J('turn-bbbb', '')] });
  check('empty/whitespace journals -> no emit', plan.emit.length === 0, plan.emit);

  // (d) multiple journals judged independently: one covered, one not
  plan = planJournalRecovery({
    events: [...baseEvents, recovered],
    journals: [J(TURN, LOST), J('turn-bbbb', 'Different prose lost from another turn entirely.')],
  });
  check(
    'multiple journals judged independently',
    plan.emit.length === 1 && plan.emit[0].turnId === 'turn-bbbb',
    plan.emit,
  );

  // (e) sidebar plumbing never renders: the marker is stripped before probing AND
  // from the recovered prose (logged replies are stored marker-stripped too)
  const side = '[[sidebar:ab12cd34]] Good catch — fixing the offset now.';
  plan = planJournalRecovery({ events: baseEvents, journals: [J(TURN, side)] });
  check(
    'sidebar marker stripped from recovered prose',
    plan.emit.length === 1 && plan.emit[0].markdown === 'Good catch — fixing the offset now.',
    plan.emit,
  );
  const loggedReply = ev(
    { type: 'assistant_message', markdown: 'Good catch — fixing the offset now.', turnId: TURN, threadId: 'th-1' },
    T('0:05'),
  );
  plan = planJournalRecovery({ events: [...baseEvents, loggedReply], journals: [J(TURN, side)] });
  check('marker-stripped probe matches the marker-stripped log -> no emit', plan.emit.length === 0, plan.emit);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll backfill checks passed.');
process.exit(failures ? 1 : 0);

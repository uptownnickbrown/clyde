// Offline check for the decision-ledger edit policy (task #40): the pure function behind
// POST /api/decisions in packages/server/src/server.ts. Deterministic; no live session,
// no ports, no writes — the ledger text is a literal in this file.
//
// The claim under protection is narrow and load-bearing: a user editing ONE ruling from
// the Decisions panel can change that ruling and nothing else. .clyde/DECISIONS.md is
// agent-writable and appended to while the user reads it (constitution rule 6), so every
// case below asks the same question in a different way — what survived the write?
//
// Usage:  npm run qa:decisions        (typecheck/build first — it imports from dist)

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '../packages/server/dist/decisions.js');

let applyDecisionEdit, RULING_LINE;
try {
  ({ applyDecisionEdit, RULING_LINE } = await import(DIST));
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

const DECIDED = '- Decided: threading is presentation over one linear conversation (2026-08-18)';
const DEFERRED = '- Deferred: bulk ruling operations — revisit when a wave lands 10+ rulings (2026-08-19)';
const ODD = '- Superseded by the ruling above, kept for provenance';
// A ledger with everything a real one has: heading, preamble, a blank line, both ruling
// kinds, a bullet in a shape the panel does NOT parse, and a trailing note.
const LEDGER = [
  '# Decisions',
  '',
  'The distilled rulings from resolved discussions. Never re-litigate an entry.',
  '',
  DECIDED,
  DEFERRED,
  ODD,
  '',
  'Older rulings live in git history.',
  '',
].join('\n');

const lines = (s) => s.split('\n');

// ---------- 1. editing a ruling changes exactly one line ----------
console.log('\n1. edit rewrites the targeted ruling and nothing else');
{
  const next = '- Decided: threading is presentation over one linear conversation, never context forking (2026-08-19)';
  const r = applyDecisionEdit(LEDGER, { original: DECIDED, text: next });
  check('accepted', r.ok === true, r);
  check('reports a change', r.ok && r.changed === true);
  const before = lines(LEDGER);
  const after = lines(r.markdown);
  check('line count unchanged', after.length === before.length, { before: before.length, after: after.length });
  check('the ruling is the new text', after[4] === next, after[4]);
  const untouched = before.every((l, i) => i === 4 || l === after[i]);
  check('every other line byte-identical', untouched);
  check('summary names both sides', r.ok && r.summary.startsWith('edited a ruling:'), r.summary);
}

// ---------- 2. delete is real deletion, of one line ----------
console.log('\n2. delete removes the ruling outright (git is the history)');
{
  const r = applyDecisionEdit(LEDGER, { original: DEFERRED });
  check('accepted with no text field', r.ok === true, r);
  const after = lines(r.markdown);
  check('exactly one line fewer', after.length === lines(LEDGER).length - 1);
  check('the ruling is gone', !r.markdown.includes(DEFERRED));
  check('its neighbours survive', r.markdown.includes(DECIDED) && r.markdown.includes(ODD));
  check('preamble survives', r.markdown.startsWith('# Decisions\n\nThe distilled rulings'));
  check('trailing prose survives', r.markdown.includes('Older rulings live in git history.'));
  const nullText = applyDecisionEdit(LEDGER, { original: DEFERRED, text: null });
  check('explicit null deletes too', nullText.ok && nullText.markdown === r.markdown);
}

// ---------- 3. what the route cannot reach ----------
// This is the guarantee that lets the panel own the ledger without owning the file: a
// non-ruling line is not merely left alone, it is unaddressable.
console.log('\n3. non-ruling content is unaddressable');
for (const [name, target] of [
  ['the heading', '# Decisions'],
  ['the preamble', 'The distilled rulings from resolved discussions. Never re-litigate an entry.'],
  ['a blank line', ''],
  ['an unparsed bullet', ODD],
  ['trailing prose', 'Older rulings live in git history.'],
]) {
  const r = applyDecisionEdit(LEDGER, { original: target, text: '- Decided: pwned (2026-08-19)' });
  check(`${name} refused`, r.ok === false && r.status === 400, r);
  const del = applyDecisionEdit(LEDGER, { original: target });
  check(`${name} cannot be deleted`, del.ok === false && del.status === 400, del);
}

// ---------- 4. the replacement must stay a ruling ----------
console.log('\n4. a save cannot turn a ruling into something else');
for (const [name, text] of [
  ['prose', 'threading is presentation only'],
  ['a bare bullet', '- threading is presentation only'],
  ['a heading', '## Decisions'],
  ['empty', '   '],
]) {
  const r = applyDecisionEdit(LEDGER, { original: DECIDED, text });
  check(`${name} refused`, r.ok === false && r.status === 400, r);
}
{
  const r = applyDecisionEdit(LEDGER, { original: DECIDED, text: '- Deferred: this axis — revisit when it bites (2026-08-19)' });
  check('a Decided ruling may become a Deferred one', r.ok === true && r.changed === true, r);
}

// ---------- 5. the ledger moving underneath the panel ----------
// The reason the payload is a line and not a whole file: an agent append between the
// panel's read and the user's save must not be clobbered, and a stale target must be
// refused rather than guessed at.
console.log('\n5. stale or ambiguous targets are refused, never guessed');
{
  const gone = applyDecisionEdit(LEDGER, { original: '- Decided: a ruling nobody recorded (2026-08-19)', text: '- Decided: x (2026-08-19)' });
  check('vanished ruling → 409', gone.ok === false && gone.status === 409, gone);

  const dupe = [LEDGER, DECIDED, ''].join('\n');
  const r = applyDecisionEdit(dupe, { original: DECIDED, text: '- Decided: y (2026-08-19)' });
  check('two identical rulings → 409, file untouched', r.ok === false && r.status === 409, r);

  // An append that lands between read and save rides through untouched.
  const appended = LEDGER + '- Decided: a ruling the agent added just now (2026-08-19)\n';
  const edited = applyDecisionEdit(appended, { original: DECIDED, text: '- Decided: z (2026-08-19)' });
  check('concurrent agent append survives the edit', edited.ok && edited.markdown.includes('a ruling the agent added just now'));
}

// ---------- 6. no-op saves stay off the wire ----------
console.log('\n6. a save that changes nothing is not a change');
{
  const r = applyDecisionEdit(LEDGER, { original: DECIDED, text: DECIDED });
  check('accepted', r.ok === true);
  check('reports changed:false', r.ok && r.changed === false, r);
  check('markdown identical', r.ok && r.markdown === LEDGER);
}

// ---------- 7. shape normalization (rule 6: untrusted input, survivable) ----------
console.log('\n7. malformed input fails survivably');
{
  const empty = applyDecisionEdit(LEDGER, { original: '   ' });
  check('blank target refused', empty.ok === false && empty.status === 400, empty);
  const noOriginal = applyDecisionEdit(LEDGER, {});
  check('missing original refused', noOriginal.ok === false && noOriginal.status === 400, noOriginal);
  const nonString = applyDecisionEdit(LEDGER, { original: 42 });
  check('non-string original refused', nonString.ok === false && nonString.status === 400, nonString);
  const emptyFile = applyDecisionEdit('', { original: DECIDED, text: DECIDED });
  check('empty ledger refused, no throw', emptyFile.ok === false && emptyFile.status === 409, emptyFile);

  // A pasted multi-line draft collapses to one line — the ledger's one-ruling-per-line
  // invariant is the point of the file, and the user's words all survive.
  const multi = applyDecisionEdit(LEDGER, {
    original: DECIDED,
    text: '- Decided: threading is presentation\n  over one linear conversation (2026-08-19)',
  });
  check('multi-line draft collapses to one line', multi.ok && lines(multi.markdown).length === lines(LEDGER).length, multi);
  check(
    'collapsed text keeps every word',
    multi.ok && multi.markdown.includes('- Decided: threading is presentation over one linear conversation (2026-08-19)'),
  );

  // Whitespace framing is the file's, not the user's, and is preserved.
  const crlf = LEDGER.split('\n').join('\r\n');
  const r = applyDecisionEdit(crlf, { original: DECIDED, text: '- Decided: crlf holds (2026-08-19)' });
  check('CRLF line endings preserved', r.ok && r.markdown.includes('- Decided: crlf holds (2026-08-19)\r\n'), r.ok && r.markdown.slice(0, 40));

  // Indentation likewise: a ruling the agent wrote indented is matched (the panel
  // renders trimmed text) and rewritten at the same indent.
  const indented = LEDGER.replace(DECIDED, `    ${DECIDED}`);
  const ind = applyDecisionEdit(indented, { original: DECIDED, text: '- Decided: indent holds (2026-08-19)' });
  check('indent preserved on rewrite', ind.ok && ind.markdown.includes('    - Decided: indent holds (2026-08-19)'), ind);
}

// ---------- 8. the grammar itself ----------
// Applied to TRIMMED lines by both sides, so these cases are stated trimmed.
console.log('\n8. ruling grammar — the two kinds, and only those');
check('- Decided: …', RULING_LINE.test(DECIDED) === true);
check('- Deferred: …', RULING_LINE.test(DEFERRED) === true);
check('- Decided with no body rejected', RULING_LINE.test('- Decided:') === false);
check('- decided (lowercase) rejected', RULING_LINE.test('- decided: x') === false);
check('a different bullet kind rejected', RULING_LINE.test('- Noted: x') === false);
check('prose mentioning Decided: rejected', RULING_LINE.test('We Decided: x') === false);

console.log(
  failures === 0 ? '\nDECISION LEDGER POLICY: all checks passed' : `\nDECISION LEDGER POLICY: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);

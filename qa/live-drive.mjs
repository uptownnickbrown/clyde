// Live QA: drive the real Clyde UI (scratch project, haiku session) via Playwright.
// Exercises: send → stream → tool chips → commit linking, thread flow (reply_in_thread
// live-fire), and the New-session action. Screenshots land in qa/screenshots/live-*.png.
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = '/Users/nbrown/Desktop/clyde/qa/screenshots';
const URL = 'http://localhost:4141/';
const log = (m) => console.log(`[live] ${m}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  log(`shot ${name}`);
};

try {
  await page.goto(URL);
  await page.waitForSelector('.composer textarea', { timeout: 15000 });
  await page.waitForTimeout(800);
  await shot('live-01-idle');

  // --- 1: send a real message, watch it stream ---
  await page.locator('.composer textarea').fill(
    'Read SCOPE.md, then create haiku.txt containing a haiku about conversation-centric IDEs, and commit it. Keep prose brief.',
  );
  await page.keyboard.press('Enter');
  log('message sent');
  await page.waitForSelector('.workbar.working', { timeout: 30000 });
  // catch a streaming frame if one appears
  try {
    await page.waitForSelector('.msg-assistant.live', { timeout: 60000 });
    await page.waitForTimeout(400);
  } catch {
    log('no streaming frame caught (turn may be tool-only so far)');
  }
  await shot('live-02-streaming');

  await page.waitForSelector('.workbar.idle', { timeout: 240000 });
  log('turn complete');
  await page.waitForTimeout(5000); // git watcher poll → commit event
  await shot('live-03-turn-complete');

  const commits = await page.locator('.divider.commit-divider').count();
  log(`commit dividers in document: ${commits}`);

  // --- 2: thread flow — select text in the last assistant message, start a thread ---
  const lastMsg = page.locator('.msg-assistant').last();
  await lastMsg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const para = lastMsg.locator('p, li').first();
  const box = await para.boundingBox();
  const y = box.y + 11;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 6, 320), y, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('.comment-fab', { timeout: 10000 });
  await page.locator('.comment-fab').click();
  await page.waitForSelector('.comment-box textarea', { timeout: 5000 });
  await page.locator('.comment-box textarea').fill('Hello? Quick thread check — reply briefly in this thread.');
  await page.keyboard.press('Enter');
  log('thread started');
  await page.waitForSelector('.thread-card .thread-assistant', { timeout: 240000 });
  log('thread reply received (reply_in_thread live-fire OK)');
  await page.waitForTimeout(400);
  await page.locator('.thread-card').last().scrollIntoViewIfNeeded();
  await shot('live-04-thread-reply');

  // --- 3: New session — fresh conversation, persistent project state ---
  await page.waitForSelector('.workbar.idle', { timeout: 240000 });
  await page.locator('.topbar-btn', { hasText: 'New session' }).click();
  await page.locator('.confirm-new button', { hasText: 'Start' }).click();
  log('new session requested');
  await page.waitForTimeout(4000);
  const msgs = await page.locator('.conversation-doc .msg').count();
  const status = await page.locator('.status').innerText();
  log(`after new session: messages=${msgs} status=${status.trim()}`);
  await shot('live-05-new-session');
  if (msgs > 0) throw new Error('new session still shows old conversation!');

  // --- 4: the fresh session is alive — one quick round-trip ---
  await page.locator('.composer textarea').fill('Say "fresh session confirmed" and nothing else.');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.msg-assistant', { timeout: 240000 });
  await page.waitForTimeout(500);
  await shot('live-06-fresh-turn');
  log('fresh session round-trip OK');

  // --- 5: AskUserQuestion round-trip — the blocking canUseTool path, live ---
  await page.waitForSelector('.workbar.idle', { timeout: 240000 });
  await page.locator('.composer textarea').fill(
    'Call the AskUserQuestion tool now with exactly one question: "Which mascot should the test suite adopt?" with options "Heron" and "Otter". After you receive my answer, reply with just the chosen mascot name.',
  );
  await page.keyboard.press('Enter');
  await page.waitForSelector('.question-card', { timeout: 240000 });
  log('question card rendered (canUseTool interception OK)');
  await page.waitForTimeout(300);
  await shot('live-07-question-card');
  await page.locator('.question-card .q-option', { hasText: 'Otter' }).click();
  await page.locator('.q-actions button.primary').click();
  log('answer submitted');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.msg-assistant')].some((m) => /otter/i.test(m.textContent ?? '')),
    { timeout: 240000 },
  );
  await page.waitForTimeout(300);
  await shot('live-08-question-answered');
  log('question round-trip OK — answer reached the model');

  // --- 6: model/effort switch — rotate the session in place, same conversation ---
  await page.waitForSelector('.workbar.idle', { timeout: 240000 });
  const chipBefore = (await page.locator('.model-chip').innerText()).trim();
  // Config persists across runs, so pick whichever effort is NOT current — the
  // switch must be a real rotation, never a dirty=false no-op that false-passes.
  const targetEffort = chipBefore.includes('· low') ? 'medium' : 'low';
  await page.locator('.model-chip').click();
  await page.waitForSelector('.model-pop');
  await page.locator('.effort-opt', { hasText: targetEffort }).first().click();
  await page.locator('.model-pop-actions button.primary').click();
  log(`effort switch applied (→ ${targetEffort})`);
  // The server rotates the session and re-broadcasts hello; the chip re-renders.
  await page.waitForFunction(
    (t) => document.querySelector('.model-chip')?.textContent?.includes(`· ${t}`),
    targetEffort,
    { timeout: 30000 },
  );
  const chipAfter = (await page.locator('.model-chip').innerText()).trim();
  log(`chip: "${chipBefore}" → "${chipAfter}"`);
  await shot('live-09-effort-switched');
  // The rotated session must still hold the conversation: recall the mascot answer
  // from section 5 (same SDK conversation — the new-session boundary was section 3).
  const msgsBefore = await page.locator('.msg-assistant').count();
  await page.locator('.composer textarea').fill(
    'From memory of this conversation only — which mascot did I pick for the test suite? One word.',
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.msg-assistant').length > n,
    msgsBefore,
    { timeout: 240000 },
  );
  await page.waitForTimeout(300);
  const recall = await page.locator('.msg-assistant').last().innerText();
  if (!/otter/i.test(recall)) throw new Error(`rotated session lost the conversation — recall answer: ${recall.slice(0, 120)}`);
  log('rotation kept the conversation (mascot recalled) — model/effort switch OK');
  await shot('live-10-rotated-recall');

  // --- 7: /btw aside — the read-only observer answers without touching the session ---
  await page.waitForSelector('.workbar.idle', { timeout: 240000 });
  const docMsgsBefore = await page.locator('.conversation-doc .msg').count();
  await page.locator('.aside-toggle').click();
  await page.locator('.composer textarea').fill(
    'Which file did you create in this project earlier today and what does it contain? One sentence.',
  );
  await page.keyboard.press('Enter');
  log('aside sent');
  await page.waitForSelector('.aside-card.running', { timeout: 15000 });
  await shot('live-11-aside-running');
  await page.waitForSelector('.aside-card:not(.running) .aside-answer', { timeout: 150000 });
  const asideChip = (await page.locator('.aside-chip').innerText()).trim();
  const asideText = (await page.locator('.aside-answer').innerText()).trim();
  if (!asideText) throw new Error('aside answered with empty text');
  log(`aside answered (${asideChip}): ${asideText.slice(0, 90)}…`);
  // Zero pollution: the conversation document gained nothing, the session stayed idle.
  const docMsgsAfter = await page.locator('.conversation-doc .msg').count();
  if (docMsgsAfter !== docMsgsBefore) throw new Error('aside leaked into the conversation document!');
  if (!(await page.locator('.workbar.idle').count())) throw new Error('aside changed session status!');
  await shot('live-12-aside-answered');
  log('aside round-trip OK — observer live-fire, zero context pollution');

  // --- 8: blocking exhibit — request_review holds the turn until the user rules ---
  await page.locator('.aside-card .aside-x').click(); // clear the card first
  await page.locator('.composer textarea').fill(
    'Call the request_review tool now with title "Haiku check", content kind "markdown" with source "haiku.txt", ' +
      'and detail "Approve if the haiku file looks right." After my verdict arrives, reply with exactly one line: ' +
      'VERDICT <the verdict> — <my comment verbatim>.',
  );
  await page.keyboard.press('Enter');
  log('exhibit requested');
  await page.waitForSelector('.exhibit-card', { timeout: 240000 });
  log('exhibit card rendered (request_review holds the turn)');
  await page.waitForTimeout(300);
  await shot('live-13-exhibit-pending');
  await page.locator('.exhibit-card .ex-comment').fill('ship it — verified live');
  await page.locator('.exhibit-card .q-actions button.primary').click();
  log('approved with comment');
  // The verdict payload must round-trip: the model echoes verdict AND comment.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.msg-assistant')].some(
        (m) => /VERDICT\s*approved/i.test(m.textContent ?? '') && /ship it/i.test(m.textContent ?? ''),
      ),
    { timeout: 240000 },
  );
  log('verdict + comment reached the model (blocking exhibit round-trip OK)');
  await page.waitForSelector('.ex-settled', { timeout: 30000 });
  await page.waitForTimeout(300);
  await shot('live-14-exhibit-settled');

  console.log('\nLIVE QA: all flows passed');
} finally {
  await browser.close();
}

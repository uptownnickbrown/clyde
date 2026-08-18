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

  console.log('\nLIVE QA: all flows passed');
} finally {
  await browser.close();
}

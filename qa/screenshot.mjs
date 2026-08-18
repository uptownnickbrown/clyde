// Playwright screenshot QA — captures every key UI state against the fixture
// server into qa/screenshots/. Run after building the web package:
//   npm run qa:screens
// Optionally also captures the live dev app (port 5173) as a dogfood shot.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFixtureServer } from './fixture-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'screenshots');
const PORT = 4123;

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));

const fixture = await startFixtureServer(PORT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
};

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.msg-assistant');
  await page.waitForTimeout(1200); // let the live delta finish streaming + gallery fetch settle

  // 1 — cold-open overview: conversation top, goal tab, rails populated
  await page.evaluate(() => document.querySelector('.conversation').scrollTo(0, 0));
  await shot('01-overview');

  // 2 — conversation tail: live streaming turn, composer with queued items
  await page.evaluate(() => {
    const c = document.querySelector('.conversation');
    c.scrollTo(0, c.scrollHeight);
  });
  await page.waitForTimeout(300);
  await shot('02-conversation-tail');

  // 2b — composer attachment chips: file via the (hidden) picker input + text alongside
  await page.setInputFiles('.composer input[type="file"]', path.join(HERE, 'fixtures/attachment-sample.png'));
  await page.waitForSelector('.attachment img');
  await page.locator('.composer textarea').fill('Here is the design reference — match the rail spacing to this.');
  await shot('02b-composer-attachment');
  await page.locator('.attachment-x').click();
  await page.locator('.composer textarea').fill('');

  // 3 — expanded activity chip in the flow
  await page.evaluate(() => document.querySelector('.conversation').scrollTo(0, 0));
  const chip = page.locator('.activity-chip > button').first();
  await chip.click();
  await shot('03-activity-chip-open');
  await chip.click();

  // 4 — span selection → comment FAB
  const para = page.locator('#msg-a2 .msg-assistant li').first();
  const box = await para.boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 10, 420), box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForSelector('.comment-fab');
  await shot('04-selection-fab');

  // 5 — comment box open with text
  await page.locator('.comment-fab').click();
  await page.waitForSelector('.comment-box textarea');
  await page.locator('.comment-box textarea').fill('Is the append actually fsynced? A crash between append and broadcast should not lose the turn.');
  await shot('05-comment-box');
  await page.locator('.comment-box .thread-actions button', { hasText: 'Cancel' }).click();

  // 6-8 — right-rail tabs
  await page.locator('.tabs button', { hasText: 'panels' }).click();
  await page.waitForTimeout(600); // gallery + metrics fetches
  await shot('06-panels-tab');

  await page.locator('.tabs button', { hasText: 'activity' }).click();
  await page.locator('.activity-panel .act').first().click(); // expand latest entry
  await shot('07-activity-tab');

  await page.locator('.tabs button', { hasText: 'context' }).click();
  await shot('08-context-tab');

  // 9 — expanded commit card in the git timeline
  await page.locator('.commits li').first().click();
  await page.waitForSelector('.commit-detail pre');
  await shot('09-commit-expanded');
  await page.locator('.commits li').first().click();

  // 10 — reviews tab with burn-down
  await page.locator('.tabs button', { hasText: 'reviews' }).click();
  await page.waitForTimeout(500);
  await shot('10-reviews-tab');

  // 10b — agents tab: one completed dispatch, one running with the delegated-task link
  await page.locator('.tabs button', { hasText: 'agents' }).click();
  await page.locator('.agents-panel .linklike').first().click(); // expand newest prompt
  await shot('10b-agents-tab');

  // 11 — logs tab
  await page.locator('.tabs button', { hasText: 'logs' }).click();
  await page.waitForTimeout(400);
  await shot('11-logs-tab');

  // 12 — goal tab scrolled to the bottom: SCOPE.md's risks table must render as a table (GFM)
  await page.locator('.tabs button', { hasText: 'goal' }).click();
  await page.evaluate(() => {
    const rail = document.querySelector('.right-rail');
    rail.scrollTo(0, rail.scrollHeight);
  });
  await page.waitForTimeout(300);
  await shot('12-goal-scope-table');

  // 13 — dogfood: the real dev app, if it is running (non-fatal if not)
  try {
    await page.goto('http://localhost:5173/', { timeout: 3000 });
    await page.waitForTimeout(1500);
    await shot('13-live-dogfood');
  } catch {
    console.log('  – live dev app not reachable, skipped dogfood shot');
  }

  console.log(`\ncaptured → ${path.relative(process.cwd(), OUT)}`);
} finally {
  await browser.close();
  await fixture.close();
}

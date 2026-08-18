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
/** Open a capability panel from the icon rail. */
const rail = (label) => page.locator(`.rail-btn[title="${label}"]`).click();

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.msg-assistant');
  await page.waitForTimeout(1200); // let the live delta finish streaming + gallery fetch settle

  // 1 — cold-open overview: conversation top, tasks panel, goal workbench
  await page.evaluate(() => document.querySelector('.conversation').scrollTo(0, 0));
  await shot('01-overview');

  // 1b — tasks panel with an item expanded + completed group opened
  await page.locator('.task').first().click();
  await page.locator('.group-toggle').click();
  await shot('01b-tasks-expanded');
  await page.locator('.task.open').click();
  await page.locator('.group-toggle').click();

  // 2 — conversation tail: live streaming turn, composer with queued items
  await page.evaluate(() => {
    const c = document.querySelector('.conversation');
    c.scrollTo({ top: c.scrollHeight, behavior: 'instant' });
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

  // 4 — span selection → thread FAB
  const para = page.locator('#msg-a2 .msg-assistant li').first();
  await para.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600); // smooth scroll must settle before measuring
  const box = await para.boundingBox();
  const selY = box.y + 11; // inside the first wrapped line — the line seam selects nothing
  await page.mouse.move(box.x + 4, selY);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 10, 420), selY, { steps: 10 });
  await page.mouse.up();
  await page.waitForSelector('.comment-fab');
  await shot('04-selection-fab');

  // 5 — thread-start box open with text
  await page.locator('.comment-fab').click();
  await page.waitForSelector('.comment-box textarea');
  await page.locator('.comment-box textarea').fill('Is the append actually fsynced? A crash between append and broadcast should not lose the turn.');
  await page.waitForTimeout(700); // the box smooth-scrolls itself to center
  await shot('05-comment-box');
  await page.locator('.comment-box .thread-actions button', { hasText: 'Cancel' }).click();

  // 4b — message-level thread: hover affordance on a USER message → quoteless box,
  // with the fixture's open message-level thread card visible beneath.
  const userMsg = page.locator('#msg-u2');
  await userMsg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600); // smooth scroll settles
  await userMsg.hover(); // reveal the ghost ⊕ Thread affordance
  await userMsg.locator('.thread-affordance').click();
  await page.waitForSelector('.comment-box textarea');
  await page
    .locator('.comment-box textarea')
    .fill('Threading on the whole message — no quote needed for this one.');
  await page.waitForTimeout(700); // the box smooth-scrolls itself to center
  await shot('04b-message-thread');
  await page.locator('.comment-box .thread-actions button', { hasText: 'Cancel' }).click();

  // 6 — right workbench: pushed panels (gallery + metrics)
  await page.locator('.wb-tabs button', { hasText: 'Panels' }).click();
  await page.waitForTimeout(600); // gallery + metrics fetches
  await shot('06-panels-tab');

  // 7-8 — capability panels: activity, context
  await rail('Activity');
  await page.locator('.activity-panel .act').first().click(); // expand latest entry
  await shot('07-activity-panel');

  await rail('Context');
  await shot('08-context-panel');

  // 9 — expanded commit card in the git timeline
  await rail('Git timeline');
  await page.locator('.commits li').first().click();
  await page.waitForSelector('.commit-detail pre');
  await shot('09-commit-expanded');
  await page.locator('.commits li').first().click();

  // 10 — reviews panel with burn-down
  await rail('Reviews');
  await page.waitForTimeout(500);
  await shot('10-reviews-panel');

  // 10b — agents panel: one completed dispatch, one running with the delegated-task link
  await rail('Agents');
  await page.locator('.agents-panel .linklike').first().click(); // expand newest prompt
  await shot('10b-agents-panel');

  // 10c — decisions ledger (parsed from .clyde/DECISIONS.md)
  await rail('Decisions');
  await page.waitForSelector('.decision-card');
  await shot('10c-decisions-panel');

  // 11 — logs panel
  await rail('Logs');
  await page.waitForTimeout(400);
  await shot('11-logs-panel');

  // 12 — goal tab scrolled to the bottom: SCOPE.md's risks table must render as a table (GFM)
  await page.locator('.wb-tabs button', { hasText: 'Goal' }).click();
  await page.evaluate(() => {
    const rail2 = document.querySelector('.right-panel .panel-scroll');
    rail2.scrollTo(0, rail2.scrollHeight);
  });
  await page.waitForTimeout(300);
  await shot('12-goal-scope-table');

  // 12b — collapsed chrome: left panel and workbench both closed, conversation full-bleed
  await rail('Logs'); // toggles the open logs panel closed
  await page.locator('.wb-tabs .wb-collapse').click();
  await page.waitForTimeout(200);
  await shot('12b-collapsed-chrome');
  await page.locator('.wb-expand').click();
  await rail('Tasks');

  // 12c — the question experience: fixture pushes a live AskUserQuestion; the
  // workbench auto-flips to the Questions tab with the amber attention treatment
  await page.evaluate(() => fetch('/fixture/ask'));
  await page.waitForSelector('.question-card');
  await page.waitForTimeout(500); // gauge/preview settle
  await shot('12c-question-card');

  // 12d — answer it: one option per question (incl. a multi-select), submit,
  // card collapses into the answered history
  await page.locator('.q-block').nth(0).locator('.q-option', { hasText: 'Comfortable' }).click();
  await page.locator('.q-block').nth(1).locator('.q-option', { hasText: 'All of them' }).click();
  await page.locator('.q-block').nth(1).locator('.q-option', { hasText: 'Decision-producing' }).click();
  await page.locator('.q-actions button.primary').click();
  await page.waitForSelector('.q-history');
  await page.waitForTimeout(300);
  await shot('12d-question-answered');

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

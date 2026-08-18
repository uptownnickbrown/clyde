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
const PORT = Number(process.env.QA_PORT ?? 4123); // override when runs happen in parallel

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

  // 1 — cold-open overview: conversation top, tasks panel, questions workbench
  // (the right rail is attention-only; Goal and Artifacts live in the left rail)
  await page.evaluate(() => document.querySelector('.conversation').scrollTo(0, 0));
  await shot('01-overview');

  // 1b — tasks panel with an item expanded + completed group opened
  await page.locator('.task').first().click();
  await page.locator('.group-toggle').click();
  await shot('01b-tasks-expanded');
  await page.locator('.task.open').click();
  await page.locator('.group-toggle').click();

  // 1c — task edit-in-place: the expanded card flips to the subject/detail/status form
  await page.locator('.task').first().click();
  await page.locator('.task-edit-btn').click();
  await page.waitForSelector('.task-edit');
  await shot('01c-task-edit');
  await page.locator('.task-edit-row button', { hasText: 'Cancel' }).click(); // discard the draft
  await page.locator('.task.open').click(); // collapse — later steps expect a closed panel

  // 2 — conversation tail: live streaming turn, composer with queued items
  await page.evaluate(() => {
    const c = document.querySelector('.conversation');
    c.scrollTo({ top: c.scrollHeight, behavior: 'instant' });
  });
  await page.waitForTimeout(300);
  await shot('02-conversation-tail');

  // 2c — model/effort picker popover open (chip opens even mid-turn; Apply waits for idle)
  await page.locator('.model-chip').click();
  await page.waitForSelector('.model-pop');
  await shot('02c-model-picker');
  await page.locator('.model-pop-backdrop').click();

  // 2d — review-intake mode armed: amber banner + placeholder, dump in progress
  await page.locator('.review-toggle').click();
  await page.waitForSelector('.review-banner');
  await page
    .locator('.composer textarea')
    .fill('The tasks panel needs drag-reorder; commit dividers should show the branch; and the context gauge is too subtle when it passes 80%.');
  await shot('02d-review-mode');
  await page.locator('.review-banner button').click();
  await page.locator('.composer textarea').fill('');

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

  // 6 — artifacts capability: the pushed-panel registry (gallery + metrics),
  // now a left-rail capability (name kept stable — same content intent)
  await rail('Artifacts');
  await page.waitForTimeout(600); // gallery + metrics fetches
  await shot('06-panels-tab');

  // 6b — goal panel in edit mode: full-height monospace editor with SCOPE.md
  // loaded, Save/Cancel beneath (Esc cancels)
  await rail('Goal');
  await page.locator('.goal-edit-btn').click();
  await page.waitForSelector('.goal-edit textarea');
  await shot('06b-goal-edit-mode');
  await page.keyboard.press('Escape'); // back to the rendered view

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

  // 10b2 — background-agent lifecycle: finished card with summary, worktree branch
  // chip, and the final report expanded
  await page.locator('.agents-panel .linklike').first().click(); // collapse the prompt again
  await page
    .locator('.agent-card', { hasText: 'Minimap' })
    .locator('.linklike', { hasText: 'show report' })
    .click();
  await shot('10b2-agents-background');

  // 10c — decisions ledger (parsed from .clyde/DECISIONS.md)
  await rail('Decisions');
  await page.waitForSelector('.decision-card');
  await shot('10c-decisions-panel');

  // 11 — logs panel
  await rail('Logs');
  await page.waitForTimeout(400);
  await shot('11-logs-panel');

  // 12 — goal capability scrolled to the bottom: SCOPE.md's risks table must render as a table (GFM)
  await rail('Goal');
  await page.evaluate(() => {
    const panel = document.querySelector('.left-panel .panel-scroll');
    panel.scrollTo(0, panel.scrollHeight);
  });
  await page.waitForTimeout(300);
  await shot('12-goal-scope-table');

  // 12b — collapsed chrome: left panel and workbench both closed, conversation full-bleed
  await rail('Goal'); // toggles the open goal panel closed
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

  // 20 — responsive layout pass (Design Vision §5, task #20). Breakpoints:
  // <1280 medium, <960 narrow (overlay drawers), <680 phone. The checks assert
  // the behavioral rules; the captures show them.

  // 20a — medium: one auxiliary surface at a time. Entering medium with both
  // surfaces open auto-collapses the workbench; opening either collapses the other.
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.waitForTimeout(300);
  await page.locator('.wb-expand').click(); // open the workbench → capability panel yields
  await page.waitForSelector('.right-panel');
  if (await page.locator('.left-panel').count())
    throw new Error('medium: capability panel should collapse when the workbench opens');
  await rail('Tasks'); // open the capability panel → workbench yields
  await page.waitForSelector('.left-panel');
  if (await page.locator('.right-panel').count())
    throw new Error('medium: workbench should collapse when the capability panel opens');
  await shot('20a-medium');

  // 20b — narrow: the capability panel is an overlay drawer over the full-width
  // conversation, scrim behind it.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(300); // entering narrow closes aux surfaces (conversation-first)
  if (await page.locator('.left-panel, .right-panel').count())
    throw new Error('narrow: aux surfaces should start closed');
  await rail('Tasks');
  await page.waitForSelector('.left-panel.drawer');
  await page.waitForSelector('.scrim');
  await page.waitForTimeout(250); // slide-in settles
  await shot('20b-narrow-drawer');

  // 20c — phone: drawers closed, conversation-first, condensed top bar
  // (no context gauge / cost readout).
  await page.locator('.scrim').click(); // scrim click closes the drawer
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  if (await page.locator('.left-panel, .right-panel').count())
    throw new Error('phone: drawers should be closed');
  if (await page.locator('.mini-gauge').isVisible())
    throw new Error('phone: context gauge should be hidden');
  await shot('20c-phone');

  // back to the standard viewport for the dogfood shot
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);

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

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
  // The popover (now three sections) can cover the backdrop's center — dismiss
  // from the corner instead of letting Playwright aim for the middle.
  await page.locator('.model-pop-backdrop').click({ position: { x: 5, y: 5 } });

  // 2d — review-intake mode armed: amber banner + placeholder, dump in progress
  await page.locator('.review-toggle').click();
  await page.waitForSelector('.review-banner');
  await page
    .locator('.composer textarea')
    .fill('The tasks panel needs drag-reorder; commit dividers should show the branch; and the context gauge is too subtle when it passes 80%.');
  await shot('02d-review-mode');
  await page.locator('.review-banner button').click();
  await page.locator('.composer textarea').fill('');

  // 28a — /btw armed: the aside toggle lit, its banner explaining that the
  // question never reaches Clyde, question typed and ready to ask.
  await page.locator('.aside-toggle').click();
  await page.waitForSelector('.aside-banner');
  const asideQuestion = 'Which tasks are still open, and has anything landed since the last commit?';
  await page.locator('.composer textarea').fill(asideQuestion);
  await shot('28a-btw-armed');

  // 28b — ask it: the composer disarms immediately and the card appears above
  // the composer in its running state ("observer reading the workspace…").
  await page.locator('.composer button.primary').click();
  await page.waitForSelector('.aside-card.running');
  if (await page.locator('.composer.aside-armed').count())
    throw new Error('/btw: submitting an aside should disarm the toggle');
  await page.waitForTimeout(250); // the card's entry animation settles
  await shot('28b-aside-running');

  // 28c — the answer lands: markdown body plus the model · duration · cost chip.
  // Aside cost is per-card and never joins the session gauge in the top bar.
  await page.waitForSelector('.aside-card:not(.running) .aside-answer');
  await page.waitForTimeout(200);
  await shot('28c-aside-card');

  // Behavioral assertion: an armed /btw submits an `aside` client message —
  // never a send_message, so the question cannot reach the agent or the queue.
  const sent = await page.evaluate(() => fetch('/fixture/client-messages').then((r) => r.json()));
  const asideMsg = sent.find((m) => m.type === 'aside');
  if (!asideMsg) throw new Error('/btw: submitting while armed must emit an `aside` client message');
  if (asideMsg.text !== asideQuestion || !asideMsg.asideId)
    throw new Error('/btw: the aside message must carry the question text and an asideId');
  if (sent.some((m) => m.type === 'send_message'))
    throw new Error('/btw: an aside must never be delivered to the agent as send_message');
  // The aside lives above the composer, not in the conversation document.
  if (await page.locator('.conversation .aside-card').count())
    throw new Error('/btw: aside cards must not render inside the conversation document');

  await page.locator('.aside-card .aside-x').click(); // dismiss — later captures start clean
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

  // 33a — the rich content kinds (#33): a model-AUTHORED html plot in its sandboxed
  // frame and an eval table rendered natively from JSON.
  await page.locator('.panel', { hasText: 'Training run' }).scrollIntoViewIfNeeded();
  await page.waitForSelector('.html-frame iframe');
  await page.waitForSelector('.data-table td');
  await page.waitForTimeout(700); // the page's own script draws the curves
  await shot('33a-artifacts-rich');

  // Behavioral assertion: the frame really executes the page's script (sandbox
  // "allow-scripts") — every mark in that plot is drawn by it, including this label.
  const minVal = await page.frameLocator('.html-frame iframe').locator('#min-val-label').textContent();
  if (!minVal?.includes('0.412'))
    throw new Error(`html panel: the sandboxed iframe must run the file's own script (got: ${minVal})`);
  const frameSandbox = await page.locator('.html-frame iframe').getAttribute('sandbox');
  if (frameSandbox !== 'allow-scripts')
    throw new Error(`html panel: agent-authored html must never get same-origin access (sandbox="${frameSandbox}")`);

  // Behavioral assertion: table cells really render, including a numeric cell the
  // normalizer coerced to text (the file mixes "78.9%" strings with a bare 78.4).
  const cells = await page.locator('.data-table td').allTextContents();
  if (!cells.includes('78.4') || !cells.includes('run-c-cosine+ema'))
    throw new Error(`table panel: cell text should render verbatim (got ${cells.length} cells)`);
  if ((await page.locator('.data-table th').count()) !== 6)
    throw new Error('table panel: all six declared columns should render as headers');

  // 33b — markdown artifact mid-edit: the #12 goal flow generalized to pushed
  // markdown (artifacts are reference the user may take a pen to; exhibits are not).
  const notes = page.locator('.panel', { hasText: 'Eval read-out' });
  await notes.scrollIntoViewIfNeeded();
  await notes.locator('.md-edit-btn').click();
  await page.waitForSelector('.md-edit textarea');
  const PEN = '\n**My call:** re-run the candidate with EMA disabled at inference — 15ms is too much for +0.3pt.\n';
  await page.locator('.md-edit textarea').fill((await page.locator('.md-edit textarea').inputValue()) + PEN);
  await shot('33b-markdown-edit');

  // Behavioral assertion: Save really POSTs /api/project-file with the edited body
  // (the fixture server records writes the way it records client messages), and the
  // panel re-reads the file so what renders is what was written.
  await page.locator('.md-edit-actions button.primary').click();
  await page.waitForSelector('.md-edit', { state: 'detached' });
  const writes = await page.evaluate(() => fetch('/fixture/file-writes').then((r) => r.json()));
  const write = writes.find((w) => w.path === 'qa/fixtures/eval-notes.md');
  if (!write) throw new Error('markdown artifact: Save must POST /api/project-file for the edited path');
  if (!write.text.includes('**My call:** re-run the candidate'))
    throw new Error('markdown artifact: the POST body must carry the edited text');
  if (!(await notes.textContent())?.includes('My call: re-run the candidate'))
    throw new Error('markdown artifact: the panel should re-read the file after saving');
  await page.waitForTimeout(200);
  await shot('33b2-markdown-saved');

  // Behavioral assertion: agent-written files are untrusted input — a table file
  // that is not a table renders an honest empty state instead of taking the panel
  // (or, in an exhibit, the surface the agent is blocked on) down with it.
  const TABLE = 'qa/fixtures/eval-table.json';
  const good = await page.evaluate(
    (p) => fetch(`/api/project-file?path=${p}`).then((r) => r.text()),
    TABLE,
  );
  const put = (p, body) => page.evaluate(([q, b]) => fetch(`/api/project-file?path=${q}`, { method: 'POST', body: b }), [p, body]);
  await put(TABLE, '{"note":"the model wrote prose where a table was expected"}');
  await rail('Tasks'); // remount the artifact panels against the garbage file
  await rail('Artifacts');
  const sweep = page.locator('.panel', { hasText: 'Eval sweep' });
  await sweep.locator('.empty').waitFor();
  if ((await page.locator('.data-table').count()) !== 0)
    throw new Error('table panel: unusable JSON must not render as a table');
  await put(TABLE, good); // restore for the rest of the run

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

  // 33c — task → commit provenance (#33): a closed task carries the sha that closed
  // it; the chip on the expanded card is a real jump into the Git timeline.
  await rail('Tasks');
  await page.locator('.group-toggle').click(); // reveal the completed group
  await page.locator('.task', { hasText: 'Wire protocol' }).click();
  await page.waitForSelector('.task-commit');
  await shot('33c-task-commit-chip');

  await page.locator('.task-commit').click();
  await page.waitForSelector('#commit-c5fcbbe41d2a .commit-detail pre');
  if (!(await page.locator('.rail-btn[title="Git timeline"]').getAttribute('class'))?.includes('active'))
    throw new Error('commit chip: clicking it should switch the left rail to the Git timeline');
  await page.waitForTimeout(400); // scroll-into-view settles
  await shot('33d-commit-jump');

  // 10 — reviews panel with burn-down
  await rail('Reviews');
  await page.waitForTimeout(500);
  await shot('10-reviews-panel');

  // 10c — raw-dump resolution (#39): this batch's dump exists on neither its
  // source.review path nor .clyde/reviews/<batch>.md, so the click must yield the
  // honest missing-state note — never the server's 404 body rendered as markdown.
  await page.locator('.batch-card .linklike').first().click();
  await page.waitForSelector('.batch-card .review-legacy-note');
  const dumpNote = await page.locator('.batch-card .review-legacy-note').textContent();
  if (!dumpNote?.includes('not on disk'))
    throw new Error(`raw-dump missing state: expected the honest note, got "${dumpNote}"`);
  await shot('10d-reviews-raw-dump-missing');
  await page.locator('.batch-card .linklike').first().click(); // collapse again

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

  // 26a — blocking exhibit: the fixture pushes a live request_review; the workbench
  // auto-flips to the Exhibits tab, the card shows the evidence itself (a gallery of
  // the captures taken so far), the task it gates, and Approve / Decline. The
  // declined-with-comment exhibit sits beneath it as the ruled-on record.
  await page.evaluate(() => fetch('/fixture/exhibit'));
  await page.waitForSelector('.exhibit-card');
  if (!(await page.locator('.wb-tabs button', { hasText: 'Exhibits' }).getAttribute('class'))?.includes('active'))
    throw new Error('exhibits: a pending exhibit should flip the workbench to the Exhibits tab');
  await page.waitForTimeout(700); // gallery fetch + images decode
  await page.locator('.ex-comment').fill('Column measure and chip alignment hold; phone top bar is right.');
  await shot('26a-exhibit-pending');

  // 26b — rule on it: Approve sends exhibit_response (the fixture server only echoes
  // exhibit_settled if the client really sent it), and the card collapses to the
  // compact outcome row with the comment.
  await page.locator('.exhibit-card .q-actions button.primary').click();
  await page.waitForSelector('.ex-settled.ex-approved');
  if (await page.locator('.exhibit-card').count())
    throw new Error('exhibits: the settled exhibit should collapse out of the pending card');
  if (await page.locator('.wb-tabs .wb-attn').count())
    throw new Error('exhibits: the attention badge should clear once nothing is pending');
  await page.waitForTimeout(200);
  await shot('26b-exhibit-settled');

  // 33e — evidence the model AUTHORED, on the attention surface: an html exhibit
  // whose page draws its own plot, framed with the ask it wants ruled on.
  await page.evaluate(() => fetch('/fixture/exhibit-html'));
  await page.waitForSelector('.exhibit-card .html-frame iframe');
  await page.waitForTimeout(700); // the plot draws itself
  await shot('33e-exhibit-html');
  await page.locator('.exhibit-card .q-actions button.primary').click(); // leave the surface clean
  await page.waitForFunction(() => document.querySelectorAll('.exhibit-card').length === 0);

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

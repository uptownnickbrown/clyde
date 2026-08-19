// Regenerates the five committed README screenshots (docs/screenshots/) from the
// fixture server, so the doc images can never silently drift from the shipped UI
// again (critic finding, task #37). Run after building the web package:
//   npm run docs:shots
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFixtureServer } from './fixture-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'docs', 'screenshots');
const PORT = Number(process.env.QA_PORT ?? 4321);

fs.mkdirSync(OUT, { recursive: true });
const fixture = await startFixtureServer(PORT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ docs/screenshots/${name}.png`);
};
const rail = (label) => page.locator(`.rail-btn[title="${label}"]`).click();

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.msg-assistant');
  await page.waitForTimeout(1200);

  // workspace — the hero: conversation top, tasks panel, attention workbench
  await page.evaluate(() => document.querySelector('.conversation').scrollTo(0, 0));
  await shot('workspace');

  // tasks — first task expanded + completed group open
  await page.locator('.task').first().click();
  await page.locator('.group-toggle').click();
  await shot('tasks');
  await page.locator('.task.open').click();
  await page.locator('.group-toggle').click();

  // threads — the span-anchored thread card (fixture th1: quoted excerpt + replies)
  const card = page.locator('.thread-card').first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600); // smooth scroll settles
  await shot('threads');

  // qa-panels — Artifacts rail: gallery + metrics + authored html/table evidence
  await rail('Artifacts');
  await page.waitForTimeout(700); // gallery + metrics fetches, plot draws itself
  await shot('qa-panels');

  // decisions — the ledger as cards
  await rail('Decisions');
  await page.waitForSelector('.decision-card');
  await shot('decisions');
} finally {
  await browser.close();
  await fixture.close();
}

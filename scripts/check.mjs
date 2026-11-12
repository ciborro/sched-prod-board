// Checks the plan's flows and hooks on a deployed board, the way a viewer meets them.
//   node scripts/check.mjs [url]   (from s03e04/board; default http://127.0.0.1:8796/)
// Does not ack: acks are made only in a recording.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:8796/';
const browser = await chromium.launch();
const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass, detail });

// open-board, loader, build, list order.
{
  const page = await browser.newPage();
  let sawLoader = false;
  page.on('domcontentloaded', async () => {
    sawLoader = await page.locator('[data-testid="loader"]').isVisible().catch(() => false);
  });
  await page.goto(url);
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  ok('R3 loader shown on open', sawLoader);
  ok('R3 loader gone once incidents load', (await page.locator('[data-testid="loader"]').count()) === 0);
  const meta = await page.locator('meta[name="build"]').getAttribute('content');
  const foot = await page.locator('[data-testid="build-sha"]').textContent();
  ok('R6 build sha in meta and footer', /^[0-9a-f]{40}$/.test(meta) && meta === foot, meta);
  const times = await page.locator('[data-testid="incident-row"] time').evaluateAll((ts) => ts.map((t) => t.dateTime));
  ok('R1 newest first', times.every((t, i) => i === 0 || Date.parse(times[i - 1]) >= Date.parse(t)), `${times.length} rows`);
  ok('R2 Ack button per row', (await page.locator('[data-testid="incident-row"]').count()) === (await page.locator('[data-testid="ack"]').count()));

  // watch-board: a new incident appears at the top without a reload, the old rows stay the same nodes.
  const topBefore = await page.locator('[data-testid="incident-row"]').first().getAttribute('data-id');
  await page.evaluate(() => (window.__mark = document.querySelector('[data-testid="incident-row"]')));
  const t0 = Date.now();
  await page.waitForFunction(
    (id) => document.querySelector('[data-testid="incident-row"]').dataset.id !== id,
    topBefore,
    { timeout: 30000 },
  );
  const topAfter = await page.locator('[data-testid="incident-row"]').first().getAttribute('data-id');
  const same = await page.evaluate(() => document.contains(window.__mark));
  ok('R1/R4 new incident on top without reload', topAfter !== topBefore, `${topBefore} -> ${topAfter} after ${Date.now() - t0} ms`);
  ok('R4 existing rows kept (not rebuilt)', same);
  await page.close();
}

// R5: each viewer sees their own zone in their own order; the full UTC value stays in <time datetime>.
for (const [locale, timezoneId] of [
  ['en-NZ', 'Pacific/Auckland'],
  ['de-DE', 'Europe/Berlin'],
  ['en-US', 'America/New_York'],
]) {
  const ctx = await browser.newContext({ locale, timezoneId });
  const page = await ctx.newPage();
  await page.goto(url);
  const t = page.locator('[data-testid="incident-row"] time').first();
  await t.waitFor();
  const [iso, shown] = [await t.getAttribute('datetime'), await t.textContent()];
  const expected = new Intl.DateTimeFormat(locale, { timeZone: timezoneId, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  ok(`R5 ${locale} ${timezoneId}`, shown === expected && /Z$/.test(iso), `${iso} -> ${shown}`);
  await ctx.close();
}

await browser.close();
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);

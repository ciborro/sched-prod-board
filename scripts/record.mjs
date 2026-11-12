// Records the board in use, as on-call meets it: open-board, watch-board, two acks with a visible pointer.
//   node scripts/record.mjs <url> <out-dir>   (from s03e04/board)
// Writes <out-dir>/raw.webm and <out-dir>/events.json (times as mm:ss from the start of the video).
// The ack replies (with receipts) go to <out-dir>/acks.json; keep that directory outside the repo.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const [url, out] = process.argv.slice(2);
if (!url || !out) throw new Error('usage: record.mjs <url> <out-dir>');
mkdirSync(out, { recursive: true });

const size = { width: 1280, height: 900 };
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  locale: 'en-GB',
  timezoneId: 'Europe/Warsaw',
  recordVideo: { dir: out, size },
});
const page = await context.newPage();
const t0 = Date.now(); // the video starts with the page
const at = (t = Date.now()) => {
  const s = Math.max(0, Math.floor((t - t0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const events = [];
const log = (what, extra = {}) => {
  const e = { at: at(), ms: Date.now() - t0, what, ...extra };
  events.push(e);
  console.log(e.at, what, JSON.stringify(extra));
};
const acks = [];
page.on('response', async (res) => {
  if (new URL(res.url()).pathname.endsWith('/ack')) {
    const body = await res.json().catch(() => null);
    acks.push({ ms: Date.now() - t0, at: at(), status: res.status(), body });
    log('ack reply', { id: body?.id, ackedAt: body?.ackedAt });
  }
});

// A visible pointer and a caption, added by the recorder only (not part of the board).
async function overlay() {
  await page.evaluate(() => {
    // Popovers, so they can be raised above a modal confirm (both live in the top layer).
    const p = document.createElement('div');
    p.id = '__pointer';
    p.popover = 'manual';
    p.style.cssText =
      'position:fixed;inset:auto;z-index:9999;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;padding:0;border-radius:50%;' +
      'background:rgba(220,0,60,.35);border:2px solid #d0003c;pointer-events:none;transition:left .6s,top .6s;overflow:visible';
    const c = document.createElement('div');
    c.id = '__caption';
    c.popover = 'manual';
    c.style.cssText =
      'position:fixed;inset:auto;z-index:9999;right:16px;top:12px;max-width:520px;margin:0;padding:8px 12px;border:0;border-radius:6px;' +
      'background:#1d1d1f;color:#fff;font:14px/1.35 system-ui;pointer-events:none';
    c.textContent = 'recorder note';
    document.body.append(p, c);
    p.showPopover();
    c.showPopover();
    addEventListener('mousemove', (e) => Object.assign(p.style, { left: `${e.clientX}px`, top: `${e.clientY}px` }));
    addEventListener('mousedown', () => (p.style.background = 'rgba(220,0,60,.9)'));
    addEventListener('mouseup', () => (p.style.background = 'rgba(220,0,60,.35)'));
  });
}
const raiseOverlay = () =>
  page.evaluate(() => {
    for (const id of ['__pointer', '__caption']) {
      const n = document.getElementById(id);
      n.hidePopover();
      n.showPopover();
    }
  });
const caption = (text) => page.evaluate((t) => (document.getElementById('__caption').textContent = `recorder note · ${t}`), text);
const pause = (ms) => page.waitForTimeout(ms);
const topId = () => page.locator('[data-testid="incident-row"]').first().getAttribute('data-id');
const rowIds = () => page.locator('[data-testid="incident-row"]').evaluateAll((rs) => rs.map((r) => r.dataset.id));
const waitNewTop = async (id, timeout = 30000) => {
  await page.waitForFunction((x) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== x, id, { timeout, polling: 50 });
  return topId();
};
async function aim(id) {
  const box = await page.locator(`[data-testid="incident-row"][data-id="${id}"] [data-testid="ack"]`).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 12 });
  return { x, y };
}
const underPointer = ({ x, y }) =>
  page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="incident-row"]')?.dataset.id ?? null, [x, y]);
async function moveTo(locator) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 10 });
  return { x, y };
}
// After a click on Ack: if the board asks to confirm, read it like a person. It names the intended
// incident -> Ack; another one -> Cancel, then pick the intended row again. Returns the acked id.
async function settle(intended, label) {
  const confirm = page.locator('[data-testid="confirm"]');
  const before = acks.length;
  for (let tries = 0; tries < 3; tries++) {
    const asked = await confirm.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false);
    if (!asked) break;
    await raiseOverlay();
    const text = (await confirm.innerText()).trim().split('\n')[0];
    const names = /INC-\d+/.exec(text)?.[0];
    log(`${label}: confirm shown`, { names, intended, text });
    await caption(`confirm names ${names}; on-call meant ${intended}`);
    await pause(1800); // reading it
    if (names === intended) {
      const q = await moveTo(page.locator('[data-testid="confirm-ack"]'));
      log(`${label}: confirm-ack`, { names });
      await page.mouse.click(q.x, q.y);
      break;
    }
    const q = await moveTo(page.locator('[data-testid="confirm-cancel"]'));
    log(`${label}: confirm-cancel`, { names });
    await page.mouse.click(q.x, q.y);
    await caption(`cancelled ${names}; picking ${intended} again`);
    await pause(800);
    const r = await aim(intended);
    await pause(500);
    log(`${label}: click again`, { intended, underPointer: await underPointer(r) });
    await page.mouse.click(r.x, r.y);
  }
  for (let waited = 0; acks.length === before && waited < 5000; waited += 100) await pause(100);
  const got = acks[before]?.body?.id ?? null;
  if (got) await page.locator(`[data-testid="incident-row"][data-id="${got}"] [data-testid="acked"]`).waitFor();
  return got;
}

// open-board
await page.goto('about:blank');
await pause(1000);
log('open-board: navigate', { url });
await page.goto(url, { waitUntil: 'commit' });
await page.locator('[data-testid="loader"]').waitFor({ state: 'attached' }).catch(() => {});
log('loader on screen', { visible: await page.locator('[data-testid="loader"]').isVisible().catch(() => false) });
await page.locator('[data-testid="incident-row"]').first().waitFor();
log('incidents on screen', { rows: await rowIds() });
await overlay();
const sha = await page.locator('[data-testid="build-sha"]').textContent();
await caption(`build ${sha.slice(0, 12)} in the footer`);
await page.mouse.move(640, 880, { steps: 5 });
await page.locator('[data-testid="build-sha"]').hover();
log('build sha shown', { sha });
await pause(3000);

// watch-board
await caption('watch-board: board stays open, no reload');
await page.mouse.move(1200, 120, { steps: 8 });
let top = await topId();
log('watch-board: waiting', { top });
top = await waitNewTop(top);
log('watch-board: new incident on top', { top, rows: await rowIds() });
await pause(2500);

// ack-incident 1: right after an arrival, the board holds still long enough.
await caption('ack-incident: on-call takes the newest incident');
const first = top;
await pause(800);
let p = await aim(first);
log('ack 1: pointer on Ack', { intended: first, underPointer: await underPointer(p) });
await pause(700);
log('ack 1: click', { intended: first, underPointer: await underPointer(p) });
await page.mouse.click(p.x, p.y);
await settle(first, 'ack 1');
await page.locator(`[data-testid="incident-row"][data-id="${first}"] [data-testid="acked"]`).waitFor();
log('ack 1: acked mark shown', { row: first });
await caption(`acked ${first}`);
await pause(2500);

// ack-incident 2: on-call aims at the next one to take; the board refreshes before the click.
// Target the 4th row: when a new row lands on top, the slot under the pointer then holds the 3rd row.
const ids = await rowIds();
const target = ids[3];
await caption(`ack-incident: on-call aims at ${target}`);
p = await aim(target);
log('ack 2: pointer on Ack', { intended: target, underPointer: await underPointer(p) });
const beforeShift = await topId();
const newTop = await waitNewTop(beforeShift);
log('ack 2: refresh inserted a row while the pointer rested', { newTop, underPointer: await underPointer(p) });
await pause(400); // human reaction: the click was already on its way
const hit = await underPointer(p);
log('ack 2: click', { intended: target, underPointer: hit });
await page.mouse.click(p.x, p.y);
const got = await settle(target, 'ack 2');
log('ack 2: acked mark shown', { row: got, intended: target });
await caption(got === target ? `aimed at ${target}, acked ${target}` : `aimed at ${target}, acked ${got}: a new row pushed the list down`);
await page.mouse.move(1200, 120, { steps: 8 });
await pause(5000);

// watch-board after the acks: marks survive the 2-s refreshes.
await caption('watch-board: acked marks stay through refreshes');
await waitNewTop(await topId());
log('watch-board: another arrival', { rows: await rowIds() });
await pause(4000);
const ackedRows = await page.locator('[data-testid="acked"]').evaluateAll((m) => m.map((x) => x.closest('[data-testid="incident-row"]').dataset.id));
log('end', { ackedRows });

const video = page.video();
await context.close();
await browser.close();
renameSync(await video.path(), join(out, 'raw.webm'));
writeFileSync(join(out, 'events.json'), JSON.stringify({ url, sha, events }, null, 2));
writeFileSync(join(out, 'acks.json'), JSON.stringify(acks, null, 2));
console.log('wrote', join(out, 'raw.webm'));

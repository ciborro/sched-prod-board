import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const failure = document.querySelector('.failure');
const confirm = document.querySelector('[data-testid="confirm"]');
const confirmText = confirm.querySelector('.confirm-text');
const confirmAck = confirm.querySelector('[data-testid="confirm-ack"]');
const confirmCancel = confirm.querySelector('[data-testid="confirm-cancel"]');

const incidents = new Map(); // id -> incident, every incident seen tonight
const rows = new Map(); // id -> <li>
const acked = new Map(); // id -> ackedAt, survives every refresh

// R5: the viewer's own zone and the order of their locale (en-GB, de-DE, en-NZ: day first).
const timeFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function markAcked(row, ackedAt) {
  row.querySelector('[data-testid="ack"]')?.remove();
  if (row.querySelector('[data-testid="acked"]')) return;
  const mark = el('span', { 'data-testid': 'acked', class: 'acked' }, 'acked');
  if (ackedAt) mark.title = `acked ${timeFormat.format(new Date(ackedAt))}`;
  row.querySelector('.action').append(mark);
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
  );
  const time = el('time', { datetime: i.openedAt, title: i.openedAt }, timeFormat.format(new Date(i.openedAt)));
  const action = el('span', { class: 'action' });
  row.append(time, action);
  if (acked.has(i.id)) {
    markAcked(row, acked.get(i.id));
  } else {
    const button = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
    button.addEventListener('click', () => askToAck(i, row, button));
    action.append(button);
  }
  return row;
}

// R2 + product's decision (2026-11-12): Ack asks to confirm, and the confirm names the incident it acks.
// The incident is bound when the button is clicked, so the confirm shows the row the click really hit.
let pending = null; // { incident, row, button }
function askToAck(incident, row, button) {
  if (acked.has(incident.id) || confirm.open) return;
  pending = { incident, row, button };
  confirmText.textContent = `Ack ${incident.id}? ${incident.severity} · ${incident.service} · ${incident.region} · ${incident.summary}`;
  confirmAck.textContent = `Ack ${incident.id}`;
  confirm.showModal();
  confirmCancel.focus();
}
confirmAck.addEventListener('click', () => {
  const p = pending;
  pending = null;
  confirm.close();
  if (p) onAck(p.incident.id, p.row, p.button);
});
confirmCancel.addEventListener('click', () => confirm.close());
confirm.addEventListener('close', () => (pending = null));

async function onAck(id, row, button) {
  button.disabled = true;
  try {
    const reply = await ack(id);
    acked.set(id, reply.ackedAt);
    markAcked(row, reply.ackedAt);
  } catch (err) {
    button.disabled = false;
    showFailure(err);
  }
}

function showFailure(err) {
  console.error(err);
  failure.textContent = `Could not reach the incident API: ${err.message}. Retrying.`;
  failure.hidden = false;
}

// R1: newest first; rows already on screen are kept, new ones are added in their place (new at the top).
function render() {
  const sorted = [...incidents.values()].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  let before = list.firstElementChild;
  for (const i of sorted) {
    let row = rows.get(i.id);
    if (!row) {
      row = buildRow(i);
      rows.set(i.id, row);
    }
    if (row !== before) list.insertBefore(row, before);
    before = row.nextElementSibling;
  }
  empty.hidden = sorted.length > 0;
}

async function refresh() {
  const page = await fetchIncidents();
  for (const i of page.incidents) {
    const known = incidents.get(i.id);
    // Keep the first openedAt we saw so a row never jumps on a refresh.
    incidents.set(i.id, known ? { ...i, openedAt: known.openedAt } : i);
  }
  failure.hidden = true;
  render();
}

// R3: the loader shows until the first answer is on screen.
async function start() {
  try {
    await refresh();
  } catch (err) {
    showFailure(err);
  }
  loader.remove();
  list.hidden = false;
  board.setAttribute('aria-busy', 'false');
  // R4: refresh every 2 s while the board is open; never two requests at once.
  const tick = async () => {
    try {
      await refresh();
    } catch (err) {
      showFailure(err);
    }
    setTimeout(tick, REFRESH_MS);
  };
  setTimeout(tick, REFRESH_MS);
}

start();

import { CONFIG } from './config.js';
import { QUESTIONS } from './questions.js';
import { el, $, store, shuffle, fmtPin, ordinal } from './util.js';
import { detectMode, openHost } from './transport.js';
import { qrSvg } from './qr.js';
import { confetti } from './confetti.js';

const SNAP_KEY = 'bq.host.v1';
const SNAP_MAX_AGE = 12 * 3600 * 1000;
const LETTERS = ['A', 'B', 'C', 'D'];
const N = QUESTIONS.length;

const params = new URLSearchParams(location.search);
const OVERRIDE_SECS = Number(params.get('secs')) > 0 ? Number(params.get('secs')) : 0;
const secsFor = (i) => OVERRIDE_SECS || QUESTIONS[i].seconds || CONFIG.SECONDS_PER_QUESTION;

let G = null;          // game state (saved in this browser so a reload can resume)
let link = null;       // connection to the players
let mode = 'relay';
let view = null;       // current screen {node, controls, update, tick}
let online = true;

const stage = $('#stage');
const ctl = $('#ctl');
const topinfo = $('#topinfo');
const statusEl = $('#status');

/* ------------------------------------------------------------------ helpers */

function joinUrl(pin) {
  const u = new URL('./', document.baseURI);
  u.search = '?pin=' + pin;
  return u;
}
function displayUrl(u) {
  return u.host + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
}
const playersList = () => G.order.map((pid) => G.players[pid]).filter(Boolean);
const connectedList = () => playersList().filter((p) => p.connected);
const answeredCount = () => connectedList().filter((p) => p.answers[G.i]).length;
// A phone that just dropped keeps counting for a few seconds, so a brief signal loss
// does not make the host skip ahead without it.
const LEAVE_GRACE = 5000;
const RESUME_GRACE = 12000;
const waitingFor = (p) => p.connected || (p.grace > Date.now());
const allAnswered = () => { const c = playersList().filter(waitingFor); return c.length > 0 && c.every((p) => p.answers[G.i]); };

let revealTimer = 0;
function checkAutoReveal() {
  if (!G || G.phase !== 'question' || revealTimer || !allAnswered()) return;
  const qi = G.i;
  revealTimer = setTimeout(() => {
    revealTimer = 0;
    if (G && G.phase === 'question' && G.i === qi && allAnswered()) toReveal();
  }, 700);
}

function rankInfo() {
  const list = playersList().slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const rank = {};
  list.forEach((p, idx) => {
    rank[p.pid] = idx > 0 && list[idx - 1].score === p.score ? rank[list[idx - 1].pid] : idx + 1;
  });
  return { list, rank };
}

function cleanName(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, CONFIG.MAX_NAME).join('');
}
function uniqueName(base, pid) {
  const name = base || 'Executive';
  const taken = (n) => playersList().some((p) => p.pid !== pid && p.name.toLowerCase() === n.toLowerCase());
  let cand = name;
  let k = 2;
  while (taken(cand)) {
    cand = Array.from(name).slice(0, Math.max(1, CONFIG.MAX_NAME - String(k).length - 1)).join('') + ' ' + k;
    k += 1;
  }
  return cand;
}

function freshGame(pin, key) {
  return {
    v: 1, pin, key, mode, round: 1, phase: 'lobby', i: -1, perm: [],
    readyUntil: 0, startedAt: 0, endsAt: 0,
    players: {}, order: [], banned: [], updated: Date.now(),
  };
}
function save() { if (G) { G.updated = Date.now(); store.set(SNAP_KEY, G); } }

/* ------------------------------------------------------------------ messages from players */

function onMessage(pid, d) {
  if (!G || !d || typeof d !== 'object') return;
  if (G.banned.includes(pid)) { link.send(pid, { t: 'kick' }); return; }
  if (d.t === 'hello') return onHello(pid, d);
  const p = G.players[pid];
  if (!p) return;
  if (d.t === 'a') onAnswer(p, d);
}

function onHello(pid, d) {
  let p = G.players[pid];
  if (!p) {
    p = G.players[pid] = {
      pid, name: uniqueName(cleanName(d.name) || 'Executive', pid), score: 0,
      answers: {}, connected: true, last: null, joined: Date.now(),
    };
    G.order.push(pid);
  } else {
    p.connected = true;
  }
  save();
  sendState(pid);
  changed();
  pingLobby();
}

function onAnswer(p, d) {
  if (G.phase !== 'question' || d.i !== G.i) return;
  const existing = p.answers[G.i];
  if (existing) { link.send(p.pid, { t: 'ack', i: G.i, d: existing.d }); return; }
  const now = Date.now();
  if (now > G.endsAt + 1500) return;
  const Q = QUESTIONS[G.i];
  const dd = Number(d.d);
  if (!Number.isInteger(dd) || dd < 0 || dd >= Q.options.length) return;
  const total = secsFor(G.i) * 1000;
  const ms = Math.min(total, Math.max(0, now - G.startedAt));
  const ok = G.perm[dd] === Q.correct;
  p.answers[G.i] = { d: dd, ms, ok, pts: ok ? Math.round(1000 * (1 - ms / total / 2)) : 0 };
  save();
  link.send(p.pid, { t: 'ack', i: G.i, d: dd });
  changed();
  checkAutoReveal();
}

function onLeft(pid) {
  const p = G && G.players[pid];
  if (p) { p.connected = false; p.grace = Date.now() + LEAVE_GRACE; save(); changed(); pingLobby(); }
}

function onAttached(pids) {
  if (!G) return;
  const set = new Set(pids);
  for (const p of playersList()) p.connected = set.has(p.pid);
  changed();
}

function onStatus(s) {
  online = s === 'online';
  updateStatus();
}

/* ------------------------------------------------------------------ messages to players */

function stateFor(p) {
  const count = G.order.length;
  const base = { t: 's', ph: G.phase, i: G.i, of: N, name: p.name, score: p.score };
  const Q = G.i >= 0 ? QUESTIONS[G.i] : null;
  switch (G.phase) {
    case 'lobby':
      return Object.assign(base, { n: count });
    case 'ready':
      return Object.assign(base, { topic: Q.topic, left: Math.max(0, G.readyUntil - Date.now()) });
    case 'question': {
      const a = p.answers[G.i];
      return Object.assign(base, {
        topic: Q.topic, text: Q.scenario, opts: G.perm.map((k) => Q.options[k]),
        total: secsFor(G.i) * 1000, left: Math.max(0, G.endsAt - Date.now()), mine: a ? a.d : null,
      });
    }
    case 'reveal': {
      const a = p.answers[G.i];
      const { rank } = rankInfo();
      return Object.assign(base, {
        topic: Q.topic, opts: G.perm.map((k) => Q.options[k]), correct: G.perm.indexOf(Q.correct),
        mine: a ? a.d : null, ok: !!(a && a.ok), gained: a && a.ok ? a.pts : 0, why: Q.why, rank: rank[p.pid], n: count,
      });
    }
    case 'final': {
      const { list, rank } = rankInfo();
      return Object.assign(base, { rank: rank[p.pid], n: count, top: list.slice(0, 3).map((x) => ({ name: x.name, score: x.score })) });
    }
    default:
      return base;
  }
}
function sendState(pid) {
  const p = G.players[pid];
  if (p && link) link.send(pid, stateFor(p));
}
function broadcastState() {
  for (const p of playersList()) link.send(p.pid, stateFor(p));
}
// In the waiting room every phone shows how many players are in; refresh them (a bit delayed, so a burst of joins is one update).
let lobbyTimer = 0;
function pingLobby() {
  if (!G || G.phase !== 'lobby' || lobbyTimer) return;
  lobbyTimer = setTimeout(() => { lobbyTimer = 0; if (G && link && G.phase === 'lobby') broadcastState(); }, 500);
}

/* ------------------------------------------------------------------ game flow */

function toLobby() {
  G.phase = 'lobby'; G.i = -1; save(); broadcastState(); render();
}
function toReady(i) {
  G.i = i;
  G.perm = shuffle(QUESTIONS[i].options.map((_, k) => k));
  G.phase = 'ready';
  G.readyUntil = Date.now() + CONFIG.READY_SECONDS * 1000;
  save(); broadcastState(); render();
}
function toQuestion() {
  G.phase = 'question';
  G.startedAt = Date.now();
  G.endsAt = G.startedAt + secsFor(G.i) * 1000;
  save(); broadcastState(); render();
}
function toReveal() {
  if (G.phase !== 'question') return;
  G.phase = 'reveal';
  for (const p of playersList()) {
    const a = p.answers[G.i];
    const gained = a && a.ok ? a.pts : 0;
    p.score += gained;
    p.last = { gained, ok: !!(a && a.ok), d: a ? a.d : null };
  }
  save(); broadcastState(); render();
}
function next() {
  if (G.phase === 'lobby') return toReady(0);
  if (G.i + 1 < N) return toReady(G.i + 1);
  return toFinal();
}
function toFinal() {
  G.phase = 'final'; save(); broadcastState(); render();
}
function playAgain() {
  G.round += 1;
  for (const p of playersList()) { p.score = 0; p.answers = {}; p.last = null; }
  toLobby();
}
function kick(pid) {
  const p = G.players[pid];
  if (!p) return;
  link.kick(pid);
  G.banned.push(pid);
  delete G.players[pid];
  G.order = G.order.filter((x) => x !== pid);
  save(); changed(); pingLobby();
}

setInterval(() => {
  if (!G) return;
  const now = Date.now();
  if (G.phase === 'ready' && now >= G.readyUntil) toQuestion();
  else if (G.phase === 'question' && now >= G.endsAt) toReveal();
  else if (G.phase === 'question') checkAutoReveal();
  if (view && view.tick) view.tick(now);
}, 200);

/* ------------------------------------------------------------------ screens */

function changed() {
  if (view && view.update) view.update();
  updateTop();
}

function updateStatus() {
  statusEl.hidden = online;
}
function updateTop() {
  topinfo.replaceChildren();
  if (!G || G.phase === 'lobby') return;
  const u = joinUrl(G.pin);
  topinfo.append(
    el('span', { class: 'ti' }, 'Join at ', el('b', {}, displayUrl(u))),
    el('span', { class: 'ti' }, 'PIN ', el('b', { class: 'ti-pin' }, fmtPin(G.pin))),
    el('span', { class: 'ti' }, el('b', {}, String(G.order.length)), G.order.length === 1 ? ' executive' : ' executives'),
  );
}

function setView(v) {
  view = v;
  stage.replaceChildren(v.node);
  ctl.replaceChildren(...(v.controls || []));
  stage.scrollTop = 0;
  updateTop();
}

function btn(label, cls, onclick) {
  return el('button', { class: 'btn ' + cls, type: 'button', onclick }, label);
}
function confirmBtn(label, action) {
  const b = btn(label, 'ghost', () => {
    if (b.dataset.armed) { action(); return; }
    b.dataset.armed = '1';
    b.textContent = 'Click again to confirm';
    setTimeout(() => { delete b.dataset.armed; b.textContent = label; }, 3000);
  });
  return b;
}
async function copyLink(text, button) {
  const old = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
    ta.remove();
  }
  button.textContent = 'Link copied';
  setTimeout(() => { button.textContent = old; }, 1600);
}

function ring(total) {
  const wrap = el('div', { class: 'ring', role: 'timer', 'aria-label': 'Time left' });
  wrap.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-bg" cx="50" cy="50" r="44"/><circle class="ring-fg" cx="50" cy="50" r="44" pathLength="100"/></svg><span class="ring-num"></span>';
  const fg = wrap.querySelector('.ring-fg');
  const num = wrap.querySelector('.ring-num');
  return {
    node: wrap,
    set(left) {
      const f = Math.max(0, Math.min(1, left / total));
      fg.style.strokeDashoffset = String(100 * (1 - f));
      num.textContent = Math.ceil(left / 1000);
      wrap.classList.toggle('low', left <= 5000);
    },
  };
}

function optionTile(k, text, extra = {}) {
  return el('div', { class: 'opt c' + k + (extra.cls ? ' ' + extra.cls : '') },
    el('span', { class: 'letter' }, LETTERS[k]),
    el('span', { class: 'otext' }, text),
    extra.count != null ? el('span', { class: 'ocount', title: 'Executives who chose this' }, String(extra.count)) : null,
    extra.cls && extra.cls.includes('good') ? el('span', { class: 'mark', 'aria-label': 'Correct answer' }, '✓') : null);
}

const views = {
  lobby() {
    const u = joinUrl(G.pin);
    const url = u.href;
    const count = el('span', { class: 'count' }, '0');
    const chips = el('div', { class: 'chips', 'aria-live': 'polite' });
    const seen = new Set();
    const qr = el('div', { class: 'qr' });
    qr.innerHTML = qrSvg(url);
    const start = btn('Start session', 'primary big', () => next());
    const copy = btn('Copy join link', 'ghost', (e) => copyLink(url, e.currentTarget));
    function update() {
      const list = playersList();
      count.textContent = String(list.length);
      start.disabled = list.length === 0;
      chips.classList.toggle('dense', list.length > 20);
      chips.replaceChildren(...list.map((p) => {
        const fresh = !seen.has(p.pid);
        seen.add(p.pid);
        return el('span', { class: 'chip' + (p.connected ? '' : ' off') + (fresh ? ' new' : '') },
          el('span', { class: 'chip-name' }, p.name),
          el('button', { class: 'chip-x', type: 'button', title: 'Remove from session', 'aria-label': 'Remove ' + p.name, onclick: () => kick(p.pid) }, '×'));
      }));
      if (!list.length) chips.append(el('p', { class: 'empty' }, 'Waiting for executives to join…'));
    }
    const node = el('section', { class: 'lobby' },
      el('div', { class: 'lobby-join' },
        el('p', { class: 'eyebrow' }, 'Walmart case · Strategy execution'),
        el('h1', { class: 'case-title' }, 'You are the CEO. Every decision counts.'),
        el('p', { class: 'eyebrow' }, 'Join at'),
        el('p', { class: 'join-url' }, displayUrl(u)),
        el('p', { class: 'eyebrow' }, 'Session PIN'),
        el('p', { class: 'pin', 'aria-label': 'Session PIN ' + G.pin.split('').join(' ') }, fmtPin(G.pin))),
      el('div', { class: 'lobby-qr' }, qr, el('p', { class: 'hint' }, 'Or scan with your phone camera')),
      el('div', { class: 'lobby-roster' }, el('h2', {}, 'Executives in the room ', count), chips));
    update();
    return { node, controls: [start, copy], update };
  },

  ready() {
    const Q = QUESTIONS[G.i];
    const num = el('div', { class: 'count-big' }, String(CONFIG.READY_SECONDS));
    const node = el('section', { class: 'ready' },
      el('p', { class: 'eyebrow' }, 'Decision ' + (G.i + 1) + ' of ' + N),
      el('h1', { class: 'ready-topic' }, Q.topic),
      num,
      el('p', { class: 'hint' }, 'Prepare your decision…'));
    return {
      node, controls: [btn('Skip countdown', 'ghost', () => toQuestion())],
      tick(now) { num.textContent = String(Math.max(1, Math.ceil((G.readyUntil - now) / 1000))); },
    };
  },

  question() {
    const Q = QUESTIONS[G.i];
    const total = secsFor(G.i) * 1000;
    const r = ring(total);
    const answered = el('div', { class: 'answered' });
    const tiles = G.perm.map((orig, k) => optionTile(k, Q.options[orig]));
    function update() {
      answered.replaceChildren(el('b', {}, String(answeredCount())), ' of ' + connectedList().length + ' executives have decided');
    }
    const node = el('section', { class: 'question' },
      el('div', { class: 'q-head' },
        el('p', { class: 'eyebrow' }, 'Decision ' + (G.i + 1) + ' of ' + N + ' · ' + Q.topic),
        r.node),
      el('h1', { class: 'q-text' }, Q.scenario),
      el('div', { class: 'opts' }, tiles),
      answered);
    update();
    r.set(Math.max(0, G.endsAt - Date.now()));
    return {
      node,
      controls: [btn('Reveal best decision', 'primary big', () => toReveal()), confirmBtn('End session', () => toFinal())],
      update,
      tick(now) { r.set(Math.max(0, G.endsAt - now)); },
    };
  },

  reveal() {
    const Q = QUESTIONS[G.i];
    const counts = G.perm.map(() => 0);
    for (const p of playersList()) { const a = p.answers[G.i]; if (a) counts[a.d] += 1; }
    const correct = G.perm.indexOf(Q.correct);
    const tiles = G.perm.map((orig, k) => optionTile(k, Q.options[orig], { cls: k === correct ? 'good' : 'dim', count: counts[k] }));
    const { list, rank } = rankInfo();
    const top = list.slice(0, CONFIG.TOP_N);
    const board = el('ol', { class: 'board' }, top.map((p) => {
      return el('li', {},
        el('span', { class: 'rk' }, String(rank[p.pid])),
        el('span', { class: 'nm' }, p.name),
        p.last && p.last.gained > 0 ? el('span', { class: 'gain' }, '+' + p.last.gained) : el('span', { class: 'gain none' }, ''),
        el('span', { class: 'sc' }, String(p.score)));
    }));
    const last = G.i + 1 >= N;
    const node = el('section', { class: 'reveal' },
      el('div', { class: 'reveal-main' },
        el('p', { class: 'eyebrow' }, 'Decision ' + (G.i + 1) + ' of ' + N + ' · ' + Q.topic),
        el('h2', { class: 'q-text small' }, Q.scenario),
        el('div', { class: 'opts' }, tiles),
        el('div', { class: 'why' }, el('b', {}, 'Rationale: '), Q.why)),
      el('aside', { class: 'reveal-side' },
        el('h2', {}, 'Executive ranking'),
        board,
        list.length > top.length ? el('p', { class: 'hint' }, '+ ' + (list.length - top.length) + ' more') : null));
    return {
      node,
      controls: [btn(last ? 'Show board verdict' : 'Next decision', 'primary big', () => next()), confirmBtn('End session', () => toFinal())],
    };
  },

  final() {
    const { list, rank } = rankInfo();
    const podium = [1, 0, 2].map((idx) => {
      const p = list[idx];
      return el('div', { class: 'pod p' + (idx + 1) + (p ? '' : ' empty') },
        p ? el('div', { class: 'pod-name' }, p.name) : null,
        p ? el('div', { class: 'pod-score' }, p.score + ' pts') : null,
        el('div', { class: 'block' }, p ? String(rank[p.pid]) : ''));
    });
    const rest = list.slice(3, 10);
    const node = el('section', { class: 'final' },
      el('p', { class: 'eyebrow' }, 'The board’s verdict'),
      el('h1', { class: 'final-title' }, list[0] ? list[0].name + ' is named CEO of the year' : 'Final results'),
      el('div', { class: 'final-body' + (rest.length ? ' two' : '') },
        el('div', { class: 'podium' }, podium),
        rest.length ? el('ol', { class: 'board wide', start: '4' }, rest.map((p) => el('li', {},
          el('span', { class: 'rk' }, String(rank[p.pid])), el('span', { class: 'nm' }, p.name), el('span', { class: 'gain none' }, ''), el('span', { class: 'sc' }, String(p.score))))) : null));
    if (list.length) setTimeout(() => confetti(), 300);
    return { node, controls: [btn('Play again', 'primary big', () => playAgain()), confirmBtn('New session (new PIN)', () => newGame())] };
  },
};

let wake = null;
async function requestWake() {
  try {
    if (navigator.wakeLock && !wake && document.visibilityState === 'visible') {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    }
  } catch (e) { /* not available */ }
}
document.addEventListener('visibilitychange', () => { if (G) requestWake(); });

function render() {
  setView(views[G.phase]());
  requestWake();
}

function showMessage(title, body, buttons = [], cls = '') {
  setView({
    node: el('section', { class: 'message ' + cls }, el('h1', {}, title), body ? el('p', { class: 'lead' }, body) : null, el('div', { class: 'row' }, buttons)),
    controls: [],
  });
}

/* ------------------------------------------------------------------ start / resume */

async function connect(pin, key) {
  showMessage('Opening the boardroom…', 'Connecting to the session service.', [], 'busy');
  link = await openHost({ mode, pin, key, onMessage, onLeft, onStatus, onAttached });
  return link;
}

async function startNew() {
  store.del(SNAP_KEY);
  try {
    await connect(null, null);
  } catch (e) {
    return showError(e);
  }
  G = freshGame(link.pin, link.key);
  save();
  render();
}

async function resume(snap) {
  try {
    await connect(snap.pin, snap.key);
  } catch (e) {
    if (e && e.message === 'bad-key') return startNew();
    return showError(e, () => resume(snap));
  }
  G = snap;
  G.mode = mode;
  G.pin = link.pin; G.key = link.key;
  for (const p of playersList()) { p.connected = false; p.grace = Date.now() + RESUME_GRACE; }
  if (G.phase === 'question' && Date.now() >= G.endsAt) { save(); toReveal(); }
  else { save(); broadcastState(); render(); }
}

function showError(e, retry) {
  const code = e && e.message;
  const text = code === 'pin-in-use'
    ? 'That session code is still in use. Wait a few seconds and try again.'
    : 'Could not connect. Check your internet connection and try again.';
  showMessage('Could not open the boardroom', text, [
    btn('Try again', 'primary big', () => (retry ? retry() : startNew())),
  ], 'error');
}

function newGame() {
  if (link) link.close();
  link = null; G = null;
  store.del(SNAP_KEY);
  startNew();
}

async function boot() {
  document.title = 'Host · ' + CONFIG.APP_NAME;
  $('#appname').textContent = CONFIG.APP_NAME;
  showMessage('Starting…', null, [], 'busy');
  mode = await detectMode();
  statusEl.title = mode === 'relay' ? 'Server connection' : 'Direct connection';
  const snap = store.get(SNAP_KEY);
  const usable = snap && snap.v === 1 && Date.now() - snap.updated < SNAP_MAX_AGE && snap.phase !== 'final' && !params.has('new');
  if (!usable) return startNew();
  const n = snap.order.length;
  const where = snap.phase === 'lobby' ? 'in the lobby' : 'at decision ' + (snap.i + 1) + ' of ' + N;
  showMessage('A session is in progress',
    'PIN ' + fmtPin(snap.pin) + ' · ' + n + (n === 1 ? ' executive' : ' executives') + ' · ' + where + '.',
    [btn('Resume session', 'primary big', () => resume(snap)), btn('Start a new session', 'ghost', () => startNew())]);
}

/* ------------------------------------------------------------------ page chrome */

$('#fs').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (e) { /* not available */ }
});
window.addEventListener('keydown', (e) => {
  if (e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) && e.code !== 'Enter') return;
  if (e.code === 'Space' || e.code === 'Enter') {
    const b = ctl.querySelector('.btn.primary:not(:disabled)');
    if (b && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); b.click(); }
  }
});
window.addEventListener('beforeunload', (e) => {
  if (G && G.phase !== 'lobby' && G.phase !== 'final') { e.preventDefault(); e.returnValue = ''; }
});

boot();

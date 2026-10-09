import { CONFIG } from './config.js';
import { el, $, store, uid, ordinal, fmtPin } from './util.js';
import { detectMode, connectPlayer } from './transport.js';
import { confetti } from './confetti.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const SESSION_KEY = 'bq.session';
const SESSION_MAX_AGE = 4 * 3600 * 1000;
const params = new URLSearchParams(location.search);

let pid = store.get('bq.pid');
if (!pid) { pid = uid(); store.set('bq.pid', pid); }

let mode = null;
let link = null;
let session = null;      // { pin, pid, name, t }
let S = null;            // last state sent by the host
let joined = false;
let auto = false;        // silent rejoin of a saved session
let attempts = 0;        // failed attempts before the first successful join
let retryN = 0;          // reconnect attempts after joining
let locked = null;       // option chosen on the current question
let pending = null;      // answer sent but not yet acknowledged
let endLocal = 0;        // local time when the current question or countdown ends
let totalMs = 1;
let waitingHost = false;
let timers = {};
let wake = null;
let loopId = 0;

const view = $('#view');
const pbar = $('#pbar');
const banner = $('#banner');

/* ------------------------------------------------------------------ chrome */

function setBanner(text) {
  if (text) { banner.textContent = text; banner.hidden = false; } else { banner.hidden = true; }
}
function updateBar() {
  if (!joined || !S) { pbar.hidden = true; return; }
  pbar.hidden = false;
  $('#pname').textContent = S.name || session.name;
  $('#pscore').textContent = (S.score || 0).toLocaleString('en-US') + ' pts';
}
function show(...nodes) {
  view.replaceChildren(...nodes);
}
async function requestWake() {
  try {
    if (navigator.wakeLock && !wake) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    }
  } catch (e) { /* not available */ }
}

/* ------------------------------------------------------------------ join screen */

function showJoin(pinValue, message) {
  stopLoop();
  joined = false; S = null;
  updateBar(); setBanner('');
  const pin = el('input', {
    id: 'pin', class: 'input pin-input', type: 'text', inputmode: 'numeric',
    autocomplete: 'off', maxlength: '7', placeholder: 'Game PIN', 'aria-label': 'Game PIN',
  });
  const name = el('input', {
    id: 'nick', class: 'input', type: 'text', maxlength: String(CONFIG.MAX_NAME), autocomplete: 'off',
    enterkeyhint: 'go', placeholder: 'Your nickname', 'aria-label': 'Your nickname',
  });
  pin.value = pinValue ? fmtPin(pinValue) : '';
  name.value = store.get('bq.name') || '';
  pin.addEventListener('input', () => {
    const digits = pin.value.replace(/\D/g, '').slice(0, 6);
    pin.value = digits.length > 3 ? digits.slice(0, 3) + ' ' + digits.slice(3) : digits;
  });
  const err = el('p', { class: 'form-error', role: 'alert' }, message || '');
  const form = el('form', { class: 'join-form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    const digits = pin.value.replace(/\D/g, '');
    const nick = name.value.replace(/\s+/g, ' ').trim();
    if (digits.length !== 6) { err.textContent = 'Enter the 6-digit PIN shown on the big screen.'; pin.focus(); return; }
    if (!nick) { err.textContent = 'Choose a nickname.'; name.focus(); return; }
    store.set('bq.name', nick);
    startJoin(digits, nick, false);
  } },
  pin, name, el('button', { class: 'btn primary big block', type: 'submit' }, 'Join game'), err);
  show(el('div', { class: 'join' },
    el('img', { class: 'join-logo', src: 'img/logo.svg', alt: '', width: '72', height: '72' }),
    el('h1', { class: 'join-title' }, CONFIG.APP_NAME),
    el('p', { class: 'join-tag' }, CONFIG.TAGLINE),
    form));
  if (pinValue) name.focus(); else pin.focus();
}

function showConnecting(text) {
  stopLoop();
  show(el('div', { class: 'center' }, el('div', { class: 'spinner', 'aria-hidden': 'true' }), el('p', { class: 'lead' }, text || 'Connecting…')));
}

/* ------------------------------------------------------------------ connection */

async function startJoin(pin, name, silent) {
  session = { pin, pid, name, t: Date.now() };
  joined = false; S = null; locked = null; pending = null; attempts = 0; retryN = 0; auto = !!silent;
  showConnecting('Joining…');
  if (!mode) mode = await detectMode();
  openLink();
}

function closeLink() {
  clearTimeout(timers.hs); clearTimeout(timers.retry);
  const old = link; link = null;
  if (old) old.close();
}

function openLink() {
  closeLink();
  waitingHost = false;
  const mine = connectPlayer({
    mode, pin: session.pin, pid,
    onOpen: () => { if (link !== mine) return; hello(); armHandshake(); },
    onHostUp: () => { if (link !== mine) return; waitingHost = false; hello(); armHandshake(); },
    onNoHost: () => {
      if (link !== mine) return;
      waitingHost = true; clearTimeout(timers.hs);
      if (joined) setBanner('Waiting for the host…'); else showConnecting('Waiting for the host…');
    },
    onMessage: (d) => { if (link === mine) handle(d); },
    onClose: () => { if (link === mine) lost(); },
    onError: (code) => { if (link === mine) failed(code); },
  });
  link = mine;
}

function hello() {
  if (link) link.send({ t: 'hello', pid, name: session.name });
}
function armHandshake(ms = 9000) {
  clearTimeout(timers.hs);
  timers.hs = setTimeout(() => { if (!waitingHost && link) lost(); }, ms);
}

function lost() {
  closeLink();
  if (!joined) {
    attempts += 1;
    if (attempts >= 3) return endSession('Couldn’t connect. Check your internet connection and try again.');
  } else {
    setBanner('Reconnecting…');
  }
  retrySoon();
}

function failed(code) {
  closeLink();
  if (code === 'kicked') return kicked();
  if (code === 'full') return endSession('This game is full.');
  if (!joined) {
    if (code === 'nogame') return endSession(auto ? '' : 'We couldn’t find a game with that PIN. Check the number on the big screen.');
    attempts += 1;
    if (attempts >= 3) return endSession('Couldn’t connect. Check your internet connection and try again.');
  } else {
    setBanner('Reconnecting…');
  }
  retrySoon();
}

function retrySoon() {
  clearTimeout(timers.retry);
  retryN += 1;
  timers.retry = setTimeout(openLink, Math.min(400 * 2 ** Math.min(retryN, 4), 5000));
}

function endSession(message) {
  const pinValue = session && session.pin;
  closeLink();
  store.del(SESSION_KEY);
  showJoin(pinValue, message);
}

function kicked() {
  closeLink();
  store.del(SESSION_KEY);
  joined = false; S = null; updateBar(); setBanner('');
  show(el('div', { class: 'center' }, el('h1', {}, 'Removed from the game'),
    el('p', { class: 'lead' }, 'The host removed you from this game.'),
    el('button', { class: 'btn primary big', type: 'button', onclick: () => showJoin('', '') }, 'Join another game')));
}

function leave() {
  closeLink();
  store.del(SESSION_KEY);
  showJoin('', '');
}

/* ------------------------------------------------------------------ messages from the host */

function handle(d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'kick') return kicked();
  if (d.t === 'ack') {
    if (S && S.i === d.i) { locked = d.d; pending = null; if (S.ph === 'question') render(); }
    return;
  }
  if (d.t !== 's') return;

  clearTimeout(timers.hs);
  joined = true; attempts = 0; retryN = 0; waitingHost = false;
  setBanner('');
  if (d.name) session.name = d.name;
  session.t = Date.now();
  store.set(SESSION_KEY, session);
  requestWake();

  const prev = S;
  S = d;
  if (d.ph === 'question') {
    endLocal = performance.now() + d.left;
    totalMs = d.total || 1;
    if (d.mine != null) { locked = d.mine; pending = null; }
    else if (pending && pending.i === d.i) { locked = pending.d; if (link) link.send({ t: 'a', i: d.i, d: pending.d }); }
    else { locked = null; pending = null; }
  } else if (d.ph === 'ready') {
    endLocal = performance.now() + d.left;
    locked = null; pending = null;
  } else {
    pending = null;
  }
  updateBar();
  render();
  if (d.ph === 'final' && !(prev && prev.ph === 'final') && d.rank <= 3 && d.n > 1) confetti();
}

function answer(k) {
  if (!S || S.ph !== 'question' || locked != null) return;
  if (performance.now() >= endLocal + 800) return;
  locked = k;
  pending = { i: S.i, d: k };
  if (link) link.send({ t: 'a', i: S.i, d: k });
  if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) { /* ignore */ } }
  render();
}

/* ------------------------------------------------------------------ screens */

function stopLoop() { loopId += 1; }
function loop(fn) {
  const id = ++loopId;
  (function frame() {
    if (id !== loopId) return;
    if (fn() !== false) requestAnimationFrame(frame);
  })();
}

function leaveButton() {
  const b = el('button', { class: 'link-btn', type: 'button', onclick: () => {
    if (b.dataset.armed) return leave();
    b.dataset.armed = '1'; b.textContent = 'Tap again to leave';
    setTimeout(() => { delete b.dataset.armed; b.textContent = 'Leave game'; }, 3000);
  } }, 'Leave game');
  return b;
}

let lastKey = '';
function render() {
  if (!S) return;
  stopLoop();
  const key = S.ph + ':' + S.i;
  if (key !== lastKey) { lastKey = key; window.scrollTo(0, 0); }
  const screens = { lobby: screenLobby, ready: screenReady, question: screenQuestion, reveal: screenReveal, final: screenFinal };
  (screens[S.ph] || screenLobby)();
}

function screenLobby() {
  show(el('div', { class: 'center' },
    el('div', { class: 'pulse', 'aria-hidden': 'true' }),
    el('h1', {}, 'You’re in!'),
    el('p', { class: 'lead' }, 'See your nickname on the big screen.'),
    el('div', { class: 'name-badge' }, S.name),
    el('p', { class: 'hint' }, (S.n || 1) + (S.n === 1 ? ' player' : ' players') + ' in the room'),
    leaveButton()));
}

function screenReady() {
  const num = el('div', { class: 'count-big' }, '3');
  show(el('div', { class: 'center' },
    el('p', { class: 'eyebrow' }, 'Decision ' + (S.i + 1) + ' of ' + S.of),
    el('h1', {}, S.topic),
    num,
    el('p', { class: 'hint' }, 'Get ready…')));
  loop(() => {
    const left = endLocal - performance.now();
    num.textContent = String(Math.max(1, Math.ceil(left / 1000)));
    return true;
  });
}

function screenQuestion() {
  const timeUp = performance.now() >= endLocal && locked == null;
  const bar = el('i', { id: 'tbar' });
  const secs = el('span', { class: 'secs' });
  const opts = S.opts.map((text, k) => el('button', {
    class: 'popt c' + k + (locked === k ? ' chosen' : '') + (locked != null && locked !== k ? ' faded' : ''),
    type: 'button',
    disabled: locked != null || timeUp,
    onclick: () => answer(k),
  }, el('span', { class: 'letter' }, LETTERS[k]), el('span', { class: 'otext' }, text)));
  let status = 'Choose the best decision. Faster correct answers score more.';
  if (locked != null) status = 'Decision locked in. Waiting for the others…';
  else if (timeUp) status = 'Time’s up for this decision.';
  show(el('div', { class: 'q' },
    el('div', { class: 'q-top' },
      el('div', { class: 'q-meta' }, el('span', { class: 'eyebrow' }, 'Decision ' + (S.i + 1) + ' of ' + S.of + ' · ' + S.topic), secs),
      el('div', { class: 'tbar', role: 'timer', 'aria-label': 'Time left' }, bar)),
    el('p', { class: 'scenario' }, S.text),
    el('div', { class: 'popts' }, opts),
    el('p', { class: 'status', 'aria-live': 'polite' }, status),
    leaveButton()));
  let expired = timeUp;
  loop(() => {
    const left = Math.max(0, endLocal - performance.now());
    bar.style.width = (100 * left / totalMs) + '%';
    secs.textContent = Math.ceil(left / 1000) + ' s';
    bar.classList.toggle('low', left <= 5000);
    if (left <= 0 && !expired) { expired = true; if (locked == null) { render(); return false; } }
    return true;
  });
}

function screenReveal() {
  const cls = S.mine == null ? 'none' : S.ok ? 'ok' : 'bad';
  const title = S.mine == null ? 'No answer' : S.ok ? 'Right call!' : 'Not quite';
  const confirmText = S.opts[S.correct];
  show(el('div', { class: 'r' },
    el('p', { class: 'eyebrow' }, 'Decision ' + (S.i + 1) + ' of ' + S.of + ' · ' + S.topic),
    el('div', { class: 'verdict ' + cls },
      el('h1', {}, title),
      el('div', { class: 'gain' }, '+' + (S.gained || 0))),
    el('div', { class: 'correct-card' },
      el('span', { class: 'letter c' + S.correct }, LETTERS[S.correct]),
      el('div', {}, el('p', { class: 'eyebrow' }, 'Best decision'), el('p', { class: 'ctext' }, confirmText))),
    el('p', { class: 'why' }, S.why),
    el('div', { class: 'standing' },
      el('span', {}, 'You are ', el('b', {}, ordinal(S.rank)), ' of ' + S.n),
      el('b', {}, (S.score || 0).toLocaleString('en-US') + ' pts')),
    el('p', { class: 'hint' }, 'Waiting for the next decision…'),
    leaveButton()));
}

function screenFinal() {
  const top = (S.top || []).map((p, i) => el('li', {}, el('span', { class: 'rk' }, String(i + 1)), el('span', { class: 'nm' }, p.name), el('span', { class: 'sc' }, p.score.toLocaleString('en-US'))));
  show(el('div', { class: 'f' },
    el('p', { class: 'eyebrow' }, 'Final standing'),
    el('div', { class: 'rank-big' }, ordinal(S.rank)),
    el('p', { class: 'lead' }, 'of ' + S.n + ' players · ' + (S.score || 0).toLocaleString('en-US') + ' pts'),
    el('ol', { class: 'board' }, top),
    el('p', { class: 'hint' }, 'Thanks for playing.'),
    el('button', { class: 'btn ghost block', type: 'button', onclick: () => leave() }, 'Leave game')));
}

/* ------------------------------------------------------------------ boot */

// After a phone sleeps or changes network, the old connection may be dead without the browser knowing.
// Say hello again: the host answers at once if it is alive; if not, the watchdog reconnects.
function refreshLink() {
  if (!session) return;
  if (!link) {
    if (joined || attempts > 0) { clearTimeout(timers.retry); openLink(); }
  } else if (joined) {
    hello(); armHandshake(4000);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session && joined) {
    requestWake();
    refreshLink();
  }
});
window.addEventListener('online', refreshLink);

(function boot() {
  document.title = CONFIG.APP_NAME;
  const urlPin = (params.get('pin') || '').replace(/\D/g, '').slice(0, 6);
  const saved = store.get(SESSION_KEY);
  const usable = saved && saved.pid === pid && Date.now() - saved.t < SESSION_MAX_AGE && (!urlPin || urlPin === saved.pin);
  if (usable) startJoin(saved.pin, saved.name, true);
  else showJoin(urlPin, '');
})();

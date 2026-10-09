// How phones and the host screen exchange messages.
//
//   relay -> through the site's own server (server.js), over a WebSocket.
//   p2p   -> directly between browsers (WebRTC), using a free public connection
//            service only to introduce the two sides. No server of your own needed.
//
// The game itself runs in the host screen. Both modes only carry messages.

import { CONFIG } from './config.js';
import { loadScript, sleep, randomPin } from './util.js';

const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

export async function detectMode() {
  const forced = String(CONFIG.TRANSPORT || 'auto').toLowerCase();
  if (forced === 'relay' || forced === 'p2p') return forced;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(new URL('api/ping', document.baseURI), { cache: 'no-store', signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok && /json/.test(r.headers.get('content-type') || '')) {
      const j = await r.json();
      if (j && j.relay === true) return 'relay';
    }
  } catch (e) { /* plain static hosting */ }
  return 'p2p';
}

function wsUrl() {
  const u = new URL('ws', document.baseURI);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.href;
}

async function getPeer() {
  if (!window.Peer) await loadScript(new URL('vendor/peerjs.min.js', document.baseURI).href);
  return window.Peer;
}

function peerOptions() {
  return Object.assign({ debug: 0, config: { iceServers: DEFAULT_ICE, sdpSemantics: 'unified-plan' } }, CONFIG.PEER_OPTIONS || {});
}

const TRANSIENT = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'];

/* =========================================================================
 * HOST SIDE
 * openHost({ mode, pin?, key?, onMessage(pid, data), onLeft(pid), onStatus('online'|'offline'), onAttached(pids) })
 *   -> { mode, pin, key, send(pid, data), all(data), kick(pid), close() }
 * ======================================================================= */

export function openHost(opts) {
  return opts.mode === 'p2p' ? openP2PHost(opts) : openRelayHost(opts);
}

function openRelayHost(opts) {
  return new Promise((resolve, reject) => {
    let ws = null;
    let closed = false;
    let settled = false;
    let retry = 0;
    const info = { pin: opts.pin || null, key: opts.key || null };

    const raw = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    const api = {
      mode: 'relay',
      get pin() { return info.pin; },
      get key() { return info.key; },
      send: (pid, d) => raw({ k: 'to', pid, d }),
      all: (d) => raw({ k: 'all', d }),
      kick: (pid) => raw({ k: 'kick', pid }),
      close() { closed = true; try { ws && ws.close(); } catch (e) { /* ignore */ } },
    };

    function connect() {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => { ws.send(JSON.stringify({ k: 'host', pin: info.pin, key: info.key })); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.k === 'hosted') {
          retry = 0;
          info.pin = m.pin; info.key = m.key;
          if (opts.onStatus) opts.onStatus('online');
          if (opts.onAttached) opts.onAttached(m.pids || []);
          if (!settled) { settled = true; resolve(api); }
        } else if (m.k === 'from') {
          opts.onMessage(m.pid, m.d);
        } else if (m.k === 'left') {
          if (opts.onLeft) opts.onLeft(m.pid);
        } else if (m.k === 'join') {
          if (opts.onJoin) opts.onJoin(m.pid);
        } else if (m.k === 'err') {
          if (!settled) { settled = true; closed = true; reject(new Error(m.code)); }
        }
      };
      ws.onclose = () => {
        if (closed) return;
        if (opts.onStatus) opts.onStatus('offline');
        retry += 1;
        if (!settled && retry > 5) { settled = true; closed = true; reject(new Error('unreachable')); return; }
        setTimeout(connect, Math.min(800 * 2 ** (retry - 1), 5000));
      };
      ws.onerror = () => { /* onclose follows */ };
    }
    connect();
  });
}

async function openP2PHost(opts) {
  const Peer = await getPeer();
  const conns = new Map();
  let closed = false;
  let peer = null;
  let pin = opts.pin || randomPin();

  const open = (id) => new Promise((resolve, reject) => {
    const p = new Peer(CONFIG.PEER_PREFIX + id, peerOptions());
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; try { p.destroy(); } catch (e) { /* ignore */ } reject({ type: 'network' }); }
    }, 12000);
    p.on('open', () => { if (!done) { done = true; clearTimeout(timer); resolve(p); } });
    p.on('error', (err) => {
      if (!done) { done = true; clearTimeout(timer); try { p.destroy(); } catch (e) { /* ignore */ } reject(err); }
    });
  });

  let attempts = 0;
  for (;;) {
    try { peer = await open(pin); break; } catch (err) {
      attempts += 1;
      const type = err && err.type;
      if (type === 'unavailable-id') {
        if (opts.pin) {
          // Resuming: the previous registration needs a few seconds to expire.
          if (attempts > 10) throw new Error('pin-in-use');
          await sleep(2500);
        } else {
          pin = randomPin();
          if (attempts > 8) throw new Error('pin-in-use');
        }
      } else if (TRANSIENT.includes(type) || type === 'network') {
        if (attempts > 3) throw new Error('unreachable');
        await sleep(1500);
      } else {
        throw new Error(type || 'unreachable');
      }
    }
  }

  let status = 'online';
  const setStatus = (s) => { if (s !== status) { status = s; if (opts.onStatus) opts.onStatus(s); } };

  peer.on('connection', (conn) => {
    conn.on('data', (d) => {
      if (!d || typeof d !== 'object') return;
      if (d.t === 'hello' && typeof d.pid === 'string') {
        const old = conns.get(d.pid);
        if (old && old !== conn) { try { old.close(); } catch (e) { /* ignore */ } }
        conns.set(d.pid, conn);
        conn._pid = d.pid;
      }
      if (conn._pid) opts.onMessage(conn._pid, d);
    });
    conn.on('close', () => {
      if (conn._pid && conns.get(conn._pid) === conn) {
        conns.delete(conn._pid);
        if (opts.onLeft) opts.onLeft(conn._pid);
      }
    });
    conn.on('error', () => { /* close follows */ });
  });

  peer.on('open', () => setStatus('online'));
  peer.on('disconnected', async () => {
    setStatus('offline');
    while (!closed && peer.disconnected) {
      try { peer.reconnect(); } catch (e) { /* retry */ }
      await sleep(3000);
    }
  });
  peer.on('error', () => {
    if (closed) return;
    if (peer.disconnected) { try { peer.reconnect(); } catch (e) { /* ignore */ } }
  });

  const sendTo = (conn, d) => { try { if (conn && conn.open) conn.send(d); } catch (e) { /* ignore */ } };
  return {
    mode: 'p2p',
    get pin() { return pin; },
    key: null,
    send: (pid, d) => sendTo(conns.get(pid), d),
    all: (d) => { for (const c of conns.values()) sendTo(c, d); },
    kick: (pid) => { const c = conns.get(pid); if (c) { sendTo(c, { t: 'kick' }); setTimeout(() => { try { c.close(); } catch (e) { /* ignore */ } }, 200); conns.delete(pid); } },
    close() { closed = true; try { peer.destroy(); } catch (e) { /* ignore */ } },
  };
}

/* =========================================================================
 * PLAYER SIDE (one connection attempt; the caller decides when to retry)
 * connectPlayer({ mode, pin, pid, onOpen, onMessage(data), onClose(), onNoHost, onHostUp, onError(code) })
 *   -> { send(data), close() }
 * error codes: nogame | full | kicked | timeout | net
 * ======================================================================= */

export function connectPlayer(opts) {
  return opts.mode === 'p2p' ? connectP2PPlayer(opts) : connectRelayPlayer(opts);
}

function connectRelayPlayer(o) {
  let ws = null;
  let dead = false;
  let fatal = false;
  const api = {
    send(d) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ k: 'm', d })); },
    close() { dead = true; try { ws && ws.close(); } catch (e) { /* ignore */ } },
  };
  try { ws = new WebSocket(wsUrl()); } catch (e) { setTimeout(() => o.onError && o.onError('net'), 0); return api; }
  const timer = setTimeout(() => { if (!dead && ws.readyState !== 1) { dead = true; try { ws.close(); } catch (e) { /* ignore */ } o.onError && o.onError('timeout'); } }, 15000);
  ws.onopen = () => { clearTimeout(timer); ws.send(JSON.stringify({ k: 'join', pin: o.pin, pid: o.pid })); };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.k === 'ok') { if (o.onOpen) o.onOpen(); }
    else if (m.k === 'd') { if (o.onMessage) o.onMessage(m.d); }
    else if (m.k === 'nohost') { if (o.onNoHost) o.onNoHost(); }
    else if (m.k === 'host') { if (o.onHostUp) o.onHostUp(); }
    else if (m.k === 'err') { fatal = true; if (!dead && o.onError) o.onError(m.code); }
  };
  ws.onclose = () => { clearTimeout(timer); if (!dead && !fatal && o.onClose) o.onClose(); };
  ws.onerror = () => { /* onclose follows */ };
  return api;
}

function connectP2PPlayer(o) {
  let peer = null;
  let conn = null;
  let dead = false;
  let opened = false;
  const api = {
    send(d) { try { if (conn && conn.open) conn.send(d); } catch (e) { /* ignore */ } },
    close() { dead = true; clearTimeout(timer); try { peer && peer.destroy(); } catch (e) { /* ignore */ } },
  };
  let timer = null;
  const fail = (code) => { if (dead) return; dead = true; clearTimeout(timer); try { peer && peer.destroy(); } catch (e) { /* ignore */ } if (o.onError) o.onError(code); };

  getPeer().then((Peer) => {
    if (dead) return;
    peer = new Peer(peerOptions());
    timer = setTimeout(() => { if (!opened) fail('timeout'); }, 15000);
    peer.on('open', () => {
      if (dead) return;
      conn = peer.connect(CONFIG.PEER_PREFIX + o.pin, { serialization: 'json', reliable: true });
      conn.on('open', () => { opened = true; clearTimeout(timer); if (o.onOpen) o.onOpen(); });
      conn.on('data', (d) => { if (o.onMessage) o.onMessage(d); });
      conn.on('close', () => { if (!dead) { dead = true; try { peer.destroy(); } catch (e) { /* ignore */ } if (o.onClose) o.onClose(); } });
      conn.on('error', () => { /* close follows */ });
    });
    peer.on('error', (err) => {
      if (opened) return; // a hiccup with the connection service does not affect an open channel
      const type = err && err.type;
      if (type === 'peer-unavailable') fail('nogame');
      else fail('net');
    });
  }).catch(() => fail('net'));
  return api;
}

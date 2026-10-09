// Optional relay server.
//
// The quiz works without any server (players connect to the host directly through
// the browser). Running this server makes connections more reliable on strict
// networks: it serves the website and relays messages between the host screen and
// the phones. It keeps no game data and holds no answers.
//
//   npm install
//   npm start        ->  http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');

const MAX_ROOMS = 500;
const MAX_PLAYERS_PER_ROOM = 300;
const HOST_GRACE_MS = 3 * 60 * 60 * 1000;   // keep a room this long after the host disconnects
const IDLE_MS = 6 * 60 * 60 * 1000;          // drop rooms with no activity for this long

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/* ------------------------------------------------------------------ static files */

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    res.writeHead(400); return res.end('Bad request');
  }
  if (urlPath === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, relay: true }));
  }
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end('ok');
  }
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/host') urlPath = '/host.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    headers['Cache-Control'] = ext === '.woff2' || file.includes(path.sep + 'vendor' + path.sep)
      ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(serveStatic);

/* ------------------------------------------------------------------ rooms */

/** @type {Map<string, {pin:string, key:string, host:any, players:Map<string,any>, last:number, hostLeft:number}>} */
const rooms = new Map();

function newPin() {
  for (let i = 0; i < 200; i++) {
    const pin = String(100000 + crypto.randomInt(900000));
    if (!rooms.has(pin)) return pin;
  }
  return null;
}

const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function bucket(ws, limit, perMs) {
  const now = Date.now();
  if (!ws._b || now - ws._b.t > perMs) ws._b = { t: now, n: 0 };
  ws._b.n += 1;
  return ws._b.n <= limit;
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on('upgrade', (req, socket, head) => {
  let p = '';
  try { p = new URL(req.url, 'http://x').pathname; } catch (e) { /* ignore */ }
  if (p !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.role = null;
  ws.room = null;
  ws.pid = null;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    /* ---- first message decides the role ---- */
    if (!ws.role) {
      if (m.k === 'host') return attachHost(ws, m);
      if (m.k === 'join') return attachPlayer(ws, m);
      return;
    }

    const room = ws.room;
    if (!room || !rooms.has(room.pin)) return;
    room.last = Date.now();

    if (ws.role === 'host') {
      if (m.k === 'to' && typeof m.pid === 'string') {
        send(room.players.get(m.pid), { k: 'd', d: m.d });
      } else if (m.k === 'all') {
        for (const pws of room.players.values()) send(pws, { k: 'd', d: m.d });
      } else if (m.k === 'kick' && typeof m.pid === 'string') {
        const pws = room.players.get(m.pid);
        if (pws) { send(pws, { k: 'err', code: 'kicked' }); pws.close(); room.players.delete(m.pid); }
      }
    } else if (ws.role === 'player') {
      if (!bucket(ws, 60, 10000)) return;
      if (m.k === 'm') send(room.host, { k: 'from', pid: ws.pid, d: m.d });
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    if (ws.role === 'host' && room.host === ws) {
      room.host = null;
      room.hostLeft = Date.now();
      for (const pws of room.players.values()) send(pws, { k: 'nohost' });
    } else if (ws.role === 'player' && room.players.get(ws.pid) === ws) {
      room.players.delete(ws.pid);
      send(room.host, { k: 'left', pid: ws.pid });
    }
  });

  ws.on('error', () => { /* handled by close */ });
});

function attachHost(ws, m) {
  let room = null;
  if (typeof m.pin === 'string' && rooms.has(m.pin)) {
    room = rooms.get(m.pin);
    if (!m.key || m.key !== room.key) return send(ws, { k: 'err', code: 'bad-key' }), ws.close();
    if (room.host && room.host !== ws) { try { room.host.close(); } catch (e) { /* ignore */ } }
  } else {
    if (rooms.size >= MAX_ROOMS) return send(ws, { k: 'err', code: 'busy' }), ws.close();
    const pin = (typeof m.pin === 'string' && /^\d{6}$/.test(m.pin) && !rooms.has(m.pin)) ? m.pin : newPin();
    if (!pin) return send(ws, { k: 'err', code: 'busy' }), ws.close();
    room = { pin, key: crypto.randomBytes(16).toString('hex'), host: null, players: new Map(), last: Date.now(), hostLeft: 0 };
    rooms.set(pin, room);
  }
  room.host = ws;
  room.hostLeft = 0;
  room.last = Date.now();
  ws.role = 'host';
  ws.room = room;
  send(ws, { k: 'hosted', pin: room.pin, key: room.key, pids: [...room.players.keys()] });
  for (const pws of room.players.values()) send(pws, { k: 'host' });
}

function attachPlayer(ws, m) {
  const room = typeof m.pin === 'string' ? rooms.get(m.pin) : null;
  if (!room) return send(ws, { k: 'err', code: 'nogame' }), ws.close();
  const pid = typeof m.pid === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(m.pid) ? m.pid : null;
  if (!pid) return ws.close();
  if (!room.players.has(pid) && room.players.size >= MAX_PLAYERS_PER_ROOM) {
    return send(ws, { k: 'err', code: 'full' }), ws.close();
  }
  const old = room.players.get(pid);
  if (old && old !== ws) { old.role = null; try { old.close(); } catch (e) { /* ignore */ } }
  ws.role = 'player';
  ws.room = room;
  ws.pid = pid;
  room.players.set(pid, ws);
  room.last = Date.now();
  send(ws, { k: 'ok' });
  if (room.host) send(room.host, { k: 'join', pid }); else send(ws, { k: 'nohost' });
}

/* ------------------------------------------------------------------ housekeeping */

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 25000);

setInterval(() => {
  const now = Date.now();
  for (const [pin, room] of rooms) {
    const hostGone = !room.host && room.hostLeft && now - room.hostLeft > HOST_GRACE_MS;
    const idle = now - room.last > IDLE_MS;
    if (hostGone || idle) {
      for (const pws of room.players.values()) { send(pws, { k: 'err', code: 'nogame' }); pws.close(); }
      rooms.delete(pin);
    }
  }
}, 60000);

server.listen(PORT, () => console.log('Quiz server listening on port ' + PORT));

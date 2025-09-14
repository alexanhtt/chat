// server.js
// Node core-only server (no npm install required).
// Run: node server.js
// You can override with: ADMIN_PASSWORD="yourpass" node server.js

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const CHATS_DIR = path.join(__dirname, 'chats');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ensure chats dir exists
if (!fs.existsSync(CHATS_DIR)) fs.mkdirSync(CHATS_DIR, { recursive: true });

// helpers
function normalizeIp(raw) {
  if (!raw) return 'unknown';
  if (raw.startsWith('::ffff:')) return raw.replace('::ffff:', '');
  if (raw === '::1') return '127.0.0.1';
  return raw;
}

// 🔑 Lấy clientId (ưu tiên client_id, fallback IP)
function getClientId(u, body, req) {
  return (body && body.client_id) || (u && u.searchParams.get('client_id')) || normalizeIp(req.socket.remoteAddress);
}

function sseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('\n');
}
function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) { /* ignore */ }
}

// storage (file per clientId)
async function saveMessage(clientId, sender, message) {
  const file = path.join(CHATS_DIR, encodeURIComponent(clientId) + '.json');
  let arr = [];
  try {
    const raw = await fsp.readFile(file, 'utf8');
    arr = JSON.parse(raw || '[]');
  } catch (e) { arr = []; }
  arr.push({ sender, message, ts: new Date().toISOString() });
  await fsp.writeFile(file, JSON.stringify(arr, null, 2), 'utf8');
  return arr;
}
async function getHistory(clientId) {
  const file = path.join(CHATS_DIR, encodeURIComponent(clientId) + '.json');
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) { return []; }
}
async function listUsers() {
  try {
    const files = await fsp.readdir(CHATS_DIR);
    return files.map(f => decodeURIComponent(path.basename(f, '.json')));
  } catch (e) { return []; }
}

// in-memory SSE registries and admin tokens
const userSSE = {}; // clientId -> Set(res)
const adminSSE = new Set(); // Set(res)
const adminTokens = new Map(); // token -> createdAt

// read body helper
async function readBody(req) {
  let b = '';
  for await (const chunk of req) b += chunk;
  try { return JSON.parse(b || '{}'); } catch (e) { return {}; }
}

// serve index.html
async function serveIndex(res) {
  try {
    const file = path.join(__dirname, 'index.html');
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  } catch (e) {
    res.writeHead(500); res.end('Index not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const host = `http://${req.headers.host || 'localhost'}`;
    const u = new URL(req.url, host);
    const pathname = u.pathname;

    // SSE endpoint
    if (pathname === '/events' && req.method === 'GET') {
      const role = u.searchParams.get('role') || 'user';
      const token = u.searchParams.get('token') || null;
      const clientId = u.searchParams.get('client_id') || normalizeIp(req.socket.remoteAddress);

      if (role === 'admin') {
        if (!token || !adminTokens.has(token)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'invalid_token' }));
          return;
        }
      }

      sseHeaders(res);

      if (role === 'user') {
        userSSE[clientId] = userSSE[clientId] || new Set();
        userSSE[clientId].add(res);
        sseSend(res, 'connect-info', { id: clientId });
        // notify admins of presence
        for (const a of adminSSE) sseSend(a, 'presence', { id: clientId, ts: new Date().toISOString() });
      } else {
        adminSSE.add(res);
        const users = await listUsers();
        sseSend(res, 'user-list', { users });
      }

      req.on('close', () => {
        if (role === 'user') {
          if (userSSE[clientId]) {
            userSSE[clientId].delete(res);
            if (userSSE[clientId].size === 0) delete userSSE[clientId];
          }
        } else {
          adminSSE.delete(res);
        }
      });
      return;
    }

    // admin login (POST)
    if (pathname === '/admin-login' && req.method === 'POST') {
      const j = await readBody(req);
      const pw = String(j.password || '');
      if (pw !== ADMIN_PASSWORD) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'wrong_password' }));
        return;
      }
      const token = crypto.randomBytes(16).toString('hex');
      adminTokens.set(token, Date.now());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, token }));
      return;
    }

    // post message (user or admin)
    if (pathname === '/message' && req.method === 'POST') {
      const j = await readBody(req);
      const role = j.role || 'user';
      const msg = String(j.message || '').slice(0, 8000);

      if (role === 'user') {
        const clientId = getClientId(u, j, req);
        await saveMessage(clientId, 'user', msg);
        const data = { user_id: clientId, sender: 'user', message: msg, ts: new Date().toISOString() };
        if (userSSE[clientId]) for (const r of userSSE[clientId]) sseSend(r, 'message', data);
        for (const a of adminSSE) sseSend(a, 'message', data);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
        return;
      } else if (role === 'admin') {
        const token = j.token || '';
        const target = j.user_id || j.user_ip || '';
        if (!adminTokens.has(token)) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:false, reason:'invalid_token' })); return; }
        if (!target) { res.writeHead(400); res.end('need user_id'); return; }
        await saveMessage(target, 'admin', msg);
        const data = { user_id: target, sender: 'admin', message: msg, ts: new Date().toISOString() };
        if (userSSE[target]) for (const r of userSSE[target]) sseSend(r, 'message', data);
        for (const a of adminSSE) sseSend(a, 'message', data);
        res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:true }));
        return;
      } else {
        res.writeHead(400); res.end('bad role');
        return;
      }
    }

    // admin list users
    if (pathname === '/admin/users' && req.method === 'GET') {
      const token = u.searchParams.get('token') || '';
      if (!adminTokens.has(token)) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:false })); return; }
      const users = await listUsers();
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:true, users }));
      return;
    }

    // admin get history
    if (pathname === '/admin/history' && req.method === 'GET') {
      const token = u.searchParams.get('token') || '';
      const userId = u.searchParams.get('user_id') || u.searchParams.get('user_ip') || '';
      if (!adminTokens.has(token)) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:false })); return; }
      if (!userId) { res.writeHead(400); res.end('need user_id'); return; }
      const h = await getHistory(userId);
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:true, history: h }));
      return;
    }

    // user get history
    if (pathname === '/user/history' && req.method === 'GET') {
      const clientId = u.searchParams.get('client_id') || normalizeIp(req.socket.remoteAddress);
      const h = await getHistory(clientId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, history: h }));
      return;
    }

    // serve index.html
    if (pathname === '/' || pathname === '/index.html') {
      await serveIndex(res);
      return;
    }

    // other static not supported => 404
    res.writeHead(404); res.end('Not found');
  } catch (err) {
    console.error('Server error', err);
    try { res.writeHead(500); res.end('Server error'); } catch(e){}; 
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}  (admin password set? ${!!process.env.ADMIN_PASSWORD})`);
  console.log('Default admin password used if ADMIN_PASSWORD not set.');
});

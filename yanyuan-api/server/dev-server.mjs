// 本地世界服务：同时提供 /api/* 与静态游戏文件，便于双浏览器实测。
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld } from '../src/core.mjs';
import { openDatabase } from './db-sqlite.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..');
const MIGRATIONS = join(ROOT, 'migrations');
const GAME_DIR = process.env.YANYUAN_GAME_DIR || resolve(ROOT, '..', 'yanyuan');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export async function createServer({ dbPath = ':memory:', gameDir = GAME_DIR, log = false } = {}) {
  const db = openDatabase(dbPath);
  for (const f of ['0001_init.sql']) {
    const p = join(MIGRATIONS, f);
    if (existsSync(p)) db.raw.exec(await readFile(p, 'utf8'));
  }
  const world = createWorld({ db, adminKey: process.env.ADMIN_KEY || '' });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);

    if (path.startsWith('/api/')) {
      let body = null;
      if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const text = Buffer.concat(chunks).toString('utf8');
        if (text) { try { body = JSON.parse(text); } catch { body = undefined; } }
        if (body === undefined) return sendJson(res, 400, { error: 'bad_json', message: '请求体不是合法 JSON' }, req);
      }
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
      const ip = (req.socket.remoteAddress || '0.0.0.0').replace('::ffff:', '');
      let out;
      try {
        out = await world.handle({ method: req.method, path, headers, body, ip });
      } catch (e) {
        if (log) console.error('[api]', e);
        out = { status: 500, body: { error: 'server_error', message: '世界服务出错了' }, headers: {} };
      }
      if (out.status === 204) { res.writeHead(204, { ...corsHeaders(req) }); return res.end(); }
      return sendJson(res, out.status, out.body, req, out.headers);
    }

    // ---- 静态文件 ----
    let rel = path;
    if (path === '/' || path === '') { res.writeHead(302, { Location: '/yanyuan/' }); return res.end(); }
    if (path === '/yanyuan') { res.writeHead(302, { Location: '/yanyuan/' }); return res.end(); }
    if (path.startsWith('/yanyuan/')) rel = path.slice('/yanyuan'.length);
    else if (!path.startsWith('/favicon')) { res.writeHead(404); return res.end('not found'); }

    let file = normalize(join(gameDir, rel));
    if (!file.startsWith(resolve(gameDir))) { res.writeHead(403); return res.end('forbidden'); }
    try {
      const st = await stat(file);
      if (st.isDirectory()) file = join(file, 'index.html');
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('404 ' + rel);
    }
    try {
      const buf = await readFile(file);
      const ext = extname(file).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': buf.length,
        'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
        'x-content-type-options': 'nosniff',
      });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
    }
  });

  return {
    server,
    db,
    world,
    listen(port = 8787, host = '127.0.0.1') {
      return new Promise((ok) => server.listen(port, host, () => ok(server.address())));
    },
    close() {
      return new Promise((ok) => { server.close(() => { db.close(); ok(); }); });
    },
  };
}

const ALLOWED_ORIGINS = (process.env.ALLOW_ORIGINS || 'https://xxxxu-ll.github.io')
  .split(',').map(s => s.trim()).filter(Boolean);

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  if (!ok) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function sendJson(res, status, body, req, extra = {}) {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...corsHeaders(req),
    ...extra,
  });
  res.end(payload);
}

// 直接运行时启动
if (process.argv[1] && process.argv[1].endsWith('dev-server.mjs')) {
  const port = Number(process.env.PORT || 8787);
  const s = await createServer({ log: true });
  const addr = await s.listen(port, process.env.HOST || '127.0.0.1');
  console.log(`[yanyuan] 世界服务 + 游戏静态文件: http://${addr.address}:${addr.port}/yanyuan/`);
  console.log(`[yanyuan] API: http://${addr.address}:${addr.port}/api/health`);
  console.log(`[yanyuan] 静态目录: ${GAME_DIR}`);
}

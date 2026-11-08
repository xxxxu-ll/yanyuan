// 校验打包后的 Worker 产物本身（与 Cloudflare 运行时同构）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const workerPath = join(ROOT, 'dist', 'worker.mjs').replace(/\\/g, '/');
const worker = (await import('file://' + workerPath + '?t=' + Date.now())).default;

const ORIGIN = 'https://xxxxu-ll.github.io';

function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(ROOT, 'migrations', '0001_init.sql'), 'utf8'));
  return {
    ALLOW_ORIGINS: ORIGIN,
    DB: {
      prepare(query) {
        let params = [];
        return {
          bind(...p) { params = p; return this; },
          async first() { return db.prepare(query).get(...params) ?? null; },
          async all() { return { results: db.prepare(query).all(...params) }; },
          async run() { return { success: true, meta: db.prepare(query).run(...params) }; },
        };
      },
    },
  };
}

const env = makeEnv();

async function call(path, { method = 'POST', body = null, token = null, origin = ORIGIN } = {}) {
  const headers = { Origin: origin };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const req = new Request('https://yanyuan-world.example.workers.dev' + path, {
    method, headers, body: body === null ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = text; } }
  return { status: res.status, json, headers: res.headers };
}

test('Worker 产物：健康检查 + CORS', async () => {
  const r = await call('/api/health', { method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await call('/api/health', { method: 'GET', origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await worker.fetch(new Request('https://x.workers.dev/api/players', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
  assert.equal(pre.status, 204);
});

test('Worker 产物：注册 / 同步 / 聊天 / 恢复', async () => {
  const created = await call('/api/players', { body: { name: '工人甲', appearance: { top: 2 } } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const token = created.json.token;

  const other = await call('/api/players', { body: { name: '工人乙', appearance: { top: 5 } } });
  assert.equal(other.status, 201);

  const sync = await call('/api/sync', { body: { x: -158, y: 178, since: 0 }, token });
  assert.equal(sync.status, 200);
  assert.equal(sync.json.players.length, 1);
  assert.equal(sync.json.players[0].name, '工人乙');
  assert.equal(sync.json.players[0].appearance.top, 5);

  const chat = await call('/api/chat', { body: { text: 'Worker 也能聊天' }, token });
  assert.equal(chat.status, 201);
  assert.equal(chat.json.message.name, '工人甲');

  const restored = await call('/api/session', { body: {}, token });
  assert.equal(restored.status, 200);
  assert.equal(restored.json.character.name, '工人甲');

  const noAuth = await call('/api/session', { body: {} });
  assert.equal(noAuth.status, 401);
});

test('Worker 产物：非法 JSON 与未知路由', async () => {
  const req = new Request('https://yanyuan-world.example.workers.dev/api/players', {
    method: 'POST', headers: { Origin: ORIGIN, 'content-type': 'application/json' }, body: '{bad json',
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
  const r2 = await call('/api/nope', { body: {} });
  assert.equal(r2.status, 404);
});

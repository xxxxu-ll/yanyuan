// 校验打包后的 Worker 产物（Durable Object + SQLite），与 Cloudflare 运行时同构
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const workerPath = join(ROOT, 'dist', 'worker.mjs').replace(/\\/g, '/');
const mod = await import('file://' + workerPath + '?t=' + Date.now());
const World = mod.World;
if (!World) throw new Error('产物里没有导出 World 类');

const ORIGIN = 'https://xxxxu-ll.github.io';

/** 用 node:sqlite 模拟 Durable Object 的 storage.sql */
function makeWorld() {
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec(query, ...params) {
      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return { toArray: () => rows };
    },
  };
  const ctx = {
    storage: { sql },
    blockConcurrencyWhile: async (fn) => { await fn(); },
  };
  return new World(ctx, { ALLOW_ORIGINS: ORIGIN, ADMIN_KEY: '' });
}

const world = makeWorld();

async function call(path, { method = 'POST', body = null, token = null, origin = ORIGIN } = {}) {
  const headers = { Origin: origin };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const req = new Request('https://yanyuan-world.example.workers.dev' + path, {
    method, headers, body: body === null ? undefined : JSON.stringify(body),
  });
  const res = await world.fetch(req);
  const text = await res.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = text; } }
  return { status: res.status, json, headers: res.headers };
}

test('DO 产物：建表 + 健康检查 + CORS', async () => {
  const r = await call('/api/health', { method: 'GET' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await call('/api/health', { method: 'GET', origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('DO 产物：注册 / 同步 / 资料 / 聊天 / 恢复', async () => {
  const created = await call('/api/players', { body: { name: '工人甲', appearance: { top: 2 }, profile: { dept: '信科', bio: '爱散步' } } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const token = created.json.token;

  const other = await call('/api/players', { body: { name: '工人乙', appearance: { top: 5 }, profile: { dept: '中文系' } } });
  assert.equal(other.status, 201);

  const sync = await call('/api/sync', { body: { x: -158, y: 178, since: 0 }, token });
  assert.equal(sync.status, 200);
  assert.equal(sync.json.players.length, 1);
  assert.equal(sync.json.players[0].name, '工人乙');
  assert.equal(sync.json.players[0].profile.dept, '中文系');
  assert.deepEqual(sync.json.gestures, []);

  const chat = await call('/api/chat', { body: { text: 'Worker 也能聊天' }, token });
  assert.equal(chat.status, 201);
  assert.equal(chat.json.message.name, '工人甲');

  const wave = await call('/api/wave', { body: { to: other.json.id }, token });
  assert.equal(wave.status, 201, JSON.stringify(wave.json));

  const syncB = await call('/api/sync', { body: { x: -150, y: 178, since: 0 }, token: other.json.token });
  assert.equal(syncB.json.gestures.length, 1);
  assert.equal(syncB.json.gestures[0].fromName, '工人甲');

  const restored = await call('/api/session', { body: {}, token });
  assert.equal(restored.status, 200);
  assert.equal(restored.json.character.name, '工人甲');

  const noAuth = await call('/api/session', { body: {} });
  assert.equal(noAuth.status, 401);
});

test('DO 产物：非法 JSON 与未知路由', async () => {
  const req = new Request('https://yanyuan-world.example.workers.dev/api/players', {
    method: 'POST', headers: { Origin: ORIGIN, 'content-type': 'application/json' }, body: '{bad json',
  });
  const res = await world.fetch(req);
  assert.equal(res.status, 400);
  const r2 = await call('/api/nope', { body: {} });
  assert.equal(r2.status, 404);
});

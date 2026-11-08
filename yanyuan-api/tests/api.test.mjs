// 世界服务自动化测试：身份、存档隔离、多人可见、聊天、限流、CORS
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/dev-server.mjs';

let srv, base;

test.before(async () => {
  srv = await createServer({ dbPath: ':memory:' });
  const addr = await srv.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}/api`;
});

test.after(async () => { if (srv) await srv.close(); });

async function call(path, { method = 'POST', body = null, token = null, origin = null } = {}) {
  const headers = {};
  if (body !== null) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  if (origin) headers.origin = origin;
  const res = await fetch(base + path, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  let json = null;
  const text = await res.text();
  if (text) { try { json = JSON.parse(text); } catch { json = text; } }
  return { status: res.status, json, headers: res.headers };
}

const APPEARANCE = { skin: 1, hair: 2, hairColor: 3, top: 4, pants: 1, shoes: 2, acc: 1 };
const A = { name: '测试甲', appearance: APPEARANCE };
const B = { name: '测试乙', appearance: { ...APPEARANCE, top: 6 } };
let A1, B1;

test('health 可用且返回真实在线人数', async () => {
  const r = await call('/health', { method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(typeof r.json.online, 'number');
});

test('两个会话创建不同角色，id 与恢复码不同', async () => {
  const ra = await call('/players', { body: A });
  const rb = await call('/players', { body: B });
  assert.equal(ra.status, 201, JSON.stringify(ra.json));
  assert.equal(rb.status, 201, JSON.stringify(rb.json));
  assert.notEqual(ra.json.id, rb.json.id);
  assert.notEqual(ra.json.token, rb.json.token);
  assert.match(ra.json.recovery, /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
  assert.equal(ra.json.character.name, '测试甲');
  assert.equal(ra.json.character.appearance.top, 4);
  A1 = ra.json; B1 = rb.json;
});

test('重名被拒绝', async () => {
  const r = await call('/players', { body: A });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'name_taken');
});

test('昵称长度与非法字符被拒绝', async () => {
  assert.equal((await call('/players', { body: { name: 'a', appearance: APPEARANCE } })).status, 400);
  assert.equal((await call('/players', { body: { name: 'a'.repeat(13), appearance: APPEARANCE } })).status, 400);
  assert.equal((await call('/players', { body: { name: '<script>', appearance: APPEARANCE } })).status, 400);
});

test('外观字段被白名单夹取，不能塞入任意数据', async () => {
  const r = await call('/players', {
    body: { name: '夹取测试', appearance: { skin: 999, hair: -5, top: 'x', evil: '<img onerror=1>', acc: 3 } },
  });
  assert.equal(r.status, 201);
  const a = r.json.character.appearance;
  assert.equal(a.skin, 5);
  assert.equal(a.hair, 0);
  assert.equal(a.top, 0);
  assert.equal(a.acc, 3);
  assert.equal(a.evil, undefined);
});

test('刷新后可用恢复码恢复同一个角色', async () => {
  const r = await call('/session', { body: {}, token: A1.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.character.id, A1.id);
  assert.equal(r.json.character.name, '测试甲');
});

test('无 token / 错误 token 无法读取会话', async () => {
  assert.equal((await call('/session', { body: {} })).status, 401);
  assert.equal((await call('/session', { body: {}, token: 'deadbeef'.repeat(3) })).status, 401);
  assert.equal((await call('/sync', { body: { x: 0, y: 0 } })).status, 401);
  assert.equal((await call('/progress', { body: { progress: {} }, token: 'f'.repeat(40) })).status, 401);
});

test('两个玩家可以互相看见对方位置和外观', async () => {
  const sa = await call('/sync', { body: { x: -158, y: 178, dir: 'down', moving: true, mode: 'walk', since: 0 }, token: A1.token });
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
  const sb = await call('/sync', { body: { x: -150, y: 176, dir: 'left', moving: true, mode: 'walk', since: 0 }, token: B1.token });
  assert.equal(sb.status, 200);
  const seenByB = sb.json.players.find(p => p.id === A1.id);
  assert.ok(seenByB, 'B 应该能看到 A');
  assert.equal(seenByB.name, '测试甲');
  assert.equal(seenByB.appearance.top, 4);
  assert.ok(Math.abs(seenByB.x - -158) < 1);
  // 同步数据不应泄露身份凭证
  assert.equal(seenByB.token, undefined);
  assert.equal(seenByB.tokenHash, undefined);
  assert.equal(seenByB.progress, undefined);

  const sa2 = await call('/sync', { body: { x: -158, y: 178, since: 0 }, token: A1.token });
  assert.ok(sa2.json.players.find(p => p.id === B1.id), 'A 应该能看到 B');
});

test('聊天消息真实送达，且昵称由服务端身份决定', async () => {
  const sent = await call('/chat', { body: { text: '在未名湖边' }, token: A1.token });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal(sent.json.message.name, '测试甲');

  const sb = await call('/sync', { body: { x: -150, y: 176, since: 0 }, token: B1.token });
  const got = sb.json.messages.find(m => m.text === '在未名湖边');
  assert.ok(got, 'B 应该收到 A 的消息');
  assert.equal(got.name, '测试甲');

  // B 冒用 A 的昵称发送，落库仍然是 B 的名字
  const spoof = await call('/chat', { body: { text: '我是甲方', name: '测试甲' }, token: B1.token });
  assert.equal(spoof.status, 201);
  assert.equal(spoof.json.message.name, '测试乙');
});

test('聊天长度被截断，空消息与超频被拒绝', async () => {
  // 新角色避免受上一条消息的冷却影响
  const c = await call('/players', { body: { name: '测试丙', appearance: APPEARANCE } });
  assert.equal(c.status, 201);
  const long = await call('/chat', { body: { text: '喵'.repeat(500) }, token: c.json.token });
  assert.equal(long.status, 201);
  assert.ok([...long.json.message.text].length <= 120, '超长消息必须被截断');

  const again = await call('/chat', { body: { text: '再说一句' }, token: c.json.token });
  assert.equal(again.status, 429, '冷却期内必须被限流');

  const d = await call('/players', { body: { name: '测试丁', appearance: APPEARANCE } });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  const empty = await call('/chat', { body: { text: '   ' }, token: d.json.token });
  assert.equal(empty.status, 400);
});

test('存档写入只影响自己，读取不会串号', async () => {
  const progress = {
    ver: 1,
    visited: { 未名湖: 1, 博雅塔: 2 },
    cats: { weiming: { a: 42, t: 3, f: true } },
    items: ['一片完整的银杏叶'],
    ach: { first_walk: 1 },
    title: '湖边散步的人',
    stats: { dist: 1234, photos: 1, chats: 2 },
    hacker: '<script>alert(1)</script>',
  };
  const w = await call('/progress', { body: { progress }, token: A1.token });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal(w.json.progress.visited['未名湖'], 1);
  assert.equal(w.json.progress.cats.weiming.a, 42);
  assert.equal(w.json.progress.hacker, undefined, '未知字段必须被丢弃');

  const a = await call('/session', { body: {}, token: A1.token });
  const b = await call('/session', { body: {}, token: B1.token });
  assert.equal(a.json.progress.cats.weiming.a, 42);
  assert.deepEqual(b.json.progress, {}, 'B 的存档必须保持独立');
});

test('存档过大被拒绝', async () => {
  const visited = {};
  for (let i = 0; i < 900; i++) visited[('地点' + i).padEnd(40, 'x')] = i;
  const r = await call('/progress', { body: { progress: { visited } }, token: A1.token });
  assert.equal(r.status, 413);
});

test('资料修改只作用于本人', async () => {
  const r = await call('/profile', { body: { appearance: { ...APPEARANCE, top: 7 }, profile: { dept: '信息科学技术学院', grade: '2023', bio: '常驻湖边' } }, token: A1.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.character.appearance.top, 7);
  assert.equal(r.json.character.profile.dept, '信息科学技术学院');

  const b = await call('/session', { body: {}, token: B1.token });
  assert.equal(b.json.character.appearance.top, 6, 'B 的外观不应被改动');
});

test('CORS 只对允许的来源放行', async () => {
  const ok = await call('/health', { method: 'GET', origin: 'https://xxxxu-ll.github.io' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://xxxxu-ll.github.io');
  const bad = await call('/health', { method: 'GET', origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(base + '/players', { method: 'OPTIONS', headers: { origin: 'https://xxxxu-ll.github.io' } });
  assert.equal(pre.status, 204);
});

test('坐标超出世界范围会被夹回', async () => {
  const r = await call('/sync', { body: { x: 99999, y: -99999, since: 0 }, token: B1.token });
  assert.equal(r.status, 200);
  assert.ok(r.json.self.x <= 940);
  assert.ok(r.json.self.y >= -760);
});

test('不存在的接口返回 404', async () => {
  const r = await call('/nothing', { body: {} });
  assert.equal(r.status, 404);
});

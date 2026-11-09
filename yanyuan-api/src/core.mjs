// 《像素燕园》世界服务核心逻辑。
// 与运行时无关：Worker（D1）和本地 Node（SQLite）共用同一份实现。
// db 接口：get(sql, params) / all(sql, params) / run(sql, params)

export const LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 12,
  BIO_MAX: 30,
  CHAT_MAX: 120,
  CHAT_COOLDOWN_MS: 2000,
  SYNC_MIN_GAP_MS: 400,
  ONLINE_WINDOW_MS: 30000,
  PROGRESS_MAX_BYTES: 8192,
  CHAT_HISTORY_MS: 15 * 60 * 1000,
  CHAT_PAGE: 40,
  MESSAGE_KEEP: 300,
  REGISTER_PER_HOUR: 60,
  TOKEN_LEN: 20,
};

const SPAWN = { x: -158.0, y: 178.0, dir: 'down' }; // 静园草坪（构建脚本已验证不在建筑/水面内）

const APPEARANCE = {
  skin: [0, 5],
  hair: [0, 5],
  hairColor: [0, 7],
  top: [0, 7],
  pants: [0, 5],
  shoes: [0, 3],
  acc: [0, 4],
};

const DIRS = new Set(['down', 'up', 'left', 'right']);
const MODES = new Set(['walk', 'run', 'bike']);

// ---------------- 小工具 ----------------
const enc = new TextEncoder();

function json(status, body, extra = {}) {
  return { status, body, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } };
}
function fail(status, error, message) {
  return json(status, { error, message });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(len) {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

/** 恢复码显示形式：XXXX-XXXX-XXXX-XXXX-XXXX */
export function formatRecovery(raw) {
  return (raw.match(/.{1,4}/g) || []).join('-').toUpperCase();
}
export function normalizeRecovery(input) {
  return String(input || '').toUpperCase().replace(/[^0-9A-F]/g, '').toLowerCase();
}

function cleanText(s, maxLen) {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 32 || (c >= 0x7f && c <= 0x9f)) continue;
    if (c >= 0x202a && c <= 0x202e) continue;
    if (c >= 0x2066 && c <= 0x2069) continue;
    out += ch;
    if ([...out].length >= maxLen) break;
  }
  return out.trim();
}

function validName(name) {
  const n = cleanText(name, LIMITS.NAME_MAX + 1);
  if ([...n].length < LIMITS.NAME_MIN || [...n].length > LIMITS.NAME_MAX) return null;
  if (/[<>\\/\u0000]/.test(n)) return null;
  return n;
}

function sanitizeAppearance(input) {
  const out = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const [key, [lo, hi]] of Object.entries(APPEARANCE)) {
    const v = Number(src[key]);
    out[key] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : 0;
  }
  return out;
}

function sanitizeProfile(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    dept: cleanText(src.dept, 14),
    grade: cleanText(src.grade, 6),
    bio: cleanText(src.bio, LIMITS.BIO_MAX),
  };
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 进度白名单校验：拒绝任意 JSON，只保留已知结构 */
export function sanitizeProgress(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = { ver: 1, visited: {}, cats: {}, items: [], ach: {}, title: '', stats: {} };

  if (src.visited && typeof src.visited === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(src.visited)) {
      if (typeof k !== 'string' || k.length > 64) continue;
      out.visited[k] = Math.round(num(v, 0));
      if (++n >= 900) break;
    }
  }
  if (src.cats && typeof src.cats === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(src.cats)) {
      if (typeof k !== 'string' || k.length > 32 || !v || typeof v !== 'object') continue;
      out.cats[k] = {
        a: Math.max(0, Math.min(100, Math.round(num(v.a, 0)))),
        t: Math.round(num(v.t, 0)),
        f: !!v.f,
      };
      if (++n >= 60) break;
    }
  }
  if (Array.isArray(src.items)) {
    for (const it of src.items.slice(0, 60)) {
      const s = cleanText(it, 24);
      if (s) out.items.push(s);
    }
  }
  if (src.ach && typeof src.ach === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(src.ach)) {
      if (typeof k !== 'string' || k.length > 40) continue;
      out.ach[k] = Math.round(num(v, 0));
      if (++n >= 120) break;
    }
  }
  out.title = cleanText(src.title, 20);
  if (src.stats && typeof src.stats === 'object') {
    out.stats = {
      dist: Math.min(1e7, Math.max(0, num(src.stats.dist, 0))),
      bike: Math.min(1e7, Math.max(0, num(src.stats.bike, 0))),
      photos: Math.min(100000, Math.max(0, Math.round(num(src.stats.photos, 0)))),
      chats: Math.min(100000, Math.max(0, Math.round(num(src.stats.chats, 0)))),
    };
  }
  const size = enc.encode(JSON.stringify(out)).length;
  if (size > LIMITS.PROGRESS_MAX_BYTES) throw new Error('progress_too_large');
  return out;
}

function parseJSON(text, fallback) {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

function publicPlayer(row) {
  return {
    id: row.id,
    name: row.name,
    appearance: parseJSON(row.appearance, {}),
    profile: parseJSON(row.profile, {}),
    x: row.x,
    y: row.y,
    dir: row.dir,
    moving: !!row.moving,
    mode: row.mode,
    seenAt: row.seen_at,
  };
}

function selfCharacter(row) {
  return {
    id: row.id,
    name: row.name,
    appearance: parseJSON(row.appearance, {}),
    profile: parseJSON(row.profile, {}),
    x: row.x,
    y: row.y,
    dir: row.dir,
    mode: row.mode,
    createdAt: row.created_at,
  };
}

// ---------------- 限流 ----------------
async function hitLimit(db, key, limit, windowMs, now) {
  const row = await db.get('SELECT hits, expires_at FROM rate_limits WHERE key = ?', [key]);
  if (!row || row.expires_at < now) {
    await db.run('INSERT INTO rate_limits (key, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = 1, expires_at = excluded.expires_at',
      [key, now + windowMs]);
    return { ok: true, remaining: limit - 1 };
  }
  if (row.hits >= limit) return { ok: false, remaining: 0 };
  await db.run('UPDATE rate_limits SET hits = hits + 1 WHERE key = ?', [key]);
  return { ok: true, remaining: limit - row.hits - 1 };
}

// ---------------- 主入口 ----------------
/**
 * @param {{db: object, now?: () => number, maxW?: number, minW?: number, allowedOrigins?: string[]}} opts
 */
export function createWorld({ db, now = () => Date.now(), bounds = null, allowedOrigins = [], adminKey = '' }) {
  const worldBounds = bounds || { minX: -1220, minY: -760, maxX: 940, maxY: 790 };

  async function authenticate(headers) {
    const raw = (headers.authorization || headers.Authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!/^[0-9a-f]{16,64}$/i.test(raw)) return null;
    const hash = await sha256Hex(raw.toLowerCase());
    const row = await db.get('SELECT * FROM players WHERE token_hash = ?', [hash]);
    return row || null;
  }

  function adminOk(headers) {
    if (!adminKey) return false;
    const got = headers['x-admin-key'] || headers['X-Admin-Key'] || '';
    if (got.length !== adminKey.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ adminKey.charCodeAt(i);
    return diff === 0;
  }

  async function handle(req) {
    const { method, path, headers = {}, body = null, ip = '0.0.0.0' } = req;
    const t = now();

    if (method === 'OPTIONS') return { status: 204, body: null, headers: {} };

    if (path === '/api/health' || path === '/health') {
      const online = await db.get('SELECT COUNT(*) AS n FROM players WHERE seen_at > ?', [t - LIMITS.ONLINE_WINDOW_MS]);
      const total = await db.get('SELECT COUNT(*) AS n FROM players', []);
      return json(200, { ok: true, online: online ? online.n : 0, total: total ? total.n : 0, now: t });
    }

    // ---- 昵称可用性（只读，便于创建角色时即时提示）----
    if (path === '/api/check-name' && method === 'POST') {
      const limited = await hitLimit(db, 'name:' + ip, 60, 60_000, t);
      if (!limited.ok) return fail(429, 'rate_limited', '查得太快了，稍后再试');
      const name = validName(body && body.name);
      if (!name) return fail(400, 'bad_name', `昵称需要 ${LIMITS.NAME_MIN}–${LIMITS.NAME_MAX} 个字符`);
      const row = await db.get('SELECT id, created_at FROM players WHERE name_key = ?', [name.toLowerCase()]);
      return json(200, {
        name,
        available: !row,
        // 只暴露「什么时候被注册的」，不暴露任何角色内容
        takenSince: row ? row.created_at : null,
      });
    }

    // ---- 维护接口（需要 X-Admin-Key，未配置时直接当作不存在）----
    if (path.startsWith('/api/admin/') && method === 'POST') {
      if (!adminKey) return fail(404, 'not_found', '没有这个接口');
      if (!adminOk(headers)) return fail(403, 'forbidden', '无权访问');
      if (path === '/api/admin/players') {
        const q = cleanText(body && body.q, 20);
        const rows = q
          ? await db.all('SELECT id, name, created_at, seen_at, progress FROM players WHERE name LIKE ? ORDER BY created_at DESC LIMIT 50', ['%' + q + '%'])
          : await db.all('SELECT id, name, created_at, seen_at, progress FROM players ORDER BY created_at DESC LIMIT 50', []);
        return json(200, { players: rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at, seenAt: r.seen_at, progressBytes: (r.progress || '').length })) });
      }
      if (path === '/api/admin/reset-token') {
        // 补发恢复码：生成新凭证并作废旧凭证（用于旧弹窗未显示、玩家丢了码的情况）
        const name = cleanText(body && body.name, LIMITS.NAME_MAX);
        if (!name) return fail(400, 'bad_name', '缺少昵称');
        const target = await db.get('SELECT id FROM players WHERE name_key = ?', [name.toLowerCase()]);
        if (!target) return fail(404, 'not_found', '没有这个角色');
        const token = randomHex(LIMITS.TOKEN_LEN);
        const hash = await sha256Hex(token);
        await db.run('UPDATE players SET token_hash = ? WHERE id = ?', [hash, target.id]);
        return json(200, { name, token, recovery: formatRecovery(token) });
      }
      if (path === '/api/admin/delete') {
        const name = cleanText(body && body.name, LIMITS.NAME_MAX);
        if (!name) return fail(400, 'bad_name', '缺少昵称');
        const row = await db.get('SELECT id FROM players WHERE name_key = ?', [name.toLowerCase()]);
        if (!row) return json(200, { deleted: 0 });
        await db.run('DELETE FROM messages WHERE player_id = ?', [row.id]);
        await db.run('DELETE FROM players WHERE id = ?', [row.id]);
        return json(200, { deleted: 1, name });
      }
      return fail(404, 'not_found', '没有这个接口');
    }

    // ---- 创建角色 ----
    if (path === '/api/players' && method === 'POST') {
      const limited = await hitLimit(db, 'reg:' + ip, LIMITS.REGISTER_PER_HOUR, 3600_000, t);
      if (!limited.ok) return fail(429, 'rate_limited', '创建角色太频繁，请稍后再试');

      const name = validName(body && body.name);
      if (!name) return fail(400, 'bad_name', `昵称需要 ${LIMITS.NAME_MIN}–${LIMITS.NAME_MAX} 个字符`);
      const appearance = sanitizeAppearance(body && body.appearance);
      const profile = sanitizeProfile(body && body.profile);

      const nameKey = name.toLowerCase();
      const exists = await db.get('SELECT id FROM players WHERE name_key = ?', [nameKey]);
      if (exists) return fail(409, 'name_taken', '这个昵称已经被占用了，换一个吧');

      const token = randomHex(LIMITS.TOKEN_LEN);
      const hash = await sha256Hex(token);
      const id = 'p_' + randomHex(12);
      await db.run(
        `INSERT INTO players (id, token_hash, name, name_key, appearance, profile, progress, x, y, dir, moving, mode, created_at, updated_at, seen_at)
         VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, 0, 'walk', ?, ?, ?)`,
        [id, hash, name, nameKey, JSON.stringify(appearance), JSON.stringify(profile), SPAWN.x, SPAWN.y, SPAWN.dir, t, t, t]
      );
      const row = await db.get('SELECT * FROM players WHERE id = ?', [id]);
      return json(201, {
        id,
        token,
        recovery: formatRecovery(token),
        character: selfCharacter(row),
        progress: {},
        spawn: SPAWN,
      });
    }

    // ---- 恢复会话 ----
    if (path === '/api/session' && method === 'POST') {
      const row = await authenticate(headers);
      if (!row) return fail(401, 'bad_token', '恢复码无效');
      await db.run('UPDATE players SET seen_at = ?, updated_at = ? WHERE id = ?', [t, t, row.id]);
      return json(200, {
        character: selfCharacter(row),
        progress: parseJSON(row.progress, {}),
        now: t,
      });
    }

    // 以下接口都需要身份
    const authed = new Set(['/api/sync', '/api/chat', '/api/progress', '/api/profile', '/api/wave']);
    if (!authed.has(path)) return fail(404, 'not_found', '没有这个接口');

    const row = await authenticate(headers);
    if (!row) return fail(401, 'bad_token', '身份校验失败，请重新登录');

    // ---- 同步 ----
    if (path === '/api/sync' && method === 'POST') {
      let x = num(body && body.x, row.x);
      let y = num(body && body.y, row.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return fail(400, 'bad_position', '坐标无效');
      x = Math.min(worldBounds.maxX, Math.max(worldBounds.minX, x));
      y = Math.min(worldBounds.maxY, Math.max(worldBounds.minY, y));

      // 轻量防瞬移：单次同步位移不超过 60 米
      const dt = Math.max(0, t - row.seen_at) / 1000;
      const dist = Math.hypot(x - row.x, y - row.y);
      if (dist > 60 + dt * 14) { x = row.x; y = row.y; }

      const dir = DIRS.has(body && body.dir) ? body.dir : row.dir;
      const mode = MODES.has(body && body.mode) ? body.mode : row.mode;
      const moving = body && body.moving ? 1 : 0;

      if (t - row.seen_at >= LIMITS.SYNC_MIN_GAP_MS) {
        await db.run('UPDATE players SET x = ?, y = ?, dir = ?, moving = ?, mode = ?, seen_at = ?, updated_at = ? WHERE id = ?',
          [x, y, dir, moving, mode, t, t, row.id]);
      }

      const others = await db.all(
        `SELECT id, name, appearance, profile, x, y, dir, moving, mode, seen_at
         FROM players WHERE seen_at > ? AND id <> ? LIMIT 80`,
        [t - LIMITS.ONLINE_WINDOW_MS, row.id]
      );
      const since = Math.min(num(body && body.since, 0), t);
      const msgs = await db.all(
        `SELECT id, player_id, name, text, created_at FROM messages
         WHERE created_at > ? AND created_at > ? ORDER BY created_at ASC LIMIT ?`,
        [since, t - LIMITS.CHAT_HISTORY_MS, LIMITS.CHAT_PAGE]
      );
      return json(200, {
        now: t,
        players: others.map(publicPlayer),
        messages: msgs.map(m => ({ id: m.id, playerId: m.player_id, name: m.name, text: m.text, at: m.created_at })),
        gestures: await (async () => {
          const rows = await db.all(
            `SELECT id, from_id, from_name, kind, created_at FROM gestures
             WHERE to_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT 20`,
            [row.id, t - 15000]
          );
          return rows.map(g => ({ id: g.id, fromId: g.from_id, fromName: g.from_name, kind: g.kind, at: g.created_at }));
        })(),
        self: { x, y, dir, mode },
        online: others.length + 1,
      });
    }

    // ---- 瞬时互动：挥手 ----
    if (path === '/api/wave' && method === 'POST') {
      const to = cleanText(body && body.to, 40);
      if (!to) return fail(400, 'bad_target', '缺少对象');
      if (to === row.id) return fail(400, 'bad_target', '不能对自己挥手');
      const target = await db.get('SELECT id, name, seen_at FROM players WHERE id = ?', [to]);
      if (!target) return fail(404, 'not_found', '这个玩家已经不在了');
      if (target.seen_at < t - LIMITS.ONLINE_WINDOW_MS) return fail(409, 'offline', '对方已经离线');
      const limited = await hitLimit(db, 'wave:' + row.id, 30, 60_000, t);
      if (!limited.ok) return fail(429, 'rate_limited', '挥得太快了');
      const id = 'g_' + randomHex(10);
      await db.run('INSERT INTO gestures (id, from_id, from_name, to_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, row.id, row.name, to, 'wave', t]);
      return json(201, { gesture: { id, fromName: row.name, kind: 'wave', at: t } });
    }

    // ---- 聊天 ----
    if (path === '/api/chat' && method === 'POST') {
      if (t - row.last_chat_at < LIMITS.CHAT_COOLDOWN_MS) {
        return fail(429, 'chat_cooldown', '说得太快了，缓一下');
      }
      const text = cleanText(body && body.text, LIMITS.CHAT_MAX);
      if (!text) return fail(400, 'empty_message', '消息不能为空');
      const id = 'm_' + randomHex(10);
      await db.run('INSERT INTO messages (id, player_id, name, text, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, row.id, row.name, text, t]);
      await db.run('UPDATE players SET last_chat_at = ? WHERE id = ?', [t, row.id]);
      if (Math.random() < 0.15) {
        await db.run('DELETE FROM messages WHERE created_at < ?', [t - 6 * 3600_000]);
        await db.run('DELETE FROM rate_limits WHERE expires_at < ?', [t - 60_000]);
      }
      return json(201, { message: { id, playerId: row.id, name: row.name, text, at: t } });
    }

    // ---- 存档 ----
    if (path === '/api/progress' && method === 'POST') {
      let progress;
      try { progress = sanitizeProgress(body && body.progress); }
      catch { return fail(413, 'progress_too_large', '存档数据过大'); }
      await db.run('UPDATE players SET progress = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(progress), t, row.id]);
      return json(200, { progress, savedAt: t });
    }

    // ---- 资料 ----
    if (path === '/api/profile' && method === 'POST') {
      const appearance = body && body.appearance ? sanitizeAppearance(body.appearance) : parseJSON(row.appearance, {});
      const profile = body && body.profile ? sanitizeProfile(body.profile) : parseJSON(row.profile, {});
      await db.run('UPDATE players SET appearance = ?, profile = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(appearance), JSON.stringify(profile), t, row.id]);
      const fresh = await db.get('SELECT * FROM players WHERE id = ?', [row.id]);
      return json(200, { character: selfCharacter(fresh) });
    }

    return fail(404, 'not_found', '没有这个接口');
  }

  return { handle, SPAWN };
}

export { SPAWN };

// 世界 Durable Object：唯一的写入点，用 Durable Object SQLite 存玩家、聊天、存档。
// 不需要 D1，免费计划即可运行。
export class World {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ready = null;
  }

  _init() {
    if (this.ready) return this.ready;
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const sql = this.ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL,
        appearance TEXT NOT NULL, profile TEXT NOT NULL DEFAULT '{}', progress TEXT NOT NULL DEFAULT '{}',
        x REAL NOT NULL, y REAL NOT NULL, dir TEXT NOT NULL DEFAULT 'down', moving INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'walk', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        seen_at INTEGER NOT NULL DEFAULT 0, last_chat_at INTEGER NOT NULL DEFAULT 0)`);
      sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_players_token ON players(token_hash)`);
      sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name ON players(name_key)`);
      sql.exec(`CREATE INDEX IF NOT EXISTS idx_players_seen ON players(seen_at)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, player_id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL,
        created_at INTEGER NOT NULL)`);
      sql.exec(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS gestures (
        id TEXT PRIMARY KEY, from_id TEXT NOT NULL, from_name TEXT NOT NULL,
        to_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL)`);
      sql.exec(`CREATE INDEX IF NOT EXISTS idx_gestures_to ON gestures(to_id, created_at)`);
    });
    return this.ready;
  }

  _db() {
    const sql = this.ctx.storage.sql;
    return {
      async get(q, params = []) {
        const rows = sql.exec(q, ...params).toArray();
        return rows[0];
      },
      async all(q, params = []) {
        return sql.exec(q, ...params).toArray();
      },
      async run(q, params = []) {
        sql.exec(q, ...params);
        return {};
      },
    };
  }

  async fetch(request) {
    await this._init();

    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsFor(origin, this.env);

    let body = null;
    if (request.method === 'POST') {
      const text = await request.text();
      if (text) {
        try { body = JSON.parse(text); } catch {
          return new Response(JSON.stringify({ error: 'bad_json', message: '请求体不是合法 JSON' }), {
            status: 400, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
          });
        }
      }
    }

    const headers = {};
    for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;

    const world = createWorld({
      db: this._db(),
      now: () => Date.now(),
      allowedOrigins: allowedOrigins(this.env),
      adminKey: this.env.ADMIN_KEY || '',
    });

    let res;
    try {
      res = await world.handle({
        method: request.method,
        path: url.pathname,
        headers,
        body,
        ip: request.headers.get('CF-Connecting-IP') || '0.0.0.0',
      });
    } catch (err) {
      res = { status: 500, body: { error: 'server_error', message: '世界服务出错了' }, headers: { 'content-type': 'application/json; charset=utf-8' } };
    }

    return new Response(res.body === null ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: {
        ...(res.headers || {}),
        ...cors,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  }
}

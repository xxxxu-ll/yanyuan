-- 《像素燕园》世界存档表结构（Cloudflare D1 / 本地 SQLite 通用）
CREATE TABLE IF NOT EXISTS players (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL,
  name         TEXT NOT NULL,
  name_key     TEXT NOT NULL,
  appearance   TEXT NOT NULL,
  profile      TEXT NOT NULL DEFAULT '{}',
  progress     TEXT NOT NULL DEFAULT '{}',
  x            REAL NOT NULL,
  y            REAL NOT NULL,
  dir          TEXT NOT NULL DEFAULT 'down',
  moving       INTEGER NOT NULL DEFAULT 0,
  mode         TEXT NOT NULL DEFAULT 'walk',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  seen_at      INTEGER NOT NULL DEFAULT 0,
  last_chat_at INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_token ON players(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name ON players(name_key);
CREATE INDEX IF NOT EXISTS idx_players_seen ON players(seen_at);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT PRIMARY KEY,
  hits       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

-- 瞬时互动（挥手等），只用于在线提示，不做长期存储
CREATE TABLE IF NOT EXISTS gestures (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL,
  from_name  TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gestures_to ON gestures(to_id, created_at);

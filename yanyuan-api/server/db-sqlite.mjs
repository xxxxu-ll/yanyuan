// 本地开发/测试用的 SQLite 适配器（Node 24 内置 node:sqlite）
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return {
    raw: db,
    async get(sql, params = []) {
      return db.prepare(sql).get(...params) || undefined;
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      return db.prepare(sql).run(...params);
    },
    close() { try { db.close(); } catch { /* ignore */ } },
  };
}

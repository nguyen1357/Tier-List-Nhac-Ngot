/*
 * Lưu dữ liệu vào Cloudflare D1 (dùng khi deploy lên Cloudflare Pages).
 * Bảng được tự tạo ở request đầu tiên — không cần chạy migration.
 *
 *   lists     danh sách bài (khi bạn thêm bài / đổi tuỳ chọn); mặc định lấy từ seed-data.js
 *   sessions  trạng thái từng lần xếp
 *   events    nhật ký thao tác, chỉ ghi thêm (session_id, seq)
 *   apple     thông tin Apple Music tra thêm; mặc định lấy từ seed-data.js
 */
import { SEED_LISTS, SEED_APPLE } from './seed-data.js';

let ready = null;
function init(db) {
  if (!ready) {
    ready = db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT)'),
      db.prepare('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, list_id TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT)'),
      db.prepare('CREATE TABLE IF NOT EXISTS events (session_id TEXT NOT NULL, seq INTEGER NOT NULL, t TEXT, type TEXT, json TEXT NOT NULL, PRIMARY KEY (session_id, seq))'),
      db.prepare('CREATE TABLE IF NOT EXISTS apple (key TEXT PRIMARY KEY, json TEXT NOT NULL)'),
    ]).catch((e) => { ready = null; throw e; });
  }
  return ready;
}
const parse = (row) => (row ? JSON.parse(row.json) : null);

export function d1Store(db) {
  const q = async (fn) => { await init(db); return fn(); };
  return {
    listLists: () => q(async () => {
      const { results } = await db.prepare('SELECT json FROM lists').all();
      const byId = { ...SEED_LISTS };
      for (const r of results) { const l = JSON.parse(r.json); byId[l.id] = l; }
      return Object.values(byId).map((l) => ({ id: l.id, eyebrow: l.eyebrow, title: l.title, count: (l.songs || []).length }));
    }),
    getList: (id) => q(async () => parse(await db.prepare('SELECT json FROM lists WHERE id = ?').bind(id).first()) || SEED_LISTS[id] || null),
    putList: (id, body) => q(() => db.prepare('INSERT OR REPLACE INTO lists (id, json, updated_at) VALUES (?, ?, ?)')
      .bind(id, JSON.stringify(body), new Date().toISOString()).run()),

    listSessions: (listId) => q(async () => {
      const stmt = listId
        ? db.prepare('SELECT json FROM sessions WHERE list_id = ? ORDER BY updated_at DESC').bind(listId)
        : db.prepare('SELECT json FROM sessions ORDER BY updated_at DESC');
      return (await stmt.all()).results.map(parse);
    }),
    getSession: (id) => q(async () => parse(await db.prepare('SELECT json FROM sessions WHERE id = ?').bind(id).first())),
    saveSession: (id, body) => q(async () => {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM events WHERE session_id = ?').bind(id).first();
      const prevCount = row ? Number(row.n) : 0;
      const stmts = body.events.slice(prevCount).map((e, i) => db
        .prepare('INSERT OR IGNORE INTO events (session_id, seq, t, type, json) VALUES (?, ?, ?, ?, ?)')
        .bind(id, prevCount + i, e.t || null, e.type || null, JSON.stringify(e)));
      stmts.push(db.prepare('INSERT OR REPLACE INTO sessions (id, list_id, json, updated_at) VALUES (?, ?, ?, ?)')
        .bind(id, body.listId, JSON.stringify(body), body.updatedAt));
      await db.batch(stmts);
    }),
    deleteSession: (id) => q(() => db.batch([
      db.prepare('DELETE FROM sessions WHERE id = ?').bind(id),
      db.prepare('DELETE FROM events WHERE session_id = ?').bind(id),
    ])),

    getAppleAll: (listId) => q(async () => {
      const out = {};
      const prefix = `${listId}:`;
      for (const [k, v] of Object.entries(SEED_APPLE)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
      const { results } = await db.prepare('SELECT key, json FROM apple WHERE key LIKE ?').bind(`${listId}:%`).all();
      for (const r of results) out[r.key.slice(prefix.length)] = JSON.parse(r.json);
      return out;
    }),
    getApple: (key) => q(async () => parse(await db.prepare('SELECT json FROM apple WHERE key = ?').bind(key).first()) || SEED_APPLE[key] || null),
    putApple: (key, value) => q(() => db.prepare('INSERT OR REPLACE INTO apple (key, json) VALUES (?, ?)').bind(key, JSON.stringify(value)).run()),
  };
}

/*
 * Lưu dữ liệu vào thư mục data/ (dùng khi chạy local bằng `node server.js`).
 *   data/lists/<listId>.json      danh sách bài + định nghĩa tier
 *   data/sessions/<id>.json       trạng thái từng lần xếp
 *   data/sessions/<id>.md         kết quả dễ đọc của lần xếp (tự cập nhật)
 *   data/logs/<id>.jsonl          nhật ký thao tác (chỉ ghi thêm, mỗi dòng 1 sự kiện)
 *   data/apple-cache.json         thông tin Apple Music (link, năm, ảnh bìa, nghe thử)
 */
import fs from 'node:fs';
import path from 'node:path';
import { sessionToMarkdown } from './core.js';

const fsp = fs.promises;

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}
async function writeJSON(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fsp.rename(tmp, file);
}
// Ghi tuần tự theo từng khoá để 2 lần lưu không chồng nhau
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

export function fsStore(dataDir) {
  const LISTS = path.join(dataDir, 'lists');
  const SESSIONS = path.join(dataDir, 'sessions');
  const LOGS = path.join(dataDir, 'logs');
  const APPLE = path.join(dataDir, 'apple-cache.json');
  for (const d of [LISTS, SESSIONS, LOGS]) fs.mkdirSync(d, { recursive: true });
  const listFile = (id) => path.join(LISTS, `${id}.json`);
  const sessionFile = (id) => path.join(SESSIONS, `${id}.json`);

  let apple = null;
  const appleCache = async () => { if (!apple) apple = await readJSON(APPLE, {}); return apple; };
  let appleTimer = null;

  return {
    async listLists() {
      const out = [];
      for (const f of (await fsp.readdir(LISTS)).filter((x) => x.endsWith('.json'))) {
        const l = await readJSON(path.join(LISTS, f), null);
        if (l) out.push({ id: l.id, eyebrow: l.eyebrow, title: l.title, count: (l.songs || []).length });
      }
      return out;
    },
    getList: (id) => readJSON(listFile(id), null),
    putList: (id, body) => withLock(`list:${id}`, () => writeJSON(listFile(id), body)),

    async listSessions(listId) {
      const out = [];
      for (const f of (await fsp.readdir(SESSIONS)).filter((x) => x.endsWith('.json'))) {
        const s = await readJSON(path.join(SESSIONS, f), null);
        if (s && (!listId || s.listId === listId)) out.push(s);
      }
      return out;
    },
    getSession: (id) => readJSON(sessionFile(id), null),
    saveSession: (id, body, { list } = {}) => withLock(`session:${id}`, async () => {
      const prev = await readJSON(sessionFile(id), null);
      const prevCount = prev && Array.isArray(prev.events) ? prev.events.length : 0;
      const fresh = body.events.slice(prevCount);
      if (fresh.length) await fsp.appendFile(path.join(LOGS, `${id}.jsonl`), fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
      await writeJSON(sessionFile(id), body);
      if (list) await fsp.writeFile(path.join(SESSIONS, `${id}.md`), sessionToMarkdown(body, list));
    }),
    deleteSession: (id) => withLock(`session:${id}`, async () => {
      for (const f of [sessionFile(id), path.join(SESSIONS, `${id}.md`), path.join(LOGS, `${id}.jsonl`)]) {
        await fsp.unlink(f).catch(() => {});
      }
    }),

    async getAppleAll(listId) {
      const cache = await appleCache();
      const out = {};
      const prefix = `${listId}:`;
      for (const [k, v] of Object.entries(cache)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
      return out;
    },
    async getApple(key) { return (await appleCache())[key] || null; },
    async putApple(key, value) {
      (await appleCache())[key] = value;
      clearTimeout(appleTimer);
      appleTimer = setTimeout(() => writeJSON(APPLE, apple).catch(console.error), 400);
    },
  };
}

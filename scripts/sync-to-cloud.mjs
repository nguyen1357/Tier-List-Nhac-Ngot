#!/usr/bin/env node
/*
 * Đẩy các lần xếp đã lưu trên máy (data/sessions/*.json) lên bản online (Cloudflare).
 *
 *   node scripts/sync-to-cloud.mjs https://ten-project.pages.dev
 *   node scripts/sync-to-cloud.mjs https://ten-project.pages.dev matkhau        # nếu web có APP_PASSWORD
 *   node scripts/sync-to-cloud.mjs https://ten-project.pages.dev matkhau --list # đẩy cả tiêu đề/hạng đã sửa trên máy
 *
 * Lần xếp nào đã có trên cloud và mới hơn bản trên máy thì giữ nguyên bản cloud.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const withList = args.includes('--list');
const [base, password] = args.filter((a) => a !== '--list');
if (!base || !/^https?:\/\//.test(base)) {
  console.log('Cách dùng: node scripts/sync-to-cloud.mjs https://ten-project.pages.dev [matkhau] [--list]');
  process.exit(1);
}
const BASE = base.replace(/\/+$/, '');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readDir = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))) : []);

let cookie = '';
async function call(method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data, headers: r.headers };
}

const login = await call('POST', '/api/login', { password: password || '' });
if (login.status === 401) { console.error('✗ Sai mật khẩu (hoặc web có mật khẩu mà bạn chưa nhập).'); process.exit(1); }
const setCookie = login.headers.get('set-cookie');
if (setCookie) cookie = setCookie.split(';')[0];
const probe = await call('GET', '/api/lists');
if (probe.status !== 200) { console.error(`✗ Không kết nối được ${BASE}: ${probe.status} ${JSON.stringify(probe.data)}`); process.exit(1); }

if (withList) {
  for (const l of readDir(path.join(ROOT, 'data', 'lists'))) {
    const r = await call('PUT', `/api/lists/${l.id}`, l);
    console.log(r.status === 200 ? `✓ Danh sách "${l.id}" (tiêu đề, hạng, bài)` : `✗ Danh sách ${l.id}: ${JSON.stringify(r.data)}`);
  }
}

const sessions = readDir(path.join(ROOT, 'data', 'sessions'));
if (!sessions.length) console.log('Không có lần xếp nào trong data/sessions để đẩy lên.');
let up = 0; let skip = 0; let fail = 0;
for (const s of sessions) {
  const remote = await call('GET', `/api/sessions/${s.id}`);
  if (remote.status === 200 && String(remote.data.updatedAt) >= String(s.updatedAt)) { skip++; console.log(`· ${s.name}: bản trên cloud đã mới hơn, giữ nguyên`); continue; }
  const r = await call('PUT', `/api/sessions/${s.id}`, s);
  if (r.status === 200) { up++; console.log(`✓ ${s.name} (${Object.values(s.tiers || {}).flat().length} bài đã xếp, ${(s.events || []).length} thao tác)`); } else { fail++; console.log(`✗ ${s.name}: ${JSON.stringify(r.data)}`); }
}
console.log(`\nXong: đẩy lên ${up}, giữ nguyên ${skip}, lỗi ${fail}. Mở ${BASE} → Menu → Lịch sử để xem.`);

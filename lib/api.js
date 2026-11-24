/*
 * API dùng chung: nhận Request chuẩn Web, trả Response.
 * `store` là nơi lưu dữ liệu: thư mục data/ (Node) hoặc Cloudflare D1.
 *
 * Mật khẩu (tuỳ chọn): đặt biến môi trường APP_PASSWORD. Khi có, mọi /api/* cần đăng nhập
 * (cookie HttpOnly sau khi POST /api/login).
 */
import { ID_RE, appleLookup, sessionToMarkdown, summarize, itunesSearch } from './core.js';

const json = (status, obj, headers = {}) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function getCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > 8e6) throw new Error('Body quá lớn');
  return text ? JSON.parse(text) : {};
}

export async function handleApi(request, store, { password = '', search = itunesSearch } = {}) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  const m = request.method;

  try {
    /* ---------- đăng nhập ---------- */
    if (parts[0] === 'login') {
      if (!password) return json(200, { ok: true, open: true });
      if (m !== 'POST') return json(405, { error: 'POST only' });
      const body = await readJsonBody(request).catch(() => ({}));
      if (body.password !== password) return json(401, { error: 'Sai mật khẩu' });
      const token = await sha256(`tierlist:${password}`);
      const secure = url.protocol === 'https:' ? '; Secure' : '';
      return json(200, { ok: true }, {
        'Set-Cookie': `tl_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
      });
    }
    if (password && getCookie(request, 'tl_auth') !== await sha256(`tierlist:${password}`)) {
      return json(401, { error: 'Cần mật khẩu', needLogin: true });
    }

    /* ---------- danh sách bài ---------- */
    if (parts[0] === 'lists') {
      if (parts.length === 1 && m === 'GET') return json(200, await store.listLists());
      const id = parts[1];
      if (!ID_RE.test(id || '')) return json(400, { error: 'id không hợp lệ' });
      if (m === 'GET') {
        const l = await store.getList(id);
        return l ? json(200, l) : json(404, { error: 'Không tìm thấy list' });
      }
      if (m === 'PUT') {
        const body = await readJsonBody(request);
        if (!Array.isArray(body.songs) || !Array.isArray(body.tiers)) return json(400, { error: 'Thiếu songs/tiers' });
        body.id = id;
        await store.putList(id, body);
        return json(200, { ok: true });
      }
    }

    /* ---------- các lần xếp ---------- */
    if (parts[0] === 'sessions') {
      if (parts.length === 1 && m === 'GET') {
        const listId = url.searchParams.get('list');
        const sessions = await store.listSessions(listId);
        const lists = {};
        const out = [];
        for (const s of sessions) {
          if (!(s.listId in lists)) lists[s.listId] = await store.getList(s.listId);
          out.push(summarize(s, lists[s.listId]));
        }
        out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        return json(200, out);
      }
      const id = parts[1];
      if (!ID_RE.test(id || '')) return json(400, { error: 'id không hợp lệ' });

      if (parts[2] === 'export.md' && m === 'GET') {
        const s = await store.getSession(id);
        if (!s) return json(404, { error: 'Không tìm thấy lần xếp' });
        const list = await store.getList(s.listId);
        if (!list) return json(404, { error: 'Không tìm thấy list' });
        return new Response(sessionToMarkdown(s, list), {
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${id}.md"`,
            'Cache-Control': 'no-store',
          },
        });
      }
      if (m === 'GET') {
        const s = await store.getSession(id);
        return s ? json(200, s) : json(404, { error: 'Không tìm thấy lần xếp' });
      }
      if (m === 'PUT' || m === 'POST') { // POST: navigator.sendBeacon khi đóng tab
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || !body.listId) return json(400, { error: 'Thiếu listId' });
        body.id = id;
        body.updatedAt = new Date().toISOString();
        if (!Array.isArray(body.events)) body.events = [];
        await store.saveSession(id, body, { list: await store.getList(body.listId) });
        return json(200, { ok: true });
      }
      if (m === 'DELETE') {
        await store.deleteSession(id);
        return json(200, { ok: true });
      }
    }

    /* ---------- Apple Music ---------- */
    if (parts[0] === 'apple') {
      const listId = parts[1];
      const songId = parts[2];
      if (!ID_RE.test(listId || '')) return json(400, { error: 'listId không hợp lệ' });
      if (!songId && m === 'GET') return json(200, await store.getAppleAll(listId));
      if (songId && m === 'GET') {
        const key = `${listId}:${songId}`;
        const cached = await store.getApple(key);
        if (cached && url.searchParams.get('force') !== '1') return json(200, cached);
        const list = await store.getList(listId);
        const song = list && list.songs.find((s) => s.id === songId);
        if (!song) return json(404, { error: 'Không tìm thấy bài' });
        try {
          const info = await appleLookup(song, list, search);
          await store.putApple(key, info);
          return json(200, info);
        } catch (e) {
          return json(502, { error: `Không tra được Apple Music: ${e.message}` });
        }
      }
    }

    return json(404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
}

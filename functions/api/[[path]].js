/*
 * Cloudflare Pages Function: xử lý mọi request /api/*.
 * Cần gắn D1 database với tên biến (binding) là DB.
 * Tuỳ chọn: biến môi trường APP_PASSWORD để bật mật khẩu.
 */
import { handleApi } from '../../lib/api.js';
import { d1Store } from '../../lib/store-d1.js';

export async function onRequest({ request, env }) {
  if (!env.DB) {
    return new Response(JSON.stringify({
      error: 'Chưa gắn D1 database. Vào Cloudflare → Pages project → Settings → Bindings → thêm D1 database với Variable name = DB, rồi deploy lại.',
    }), { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  return handleApi(request, d1Store(env.DB), { password: env.APP_PASSWORD || '' });
}

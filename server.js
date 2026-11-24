#!/usr/bin/env node
/*
 * Tier List Nhạc — chạy local, không cần cài thư viện (Node 18+).
 *   node server.js                    -> http://localhost:5173
 *   PORT=8080 node server.js          -> đổi cổng
 *   APP_PASSWORD=bimat node server.js -> bật mật khẩu
 * Dữ liệu & log lưu trong thư mục data/ (xem lib/store-fs.js).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { handleApi } from './lib/api.js';
import { fsStore } from './lib/store-fs.js';
import { itunesSearch } from './lib/core.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto; // Node 18

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const store = fsStore(path.join(ROOT, 'data'));

// iTunes giới hạn ~20 request/phút -> xếp hàng, mỗi request cách nhau >= 1.5s
let queue = Promise.resolve();
let last = 0;
function throttledSearch(term, country) {
  const p = queue.then(async () => {
    const wait = Math.max(0, last + 1500 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return itunesSearch(term, country);
  });
  queue = p.catch(() => {});
  return p;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 8e6) { reject(new Error('Body quá lớn')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveApi(req, res) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? await readRaw(req) : undefined,
  });
  const response = await handleApi(request, store, { password: process.env.APP_PASSWORD || '', search: throttledSearch });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const data = await fs.promises.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await serveApi(req, res);
    else await serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: e.message })); }
  }
}).listen(PORT, HOST, () => {
  console.log(`\n  🎵 Tier List Nhạc đang chạy: http://localhost:${PORT}\n  Dữ liệu & log lưu trong: ${path.join(ROOT, 'data')}${process.env.APP_PASSWORD ? '\n  🔒 Đã bật mật khẩu' : ''}\n  (Ctrl+C để tắt)\n`);
});

// Gói data/lists/*.json + data/apple-cache.json thành lib/seed-data.js để Cloudflare Functions dùng.
// Chạy: npm run build   (Cloudflare Pages cũng chạy lệnh này khi deploy)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const listsDir = path.join(root, 'data', 'lists');
const lists = {};
for (const f of fs.readdirSync(listsDir).filter((x) => x.endsWith('.json'))) {
  const l = JSON.parse(fs.readFileSync(path.join(listsDir, f), 'utf8'));
  lists[l.id] = l;
}
const applePath = path.join(root, 'data', 'apple-cache.json');
const apple = fs.existsSync(applePath) ? JSON.parse(fs.readFileSync(applePath, 'utf8')) : {};
const out = `// FILE TỰ SINH bởi scripts/build-seed.mjs — đừng sửa tay. Sửa data/lists/*.json rồi chạy: npm run build
export const SEED_LISTS = ${JSON.stringify(lists)};
export const SEED_APPLE = ${JSON.stringify(apple)};
`;
fs.writeFileSync(path.join(root, 'lib', 'seed-data.js'), out);
console.log(`seed-data.js: ${Object.keys(lists).length} list, ${Object.keys(apple).length} mục Apple Music`);

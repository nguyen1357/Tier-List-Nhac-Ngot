'use strict';
/* ======================================================================
 * Tier List Nhạc — client
 * ==================================================================== */

/* ---------------- tiny helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const api = {
  async req(method, url, body, retry = true) {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (r.status === 401 && data && data.needLogin && retry) { // trang có mật khẩu
      await askLogin();
      return this.req(method, url, body, false);
    }
    if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
    return data;
  },
  get(u) { return this.req('GET', u); },
  put(u, b) { return this.req('PUT', u, b); },
  del(u) { return this.req('DELETE', u); },
};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
  .toLowerCase().replace(/[^a-z0-9%]+/g, '');
const baseTitle = (t) => norm(String(t || '').replace(/\([^)]*\)/g, ' ')) || norm(t);
const plainTitle = (t) => String(t || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || String(t || '');
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
  .replace(/%/g, '-phan-tram').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bai';
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

/* ---------------- state ---------------- */
let LIST = null;           // định nghĩa list (tiers + songs)
let SONGS = new Map();     // id -> song (kể cả bài bị bỏ qua, để hiện tên trong nhật ký)
let ACTIVE = [];           // các bài được xếp (đã loại single trùng album)
let ACTIVE_SET = new Set();
let ALBUM_COUNT = new Map();
let APPLE = {};            // id -> thông tin Apple Music
let S = null;              // lần xếp hiện tại
let undoStack = [];
let rolling = false;
let lastTouched = null;
let audio = null;
let modalKey = null;
const appleInflight = new Set();

const tierById = (id) => LIST.tiers.find((t) => t.id === id);
const lastTier = () => LIST.tiers[LIST.tiers.length - 1];
const songName = (s) => s.short || s.title;
const displayTitle = (s) => songName(s) + (s.feat ? ` (với ${s.feat})` : '');

function indexSongs() {
  SONGS = new Map(LIST.songs.map((s) => [s.id, s]));
  ALBUM_COUNT = new Map();
  for (const s of LIST.songs) if (s.album && s.album !== 'Single') ALBUM_COUNT.set(s.album, (ALBUM_COUNT.get(s.album) || 0) + 1);
  // Ưu tiên album: single trùng tên + cùng nghệ sĩ với một bài trong album -> bỏ qua single
  const albumKeys = new Map();
  for (const s of LIST.songs) {
    if (s.album === 'Single') continue;
    albumKeys.set(`${norm(s.artist)}|${baseTitle(s.short || s.title)}`, s.id);
  }
  for (const s of LIST.songs) {
    if (s.album !== 'Single' || s.keepDuplicate || s.duplicateOf) continue;
    const hit = albumKeys.get(`${norm(s.artist)}|${baseTitle(s.short || s.title)}`);
    if (hit) s.duplicateOf = hit;
  }
  ACTIVE = LIST.songs.filter((s) => !s.duplicateOf && !(s.guest && LIST.excludeGuests) && !(s.demo && LIST.excludeDemos));
  ACTIVE_SET = new Set(ACTIVE.map((s) => s.id));
}
/** Apple báo single này đã nằm trong album có sẵn -> bỏ qua khỏi bộ bài */
function excludeDuplicate(id, dupId) {
  const s = SONGS.get(id);
  if (!s || s.album !== 'Single' || s.keepDuplicate || s.duplicateOf || !SONGS.has(dupId)) return false;
  s.duplicateOf = dupId;
  indexSongs();
  if (S) {
    if (S.current === id) stopPreview();
    normalizeSession(S);
    log({ type: 'skip-duplicate', song: id, of: dupId });
    checkFinished();
    save();
    render();
  }
  saveList();
  const d = SONGS.get(dupId);
  toast(`Bỏ qua single “${displayTitle(s)}” — đã có trong album ${d.album} (${displayTitle(d)})`, 'warn');
  return true;
}
function toggleGroup(flag, label) {
  if (!LIST[flag]) {
    const key = flag === 'excludeGuests' ? 'guest' : 'demo';
    const placed = [...placedSet()].filter((id) => SONGS.get(id)[key]).length;
    if (placed && !confirm(`${placed} bài trong nhóm này đã được xếp và sẽ bị gỡ khỏi bảng (bật lại sẽ phải xếp lại). Tiếp tục?`)) return;
  }
  LIST[flag] = !LIST[flag];
  indexSongs();
  if (S.current && !ACTIVE_SET.has(S.current)) stopPreview();
  normalizeSession(S);
  log({ type: LIST[flag] ? 'exclude-group' : 'include-group', group: label });
  checkFinished();
  saveList();
  save();
  render();
  closeModal();
  toast(LIST[flag] ? `Không tính ${label}` : `Đã tính cả ${label}`, 'ok');
}
const toggleGuests = () => toggleGroup('excludeGuests', 'các bài kết hợp (Thắng góp giọng)');
function keepDuplicate(id) {
  const s = SONGS.get(id);
  if (!s) return;
  delete s.duplicateOf;
  s.keepDuplicate = true;
  indexSongs();
  saveList();
  save();
  render();
  toast(`Đã đưa “${displayTitle(s)}” trở lại bộ bài`, 'ok');
}

/** Thông tin hiển thị đầy đủ của 1 bài (gộp dữ liệu gốc + Apple Music) */
function meta(id) {
  const s = SONGS.get(id);
  const a = APPLE[id];
  const ok = !!(a && a.found);
  const override = ok && s.verify; // single/collab chưa xác minh -> tin Apple
  const album = override ? a.collectionName : s.album;
  const artist = override ? a.artistName : s.artist;
  const searchTerm = `${plainTitle(songName(s))} ${s.artist}`;
  return {
    ...s,
    artist,
    album,
    albumShort: override ? a.collectionName : (s.albumShort || s.album),
    year: (override ? a.year : s.year) || (ok ? a.year : null),
    track: override ? a.trackNumber : (s.track || (ok ? a.trackNumber : null)),
    trackCount: override ? a.trackCount : (ALBUM_COUNT.get(s.album) || (ok ? a.trackCount : null)),
    artwork: ok ? a.artwork : null,
    preview: ok ? a.previewUrl : null,
    appleUrl: (ok && a.trackViewUrl) || s.appleUrl || null,
    appleAlbumUrl: (ok && a.collectionViewUrl) || s.appleAlbumUrl || null,
    appleSearch: `https://music.apple.com/vn/search?term=${encodeURIComponent(searchTerm)}`,
  };
}

function placedSet() {
  const set = new Set();
  for (const t of LIST.tiers) for (const id of S.tiers[t.id]) set.add(id);
  return set;
}
function pendingIds() {
  const placed = placedSet();
  const removed = new Set(S.removed);
  return ACTIVE.map((s) => s.id).filter((id) => !placed.has(id) && !removed.has(id) && id !== S.current);
}
function locate(id) {
  for (const t of LIST.tiers) {
    const i = S.tiers[t.id].indexOf(id);
    if (i >= 0) return { zone: 'tier', tier: t.id, index: i };
  }
  if (S.removed.includes(id)) return { zone: 'removed' };
  if (S.current === id) return { zone: 'current' };
  return { zone: 'pending' };
}
function detach(id) {
  for (const t of LIST.tiers) S.tiers[t.id] = S.tiers[t.id].filter((x) => x !== id);
  S.removed = S.removed.filter((x) => x !== id);
  if (S.current === id) S.current = null;
}
function statusLabel(id) {
  const l = locate(id);
  if (l.zone === 'tier') return tierById(l.tier).name;
  if (l.zone === 'removed') return 'Đã bỏ';
  if (l.zone === 'current') return 'Đang nghe';
  return 'Chưa xếp';
}

/* ---------------- mutations + undo + log ---------------- */
const snap = () => JSON.stringify({ tiers: S.tiers, removed: S.removed, current: S.current, finished: S.finished });
function log(e) { S.events.push({ t: new Date().toISOString(), ...e }); }
function commit(event, fn) {
  const before = snap();
  fn();
  if (snap() === before) return false;
  undoStack.push(before);
  if (undoStack.length > 300) undoStack.shift();
  if (event) log(event);
  checkFinished();
  save();
  render();
  return true;
}
function checkFinished() {
  const N = ACTIVE.length;
  const done = placedSet().size + S.removed.length === N && !S.current;
  if (done && !S.finished) {
    S.finished = true;
    log({ type: 'finish' });
    setTimeout(() => toast(`🎉 Xếp xong cả ${N} bài! Bấm ⋯ (M) → Xuất kết quả.`, 'ok'), 300);
  } else if (!done) S.finished = false;
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) return toast('Không còn gì để hoàn tác');
  Object.assign(S, JSON.parse(prev));
  normalizeSession(S); // không khôi phục single đã bị loại vì trùng album
  log({ type: 'undo' });
  stopPreview();
  save();
  render();
  if (S.current) ensureApple(S.current);
  toast('↶ Đã hoàn tác');
}

function place(id, tierId, index = null) {
  if (!SONGS.has(id) || !tierById(tierId)) return;
  const from = locate(id);
  let ev;
  if (from.zone === 'tier') ev = from.tier === tierId ? { type: 'reorder', song: id, tier: tierId, index } : { type: 'move', song: id, from: from.tier, tier: tierId };
  else ev = { type: 'place', song: id, tier: tierId, from: from.zone };
  lastTouched = id;
  setTimeout(() => { if (lastTouched === id) lastTouched = null; }, 1300);
  const changed = commit(ev, () => {
    detach(id);
    const arr = S.tiers[tierId];
    const idx = index == null || index > arr.length ? arr.length : Math.max(0, index);
    arr.splice(idx, 0, id);
  });
  if (changed && from.zone === 'current') {
    stopPreview();
    const t = tierById(tierId);
    toast(`${displayTitle(SONGS.get(id))} → ${t.name}`);
  }
}
function removeSong(id) {
  if (!id) return toast('Chưa có bài nào để bỏ', 'warn');
  const from = locate(id);
  if (from.zone === 'current') stopPreview();
  commit({ type: 'remove', song: id, from: from.tier || from.zone }, () => { detach(id); S.removed.push(id); });
  toast(`✕ Đã bỏ ${displayTitle(SONGS.get(id))}`);
}
function restoreSong(id) {
  commit({ type: 'restore', song: id }, () => detach(id));
}
function toStage(id) {
  if (rolling) return;
  stopPreview();
  const from = locate(id);
  commit({ type: 'relisten', song: id, from: from.tier || from.zone }, () => { detach(id); S.current = id; });
  ensureApple(id);
}

/* ---------------- drawing ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function draw(skip = false) {
  if (rolling) return;
  if (S.current && !skip) {
    toast('Xếp bài đang nghe trước (phím 1–5 hoặc kéo thả), X để bỏ · Shift+Space = trả bài về & rút bài khác', 'warn');
    const st = $('#stage');
    st.classList.remove('nudge'); void st.offsetWidth; st.classList.add('nudge');
    return;
  }
  const pool = pendingIds();
  const prev = S.current;
  if (!pool.length) {
    return toast(skip ? 'Không còn bài nào khác trong bộ bài' : (S.finished ? 'Đã xếp xong tất cả! 🎉' : 'Hết bài để rút.'), 'warn');
  }
  stopPreview();
  const pick = pool[Math.floor(Math.random() * pool.length)];
  ensureApple(pick, false, true); // tra Apple Music song song với hiệu ứng rút
  rolling = true;
  try { await rollAnimation(pool, pick); } finally { rolling = false; }
  if (!ACTIVE_SET.has(pick)) return draw(skip); // single vừa bị loại vì trùng album -> rút lại
  commit(skip ? { type: 'skip-draw', song: pick, skipped: prev } : { type: 'draw', song: pick }, () => { S.current = pick; });
}
async function rollAnimation(pool, pick) {
  const st = $('#stage');
  st.className = 'stage rolling';
  const title = h('div', { class: 'roll-title' });
  const kicker = h('div', { class: 'roll-kicker' }, 'ĐANG RÚT…');
  st.replaceChildren(h('div', { class: 'rolling-wrap' }, h('div', { class: 'disc' }, h('div', { class: 'disc-label' })), h('div', {}, kicker, title)));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const delays = reduce ? [120] : [45, 45, 50, 55, 60, 65, 75, 85, 100, 120, 145, 180, 230];
  for (const d of delays) {
    const id = pool.length > 1 ? pool[Math.floor(Math.random() * pool.length)] : pick;
    title.textContent = displayTitle(SONGS.get(id));
    await sleep(d);
  }
  title.textContent = displayTitle(SONGS.get(pick));
  await sleep(reduce ? 0 : 160);
}

/* ---------------- Apple Music ---------------- */
async function ensureApple(id, force = false, quiet = false) {
  if (!id || appleInflight.has(id) || (!force && APPLE[id])) return APPLE[id];
  appleInflight.add(id);
  if (S.current === id && !rolling) renderStage();
  try {
    APPLE[id] = await api.get(`/api/apple/${LIST.id}/${encodeURIComponent(id)}${force ? '?force=1' : ''}`);
  } catch (e) {
    console.warn(e);
    if (!quiet && S.current === id) toast('Chưa kết nối được Apple Music — vẫn có nút mở trang tìm kiếm.', 'warn');
  } finally {
    appleInflight.delete(id);
  }
  const r = APPLE[id];
  if (r && r.duplicateOf && excludeDuplicate(id, r.duplicateOf)) return r;
  if (S.current === id && !rolling) renderStage();
  if (r && r.found) renderBoard();
  return r;
}
function stopPreview() {
  if (audio) { audio.pause(); audio = null; }
  const d = $('#stage .disc');
  if (d) d.classList.remove('playing');
  const b = $('#preview-btn');
  if (b) b.firstChild.textContent = '▶ Nghe thử 30s ';
}
function togglePreview() {
  if (!S.current) return;
  const m = meta(S.current);
  if (!m.preview) return toast('Bài này chưa có bản nghe thử', 'warn');
  if (audio && !audio.paused) return stopPreview();
  audio = new Audio(m.preview);
  audio.volume = 0.8;
  audio.play().catch(() => toast('Trình duyệt chặn phát nhạc — bấm lại nút nghe thử', 'warn'));
  audio.addEventListener('ended', stopPreview);
  const d = $('#stage .disc');
  if (d) d.classList.add('playing');
  const b = $('#preview-btn');
  if (b) b.firstChild.textContent = '❚❚ Dừng ';
}
/* Mở Apple Music: bằng app desktop (deep link) hoặc trình duyệt — đổi trong Menu */
const OPEN_MODES = [
  { id: 'music', label: 'App Apple Music', note: 'link music:// — chắc chắn chạy trên Mac', scheme: 'music://' },
  { id: 'itmss', label: 'App Apple Music (kiểu iTunes)', note: 'link itmss:// — thử cách này nếu cách trên không mở được app', scheme: 'itmss://' },
  { id: 'web', label: 'Trình duyệt', note: 'mở music.apple.com trong tab mới' },
];
function openMode() { return OPEN_MODES.find((x) => x.id === store.get('tl:openMode')) || OPEN_MODES[0]; }
function cycleOpenMode() {
  const i = OPEN_MODES.indexOf(openMode());
  const next = OPEN_MODES[(i + 1) % OPEN_MODES.length];
  store.set('tl:openMode', next.id);
  closeModal();
  toast(`Mở Apple Music bằng: ${next.label}`, 'ok');
}
function openWeb(url) { window.open(url, '_blank', 'noopener'); }
function openAppleUrl(url) {
  const mode = openMode();
  if (!url) return;
  if (mode.id === 'web' || !/^https:\/\/music\.apple\.com\//.test(url)) return openWeb(url);
  const appUrl = url.replace(/^https:\/\//, mode.scheme);
  let left = false;
  const onLeave = () => { left = true; };
  window.addEventListener('blur', onLeave, { once: true });
  document.addEventListener('visibilitychange', onLeave, { once: true });
  window.location.href = appUrl; // trình duyệt chuyển link cho app (lần đầu có thể hỏi "Mở Apple Music?")
  setTimeout(() => {
    window.removeEventListener('blur', onLeave);
    document.removeEventListener('visibilitychange', onLeave);
    if (left) return;
    actionToast('Không thấy app Apple Music mở?', [
      ['Mở bản web', () => openWeb(url)],
      ['Đổi cách mở', openMenu],
    ]);
  }, 2500);
}
function openApple() {
  if (!S.current) return;
  const m = meta(S.current);
  openAppleUrl(m.appleUrl || m.appleSearch);
}
// mọi link Apple Music trong trang đều đi qua openAppleUrl
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-apple]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  openAppleUrl(a.href);
});
async function syncAllApple() {
  closeModal();
  const todo = ACTIVE.filter((s) => !APPLE[s.id]);
  if (!todo.length) return toast('Đã có thông tin Apple Music cho tất cả bài', 'ok');
  let done = 0; let found = 0; let failed = 0;
  const el = $('#save-state');
  toast(`Đang tra Apple Music cho ${todo.length} bài (~${Math.ceil(todo.length * 1.6 / 60)} phút)…`);
  for (const s of todo) {
    const r = await ensureApple(s.id, false, true);
    done++;
    if (!r) failed++; else if (r.found) found++;
    el.textContent = `Apple Music ${done}/${todo.length}`;
    if (failed >= 3 && failed === done) { toast('Không kết nối được Apple Music (kiểm tra mạng).', 'error'); break; }
  }
  renderSaveState();
  const skipped = todo.filter((s) => s.duplicateOf).length;
  toast(`Xong: tìm thấy ${found}/${done} bài${failed ? ` · lỗi ${failed}` : ''}${skipped ? ` · bỏ qua ${skipped} single đã có trong album` : ''}`, found ? 'ok' : 'warn');
}

/* ---------------- persistence ---------------- */
let saveTimer = null;
let saving = Promise.resolve();
let saveError = false;
function save() {
  S.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
  renderSaveState('Đang lưu…');
}
function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const payload = JSON.parse(JSON.stringify(S));
  saving = saving
    .then(() => api.put(`/api/sessions/${payload.id}`, payload))
    .then(() => { saveError = false; renderSaveState(); })
    .catch((e) => { saveError = true; renderSaveState(); toast(`Không lưu được: ${e.message}`, 'error'); });
  return saving;
}
window.addEventListener('beforeunload', () => {
  if (saveTimer && S) navigator.sendBeacon(`/api/sessions/${S.id}`, new Blob([JSON.stringify(S)], { type: 'application/json' }));
});
async function saveList() {
  try { await api.put(`/api/lists/${LIST.id}`, LIST); } catch (e) { toast(`Không lưu được danh sách bài: ${e.message}`, 'error'); }
}

function blankSession(n) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return {
    id: `${LIST.id}-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
    listId: LIST.id,
    name: `Lần xếp #${n}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    finished: false,
    tiers: Object.fromEntries(LIST.tiers.map((t) => [t.id, []])),
    removed: [],
    current: null,
    events: [],
  };
}
async function newSession() {
  const all = await api.get(`/api/sessions?list=${LIST.id}`).catch(() => []);
  if (S && saveTimer) await flush();
  stopPreview();
  S = blankSession(all.length + 1);
  log({ type: 'start' });
  undoStack = [];
  store.set(`tl:last:${LIST.id}`, S.id);
  await flush();
  render();
  toast(`Bắt đầu ${S.name}`, 'ok');
}
function normalizeSession(s) {
  s.tiers = s.tiers || {};
  const seen = new Set();
  const keep = (id) => ACTIVE_SET.has(id) && !seen.has(id) && seen.add(id);
  for (const t of LIST.tiers) s.tiers[t.id] = (s.tiers[t.id] || []).filter(keep);
  for (const k of Object.keys(s.tiers)) if (!tierById(k)) delete s.tiers[k];
  s.removed = (s.removed || []).filter(keep);
  if (s.current && (!ACTIVE_SET.has(s.current) || seen.has(s.current))) s.current = null;
  delete s.unliked;
  s.events = s.events || [];
  return s;
}
async function loadSession(id) {
  if (S && saveTimer) await flush();
  stopPreview();
  S = normalizeSession(await api.get(`/api/sessions/${id}`));
  undoStack = [];
  store.set(`tl:last:${LIST.id}`, S.id);
  render();
  if (S.current) ensureApple(S.current, false, true);
}

/* ---------------- rendering ---------------- */
const HINT_PLACE = 'Phím 1–5 để xếp, hoặc kéo thẻ thả vào hạng. X = bỏ bài này (không thích / không xếp). O = mở Apple Music · P = nghe thử.';
const HINT_IDLE = 'Kéo ô trên bảng để đổi hạng hoặc đổi thứ tự. Chuột phải vào ô để đưa lên khung rút nghe lại.';

function render() {
  renderProgress();
  renderBoard();
  if (!rolling) renderStage();
}
function renderHeader() {
  $('#eyebrow').textContent = LIST.eyebrow;
  $('#title').textContent = LIST.title;
  $('#desc').textContent = LIST.description;
  document.title = `${LIST.eyebrow} — ${LIST.title}`;
}
function renderProgress() {
  const N = ACTIVE.length;
  const placed = placedSet().size;
  const removed = S.removed.length;
  $('#bar').style.width = `${(placed / N) * 100}%`;
  $('#progress-text').textContent = `Đã xếp ${placed}/${N} bài${removed ? ` · đã bỏ ${removed}` : ''}`;
  $('#remaining').textContent = `Còn ${N - placed - removed}/${N}`;
  $('#session-name').textContent = `${S.name} · ${fmtDateTime(S.createdAt)}${S.finished ? ' · ✅ xong' : ''}`;
}
function renderSaveState(text) {
  const el = $('#save-state');
  el.classList.toggle('err', saveError && !text);
  el.textContent = text || (saveError ? '● Chưa lưu được' : '✓ Đã lưu');
}

function chipSub(m) {
  if (m.album !== 'Single') return m.albumShort;
  return m.guest ? m.artist : `Single${m.year ? ` · ${m.year}` : ''}`;
}
function chip(id, kind = '') {
  const m = meta(id);
  const cls = ['chip', kind, id === lastTouched ? 'flash' : ''].filter(Boolean).join(' ');
  return h('div', {
    class: cls,
    draggable: 'true',
    dataset: { id },
    title: `${displayTitle(m)}\n${m.artist} · ${m.album}${m.year ? ` (${m.year})` : ''}\n— Chuột phải: đưa lên khung rút nghe lại${kind === 'removed' ? '\n— Bấm đúp: trả về bộ bài' : ''}`,
  }, h('b', {}, displayTitle(m)), h('small', {}, chipSub(m)));
}
function renderBoard() {
  const wrap = $('#tiers');
  wrap.replaceChildren(...LIST.tiers.map((t, i) => {
    const zone = h('div', { class: 'tier-cards', dataset: { tier: t.id } }, S.tiers[t.id].map((id) => chip(id)));
    return h('section', { class: 'tier', style: `--c:${t.color};--t:${t.text || '#fff'}` },
      h('div', { class: 'tier-label' },
        h('span', { class: 'tier-num' }, i + 1),
        h('div', { class: 'tier-name' }, t.name),
        h('div', { class: 'tier-sub' }, t.sub),
        S.tiers[t.id].length ? h('span', { class: 'tier-count' }, S.tiers[t.id].length) : null),
      zone);
  }));
  const rz = $('#removed');
  rz.replaceChildren(
    h('span', { class: 'label' }, `Đã bỏ (${S.removed.length})`),
    ...S.removed.map((id) => chip(id, 'removed')),
    h('span', {}, S.removed.length ? 'Bấm đúp để trả về bộ bài' : 'Kéo thả vào đây để bỏ bài · bấm đúp để trả bài về bộ bài'),
  );
}
function renderStage() {
  const st = $('#stage');
  $('#hint').textContent = S.current ? HINT_PLACE : HINT_IDLE;
  if (!S.current) {
    stopPreview();
    st.className = 'stage empty';
    const N = ACTIVE.length;
    st.replaceChildren(h('div', {
      class: 'empty-msg',
      html: S.finished
        ? `Xong rồi! 🎉<small>Đã xếp hết ${N} bài. Bấm ⋯ (M) để xuất kết quả hoặc bắt đầu lần xếp mới.</small>`
        : 'Bấm <b>RÚT</b> (Space) để rút bài tiếp theo',
    }));
    return;
  }
  const id = S.current;
  const m = meta(id);
  const a = APPLE[id];
  const loading = appleInflight.has(id);
  const playing = !!(audio && !audio.paused);
  st.className = 'stage revealed';

  let status;
  if (loading) status = h('span', { class: 'apple-status' }, '⏳ Đang tìm trên Apple Music…');
  else if (a && !a.found) status = h('span', { class: 'apple-status' }, 'Không tìm thấy bài chính xác — nút sẽ mở trang tìm kiếm');
  const songTitle = songName(m);
  st.replaceChildren(h('div', { class: 'reveal', draggable: 'true', dataset: { id } },
    h('div', { class: 'reveal-top' },
      h('div', { class: `disc${playing ? ' playing' : ''}` },
        h('div', { class: 'disc-label' }, m.artwork ? h('img', { src: m.artwork, alt: '', draggable: 'false' }) : null)),
      h('div', { style: 'min-width:0' },
        h('div', { class: 'kicker' }, `${m.artist} · ${m.albumShort}${m.year ? ` (${m.year})` : ''}`),
        h('div', { class: 'song-title' }, songTitle),
        m.title !== songTitle ? h('div', { class: 'song-sub' }, m.title) : null,
        m.feat ? h('div', { class: 'song-sub' }, `với ${m.feat}`) : null)),
    h('dl', { class: 'meta' },
      h('div', {}, h('dt', {}, 'Nghệ sĩ'), h('dd', {}, m.artist + (m.feat ? `, ${m.feat}` : ''))),
      h('div', {}, h('dt', {}, 'Năm ra mắt'), h('dd', {}, m.year || '—')),
      h('div', {}, h('dt', {}, 'Album'), h('dd', {}, m.album || '—')),
      h('div', {}, h('dt', {}, 'Track'), h('dd', {}, m.track ? `${m.track}${m.trackCount ? `/${m.trackCount}` : ''}` : '—'))),
    h('div', { class: 'actions' },
      h('a', { class: 'pill-btn apple', href: m.appleUrl || m.appleSearch, target: '_blank', rel: 'noopener', draggable: 'false', 'data-apple': true, title: `Mở bằng: ${openMode().label} (đổi trong Menu)` },
        '♫ Mở trên Apple Music ', h('kbd', {}, 'O')),
      m.preview ? h('button', { class: 'pill-btn ghost', id: 'preview-btn', type: 'button', onclick: togglePreview }, playing ? '❚❚ Dừng ' : '▶ Nghe thử 30s ', h('kbd', {}, 'P')) : null,
      m.appleAlbumUrl ? h('a', { class: 'pill-btn ghost', href: m.appleAlbumUrl, target: '_blank', rel: 'noopener', draggable: 'false', 'data-apple': true }, 'Album ↗') : null),
    status));
}

/* ---------------- drag & drop ---------------- */
let dragId = null;
const marker = h('div', { class: 'drop-marker' });
function dropZoneAt(target) {
  if (target && target.nodeType === 3) target = target.parentElement;
  let zone = target.closest && target.closest('.tier-cards, .removed-zone, #stage');
  if (!zone) {
    const row = target.closest && target.closest('.tier');
    if (row) zone = row.querySelector('.tier-cards');
  }
  return zone;
}
function zoneChips(zone) {
  return $$('.chip', zone).filter((c) => c.dataset.id !== dragId);
}
function insertBefore(zone, x, y) {
  for (const c of zoneChips(zone)) {
    const r = c.getBoundingClientRect();
    if (y < r.top) return c;
    if (y <= r.bottom && x < r.left + r.width / 2) return c;
  }
  return null;
}
document.addEventListener('dragstart', (e) => {
  const el = e.target.closest && e.target.closest('[draggable="true"][data-id]');
  if (!el || rolling) return;
  dragId = el.dataset.id;
  e.dataTransfer.setData('text/plain', dragId);
  e.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => el.classList.add('dragging'));
});
document.addEventListener('dragend', () => {
  dragId = null;
  marker.remove();
  $$('.dragging').forEach((x) => x.classList.remove('dragging'));
  $$('.drop-hover').forEach((x) => x.classList.remove('drop-hover'));
});
document.addEventListener('dragover', (e) => {
  if (!dragId) return;
  const zone = dropZoneAt(e.target);
  $$('.drop-hover').forEach((x) => { if (x !== zone) x.classList.remove('drop-hover'); });
  if (!zone) { marker.remove(); return; }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  zone.classList.add('drop-hover');
  if (zone.classList.contains('tier-cards')) {
    const before = insertBefore(zone, e.clientX, e.clientY);
    if (marker.nextSibling !== before || marker.parentNode !== zone) zone.insertBefore(marker, before);
  } else marker.remove();
});
document.addEventListener('drop', (e) => {
  if (!dragId) return;
  const zone = dropZoneAt(e.target);
  if (!zone) return;
  e.preventDefault();
  const id = dragId;
  marker.remove();
  if (zone.classList.contains('tier-cards')) {
    const chips = zoneChips(zone);
    const b = insertBefore(zone, e.clientX, e.clientY);
    place(id, zone.dataset.tier, b ? chips.indexOf(b) : chips.length);
  } else if (zone.classList.contains('removed-zone')) {
    if (locate(id).zone !== 'removed') removeSong(id);
  } else if (zone.id === 'stage') {
    if (S.current !== id) toStage(id);
  }
});
document.addEventListener('contextmenu', (e) => {
  const c = e.target.closest && e.target.closest('.chip[data-id]');
  if (!c) return;
  e.preventDefault();
  toStage(c.dataset.id);
});
document.addEventListener('dblclick', (e) => {
  const c = e.target.closest && e.target.closest('.chip.removed[data-id]');
  if (c) restoreSong(c.dataset.id);
});

/* ---------------- modal ---------------- */
const dlg = $('#modal');
function openModal(title, body, { wide = false, onKey = null, onClose = null } = {}) {
  if (dlg.open) dlg.close();
  $('#modal-title').textContent = title;
  $('#modal-body').replaceChildren(body);
  dlg.classList.toggle('wide', wide);
  modalKey = onKey;
  dlg._onClose = onClose;
  dlg.showModal();
}
function closeModal() { if (dlg.open) dlg.close(); }
dlg.addEventListener('close', () => {
  const f = dlg._onClose;
  dlg._onClose = null;
  modalKey = null;
  if (f) f();
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeModal(); }); // bấm ra ngoài để đóng

function actionToast(msg, actions) {
  const el = h('div', { class: 'toast action' }, h('span', {}, msg),
    actions.map(([label, fn]) => h('button', { type: 'button', onclick: () => { el.remove(); fn(); } }, label)));
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 7000);
  setTimeout(() => el.remove(), 7400);
}
/* ---------- đăng nhập (khi bật APP_PASSWORD) ---------- */
let loginPromise = null;
function askLogin() {
  if (loginPromise) return loginPromise;
  loginPromise = new Promise((resolve) => {
    let ok = false;
    const show = () => {
      const input = h('input', { type: 'password', required: true, autocomplete: 'current-password', placeholder: 'Mật khẩu' });
      const err = h('p', { class: 'warn-text', style: 'grid-column:1/-1;margin:0' });
      const f = h('form', { class: 'form' },
        h('label', { class: 'full' }, 'Trang này có mật khẩu — nhập để tiếp tục', input),
        err,
        h('div', { class: 'row', style: 'grid-column:1/-1;justify-content:flex-end' }, h('button', { type: 'submit', class: 'btn primary' }, 'Vào')));
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
        if (r.ok) { ok = true; closeModal(); resolve(); } else { err.textContent = 'Sai mật khẩu, thử lại nhé.'; input.select(); }
      });
      openModal('🔒 Đăng nhập', f, { onClose: () => { if (!ok) setTimeout(show, 200); } });
      setTimeout(() => input.focus(), 30);
    };
    show();
  }).finally(() => { loginPromise = null; });
  return loginPromise;
}
function toast(msg, kind = 'info') {
  const el = h('div', { class: `toast ${kind}` }, msg);
  $('#toasts').append(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  setTimeout(() => el.classList.add('out'), 2800);
  setTimeout(() => el.remove(), 3200);
}

/* ---------- Vote ---------- */
function openVote() {
  if (!S.current) return toast('Rút một bài trước khi vote (Space)', 'warn');
  const id = S.current;
  const counts = LIST.tiers.map(() => 0);
  let dur = Number(store.get('tl:voteDur')) || 30;
  let left = dur;
  let timer = null;
  const body = h('div', { class: 'vote' });
  const stop = () => { clearInterval(timer); timer = null; };
  const start = () => {
    if (timer) return;
    if (left <= 0) left = dur;
    timer = setInterval(() => { left--; if (left <= 0) { left = 0; stop(); toast('⏱ Hết giờ vote! Enter để chốt', 'ok'); } paint(); }, 1000);
  };
  const winner = () => { const mx = Math.max(...counts); return mx > 0 ? counts.indexOf(mx) : -1; };
  const bump = (i, d) => { counts[i] = Math.max(0, counts[i] + d); paint(); };
  const apply = () => {
    const w = winner();
    if (w < 0) return toast('Chưa có phiếu nào', 'warn');
    log({ type: 'vote', song: id, counts: [...counts], tier: LIST.tiers[w].id });
    closeModal();
    if (S.current === id) place(id, LIST.tiers[w].id);
  };
  function paint() {
    const mx = Math.max(1, ...counts);
    const w = winner();
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    body.replaceChildren(
      h('div', { class: 'vote-song' }, displayTitle(SONGS.get(id))),
      h('div', { class: `vote-timer${timer && left <= 5 ? ' urgent' : ''}` }, `${mm}:${ss}`),
      h('div', { class: 'vote-cols', style: `--n:${LIST.tiers.length}` }, LIST.tiers.map((t, i) =>
        h('button', {
          type: 'button',
          class: `vote-col${w === i ? ' win' : ''}`,
          style: `--c:${t.color};--t:${t.text}`,
          onclick: () => bump(i, 1),
          oncontextmenu: (e) => { e.preventDefault(); bump(i, -1); },
        },
        h('div', { class: 'vote-bar-wrap' }, h('div', { class: 'vote-bar', style: `height:${(counts[i] / mx) * 100}%` })),
        h('div', { class: 'vote-count' }, counts[i]),
        h('div', { class: 'vote-name' }, `${i + 1} · ${t.name}`)))),
      h('div', { class: 'vote-actions' },
        h('div', { class: 'row' },
          [15, 30, 60].map((s) => h('button', {
            type: 'button', class: `btn sm${dur === s ? ' primary' : ''}`,
            onclick: () => { dur = s; store.set('tl:voteDur', String(s)); stop(); left = s; paint(); },
          }, `${s}s`)),
          h('button', { type: 'button', class: 'btn sm', onclick: () => { timer ? stop() : start(); paint(); } }, timer ? '❚❚ Dừng' : '▶ Chạy giờ'),
          h('button', { type: 'button', class: 'btn sm', onclick: () => { stop(); left = dur; counts.fill(0); paint(); } }, '↺ Làm lại')),
        h('button', { type: 'button', class: 'btn primary', onclick: apply }, w >= 0 ? `Chốt → ${LIST.tiers[w].name} (Enter)` : 'Chốt (Enter)')),
      h('p', { class: 'muted' }, 'Bấm cột hoặc phím 1–5: +1 phiếu · Shift+1–5 / chuột phải: −1 · Space: chạy/dừng đồng hồ · Enter: chốt hạng nhiều phiếu nhất (hoà thì lấy hạng cao hơn) · Esc: đóng'),
    );
  }
  openModal('⏱ Vote', body, {
    onKey: (e) => {
      const dm = /^(Digit|Numpad)(\d)$/.exec(e.code);
      if (dm) { const i = Number(dm[2]) - 1; if (i >= 0 && i < counts.length) { e.preventDefault(); bump(i, e.shiftKey ? -1 : 1); } return; }
      if (e.code === 'Space') { e.preventDefault(); timer ? stop() : start(); paint(); }
      if (e.key === 'Enter') { e.preventDefault(); apply(); }
    },
    onClose: stop,
  });
  paint();
}

/* ---------- Luật ---------- */
function openRules() {
  const keys = [
    ['Space', 'Rút bài tiếp theo (phải xếp bài đang nghe trước)'],
    ['Shift + Space', 'Trả bài đang nghe về bộ bài & rút bài khác'],
    [`1 – ${LIST.tiers.length}`, 'Xếp bài đang nghe vào hạng tương ứng'],
    ['Kéo thả', 'Xếp / đổi hạng / đổi thứ tự trong hạng; thả vào “Đã bỏ” để bỏ; thả lên khung rút để nghe lại'],
    ['Chuột phải', 'Đưa một bài trên bảng lên khung rút để nghe lại'],
    ['X', 'Bỏ bài đang nghe (không thích / không xếp)'],
    ['O / P', 'Mở bài trên Apple Music (app hoặc trình duyệt — đổi trong Menu) / nghe thử 30 giây'],
    ['T', 'Vote cùng bạn bè (đếm phiếu + đồng hồ)'],
    ['A', 'Thêm bài mới vào danh sách'],
    ['Z / Ctrl+Z', 'Hoàn tác'],
    ['M', 'Menu: lần xếp mới, lịch sử, nhật ký, danh sách bài, xuất kết quả'],
    ['C', 'Mở bảng luật này'],
  ];
  openModal('Luật chơi', h('div', { class: 'rules' },
    h('h3', {}, 'Các hạng'),
    h('dl', {}, LIST.tiers.map((t, i) => [
      h('dt', {}, h('span', { class: 'tag', style: `--c:${t.color};--t:${t.text}` }, `${i + 1} · ${t.name}`)),
      h('dd', {}, t.sub)])),
    h('p', { class: 'muted' }, 'Mọi thao tác được tự động lưu vào thư mục data/ của server (kèm nhật ký từng lần xếp).'),
    h('h3', {}, 'Phím tắt'),
    h('div', { class: 'keys' }, keys.map(([k, d]) => [h('kbd', {}, k), h('span', {}, d)]))));
}

/* ---------- + Bài ---------- */
function openAddSong() {
  const f = h('form', { class: 'form' },
    h('label', { class: 'full' }, 'Tên bài *', h('input', { type: 'text', name: 'title', required: true, autocomplete: 'off' })),
    h('label', {}, 'Nghệ sĩ *', h('input', { type: 'text', name: 'artist', value: 'Ngọt', required: true })),
    h('label', {}, 'Kết hợp với (feat.)', h('input', { type: 'text', name: 'feat' })),
    h('label', {}, 'Album (để trống = Single)', h('input', { type: 'text', name: 'album', list: 'album-list' })),
    h('label', {}, 'Năm', h('input', { type: 'number', name: 'year', min: 1990, max: 2100 })),
    h('label', { class: 'full' }, 'Link Apple Music (không bắt buộc — để trống app sẽ tự tìm)', h('input', { type: 'url', name: 'appleUrl', placeholder: 'https://music.apple.com/…' })),
    h('label', { class: 'check full' }, h('input', { type: 'checkbox', name: 'drawNow' }), 'Đưa luôn lên khung rút'),
    h('div', { class: 'row full', style: 'grid-column:1/-1;justify-content:flex-end' },
      h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Huỷ'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Thêm bài')),
    h('datalist', { id: 'album-list' }, [...ALBUM_COUNT.keys()].map((a) => h('option', { value: a }))));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const title = d.title.trim();
    if (!title) return;
    // chống trùng: so tên (bỏ dấu, bỏ phần trong ngoặc) với toàn bộ danh sách
    const newAlbum = d.album.trim() || 'Single';
    const dup = LIST.songs.find((s) => baseTitle(s.short || s.title) === baseTitle(title) || baseTitle(s.title) === baseTitle(title));
    if (dup && dup.album !== 'Single' && newAlbum === 'Single') {
      return toast(`Không thêm: “${displayTitle(dup)}” đã có trong album ${dup.album} (ưu tiên bản album)`, 'warn');
    }
    if (dup && !confirm(`Đã có “${displayTitle(dup)}” (${dup.artist} · ${dup.album}).\n\nVẫn thêm bài này?`)) return;
    let id = slug(title);
    for (let n = 2; SONGS.has(id); n++) id = `${slug(title)}-${n}`;
    const song = { id, title, artist: d.artist.trim() || 'Ngọt' };
    if (d.feat.trim()) song.feat = d.feat.trim();
    song.album = d.album.trim() || 'Single';
    song.year = d.year ? Number(d.year) : null;
    if (d.appleUrl.trim()) song.appleUrl = d.appleUrl.trim();
    if (song.album === 'Single') song.verify = true;
    LIST.songs.push(song);
    indexSongs();
    saveList();
    log({ type: 'add-song', song: id });
    closeModal();
    if (d.drawNow) toStage(id); else { save(); render(); }
    ensureApple(id, false, true);
    toast(`＋ Đã thêm ${displayTitle(song)}`, 'ok');
  });
  openModal('＋ Thêm bài', f);
  setTimeout(() => f.querySelector('input[name=title]').focus(), 30);
}

/* ---------- Menu ---------- */
function openMenu() {
  const missing = ACTIVE.filter((s) => !APPLE[s.id]).length;
  const skippedN = LIST.songs.length - ACTIVE.length;
  const item = (title, desc, fn, cls = '') => h('button', { type: 'button', class: `menu-item ${cls}`, onclick: fn }, h('b', {}, title), h('span', {}, desc));
  openModal('Menu', h('div', { class: 'menu-grid' },
    item('🆕 Lần xếp mới', 'Bắt đầu lại từ đầu, lần xếp hiện tại vẫn được giữ trong lịch sử', () => {
      if (confirm('Bắt đầu một lần xếp mới?')) { closeModal(); newSession(); }
    }),
    item('🗂 Lịch sử các lần xếp', 'Xem / mở lại / xuất / xoá các lần xếp đã lưu', openHistory),
    item('📜 Nhật ký lần xếp này', `${S.events.length} thao tác đã ghi`, openLog),
    item('🎵 Danh sách bài', `${ACTIVE.length} bài${skippedN ? ` (bỏ qua ${skippedN} single trùng album)` : ''} · tìm kiếm, nghe lại`, openSongs),
    item('🍎 Đồng bộ Apple Music', missing ? `Tra link, năm, ảnh bìa cho ${missing} bài còn thiếu` : 'Đã có đủ — bấm để kiểm tra lại', syncAllApple),
    LIST.songs.some((s) => s.guest) && item(`🤝 Bài kết hợp: ${LIST.excludeGuests ? 'đang KHÔNG tính' : 'đang tính'}`, `${LIST.songs.filter((s) => s.guest).length} bài của nghệ sĩ khác có Thắng góp giọng — bấm để ${LIST.excludeGuests ? 'tính vào' : 'bỏ ra'}`, toggleGuests),
    item(`🍎 Mở Apple Music bằng: ${openMode().label}`, `${openMode().note} — bấm để đổi cách mở`, cycleOpenMode),
    item('✏️ Đổi tên lần xếp', S.name, renameSession),
    item('⬇️ Xuất kết quả (.md)', 'Bảng xếp hạng + nhật ký, dạng Markdown', () => exportSession(S.id)),
    item('⬇️ Xuất dữ liệu (.json)', 'Toàn bộ trạng thái lần xếp này', exportJSON),
  ), { wide: false });
}
async function renameSession() {
  const name = prompt('Tên lần xếp:', S.name);
  if (!name || !name.trim() || name.trim() === S.name) return;
  S.name = name.trim();
  log({ type: 'rename', name: S.name });
  save();
  renderProgress();
  closeModal();
}
async function exportSession(id) {
  if (S && S.id === id) await flush();
  const a = h('a', { href: `/api/sessions/${id}/export.md`, download: `${id}.md` });
  document.body.append(a); a.click(); a.remove();
}
function exportJSON() {
  const blob = new Blob([JSON.stringify({ list: LIST, session: S }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `${S.id}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openHistory() {
  const body = h('div', {}, h('p', { class: 'muted' }, 'Đang tải…'));
  openModal('🗂 Lịch sử các lần xếp', body, { wide: true });
  if (saveTimer) await flush();
  let rows;
  try { rows = await api.get(`/api/sessions?list=${LIST.id}`); } catch (e) { body.replaceChildren(h('p', {}, `Lỗi: ${e.message}`)); return; }
  body.replaceChildren(
    h('p', { class: 'muted' }, `Mỗi lần xếp được lưu ở data/sessions/ (JSON + bản .md dễ đọc) và nhật ký ở data/logs/.`),
    h('table', {},
      h('thead', {}, h('tr', {}, ['Lần xếp', 'Bắt đầu', 'Cập nhật', 'Tiến độ', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.id === S.id ? 'current' : '' },
        h('td', {}, h('b', {}, r.name), r.id === S.id ? ' (đang mở)' : '', r.finished ? ' ✅' : ''),
        h('td', {}, fmtDateTime(r.createdAt)),
        h('td', {}, fmtDateTime(r.updatedAt)),
        h('td', {}, `${r.placed}/${r.total} xếp${r.removed ? ` · ${r.removed} bỏ` : ''} · ${r.events} thao tác`),
        h('td', {}, h('div', { class: 'row' },
          r.id !== S.id ? h('button', { class: 'btn sm primary', onclick: async () => { closeModal(); await loadSession(r.id); toast(`Đã mở ${r.name}`, 'ok'); } }, 'Mở') : null,
          h('button', { class: 'btn sm', onclick: () => exportSession(r.id) }, 'Xuất .md'),
          r.id !== S.id ? h('button', {
            class: 'btn sm danger',
            onclick: async () => {
              if (!confirm(`Xoá vĩnh viễn “${r.name}” (kèm nhật ký)?`)) return;
              await api.del(`/api/sessions/${r.id}`);
              openHistory();
            },
          }, 'Xoá') : null)))))));
}

function describeEvent(e) {
  const s = e.song && SONGS.get(e.song) ? displayTitle(SONGS.get(e.song)) : (e.song || '');
  const tn = (id) => (tierById(id) || {}).name || id;
  switch (e.type) {
    case 'start': return 'Bắt đầu lần xếp';
    case 'draw': return `🎲 Rút: ${s}`;
    case 'skip-draw': return `🎲 Trả “${e.skipped && SONGS.get(e.skipped) ? displayTitle(SONGS.get(e.skipped)) : e.skipped}” về bộ bài, rút: ${s}`;
    case 'place': return `Xếp ${s} → ${tn(e.tier)}`;
    case 'move': return `Chuyển ${s}: ${tn(e.from)} → ${tn(e.tier)}`;
    case 'reorder': return `Đổi thứ tự ${s} trong ${tn(e.tier)}`;
    case 'remove': return `✕ Bỏ ${s}`;
    case 'restore': return `Trả ${s} về bộ bài`;
    case 'relisten': return `Đưa ${s} lên khung rút nghe lại`;
    case 'vote': return `⏱ Vote ${s}: ${(e.counts || []).map((c, i) => `${LIST.tiers[i] ? LIST.tiers[i].name : i + 1} ${c}`).join(' · ')}`;
    case 'add-song': return `＋ Thêm bài: ${s}`;
    case 'undo': return '↶ Hoàn tác';
    case 'rename': return `Đổi tên thành “${e.name}”`;
    case 'finish': return '🎉 Xếp xong toàn bộ';
    case 'exclude-group': return `Không tính ${e.group}`;
    case 'include-group': return `Tính cả ${e.group}`;
    case 'skip-duplicate': return `Bỏ qua single ${s} (đã có trong album: ${e.of && SONGS.get(e.of) ? displayTitle(SONGS.get(e.of)) : e.of})`;
    default: return `${e.type} ${s}`;
  }
}
function openLog() {
  openModal(`📜 Nhật ký — ${S.name}`, h('div', {},
    h('p', { class: 'muted' }, `${S.events.length} thao tác · cũng được ghi vào data/logs/${S.id}.jsonl`),
    h('ul', { class: 'log-list' }, [...S.events].reverse().map((e) => h('li', {}, h('time', {}, fmtTime(e.t)), h('span', {}, describeEvent(e)))))), { wide: true });
}

function openSongs() {
  const q = h('input', { type: 'search', placeholder: 'Tìm bài, album, nghệ sĩ…', style: 'flex:1;min-width:200px' });
  const tbody = h('tbody');
  function paint() {
    const term = norm(q.value);
    tbody.replaceChildren(...LIST.songs.filter((s) => !term || norm(`${s.title} ${s.short || ''} ${s.album} ${s.artist} ${s.feat || ''}`).includes(term)).map((s) => {
      const m = meta(s.id);
      const a = APPLE[s.id];
      const l = locate(s.id);
      const t = l.zone === 'tier' ? tierById(l.tier) : null;
      const dup = s.duplicateOf && SONGS.get(s.duplicateOf);
      if (!dup && !ACTIVE_SET.has(s.id)) {
        return h('tr', { class: 'skipped' }, h('td', {}, h('b', {}, displayTitle(m)), h('div', { class: 'muted' }, `${s.demo ? 'Bài demo' : 'Bài kết hợp'} — đang không tính (bật lại trong Menu)`)),
          h('td', {}, m.artist), h('td', {}, m.album), h('td', {}, m.year || '—'), h('td', {}, h('span', { class: 'tag' }, 'Không tính')), h('td', {}), h('td', {}));
      }
      if (dup) {
        return h('tr', { class: 'skipped' },
          h('td', {}, h('b', {}, displayTitle(m)), h('div', { class: 'warn-text' }, `Bỏ qua — đã có trong album ${dup.album} (“${displayTitle(dup)}”)`)),
          h('td', {}, m.artist), h('td', {}, m.album), h('td', {}, m.year || '—'),
          h('td', {}, h('span', { class: 'tag' }, 'Bỏ qua')), h('td', {}),
          h('td', {}, h('button', { class: 'btn sm', title: 'Nếu đây thực ra là bài khác, giữ lại để xếp', onclick: () => { keepDuplicate(s.id); paint(); } }, 'Vẫn giữ')));
      }
      return h('tr', { class: S.current === s.id ? 'current' : '' },
        h('td', {}, h('b', {}, displayTitle(m))),
        h('td', {}, m.artist),
        h('td', {}, m.album, m.track ? h('span', { class: 'muted' }, ` #${m.track}`) : null),
        h('td', {}, m.year || '—'),
        h('td', {}, h('span', { class: 'tag', style: t ? `--c:${t.color};--t:${t.text}` : '' }, statusLabel(s.id))),
        h('td', {}, a ? (a.found ? h('a', { href: m.appleUrl, target: '_blank', rel: 'noopener', 'data-apple': true }, '✓ mở') : h('span', { class: 'muted' }, 'không thấy')) : h('span', { class: 'muted' }, '—')),
        h('td', {}, h('div', { class: 'row' },
          S.current !== s.id ? h('button', { class: 'btn sm', onclick: () => { closeModal(); toStage(s.id); } }, 'Nghe lại') : null,
          l.zone === 'removed' ? h('button', { class: 'btn sm', onclick: () => { restoreSong(s.id); paint(); } }, 'Trả về') : null)));
    }));
  }
  q.addEventListener('input', paint);
  openModal('🎵 Danh sách bài', h('div', {},
    h('div', { class: 'row', style: 'margin-bottom:10px' }, q),
    h('table', {},
      h('thead', {}, h('tr', {}, ['Bài', 'Nghệ sĩ', 'Album', 'Năm', 'Trạng thái', 'Apple', ''].map((x) => h('th', {}, x)))),
      tbody),
    h('p', { class: 'muted' }, 'Muốn sửa thông tin gốc (tên, album, năm…)? Sửa file data/lists/ngot-thang.json rồi tải lại trang. Single nào đã có trong một album của danh sách (trùng tên, hoặc Apple Music xác nhận) sẽ tự động bị bỏ qua — ưu tiên bản album.')), { wide: true });
  paint();
}

/* ---------------- keyboard & buttons ---------------- */
document.addEventListener('keydown', (e) => {
  if (dlg.open) {
    if (modalKey && !e.target.matches('input, textarea, select')) modalKey(e);
    return;
  }
  if (e.target.matches('input, textarea, select') || !S) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); draw(e.shiftKey); return; }
  const dm = /^(Digit|Numpad)(\d)$/.exec(e.code);
  if (dm) {
    const t = LIST.tiers[Number(dm[2]) - 1];
    if (!t || rolling) return;
    if (S.current) place(S.current, t.id);
    else toast('Chưa có bài trên khung rút — bấm Space để rút', 'warn');
    return;
  }
  if (rolling) return;
  switch (e.key.toLowerCase()) {
    case 'x': removeSong(S.current); break;
    case 'z': undo(); break;
    case 't': openVote(); break;
    case 'a': e.preventDefault(); openAddSong(); break;
    case 'c': openRules(); break;
    case 'm': openMenu(); break;
    case 'o': openApple(); break;
    case 'p': togglePreview(); break;
    default:
  }
});
$('.controls').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || !S) return;
  b.blur();
  ({
    draw: () => draw(false),
    vote: openVote,
    add: openAddSong,
    remove: () => removeSong(S.current),
    rules: openRules,
    undo,
    menu: openMenu,
  })[b.dataset.act]();
});
$('#session-name').addEventListener('click', renameSession);

/* ---------------- boot ---------------- */
(async function init() {
  try {
    const listId = new URLSearchParams(location.search).get('list') || 'ngot-thang';
    LIST = await api.get(`/api/lists/${encodeURIComponent(listId)}`);
    indexSongs();
    renderHeader();
    APPLE = await api.get(`/api/apple/${LIST.id}`).catch(() => ({}));
    const sessions = await api.get(`/api/sessions?list=${LIST.id}`).catch(() => []);
    const last = store.get(`tl:last:${LIST.id}`);
    const pick = sessions.find((s) => s.id === last) || sessions.find((s) => !s.finished) || null;
    if (pick) await loadSession(pick.id);
    else await newSession();
    renderSaveState();
  } catch (e) {
    console.error(e);
    document.body.append(h('div', { class: 'toast error', style: 'position:fixed;top:20px;left:50%;transform:translateX(-50%)' },
      `Không tải được dữ liệu: ${e.message}. Nếu chạy local: bạn đã chạy “node server.js” chưa?`));
  }
})();

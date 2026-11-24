/*
 * Logic dùng chung cho server Node (chạy local) và Cloudflare Pages Functions.
 * Không phụ thuộc Node API — chỉ dùng chuẩn Web (fetch, URL...).
 */

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,100}$/i;

/* ---------- chuẩn hoá chữ (chống trùng & khớp Apple) ---------- */
export const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
  .toLowerCase().replace(/[^a-z0-9%]+/g, '');

export function baseTitle(t) {
  const stripped = String(t || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s(-|–)\s.*$/, ' ')
    .replace(/\b(feat\.?|ft\.?|with)\s.*$/i, ' ');
  return norm(stripped) || norm(t);
}

export const plainTitle = (t) => String(t || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || String(t || '');

/** Các bài được tính trong tier list (bỏ single trùng album, nhóm bị tắt) */
export const activeSongs = (list) => list.songs.filter((x) => !x.duplicateOf && !(x.guest && list.excludeGuests) && !(x.demo && list.excludeDemos));

/* ---------- Apple Music (iTunes Search API) ---------- */
export async function itunesSearch(term, country) {
  const qs = new URLSearchParams({ term, country, media: 'music', entity: 'song', limit: '50' });
  const r = await fetch(`https://itunes.apple.com/search?${qs}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`iTunes HTTP ${r.status}`);
  const j = JSON.parse(await r.text());
  return j.results || [];
}

const NON_ORIGINAL = /\b(live|remix|instrumental|karaoke|acoustic|lofi|lo-fi|sped up|slowed|version|ver\.)\b/i;

export function pickBest(results, song, listAlbums) {
  const wants = new Set([baseTitle(song.title), song.short ? baseTitle(song.short) : null].filter(Boolean));
  const albumN = song.album && song.album !== 'Single' ? norm(song.album) : '';
  const artistN = norm(song.artist);
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    if (r.wrapperType && r.wrapperType !== 'track') continue;
    const an = norm(r.artistName);
    if (!(an.includes('ngot') || an.includes('thang') || (artistN && an.includes(artistN)))) continue;
    const tn = baseTitle(r.trackName);
    let score;
    if (wants.has(tn)) score = 100;
    else if ([...wants].some((w) => tn.length >= 3 && w.length >= 3 && (tn.startsWith(w) || w.startsWith(tn)))) score = 55;
    else continue;
    const cn = norm(r.collectionName);
    const isSingle = /-(single|ep)$/i.test(String(r.collectionName).replace(/\s+/g, '')) || r.trackCount === 1;
    // Ưu tiên đúng album; single thì ưu tiên bản nằm trong album (tránh trùng single/album)
    if (albumN && cn && (cn === albumN || cn.startsWith(albumN) || albumN.startsWith(cn))) score += 40;
    else if (!isSingle && listAlbums.has(cn)) score += 25;
    if (isSingle) score -= 15; else score += 10;
    if (NON_ORIGINAL.test(r.trackName) && !NON_ORIGINAL.test(song.title)) score -= 30;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/** Tra 1 bài trên Apple Music. `search(term, country)` do nơi chạy cung cấp (Node có xếp hàng chống rate-limit). */
export async function appleLookup(song, list, search = itunesSearch) {
  const listAlbums = new Set(list.songs.filter((s) => s.album && s.album !== 'Single').map((s) => norm(s.album)));
  const title = plainTitle(song.short || song.title);
  const terms = [`${title} ${song.artist}`];
  if (song.verify || song.album === 'Single') terms.push(`${title} Ngọt`, `${title} Thắng`, title);
  const tried = new Set();
  for (const country of ['vn', 'us']) {
    for (const term of terms) {
      const key = `${country}|${term}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const r = pickBest(await search(term, country), song, listAlbums);
      if (!r) continue;
      const out = {
        found: true,
        country,
        trackId: r.trackId,
        trackName: r.trackName,
        artistName: r.artistName,
        collectionName: r.collectionName,
        releaseDate: r.releaseDate || null,
        year: r.releaseDate ? Number(String(r.releaseDate).slice(0, 4)) : null,
        trackNumber: r.trackNumber || null,
        trackCount: r.trackCount || null,
        trackViewUrl: r.trackViewUrl ? r.trackViewUrl.replace(/[?&]uo=\d+/, '') : null,
        collectionViewUrl: r.collectionViewUrl ? r.collectionViewUrl.replace(/[?&]uo=\d+/, '') : null,
        previewUrl: r.previewUrl || null,
        artwork: r.artworkUrl100 ? r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null,
        fetchedAt: new Date().toISOString(),
      };
      // Single mà Apple xếp vào một album đã có trong danh sách -> đánh dấu trùng (ưu tiên bản album)
      if (song.album === 'Single') {
        const cn = norm(r.collectionName);
        const dup = list.songs.find((s) => s.id !== song.id && s.album !== 'Single' && norm(s.album) === cn
          && baseTitle(s.short || s.title) === baseTitle(r.trackName));
        if (dup) out.duplicateOf = dup.id;
      }
      return out;
    }
  }
  return { found: false, fetchedAt: new Date().toISOString() };
}

/* ---------- Xuất kết quả 1 lần xếp ra Markdown ---------- */
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }); } catch { return iso; }
}

export function sessionToMarkdown(s, list) {
  const songs = new Map(list.songs.map((x) => [x.id, x]));
  const name = (id) => {
    const x = songs.get(id);
    if (!x) return id;
    return `${x.short || x.title}${x.feat ? ` (với ${x.feat})` : ''}`;
  };
  const label = (id) => {
    const x = songs.get(id);
    if (!x) return id;
    return `${name(id)} — ${x.artist} · ${x.album}${x.year ? ` (${x.year})` : ''}`;
  };
  const tierName = (tid) => (list.tiers.find((t) => t.id === tid) || {}).name || tid;
  const placed = list.tiers.reduce((n, t) => n + ((s.tiers && s.tiers[t.id]) || []).length, 0);
  const removed = (s.removed || []).length;
  const ex = new Set(s.excluded || []);
  const active = activeSongs(list).filter((x) => !ex.has(x.id));
  const total = active.length;
  const L = [];
  L.push(`# ${list.eyebrow} — ${list.title}`, '');
  L.push(`**${s.name}** · bắt đầu ${fmtDate(s.createdAt)} · cập nhật ${fmtDate(s.updatedAt)}${s.finished ? ' · ✅ ĐÃ XONG' : ''}`, '');
  L.push(`Đã xếp ${placed}/${total} · Đã bỏ ${removed} · Còn lại ${total - placed - removed}`, '');
  for (const t of list.tiers) {
    const arr = (s.tiers && s.tiers[t.id]) || [];
    L.push(`## ${t.name} — ${t.sub} (${arr.length})`, '');
    if (!arr.length) L.push('_(trống)_');
    arr.forEach((id, i) => L.push(`${i + 1}. ${label(id)}`));
    L.push('');
  }
  if (removed) {
    L.push(`## Đã bỏ (${removed})`, '');
    s.removed.forEach((id) => L.push(`- ${label(id)}`));
    L.push('');
  }
  const done = new Set([...list.tiers.flatMap((t) => (s.tiers && s.tiers[t.id]) || []), ...(s.removed || [])]);
  const left = active.filter((x) => !done.has(x.id));
  if (left.length) {
    L.push(`## Chưa xếp (${left.length})`, '');
    left.forEach((x) => L.push(`- ${label(x.id)}`));
    L.push('');
  }
  const off = activeSongs(list).filter((x) => ex.has(x.id));
  if (off.length) {
    L.push(`## Không xếp lượt này (${off.length})`, '');
    off.forEach((x) => L.push(`- ${label(x.id)}`));
    L.push('');
  }
  const skipped = list.songs.filter((x) => x.duplicateOf);
  if (skipped.length) {
    L.push(`## Single bỏ qua vì đã có trong album (${skipped.length})`, '');
    skipped.forEach((x) => L.push(`- ${label(x.id)} → trùng ${label(x.duplicateOf)}`));
    L.push('');
  }
  const ev = s.events || [];
  if (ev.length) {
    L.push(`## Nhật ký (${ev.length} thao tác)`, '');
    for (const e of ev) {
      const song = e.song ? name(e.song) : '';
      let text;
      switch (e.type) {
        case 'start': text = 'Bắt đầu lần xếp'; break;
        case 'draw': text = `Rút: ${song}`; break;
        case 'skip-draw': text = `Trả "${name(e.skipped)}" về bộ bài, rút: ${song}`; break;
        case 'place': text = `Xếp ${song} → ${tierName(e.tier)}`; break;
        case 'move': text = `Chuyển ${song}: ${tierName(e.from)} → ${tierName(e.tier)}`; break;
        case 'reorder': text = `Đổi thứ tự ${song} trong ${tierName(e.tier)} (vị trí ${Number(e.index) + 1})`; break;
        case 'remove': text = `Bỏ ${song}`; break;
        case 'restore': text = `Trả ${song} về bộ bài`; break;
        case 'relisten': text = `Đưa ${song} lên khung rút nghe lại`; break;
        case 'vote': text = `Vote ${song}: ${(e.counts || []).map((c, i) => `${list.tiers[i] ? list.tiers[i].name : i + 1} ${c}`).join(' · ')}`; break;
        case 'add-song': text = `Thêm bài: ${song}`; break;
        case 'undo': text = 'Hoàn tác'; break;
        case 'rename': text = `Đổi tên thành "${e.name}"`; break;
        case 'edit-labels': text = 'Sửa tiêu đề / các hạng'; break;
        case 'delete-song': text = `Xoá bài: ${e.title || e.song}`; break;
        case 'draw-mode': text = e.mode === 'album' ? 'Rút theo album' : 'Rút ngẫu nhiên'; break;
        case 'pick': text = `Chọn nghe: ${song}`; break;
        case 'filter': text = `${e.on ? 'Bật' : 'Tắt'} ${e.count} bài trong Menu nhạc`; break;
        case 'finish': text = '🎉 Xếp xong toàn bộ'; break;
        case 'exclude-group': text = `Không tính ${e.group}`; break;
        case 'include-group': text = `Tính cả ${e.group}`; break;
        case 'skip-duplicate': text = `Bỏ qua single ${song} (đã có trong album: ${name(e.of)})`; break;
        default: text = `${e.type}${song ? `: ${song}` : ''}`;
      }
      L.push(`- \`${fmtDate(e.t)}\` ${text}`);
    }
    L.push('');
  }
  return L.join('\n');
}

export function summarize(s, list) {
  const ex = new Set(s.excluded || []);
  const total = list ? activeSongs(list).filter((x) => !ex.has(x.id)).length : 0;
  const placed = Object.values(s.tiers || {}).reduce((n, a) => n + a.length, 0);
  return {
    id: s.id, listId: s.listId, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt,
    finished: !!s.finished, placed, removed: (s.removed || []).length, total, events: (s.events || []).length,
  };
}

/* Community features, stored in Netlify Blobs (store "gallery").
 *   POST /api/like                 body { kind: 'p'|'s', id, device }   -> { liked, n }   (no login; one like per device)
 *   GET  /api/comments?id=                                             -> { items }
 *   POST /api/comments?id=         body { name, text }                 -> { items }      (no login; rate-limited)
 *   GET  /api/songs                                                    -> { items }      recommended songs
 *   POST /api/songs                body { videoId, title, artist, genre, desc, moment?: { t, line }, scenes?: [] }   (login)
 *   PUT  /api/songs?sid=           body { title, artist, genres, desc, moment?, scenes? } or just { moment?, scenes? }   (login, own song)
 *   DELETE /api/songs?sid=                                             (login, own song)
 *   GET  /api/song-search?q= | ?url=                                   -> { items }      YouTube search (CDN cached)
 *   POST /api/admin/login          body { password }                   -> { token }      (ADMIN_PASSWORD env)
 *   GET  /api/admin/data                                               -> everything incl. hidden (admin)
 *   POST /api/admin/act            body { target, id, op, cid }        (admin: hide / show / delete)
 */
import { getStore } from '@netlify/blobs';
import { notify, ownerOf, isBanned, BANNED_MSG } from './social.mjs';
import { recordSpread } from './spread.mjs';

const API_KEY = 'AIzaSyA4gaZyYp09zqvc8jbBmjqJRruWDhh80mM';
const SITE = globalThis.__SITE || 'https://playlist-share.netlify.app';
const ID_RE = /^[\w-]{6,64}$/;
const VID_RE = /^[\w-]{11}$/;
/** genres: 1-3 known ids, required */
const pickGenres = (g) => [...new Set((Array.isArray(g) ? g : [g]).filter((x) => GENRES.includes(x)))].slice(0, 3);
const GENRES = ['jpop', 'rock', 'anime', 'citypop', 'kpop', 'western', 'hiphop', 'edm', 'chill', 'bgm', 'other'];
/** 「ここを聴いて」: moment { t: seconds 0..3600, line: ≤120 chars } and up to 3 scene ids (same ids as Discover.SCENES in public/discover.js).
 *  Returns only the keys present in the body, so a PUT without them keeps the stored values; moment: null removes it. */
const SCENES = ['night', 'morning', 'rain', 'drive', 'work', 'heartbreak', 'cheer', 'sleepless', 'season', 'love', 'cry', 'walk',
  'commute', 'focus', 'workout', 'dance', 'party', 'karaoke', 'chill', 'healing', 'bath', 'cafe', 'sunset', 'travel',
  'summer', 'winter', 'youth', 'nostalgia', 'friends', 'alone', 'midnight', 'brave', 'family', 'festival', 'wafu'];
function momentFields(b) {
  const out = {};
  if ('moment' in b) {
    const t = Number(b.moment?.t);
    out.moment = b.moment && Number.isFinite(t) && t >= 0 && t <= 3600 ? { t: Math.round(t * 10) / 10, line: clip(b.moment.line, 120) } : undefined;
  }
  if ('head' in b) out.head = clip(String(b.head || '').replace(/\s+/g, ' ').trim(), 60);
  if ('scenes' in b) out.scenes = [...new Set((Array.isArray(b.scenes) ? b.scenes : []).filter((x) => SCENES.includes(x)))].slice(0, 3);
  return out;
}

const db = () => getStore({ name: 'gallery', consistency: 'strong' });
const json = (obj, status = 200, cdn = 'no-store') => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': cdn },
});
const readJson = async (store, key, def) => (await store.get(key, { type: 'json' })) ?? def;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
const enc = new TextEncoder();
async function sha(s) { const d = await crypto.subtle.digest('SHA-256', enc.encode('ps1:' + s)); return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join(''); }
const ipOf = (req, ctx) => ctx?.ip || req.headers.get('cf-connecting-ip') || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
const env = (k) => (globalThis.Netlify?.env?.get?.(k)) || process.env[k] || '';
const yt = (path, params) => fetch(`https://www.googleapis.com/youtube/v3/${path}?` + new URLSearchParams({ ...params, key: API_KEY }), { headers: { Referer: SITE + '/' } });
const isoSec = (iso) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '') || []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };
const decode = (s) => (s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function me(auth) {
  if (!/^Bearer\s+\S+/.test(auth || '')) return null;
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const c = (await r.json()).items?.[0];
  return c ? { id: c.id, name: c.snippet?.title || '', icon: c.snippet?.thumbnails?.default?.url || '' } : null;
}

/* ---------- admin token: HMAC(ADMIN_PASSWORD, expiry) ---------- */
async function hmac(msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode('admin:' + env('ADMIN_PASSWORD')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function isAdmin(req) {
  if (!env('ADMIN_PASSWORD')) return false;
  const m = /^Admin\s+(\d+)\.([\w-]+)$/.exec(req.headers.get('authorization') || '');
  if (!m || +m[1] < Date.now()) return false;
  return (await hmac(m[1])) === m[2];
}

/* Thread key for comments: playlists use their id (kept for existing data), songs use "s:<sid>". */
const tkeyOf = (kind, id) => (kind === 's' ? 's:' + id : id);
async function targetExists(store, kind, id) {
  if (kind === 's') return (await readJson(store, 'songs', [])).some((x) => x.sid === id && !x.hidden);
  return (await readJson(store, 'list', [])).some((x) => x.id === id && !x.hidden);
}

/* ---------- likes (playlists "p", songs "s", comments "c") ---------- */
async function like(req, ctx) {
  const b = await req.json().catch(() => ({}));
  const kind = ['p', 's', 'c'].includes(b.kind) ? b.kind : 'p', id = String(b.id || ''), device = String(b.device || '');
  if (!ID_RE.test(id) || device.length < 16 || device.length > 80) return json({ error: 'bad request' }, 400);
  const store = db();
  if (kind === 'c') {
    // a comment like names the thread it lives in: { thread: 'p:<playlistId>' | 's:<sid>' }
    const m = /^([ps]):([\w-]{6,64})$/.exec(String(b.thread || ''));
    if (!m) return json({ error: 'bad request' }, 400);
    const list = await readJson(store, 'c/' + tkeyOf(m[1], m[2]), []);
    if (!list.some((c) => c.cid === id && !c.hidden)) return json({ error: 'not found' }, 404);
  } else if (!(await targetExists(store, kind, id))) return json({ error: 'not listed' }, 404);
  const key = `${kind}:${id}`, dev = await sha('d:' + device), ip = await sha('i:' + ipOf(req, ctx));
  const rec = await readJson(store, 'lk/' + key, { devs: [], ips: {} });
  const likes = await readJson(store, 'likes', {});
  let liked;
  if (rec.devs.includes(dev)) {
    rec.devs = rec.devs.filter((x) => x !== dev); rec.ips[ip] = Math.max(0, (rec.ips[ip] || 1) - 1); liked = false;
  } else {
    if ((rec.ips[ip] || 0) >= 5) return json({ error: 'この回線からのいいねが多すぎます' }, 429); // same network can't spam
    rec.devs.push(dev); rec.ips[ip] = (rec.ips[ip] || 0) + 1; liked = true;
  }
  likes[key] = rec.devs.length;
  await store.setJSON('lk/' + key, rec);
  await store.setJSON('likes', likes);
  if (liked && kind !== 'c') { const o = await ownerOf(store, kind, id); if (o) await notify(store, o.ownerId, { t: 'like', kind, id, title: o.title }); }
  return json({ liked, n: likes[key] });
}

/* ---------- comments: threads (one level of replies), likes, per-device user ID ---------- */
const publicComments = (list, likes) => list.filter((c) => !c.hidden && !(c.deleted && !list.some((r) => r.parent === c.cid && !r.hidden && !r.deleted)))
  .map(({ cid, name, text, at, uid, parent, chId, icon, deleted }) => (deleted
    ? { cid, name: '', text: '', at, uid: '', parent: parent || '', likes: 0, deleted: true } // kept only as the head of a thread that still has replies
    : { cid, name, text, at, uid: uid || '', parent: parent || '', likes: likes['c:' + cid] || 0, ...(chId ? { chId, icon: icon || '' } : {}) }));
async function comments(req, ctx, id, kind) {
  if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400);
  const store = db();
  const tkey = tkeyOf(kind, id);
  const list = await readJson(store, 'c/' + tkey, []);
  if (req.method === 'GET') return json({ items: publicComments(list, await readJson(store, 'likes', {})) });
  if (req.method === 'DELETE') {
    // the author can delete their own comment: logged in -> same channel; otherwise -> same device (uid)
    const b = await req.json().catch(() => ({}));
    const c = list.find((x) => x.cid === b.cid && !x.hidden && !x.deleted);
    if (!c) return json({ error: 'コメントが見つかりません' }, 404);
    let ok = false;
    if (c.chId) { const who = await me(req.headers.get('authorization')); ok = !!who && who.id === c.chId; }
    else if (String(b.device || '').length >= 16) ok = (await sha('u:' + b.device)).slice(0, 8) === c.uid;
    if (!ok) return json({ error: '自分のコメントだけ削除できます' }, 403);
    const hasReplies = list.some((r) => r.parent === c.cid && !r.hidden && !r.deleted);
    const next = hasReplies ? list.map((x) => (x.cid === c.cid ? { ...x, deleted: true, text: '' } : x)) : list.filter((x) => x.cid !== c.cid);
    await store.setJSON('c/' + tkey, next);
    const counts = await readJson(store, 'ccount', {}); counts[tkey] = next.filter((x) => !x.hidden && !x.deleted).length; await store.setJSON('ccount', counts);
    return json({ items: publicComments(next, await readJson(store, 'likes', {})) });
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!(await targetExists(store, kind, id))) return json({ error: kind === 's' ? 'この曲は掲載されていません' : 'みんなのプレイリストに掲載中のものだけコメントできます' }, 404);
  const b = await req.json().catch(() => ({}));
  // logged in -> the comment is posted as the user's YouTube channel (name, icon, profile link)
  let who = null;
  if (/^Bearer\s+\S+/.test(req.headers.get('authorization') || '')) {
    who = await me(req.headers.get('authorization'));
    if (!who) return json({ error: 'ログインの有効期限が切れました。もう一度ログインしてください' }, 401);
    if (await isBanned(store, who.id)) return json({ error: BANNED_MSG }, 403);
  }
  const name = who ? clip(who.name, 40) : (clip(b.name, 20) || '名無しさん'), text = clip(b.text, 300), device = String(b.device || '');
  if (!text) return json({ error: 'コメントを入力してください' }, 400);
  if (/https?:\/\//i.test(text) && (text.match(/https?:\/\//gi) || []).length > 2) return json({ error: 'リンクが多すぎます' }, 400);
  // replies attach to the thread's root comment
  let parent = '';
  if (b.parent) {
    const p = list.find((c) => c.cid === b.parent && !c.hidden);
    if (!p) return json({ error: '返信先のコメントが見つかりません' }, 404);
    parent = p.parent || p.cid;
  }
  const ip = await sha('i:' + ipOf(req, ctx));
  const rl = await readJson(store, 'rl/' + ip, 0);
  if (Date.now() - rl < 15000) return json({ error: '少し時間をおいてからもう一度お試しください' }, 429);
  await store.setJSON('rl/' + ip, Date.now());
  const uid = (await sha('u:' + (device.length >= 16 ? device : ip))).slice(0, 8); // same device -> same ID
  const cid = (await sha(tkey + ip + Date.now() + Math.random())).slice(0, 12);
  list.push({ cid, name, text, at: Date.now(), ip, ...(who ? { chId: who.id, icon: clip(who.icon, 300) } : { uid }), ...(parent ? { parent } : {}) });
  await store.setJSON('c/' + tkey, list.slice(-500));
  const counts = await readJson(store, 'ccount', {}); counts[tkey] = list.filter((c) => !c.hidden && !c.deleted).length; await store.setJSON('ccount', counts);
  const o = await ownerOf(store, kind, id);
  const note = { kind, id, title: o?.title || '', from: name, fromId: who?.id || '', text };
  if (o) await notify(store, o.ownerId, { ...note, t: 'comment' });
  if (parent) { const root = list.find((c) => c.cid === parent); if (root?.chId && root.chId !== o?.ownerId) await notify(store, root.chId, { ...note, t: 'reply' }); }
  return json({ items: publicComments(list, await readJson(store, 'likes', {})) });
}

/* ---------- recommended songs ---------- */
async function songs(req, url) {
  const store = db();
  if (req.method === 'GET') {
    const list = (await readJson(store, 'songs', [])).filter((s) => !s.hidden);
    const likes = await readJson(store, 'likes', {}), cc = await readJson(store, 'ccount', {}), bc = await readJson(store, 'bmcount', {});
    return json({ items: list.map((s) => ({ ...s, likes: likes['s:' + s.sid] || 0, comments: cc['s:' + s.sid] || 0, bm: bc['s:' + s.sid] || 0 })) }, 200, 'public, s-maxage=30, stale-while-revalidate=120');
  }
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: 'ログインしてください' }, 401);
  if (req.method !== 'DELETE' && await isBanned(store, who.id)) return json({ error: BANNED_MSG }, 403);
  let list = await readJson(store, 'songs', []);
  if (req.method === 'DELETE') {
    const sid = url.searchParams.get('sid') || '';
    const s = list.find((x) => x.sid === sid);
    if (!s) return json({ error: 'not found' }, 404);
    if (s.byId !== who.id) return json({ error: '投稿した本人だけが削除できます' }, 403);
    const also = (s.also || []).filter((x) => x.id !== who.id);
    if (also.length) {
      // other people recommend it too: the next one becomes the main recommender, the song stays
      const [next, ...rest] = also;
      list = list.map((x) => (x.sid === sid ? { ...x, by: next.name, byId: next.id, desc: next.desc || '', also: rest, updated: Date.now() } : x));
    } else list = list.filter((x) => x.sid !== sid);
    await store.setJSON('songs', list);
    return json({ ok: true });
  }
  if (req.method === 'POST' && url.searchParams.get('also')) {
    const sid = url.searchParams.get('also') || '', i = list.findIndex((x) => x.sid === sid && !x.hidden);
    if (i < 0) return json({ error: 'この曲は見つかりませんでした' }, 404);
    const s = list[i];
    if (s.byId === who.id) return json({ error: 'あなたが投稿したおすすめ曲です' }, 400);
    const b = await req.json().catch(() => ({}));
    const also = (s.also || []).filter((x) => x.id !== who.id);
    const leaving = b.leave === true;
    if (!leaving) also.push({ id: who.id, name: clip(who.name, 60), desc: clip(b.desc, 300), at: Date.now() });
    list[i] = { ...s, also: also.slice(0, 200) };
    await store.setJSON('songs', list);
    if (!leaving && !(s.also || []).some((x) => x.id === who.id)) await notify(store, s.byId, { t: 'also', kind: 's', id: sid, title: s.title, from: who.name, fromId: who.id, text: clip(b.desc, 120) });
    if (!leaving) await recordSpread(store, { sid, from: { id: s.byId, name: s.by }, to: { id: who.id, name: who.name }, kind: 'also' });
    return json({ ok: true, item: list[i], joined: !leaving });
  }
  if (req.method === 'PUT') {
    const sid = url.searchParams.get('sid') || '';
    const i = list.findIndex((x) => x.sid === sid);
    if (i < 0) return json({ error: 'not found' }, 404);
    if (list[i].byId !== who.id) return json({ error: '投稿した本人だけが編集できます' }, 403);
    const b = await req.json().catch(() => ({}));
    const mf = momentFields(b);
    if (b.genres === undefined && Object.keys(mf).length) { // only the moment / scenes (song page "ここを聴いて" editor)
      list[i] = { ...list[i], ...mf, updated: Date.now() };
      await store.setJSON('songs', list);
      return json({ ok: true, item: list[i] });
    }
    const genres = pickGenres(b.genres);
    if (!genres.length) return json({ error: 'ジャンルを1つ以上選んでください' }, 400);
    list[i] = { ...list[i], title: clip(b.title, 120) || list[i].title, artist: clip(b.artist, 80) || list[i].artist, desc: clip(b.desc, 300), genres, genre: genres[0], ...mf, updated: Date.now() };
    await store.setJSON('songs', list);
    return json({ ok: true, item: list[i] });
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const b = await req.json().catch(() => ({}));
  if (!VID_RE.test(b.videoId || '')) return json({ error: '曲を選んでください' }, 400);
  const genres = pickGenres(b.genres ?? b.genre);
  if (!genres.length) return json({ error: 'ジャンルを1つ以上選んでください' }, 400);
  const genre = genres[0];
  if (!momentFields(b).moment) return json({ error: '「ここを聴いて」（どこから流すか）を選んでください' }, 400);
  const r = await yt('videos', { part: 'snippet,status,contentDetails', id: b.videoId });
  const v = r.ok ? (await r.json()).items?.[0] : null;
  if (!v) return json({ error: 'この曲は見つかりませんでした' }, 404);
  const nk = (x) => nrmJ(x.title) + '|' + nrmJ(x.artist);
  const same = list.find((x) => !x.hidden && (x.videoId === b.videoId || (b.title && b.artist && nk(x) === nk({ title: b.title, artist: b.artist }))));
  if (same) {
    if (same.byId === who.id || (same.also || []).some((x) => x.id === who.id)) return json({ error: 'この曲はすでにおすすめしています', sid: same.sid }, 409);
    // already recommended by someone else: add this person as another recommender
    same.also = [...(same.also || []), { id: who.id, name: clip(who.name, 60), desc: clip(b.desc, 300), at: Date.now() }].slice(0, 200);
    await store.setJSON('songs', list);
    await notify(store, same.byId, { t: 'also', kind: 's', id: same.sid, title: same.title, from: who.name, fromId: who.id, text: clip(b.desc, 120) });
    await recordSpread(store, { sid: same.sid, from: { id: same.byId, name: same.by }, to: { id: who.id, name: who.name }, kind: 'also' });
    return json({ ok: true, sid: same.sid, joined: true });
  }
  const sid = (await sha(b.videoId + who.id + Date.now())).slice(0, 12);
  const th = v.snippet?.thumbnails || {};
  list.unshift({
    sid, videoId: b.videoId, title: clip(b.title || decode(v.snippet?.title), 120), artist: clip(b.artist || v.snippet?.channelTitle, 80),
    thumb: th.medium?.url || th.high?.url || th.default?.url || `https://i.ytimg.com/vi/${b.videoId}/mqdefault.jpg`,
    d: isoSec(v.contentDetails?.duration), embed: v.status?.embeddable !== false, src: /-\s*topic$/i.test(v.snippet?.channelTitle || '') ? 'audio' : 'mv',
    ...(/^https:\/\/is\d+-ssl\.mzstatic\.com\/[\w./%-]+$/.test(b.art || '') ? { art: b.art } : {}),
    genre, genres, desc: clip(b.desc, 300), ...momentFields(b), by: clip(who.name, 60), byId: who.id, at: Date.now(),
  });
  await store.setJSON('songs', list.slice(0, 2000));
  return json({ ok: true, sid });
}

/** Find a playable official upload for a song picked from the music catalog.
 *  Only the artist's own channel (or its "- Topic" / VEVO channel) counts: no lyric videos, covers or live cuts.
 *  GET /api/song-match?t=<title>&a=<artist>&d=<seconds>  -> { videoId, title, channel, thumb, d, embed } or {} */
const BAD = /(cover|カバー|歌ってみた|弾いてみた|叩いてみた|karaoke|カラオケ|live|ライブ|budokan|武道館|tour|reaction|nightcore|sped up|slowed|instrumental|off vocal|remix|tutorial|弾き語り|メドレー|medley|切り抜き|shorts|short ver|lyric|歌詞|teaser|trailer|予告|making|メイキング|first take|acoustic|8d)/i;
const nrmJ = (s) => (s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
async function songMatch(url) {
  const t = clip(url.searchParams.get('t'), 120), a = clip(url.searchParams.get('a'), 80), d = +url.searchParams.get('d') || 0;
  if (!t || !a) return json({ error: 'bad request' }, 400);
  const audio = await audioMatch(t, a, d);
  if (audio) return json(audio, 200, 'public, durable, s-maxage=2592000');
  const r = await yt('search', { part: 'snippet', type: 'video', maxResults: '15', q: `${a} ${t}` });
  if (!r.ok) return json({ error: r.status === 403 ? '今日の検索の上限に達しました。少し時間をおいてお試しください' : '曲を探せませんでした' }, r.status === 403 ? 429 : 502);
  const ids = ((await r.json()).items || []).map((x) => x.id?.videoId).filter(Boolean);
  if (!ids.length) return json({}, 200, 'public, durable, s-maxage=86400');
  const dv = await yt('videos', { part: 'snippet,contentDetails,status', id: ids.join(',') });
  const vids = dv.ok ? (await dv.json()).items || [] : [];
  const nt = nrmJ(t), na = nrmJ(a);
  let best = null, bestScore = 0;
  for (const v of vids) {
    const title = decode(v.snippet?.title), ch = decode(v.snippet?.channelTitle), sec = isoSec(v.contentDetails?.duration);
    const nv = nrmJ(title), nch = nrmJ(ch.replace(/\s*-\s*topic$/i, '')).replace(/vevo$/, '').replace(/official(channel)?$/, '');
    if (!(nch.length >= 2 && (nch.includes(na) || na.includes(nch)))) continue;   // the artist's own channel only
    if (!(nt && nv.includes(nt))) continue;                                         // must be this song
    if (BAD.test(title) && !BAD.test(t)) continue;
    if (d && sec && (sec < d - 15 || sec > d + 90)) continue;                       // length must fit (MVs may have an intro)
    let sc = 1;
    if (/-\s*topic$/i.test(ch) || /official audio|audio|音源/i.test(title)) sc += 3; // prefer the audio
    if (/\bmv\b|music video|official video|ミュージックビデオ/i.test(title)) sc += 2;
    if (d && sec) sc += Math.abs(sec - d) <= 4 ? 2 : 0;
    if (v.status?.embeddable === false) sc -= 2;
    if (sc > bestScore) { bestScore = sc; best = { videoId: v.id, title, channel: ch, thumb: v.snippet?.thumbnails?.medium?.url || '', d: sec, embed: v.status?.embeddable !== false, kind: /-\s*topic$/i.test(ch) ? 'audio' : 'mv' }; }
  }
  return json(best || {}, 200, 'public, durable, s-maxage=2592000');
}

/** YouTube Music catalogue search (songs only) — the same "art track" audio YouTube Music plays.
 *  Uses YouTube Music's own web search; returns [] when it is unavailable so callers fall back. */
async function ytmSongs(q) {
  try {
    const r = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://music.youtube.com', referer: 'https://music.youtube.com/', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20251110.01.00', hl: 'ja', gl: 'JP' } }, query: q, params: 'EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQFQ==' }),
    });
    if (!r.ok) return [];
    const out = [], walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (o.musicResponsiveListItemRenderer) {
        const it = o.musicResponsiveListItemRenderer, cols = (it.flexColumns || []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []);
        const videoId = it.playlistItemData?.videoId || cols[0]?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
        const meta = cols[1] || [];
        const artists = meta.filter((x) => (x.navigationEndpoint?.browseEndpoint?.browseId || '').startsWith('UC')).map((x) => x.text);
        const album = meta.find((x) => (x.navigationEndpoint?.browseEndpoint?.browseId || '').startsWith('MPRE'))?.text || '';
        const dur = meta.map((x) => x.text).find((x) => /^\d+:\d{2}(:\d{2})?$/.test(x)) || '';
        const d = dur ? dur.split(':').reduce((a2, n) => a2 * 60 + +n, 0) : 0;
        if (videoId) out.push({ videoId, title: cols[0].map((x) => x.text).join(''), artist: artists.join('、') || meta[0]?.text || '', album, d });
        return;
      }
      for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v);
    };
    walk(await r.json());
    return out;
  } catch { return []; }
}
/** the CD (album) audio of a song on YouTube Music, if it can be played here */
async function audioMatch(t, a, d) {
  const nt = nrmJ(t), na = nrmJ(a);
  const songs = await ytmSongs(`${t} ${a}`);
  const hit = songs.find((s) => {
    const ns = nrmJ(s.title), nar = nrmJ(s.artist);
    if (!ns || !(ns === nt || ns.startsWith(nt) || nt.startsWith(ns))) return false;
    if (!(nar && (nar.includes(na) || na.includes(nar)))) return false;
    if (BAD.test(s.title) && !BAD.test(t)) return false;
    return !d || !s.d || Math.abs(s.d - d) <= 8;
  });
  if (!hit) return null;
  const r = await yt('videos', { part: 'snippet,status', id: hit.videoId });
  const v = r.ok ? (await r.json()).items?.[0] : null;
  if (!v || v.status?.embeddable === false) return null;
  return { videoId: hit.videoId, title: hit.title, channel: decode(v.snippet?.channelTitle) || hit.artist, album: hit.album, thumb: v.snippet?.thumbnails?.medium?.url || '', d: hit.d, embed: true, kind: 'audio' };
}

async function songSearch(url) {
  const q = clip(url.searchParams.get('q'), 100), link = url.searchParams.get('url') || '';
  let ids = [];
  const m = /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/.exec(link);
  if (m) ids = [m[1]];
  else if (q) {
    const r = await yt('search', { part: 'snippet', type: 'video', videoCategoryId: '10', maxResults: '12', q });
    if (!r.ok) return json({ error: r.status === 403 ? '今日の検索の上限に達しました。曲のURLを貼り付けて選んでください' : '検索できませんでした' }, r.status === 403 ? 429 : 502);
    ids = ((await r.json()).items || []).map((x) => x.id?.videoId).filter(Boolean);
  } else return json({ items: [] });
  if (!ids.length) return json({ items: [] }, 200, 'public, s-maxage=86400');
  const d = await yt('videos', { part: 'snippet,contentDetails,status', id: ids.join(',') });
  const items = d.ok ? ((await d.json()).items || []).map((v) => ({
    videoId: v.id, title: decode(v.snippet?.title), channel: decode(v.snippet?.channelTitle),
    thumb: v.snippet?.thumbnails?.medium?.url || '', d: isoSec(v.contentDetails?.duration), embed: v.status?.embeddable !== false,
  })) : [];
  return json({ items }, 200, 'public, durable, s-maxage=86400');
}

/* ---------- profile: short self-introduction ---------- */
async function profile(req, url) {
  const store = db();
  if (req.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    if (!/^UC[\w-]{10,40}$/.test(id)) return json({ error: 'bad id' }, 400);
    return json(await readJson(store, 'prof/' + id, {}));
  }
  if (req.method !== 'PUT') return json({ error: 'method not allowed' }, 405);
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: 'ログインしてください' }, 401);
  const b = await req.json().catch(() => ({}));
  const prof = { bio: clip(b.bio, 300), name: clip(who.name, 60), icon: clip(who.icon, 300), updated: Date.now() };
  await store.setJSON('prof/' + who.id, prof);
  return json(prof);
}

/* ---------- admin ---------- */
async function admin(req, path) {
  const store = db();
  if (path === '/api/admin/login') {
    if (!env('ADMIN_PASSWORD')) return json({ error: '運営パスワードがまだ設定されていません（Netlify の ADMIN_PASSWORD）' }, 501);
    const b = await req.json().catch(() => ({}));
    if (String(b.password || '') !== env('ADMIN_PASSWORD')) { await new Promise((r) => setTimeout(r, 1200)); return json({ error: 'パスワードが違います' }, 403); }
    const exp = String(Date.now() + 12 * 3600 * 1000);
    return json({ token: `${exp}.${await hmac(exp)}` });
  }
  if (!(await isAdmin(req))) return json({ error: '運営ログインが必要です' }, 401);
  if (path === '/api/admin/data') {
    const list = await readJson(store, 'list', []), songs = await readJson(store, 'songs', []), likes = await readJson(store, 'likes', {});
    const comments = {};
    const pick = ({ cid, name, text, at, hidden, uid, parent, chId }) => ({ cid, name, text, at, hidden: !!hidden, uid: uid || (chId ? 'ch:' + chId : ''), chId: chId || '', parent: parent || '', likes: likes['c:' + cid] || 0 });
    for (const p of list) comments[p.id] = (await readJson(store, 'c/' + p.id, [])).map(pick);
    for (const s of songs) comments['s:' + s.sid] = (await readJson(store, 'c/s:' + s.sid, [])).map(pick);
    const reports = (await readJson(store, 'reports', [])).map(({ ip, ...r }) => r);
    const posts = [];
    const postRow = (p) => ({ pid: p.pid, by: p.by, byId: p.byId, text: p.text, songs: (p.songs || []).length, songTitles: (p.songs || []).slice(0, 3).map((x) => x.title), thumb: p.songs?.[0]?.art || p.songs?.[0]?.thumb || '', img: p.img || '', battle: !!p.battle, parent: p.parent || '', at: p.at, hidden: !!p.hidden, rc: p.rc || 0 });
    for (const x of (await readJson(store, 'tl', [])).slice(0, 300)) {
      const p = await readJson(store, 'po/' + x.pid, null); if (!p || p.deleted) continue;
      posts.push(postRow(p));
      for (const rid of (await readJson(store, 'rp/' + x.pid, [])).slice(-50)) { const r = await readJson(store, 'po/' + rid, null); if (r && !r.deleted) posts.push(postRow(r)); }
    }
    for (const r of reports.filter((r) => r.kind === 'm')) { const p = await readJson(store, 'po/' + r.id, null); r.title = p && !p.deleted ? `${p.by}「${(p.text || p.songs?.[0]?.title || '写真').slice(0, 60)}」` : '（削除済みの投稿）'; }
    // everyone who has shared, posted or commented, with what they did
    const bans = await readJson(store, 'bans', {}), users = {};
    const u = (id, name) => { if (!id) return null; users[id] = users[id] || { id, name: name || '', playlists: 0, songs: 0, posts: 0, comments: 0, last: 0, banned: !!bans[id] }; if (name && !users[id].name) users[id].name = name; return users[id]; };
    for (const p of list) { const x = u(p.ownerId, p.owner); if (x) { x.playlists++; x.last = Math.max(x.last, p.updated || p.at || 0); } }
    for (const so of songs) { for (const r of [{ id: so.byId, name: so.by }, ...(so.also || [])]) { const x = u(r.id, r.name); if (x) { x.songs++; x.last = Math.max(x.last, so.at || 0); } } }
    for (const p of posts) { const x = u(p.byId, p.by); if (x) { x.posts++; x.last = Math.max(x.last, p.at || 0); } }
    for (const cs of Object.values(comments)) for (const c of cs) { const x = u(c.chId, c.name); if (x) { x.comments++; x.last = Math.max(x.last, c.at || 0); } }
    for (const [id, b] of Object.entries(bans)) u(id, b.name);
    const log = await readJson(store, 'adminlog', []);
    return json({ playlists: list.map((p) => ({ ...p, likes: likes['p:' + p.id] || 0 })), songs: songs.map((s) => ({ ...s, likes: likes['s:' + s.sid] || 0 })), comments, reports, posts, users: Object.values(users).sort((a, b) => b.last - a.last), log });
  }
  if (path === '/api/admin/act' && req.method === 'POST') {
    const { target, id, op, cid, kind, name, note } = await req.json().catch(() => ({}));
    const log = async (what) => { const l = await readJson(store, 'adminlog', []); l.unshift({ at: Date.now(), target, id, op, what: String(what || '').slice(0, 120) }); await store.setJSON('adminlog', l.slice(0, 300)); };
    // when something is hidden or deleted, the reports about it are done too
    const resolve = async (k, rid, rcid) => store.setJSON('reports', (await readJson(store, 'reports', [])).filter((r) => !(r.kind === k && r.id === rid && (!rcid || r.cid === rcid))));
    if (target === 'user') {
      if (!/^UC[\w-]{20,}$/.test(id || '')) return json({ error: 'bad id' }, 400);
      const bans = await readJson(store, 'bans', {});
      if (op === 'ban') { bans[id] = { name: String(name || '').slice(0, 60), at: Date.now(), note: String(note || '').slice(0, 200) }; await store.setJSON('bans', bans); await log(`${name || id} を利用停止`); return json({ ok: true }); }
      if (op === 'unban') { delete bans[id]; await store.setJSON('bans', bans); await log(`${name || id} の利用停止を解除`); return json({ ok: true }); }
      if (op === 'hideall') {
        await store.setJSON('list', (await readJson(store, 'list', [])).map((x) => (x.ownerId === id ? { ...x, hidden: true } : x)));
        await store.setJSON('songs', (await readJson(store, 'songs', [])).map((x) => (x.byId === id ? { ...x, hidden: true } : x)));
        for (const x of await readJson(store, 'tl', [])) if (x.byId === id) { const p = await readJson(store, 'po/' + x.pid, null); if (p && !p.deleted) await store.setJSON('po/' + x.pid, { ...p, hidden: true }); }
        await log(`${name || id} の投稿をすべて非公開`); return json({ ok: true });
      }
      return json({ error: 'bad op' }, 400);
    }
    if (target === 'report' && op === 'resolve') { await resolve(kind, id, cid); await log('通報を対応済みに'); return json({ ok: true }); }
    if (!['hide', 'show', 'delete'].includes(op)) return json({ error: 'bad op' }, 400);
    if (op !== 'show' && target !== 'report') await resolve({ playlist: 'p', song: 's', comment: 'c', post: 'm' }[target], target === 'comment' ? (id.startsWith('s:') ? id.slice(2) : id) : id, target === 'comment' ? cid : '');
    await log(String(name || ''));
    if (target === 'playlist') {
      let list = await readJson(store, 'list', []);
      list = op === 'delete' ? list.filter((x) => x.id !== id) : list.map((x) => (x.id === id ? { ...x, hidden: op === 'hide' } : x));
      await store.setJSON('list', list);
    } else if (target === 'song') {
      let list = await readJson(store, 'songs', []);
      list = op === 'delete' ? list.filter((x) => x.sid !== id) : list.map((x) => (x.sid === id ? { ...x, hidden: op === 'hide' } : x));
      await store.setJSON('songs', list);
    } else if (target === 'comment') {
      let list = await readJson(store, 'c/' + id, []);
      list = op === 'delete' ? list.filter((c) => c.cid !== cid && c.parent !== cid) : list.map((c) => (c.cid === cid ? { ...c, hidden: op === 'hide' } : c)); // deleting a thread removes its replies
      await store.setJSON('c/' + id, list);
      const counts = await readJson(store, 'ccount', {}); counts[id] = list.filter((c) => !c.hidden).length; await store.setJSON('ccount', counts);
    } else if (target === 'post') {
      const p = await readJson(store, 'po/' + id, null);
      if (!p) return json({ error: 'not found' }, 404);
      if (op === 'delete') {
        await store.setJSON('po/' + id, { pid: id, deleted: true, at: p.at, parent: p.parent || '' });
        if (p.parent) await store.setJSON('rp/' + p.parent, (await readJson(store, 'rp/' + p.parent, [])).filter((x) => x !== id));
        else await store.setJSON('tl', (await readJson(store, 'tl', [])).filter((x) => x.pid !== id));
        if (p.img) { try { await getStore('covers').delete(p.img); } catch { /* ignore */ } }
      } else await store.setJSON('po/' + id, { ...p, hidden: op === 'hide' });
    } else if (target === 'report') {
      await store.setJSON('reports', (await readJson(store, 'reports', [])).filter((r) => r.rid !== id)); // resolved
    } else return json({ error: 'bad target' }, 400);
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}

export default async (req, ctx) => {
  const url = new URL(req.url), path = url.pathname;
  try {
    if (path === '/api/like' && req.method === 'POST') return await like(req, ctx);
    if (path === '/api/comments') return await comments(req, ctx, url.searchParams.get('id') || '', url.searchParams.get('kind') === 's' ? 's' : 'p');
    if (path === '/api/songs') return await songs(req, url);
    if (path === '/api/song-search') return await songSearch(url);
    if (path === '/api/song-match') return await songMatch(url);
    if (path === '/api/profile') return await profile(req, url);
    if (path.startsWith('/api/admin/')) return await admin(req, path);
  } catch (e) {
    console.error(e);
    return json({ error: 'サーバーでエラーが起きました' }, 500);
  }
  return json({ error: 'not found' }, 404);
};

export const config = { path: ['/api/like', '/api/comments', '/api/songs', '/api/song-search', '/api/song-match', '/api/profile', '/api/admin/login', '/api/admin/data', '/api/admin/act'] };

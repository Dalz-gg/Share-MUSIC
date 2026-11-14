/* Public gallery ("みんなのプレイリスト") and per-user bookmarks, stored in Netlify Blobs.
 *   GET    /api/gallery                 -> { items: [...] }   newest first, only playlists that are still viewable
 *   GET    /api/gallery-status?id=      -> { listed, bm }
 *   POST   /api/gallery?id=             -> publish (owner only, playlist must be unlisted/public)
 *   DELETE /api/gallery?id=             -> unpublish (owner only)
 *   GET    /api/bookmarks               -> { items: [...] }   (logged-in user)
 *   POST   /api/bookmarks?id=           -> add bookmark   body: { title, owner, image }
 *   DELETE /api/bookmarks?id=           -> remove bookmark
 * Identity = the caller's YouTube channel, checked with their own Google token. */
import { getStore } from '@netlify/blobs';
import { notify, ownerOf, isBanned, BANNED_MSG } from './social.mjs';

const API_KEY = 'AIzaSyA4gaZyYp09zqvc8jbBmjqJRruWDhh80mM';
const SITE = globalThis.__SITE || 'https://playlist-share.netlify.app';
const ID_RE = /^[\w-]{10,64}$/;
const MAX_GALLERY = 300, MAX_BM = 500;
const GENRES = ['jpop', 'rock', 'anime', 'citypop', 'kpop', 'western', 'hiphop', 'edm', 'chill', 'bgm', 'other'];

const json = (obj, status = 200, cdn = 'no-store') => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': cdn },
});
const db = () => getStore({ name: 'gallery', consistency: 'strong' });
const clip = (s, n) => String(s || '').slice(0, n);

async function me(auth) {
  if (!/^Bearer\s+\S+/.test(auth || '')) return null;
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const c = (await r.json()).items?.[0];
  return c ? { id: c.id, name: c.snippet?.title || '' } : null;
}
async function publicPlaylists(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await fetch('https://www.googleapis.com/youtube/v3/playlists?' + new URLSearchParams({ part: 'snippet,status,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: '50', key: API_KEY }), { headers: { Referer: SITE + '/' } });
    if (!r.ok) throw new Error('youtube ' + r.status);
    for (const p of (await r.json()).items || []) if (p.status?.privacyStatus !== 'private') out.set(p.id, p);
  }
  return out;
}
const thumbOf = (th = {}) => Object.values(th).map((x) => x.url).find((u) => u && !u.includes('/vi/')) || th.maxres?.url || th.standard?.url || th.high?.url || th.medium?.url || '';
async function coverOf(id, fallback) {
  try { const m = await getStore('covers').getMetadata(id); if (m?.metadata?.v) return `/api/cover?id=${encodeURIComponent(id)}&v=${m.metadata.v}`; } catch { /* ignore */ }
  return fallback;
}
const readJson = async (store, key, def) => (await store.get(key, { type: 'json' })) ?? def;

export default async (req) => {
  const url = new URL(req.url), path = url.pathname, id = url.searchParams.get('id') || '';
  const store = db();
  try {
    /* ---------------- gallery ---------------- */
    if (path === '/api/gallery' && req.method === 'GET') {
      const list = (await readJson(store, 'list', [])).filter((x) => !x.hidden);
      const counts = await readJson(store, 'bmcount', {});
      const likes = await readJson(store, 'likes', {});
      const ccount = await readJson(store, 'ccount', {});
      let live = null;
      try { live = await publicPlaylists(list.map((x) => x.id)); } catch { /* show stored data if YouTube is unreachable */ }
      const items = [];
      for (const x of list) {
        if (live && !live.has(x.id)) continue; // made private or deleted
        const p = live?.get(x.id);
        items.push({
          ...x,
          title: p?.snippet?.title || x.title, owner: p?.snippet?.channelTitle || x.owner,
          count: p?.contentDetails?.itemCount ?? x.count,
          image: await coverOf(x.id, thumbOf(p?.snippet?.thumbnails) || x.image),
          bm: counts[x.id] || 0, likes: likes['p:' + x.id] || 0, comments: ccount[x.id] || 0,
        });
      }
      return json({ items }, 200, 'public, s-maxage=60, stale-while-revalidate=300');
    }
    if (path === '/api/gallery-status') {
      if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400);
      const list = await readJson(store, 'list', []);
      const counts = await readJson(store, 'bmcount', {});
      const likes = await readJson(store, 'likes', {});
      const x = list.find((y) => y.id === id);
      return json({ listed: !!x && !x.hidden, hidden: !!x?.hidden, genre: x?.genre || '', genres: x?.genres || (x?.genre ? [x.genre] : []), desc: x?.desc || '', look: x?.look || 'vinyl', bm: counts[id] || 0, likes: likes['p:' + id] || 0 });
    }
    if (path === '/api/gallery' && (req.method === 'POST' || req.method === 'DELETE')) {
      if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400);
      const who = await me(req.headers.get('authorization'));
      if (!who) return json({ error: 'ログインし直してください' }, 401);
      const pr = await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet,status,contentDetails&id=${encodeURIComponent(id)}`, { headers: { Authorization: req.headers.get('authorization') } });
      const p = pr.ok ? (await pr.json()).items?.[0] : null;
      if (!p || p.snippet?.channelId !== who.id) return json({ error: 'このプレイリストの持ち主だけが変更できます' }, 403);
      const all = await readJson(store, 'list', []);
      const prev = all.find((x) => x.id === id);
      if (prev?.hidden && req.method === 'POST') return json({ error: 'このプレイリストは運営により非公開になっています' }, 403);
      if (req.method === 'POST' && await isBanned(store, who.id)) return json({ error: BANNED_MSG }, 403);
      let list = all.filter((x) => x.id !== id);
      if (req.method === 'POST') {
        if (p.status?.privacyStatus === 'private') return json({ error: '非公開のプレイリストは公開できません。公開範囲を「限定公開」にしてください' }, 409);
        const body = await req.json().catch(() => ({}));
        const genres = [...new Set((Array.isArray(body.genres) ? body.genres : [body.genre]).filter((g) => GENRES.includes(g)))].slice(0, 3);
        if (!genres.length) return json({ error: 'ジャンルを1つ以上選んでください' }, 400);
        const item = {
          id, title: clip(p.snippet?.title, 150), owner: clip(p.snippet?.channelTitle || who.name, 100), ownerId: who.id,
          image: await coverOf(id, thumbOf(p.snippet?.thumbnails)), count: p.contentDetails?.itemCount ?? null,
          look: (body.look || url.searchParams.get('look')) === 'tape' ? 'tape' : 'vinyl',
          genres, genre: genres[0], desc: clip(body.desc ?? p.snippet?.description, 500),
          at: prev?.at || Date.now(), updated: Date.now(),
        };
        if (prev) list.splice(Math.max(0, all.indexOf(prev)), 0, item); else list.unshift(item); // keep position when updating
        list = list.slice(0, MAX_GALLERY);
      }
      await store.setJSON('list', list);
      return json({ ok: true, listed: req.method === 'POST' });
    }

    /* ---------------- bookmarks ---------------- */
    if (path === '/api/bookmarks') {
      const who = await me(req.headers.get('authorization'));
      if (!who) return json({ error: 'ログインし直してください' }, 401);
      // p = playlists; s = recommended songs; t = any song of a playlist (by video ID). Songs of both kinds share one list.
      const kq = url.searchParams.get('kind'), kind = kq === 's' || kq === 't' ? kq : 'p';
      const key = (kind === 'p' ? 'bm/' : 'bms/') + who.id;
      const iid = kind === 't' ? 't:' + id : id, ck = kind === 'p' ? id : kind + ':' + id;
      let bms = await readJson(store, key, []);
      if (req.method === 'GET') return json({ items: bms });
      if (!(kind === 's' ? /^[\w-]{6,40}$/ : kind === 't' ? /^[\w-]{11}$/ : ID_RE).test(id)) return json({ error: 'bad id' }, 400);
      const counts = await readJson(store, 'bmcount', {});
      const had = bms.some((x) => x.id === iid);
      bms = bms.filter((x) => x.id !== iid);
      if (req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const ytImg = (u) => (/^https:\/\/(i\.ytimg\.com|is\d+-ssl\.mzstatic\.com|lh\d\.googleusercontent\.com|yt\d\.ggpht\.com)\//.test(u || '') ? clip(u, 500) : '');
        bms.unshift(kind === 's'
          ? { id, sid: id, title: clip(b.title, 150), artist: clip(b.artist, 100), by: clip(b.by, 100), image: clip(b.image, 500), at: Date.now() }
          : kind === 't'
            ? { id: iid, vid: id, title: clip(b.title, 150), artist: clip(b.artist, 100), image: ytImg(b.image) || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, pid: /^[\w-]{10,64}$/.test(b.pid || '') ? b.pid : '', ptitle: clip(b.ptitle, 150), d: Math.max(0, Math.min(+b.d || 0, 36000)), at: Date.now() }
            : { id, title: clip(b.title, 150), owner: clip(b.owner, 100), ownerId: /^UC[\w-]{20,}$/.test(b.ownerId || '') ? b.ownerId : '', image: clip(b.image, 500), at: Date.now() });
        bms = bms.slice(0, MAX_BM);
        if (!had) {
          counts[ck] = (counts[ck] || 0) + 1;
          const o = kind === 't' ? null : await ownerOf(store, kind, id);
          if (o) await notify(store, o.ownerId, { t: 'bm', kind, id, title: o.title, from: who.name, fromId: who.id });
        }
      } else if (req.method === 'DELETE') {
        if (had) counts[ck] = Math.max(0, (counts[ck] || 1) - 1);
      } else return json({ error: 'method not allowed' }, 405);
      await store.setJSON(key, bms);
      await store.setJSON('bmcount', counts);
      return json({ ok: true, items: bms, bm: counts[ck] || 0 });
    }
  } catch (e) {
    console.error(e);
    return json({ error: 'サーバーでエラーが起きました' }, 500);
  }
  return json({ error: 'not found' }, 404);
};

export const config = { path: ['/api/gallery', '/api/gallery-status', '/api/bookmarks'] };

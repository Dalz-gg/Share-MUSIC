/* Stage 2 — reactions on recommended songs and ありがとう便.
 *   刺さった (k 'get') is the existing song like: it keeps using POST /api/like (no login, one per device),
 *     so every like given so far carries over as 刺さった. Its count comes back here as `get`.
 *   わかる (k 'wkr') and ありがとう (k 'thx') need a login (one per account).
 *
 *   POST /api/song-react   { sid, k: 'wkr' | 'thx', on?: boolean }   toggle (or set with `on`)   -> { sid, get, wkr, thx, mine }
 *   GET  /api/song-reacts?sid=<sid>              -> { sid, get, wkr, thx, mine }     (mine only with a login)
 *   GET  /api/song-reacts?sids=a,b,c             -> { items: { <sid>: { get, wkr, thx, mine? } } }   (up to 40)
 *   GET  /api/song-reacts?user=<channel>         -> { thx }   ありがとうをもらった数
 *
 * Storage (gallery store), one record per song / per person:
 *   "sr/<sid>"    { wkr: [channelId], thx: [{ id, name, at, to: [channelId] }], sent: [channelId] }
 *   "thxn/<id>"   number of ありがとう received (each thanks counts once for every recommender it reached)
 * ありがとう notifies the poster and everyone who said 私もおすすめ (t: 'thx'), and records a spread edge
 * poster -> thanker (kind 'thx'). */
import { getStore } from '@netlify/blobs';
import { notify, isBanned, BANNED_MSG } from './social.mjs';
import { recordSpread } from './spread.mjs';

const db = () => getStore({ name: 'gallery', consistency: 'strong' });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store' } });
const readJson = async (store, key, def) => (await store.get(key, { type: 'json' })) ?? def;
const SID_RE = /^[\w-]{6,64}$/;
const CH_RE = /^UC[\w-]{20,}$/;
const KINDS = ['wkr', 'thx'];

async function me(auth) {
  if (!/^Bearer\s+\S+/.test(auth || '')) return null;
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const c = (await r.json()).items?.[0];
  return c ? { id: c.id, name: c.snippet?.title || '' } : null;
}

const recOf = async (store, sid) => {
  const r = await readJson(store, 'sr/' + sid, {});
  return { wkr: Array.isArray(r.wkr) ? r.wkr : [], thx: Array.isArray(r.thx) ? r.thx : [], sent: Array.isArray(r.sent) ? r.sent : [] };
};
/** everyone who recommends a song: the poster first, then those who said 私もおすすめ */
const recPeople = (s) => [{ id: s.byId, name: s.by }, ...(s.also || []).map((x) => ({ id: x.id, name: x.name }))].filter((x) => x.id && CH_RE.test(x.id));
function counts(rec, likes, sid, who) {
  const out = { get: likes['s:' + sid] || 0, wkr: rec.wkr.length, thx: rec.thx.length };
  if (who) out.mine = { wkr: rec.wkr.includes(who.id), thx: rec.thx.some((x) => x.id === who.id) };
  return out;
}

async function get(req, url) {
  const store = db();
  const user = url.searchParams.get('user');
  if (user != null) {
    if (!CH_RE.test(user)) return json({ error: 'bad id' }, 400);
    return json({ thx: Math.max(0, +(await readJson(store, 'thxn/' + user, 0)) || 0) });
  }
  const one = url.searchParams.get('sid');
  const sids = one != null ? [one] : [...new Set(String(url.searchParams.get('sids') || '').split(',').filter(Boolean))].slice(0, 40);
  if (!sids.length || !sids.every((s) => SID_RE.test(s))) return json({ error: 'bad request' }, 400);
  const who = req.headers.get('authorization') ? await me(req.headers.get('authorization')) : null;
  const likes = await readJson(store, 'likes', {});
  const recs = await Promise.all(sids.map((s) => recOf(store, s)));
  if (one != null) return json({ sid: one, ...counts(recs[0], likes, one, who) });
  return json({ items: Object.fromEntries(sids.map((s, i) => [s, counts(recs[i], likes, s, who)])) });
}

async function post(req) {
  const b = await req.json().catch(() => ({}));
  const sid = String(b.sid || ''), k = String(b.k || '');
  if (!SID_RE.test(sid)) return json({ error: 'bad request' }, 400);
  if (k === 'get') return json({ error: '「刺さった」は /api/like で送ってください' }, 400);
  if (!KINDS.includes(k)) return json({ error: 'bad request' }, 400);
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: 'ログインしてください' }, 401);
  const store = db();
  if (await isBanned(store, who.id)) return json({ error: BANNED_MSG }, 403);
  const song = (await readJson(store, 'songs', [])).find((x) => x.sid === sid && !x.hidden);
  if (!song) return json({ error: 'この曲は見つかりませんでした' }, 404);
  const rec = await recOf(store, sid);
  const people = recPeople(song);
  const had = k === 'wkr' ? rec.wkr.includes(who.id) : rec.thx.some((x) => x.id === who.id);
  const on = typeof b.on === 'boolean' ? b.on : !had;
  if (on && k === 'thx' && people.some((p) => p.id === who.id)) return json({ error: '自分がおすすめした曲には「ありがとう」を送れません' }, 400);
  if (on !== had) {
    if (k === 'wkr') {
      rec.wkr = on ? [...rec.wkr, who.id] : rec.wkr.filter((x) => x !== who.id);
    } else if (on) {
      const to = people.map((p) => p.id).filter((id) => id !== who.id);
      rec.thx.push({ id: who.id, name: String(who.name || '').slice(0, 60), at: Date.now(), to });
      for (const id of to) await store.setJSON('thxn/' + id, (+(await readJson(store, 'thxn/' + id, 0)) || 0) + 1);
      if (!rec.sent.includes(who.id)) { // a thanks taken back and sent again does not ring twice
        rec.sent.push(who.id);
        for (const id of to) await notify(store, id, { t: 'thx', kind: 's', id: sid, title: song.title, from: who.name, fromId: who.id });
      }
      if (people[0]) await recordSpread(store, { sid, from: people[0], to: who, kind: 'thx' });
    } else {
      const mine = rec.thx.find((x) => x.id === who.id);
      rec.thx = rec.thx.filter((x) => x !== mine);
      for (const id of mine?.to || []) await store.setJSON('thxn/' + id, Math.max(0, ((+(await readJson(store, 'thxn/' + id, 0)) || 0) - 1)));
    }
    rec.thx = rec.thx.slice(-5000); rec.wkr = rec.wkr.slice(-5000); rec.sent = rec.sent.slice(-5000);
    await store.setJSON('sr/' + sid, rec);
  }
  return json({ sid, ...counts(rec, await readJson(store, 'likes', {}), sid, who) });
}

export default async (req) => {
  const url = new URL(req.url), path = url.pathname;
  try {
    if (path === '/api/song-reacts' && req.method === 'GET') return await get(req, url);
    if (path === '/api/song-react' && req.method === 'POST') return await post(req);
    if (path === '/api/song-react' || path === '/api/song-reacts') return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: 'サーバーでエラーが起きました' }, 500);
  }
  return json({ error: 'not found' }, 404);
};
export const config = { path: ['/api/song-react', '/api/song-reacts'] };

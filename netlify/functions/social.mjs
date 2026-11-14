/* Notifications, follows and reports.
 *   GET    /api/notifs                 -> { items, unread }          (logged-in user)
 *   POST   /api/notifs/read            -> mark everything as read
 *   GET    /api/follows                -> { items: [{ id, name, at }] }  people I follow (logged in)
 *   GET    /api/follows?of=<channel>   -> { followers, following }   counts for a profile
 *   POST   /api/follows?id=<channel>   -> follow      body: { name }
 *   DELETE /api/follows?id=<channel>   -> unfollow
 *   POST   /api/report                 -> report a playlist / song / comment to the operator
 * Other handlers call notify() when someone likes, comments on, bookmarks or follows. */
import { getStore } from '@netlify/blobs';

const db = () => getStore({ name: 'gallery', consistency: 'strong' });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store' } });
const readJson = async (store, key, def) => (await store.get(key, { type: 'json' })) ?? def;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
const CH_RE = /^UC[\w-]{20,}$/;
const MAX_NOTIFS = 100;
const enc = new TextEncoder();
async function sha(s) { const d = await crypto.subtle.digest('SHA-256', enc.encode('ps1:' + s)); return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join(''); }
const ipOf = (req, ctx) => ctx?.ip || req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

async function me(auth) {
  if (!/^Bearer\s+\S+/.test(auth || '')) return null;
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const c = (await r.json()).items?.[0];
  return c ? { id: c.id, name: c.snippet?.title || '' } : null;
}

/** accounts the operator has suspended can no longer post, comment or share */
export async function isBanned(store, id) { return !!id && !!(await readJson(store, 'bans', {}))[id]; }
export const BANNED_MSG = 'このアカウントは運営により利用が停止されています';

/** who owns a shared playlist ("p") or a recommended song ("s"), and its title */
export async function ownerOf(store, kind, id) {
  if (kind === 's') { const s = (await readJson(store, 'songs', [])).find((x) => x.sid === id); return s ? { ownerId: s.byId, title: s.title } : null; }
  const p = (await readJson(store, 'list', [])).find((x) => x.id === id); return p ? { ownerId: p.ownerId, title: p.title } : null;
}

/** add a notification for `to` (a channel id). Anonymous likes on the same thing are merged into one entry. */
export async function notify(store, to, n) {
  try {
    if (!to || !CH_RE.test(to) || (n.fromId && n.fromId === to)) return;
    const key = 'nt/' + to;
    const list = await readJson(store, key, []);
    const now = Date.now();
    // the same person re-adding the same reaction (or re-following) shortly after does not notify twice
    if (n.fromId && ['react', 'follow', 'bm'].includes(n.t) && list.some((x) => x.t === n.t && x.fromId === n.fromId && x.id === n.id && (x.r || '') === (n.r || '') && now - x.at < 6 * 3600e3)) return;
    if (n.t === 'like') {
      const same = list.find((x) => x.t === 'like' && x.kind === n.kind && x.id === n.id && now - x.at < 6 * 3600e3);
      if (same) { same.n = (same.n || 1) + 1; same.at = now; await store.setJSON(key, [same, ...list.filter((x) => x !== same)]); return; }
    }
    list.unshift({ ...n, title: clip(n.title, 120), from: clip(n.from, 60), text: clip(n.text, 120), at: now });
    await store.setJSON(key, list.slice(0, MAX_NOTIFS));
  } catch (e) { console.error('notify', e); }
}

async function notifs(req, path) {
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: 'ログインしてください' }, 401);
  const store = db();
  if (path === '/api/notifs/read' && req.method === 'POST') { await store.setJSON('ntr/' + who.id, Date.now()); return json({ ok: true }); }
  const items = await readJson(store, 'nt/' + who.id, []), read = await readJson(store, 'ntr/' + who.id, 0);
  return json({ items, unread: items.filter((x) => x.at > read).length, read });
}

async function follows(req, url) {
  const store = db();
  const of = url.searchParams.get('of') || '';
  if (req.method === 'GET' && of) {
    if (!CH_RE.test(of)) return json({ error: 'bad id' }, 400);
    const fc = await readJson(store, 'fc', {});
    return json({ followers: fc[of] || 0, following: (await readJson(store, 'fl/' + of, [])).length });
  }
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: 'ログインしてください' }, 401);
  const key = 'fl/' + who.id;
  let list = await readJson(store, key, []);
  if (req.method === 'GET') return json({ items: list });
  const id = url.searchParams.get('id') || '';
  if (!CH_RE.test(id)) return json({ error: 'bad id' }, 400);
  if (id === who.id) return json({ error: '自分はフォローできません' }, 400);
  const fc = await readJson(store, 'fc', {});
  const had = list.some((x) => x.id === id);
  if (req.method === 'POST') {
    if (!had) {
      const b = await req.json().catch(() => ({}));
      list.unshift({ id, name: clip(b.name, 60), at: Date.now() }); list = list.slice(0, 1000);
      fc[id] = (fc[id] || 0) + 1;
      await notify(store, id, { t: 'follow', from: who.name, fromId: who.id });
    }
  } else if (req.method === 'DELETE') {
    if (had) { list = list.filter((x) => x.id !== id); fc[id] = Math.max(0, (fc[id] || 1) - 1); }
  } else return json({ error: 'method not allowed' }, 405);
  await store.setJSON(key, list); await store.setJSON('fc', fc);
  return json({ ok: true, items: list, followers: fc[id] || 0 });
}

const REASONS = { spam: 'スパム・宣伝', abuse: '悪口・嫌がらせ', inappropriate: '不適切な内容', rights: '権利の侵害', other: 'その他' };
async function report(req, ctx) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const b = await req.json().catch(() => ({}));
  const kind = ['p', 's', 'c', 'm'].includes(b.kind) ? b.kind : '';
  const id = String(b.id || ''), cid = String(b.cid || ''), thread = String(b.thread || '');
  if (!kind || !/^[\w-]{6,64}$/.test(id) || (kind === 'c' && (!/^[\w-]{6,40}$/.test(cid) || !/^[ps]:[\w-]{6,64}$/.test(thread)))) return json({ error: 'bad request' }, 400);
  if (!REASONS[b.reason]) return json({ error: '理由を選んでください' }, 400);
  const store = db();
  const ip = await sha('i:' + ipOf(req, ctx));
  const rl = await readJson(store, 'rr/' + ip, 0);
  if (Date.now() - rl < 20000) return json({ error: '少し時間をおいてからもう一度お試しください' }, 429);
  await store.setJSON('rr/' + ip, Date.now());
  const list = await readJson(store, 'reports', []);
  list.unshift({ rid: (await sha(id + cid + ip + Date.now())).slice(0, 12), kind, id, cid, thread, reason: b.reason, text: clip(b.text, 300), at: Date.now(), ip });
  await store.setJSON('reports', list.slice(0, 500));
  return json({ ok: true });
}

export default async (req, ctx) => {
  const url = new URL(req.url), path = url.pathname;
  try {
    if (path === '/api/notifs' || path === '/api/notifs/read') return await notifs(req, path);
    if (path === '/api/follows') return await follows(req, url);
    if (path === '/api/report') return await report(req, ctx);
  } catch (e) {
    console.error(e);
    return json({ error: 'サーバーでエラーが起きました' }, 500);
  }
  return json({ error: 'not found' }, 404);
};

export const config = { path: ['/api/notifs', '/api/notifs/read', '/api/follows', '/api/report'] };

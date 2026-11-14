/* Community: short posts with songs (mixtapes), a photo, song battles, quotes, replies and music reactions.
 *   GET    /api/posts?feed=all|following&before=<ms>&by=<channel>   -> { items, next }      (timeline, newest first)
 *   GET    /api/post?pid=                                            -> { item, replies }    (a post and its replies)
 *   POST   /api/posts                 body: { text, songs[], img, battle, quote, parent }   (logged in)
 *   DELETE /api/posts?pid=            delete my post
 *   POST   /api/post-react            body: { pid, r }      toggle a reaction (heart|fire|cry|loop|emo)
 *   POST   /api/post-vote             body: { pid, side }   vote in a song battle (0|1, can change)
 *   POST   /api/post-img              raw image (jpeg/webp/png, <= 900KB) -> { key }
 *   GET    /api/pimg?k=<key>          the photo
 * Storage: posts in D1 ("gallery" store: po/<pid>, timeline index "tl", replies "rp/<pid>"), photos in KV ("covers"). */
import { getStore } from '@netlify/blobs';
import { notify, isBanned, BANNED_MSG } from './social.mjs';

const db = () => getStore({ name: 'gallery', consistency: 'strong' });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store' } });
const readJson = async (store, key, def) => (await store.get(key, { type: 'json' })) ?? def;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
const enc = new TextEncoder();
async function sha(s) { const d = await crypto.subtle.digest('SHA-256', enc.encode('ps1:' + s)); return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join(''); }
const PID_RE = /^[a-f0-9]{14}$/, VID_RE = /^[\w-]{11}$/, IMG_RE = /^pi_[a-f0-9]{8}_[a-f0-9]{16}$/;
const REACTIONS = ['heart', 'fire', 'cry', 'loop', 'emo'];
const MAX_TL = 3000, MAX_SONGS = 30, PAGE = 20;
const imgOk = (u) => (/^https:\/\/(i\.ytimg\.com|is\d+-ssl\.mzstatic\.com)\//.test(u || '') ? clip(u, 400) : '');

async function me(auth) {
  if (!/^Bearer\s+\S+/.test(auth || '')) return null;
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const c = (await r.json()).items?.[0];
  return c ? { id: c.id, name: c.snippet?.title || '', icon: c.snippet?.thumbnails?.default?.url || '' } : null;
}

/** what the reader sees of a post: counts, and their own reactions / vote */
async function view(store, p, uid, depth = 0) {
  if (!p) return null;
  if (p.deleted || p.hidden) return { pid: p.pid, deleted: true, at: p.at, parent: p.parent || '' };
  const rx = await readJson(store, 'pr/' + p.pid, {});
  const counts = Object.fromEntries(REACTIONS.map((r) => [r, 0]));
  for (const list of Object.values(rx)) for (const r of list) if (r in counts) counts[r]++;
  const out = {
    pid: p.pid, by: p.by, byId: p.byId, icon: p.icon || '', text: p.text, at: p.at, songs: p.songs || [], img: p.img || '',
    battle: !!p.battle, parent: p.parent || '', rc: p.rc || 0, qc: p.qc || 0, rx: counts, mine: uid ? rx[uid] || [] : [],
  };
  if (p.battle) {
    const votes = await readJson(store, 'pv/' + p.pid, {});
    const v = [0, 0]; for (const s of Object.values(votes)) if (s === 0 || s === 1) v[s]++;
    out.votes = v; out.myVote = uid && uid in votes ? votes[uid] : null;
  }
  if (p.quote && depth === 0) {
    const q = await readJson(store, 'po/' + p.quote, null);
    out.q = q && !q.deleted && !q.hidden ? { pid: q.pid, by: q.by, byId: q.byId, icon: q.icon || '', text: q.text, at: q.at, songs: (q.songs || []).slice(0, 2), img: q.img || '', battle: !!q.battle } : { pid: p.quote, deleted: true };
  }
  return out;
}

async function timeline(req, url) {
  const store = db();
  const auth = req.headers.get('authorization');
  const who = auth ? await me(auth) : null;
  const feed = url.searchParams.get('feed') || 'all', by = url.searchParams.get('by') || '', before = +url.searchParams.get('before') || Infinity;
  let tl = await readJson(store, 'tl', []);
  if (by) tl = tl.filter((x) => x.byId === by);
  else if (feed === 'following') {
    if (!who) return json({ error: 'ログインしてください' }, 401);
    const fl = new Set((await readJson(store, 'fl/' + who.id, [])).map((x) => x.id)); fl.add(who.id);
    tl = tl.filter((x) => fl.has(x.byId));
  }
  const page = tl.filter((x) => x.at < before).slice(0, PAGE);
  const items = [];
  for (const x of page) { const v = await view(store, await readJson(store, 'po/' + x.pid, null), who?.id); if (v && !v.deleted) items.push(v); }
  return json({ items, next: page.length === PAGE ? page[page.length - 1].at : null, me: who?.id || '' });
}

async function one(req, url) {
  const store = db(), pid = url.searchParams.get('pid') || '';
  if (!PID_RE.test(pid)) return json({ error: 'bad id' }, 400);
  const auth = req.headers.get('authorization'), who = auth ? await me(auth) : null;
  const p = await readJson(store, 'po/' + pid, null);
  if (!p) return json({ error: 'この投稿は見つかりませんでした' }, 404);
  const item = await view(store, p, who?.id);
  const replies = [];
  for (const rid of await readJson(store, 'rp/' + pid, [])) { const v = await view(store, await readJson(store, 'po/' + rid, null), who?.id, 1); if (v && !v.deleted) replies.push(v); }
  const parent = p.parent ? await view(store, await readJson(store, 'po/' + p.parent, null), who?.id, 1) : null;
  return json({ item, replies, parent, me: who?.id || '' });
}

async function create(req) {
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: 'ログインしてください' }, 401);
  if (await isBanned(db(), who.id)) return json({ error: BANNED_MSG }, 403);
  const store = db();
  const last = await readJson(store, 'prl/' + who.id, 0);
  if (Date.now() - last < 8000) return json({ error: '少し時間をおいてから投稿してください' }, 429);
  const b = await req.json().catch(() => ({}));
  const text = clip(b.text, 500);
  const songs = (Array.isArray(b.songs) ? b.songs : []).filter((s) => VID_RE.test(s?.id || '')).slice(0, MAX_SONGS)
    .map((s) => ({ id: s.id, title: clip(s.title, 120), artist: clip(s.artist, 80), thumb: imgOk(s.thumb) || `https://i.ytimg.com/vi/${s.id}/mqdefault.jpg`, art: imgOk(s.art), d: Math.max(0, Math.min(+s.d || 0, 36000)) }));
  const battle = !!b.battle && songs.length === 2;
  if (b.battle && !battle) return json({ error: '曲バトルには曲を2曲選んでください' }, 400);
  let img = '';
  if (b.img) {
    if (!IMG_RE.test(b.img) || !b.img.startsWith('pi_' + (await sha('u:' + who.id)).slice(0, 8) + '_')) return json({ error: '写真をもう一度選んでください' }, 400);
    img = b.img;
  }
  if (!text && !songs.length && !img) return json({ error: '文章・曲・写真のどれかを入れてください' }, 400);
  const quote = PID_RE.test(b.quote || '') ? b.quote : '', parentId = PID_RE.test(b.parent || '') ? b.parent : '';
  const q = quote ? await readJson(store, 'po/' + quote, null) : null;
  const parent = parentId ? await readJson(store, 'po/' + parentId, null) : null;
  if (quote && (!q || q.deleted || q.hidden)) return json({ error: '引用する投稿が見つかりません' }, 404);
  if (parentId && (!parent || parent.deleted || parent.hidden)) return json({ error: '返信先の投稿が見つかりません' }, 404);
  const pid = (await sha(who.id + Date.now() + Math.random())).slice(0, 14);
  const p = { pid, by: clip(who.name, 60), byId: who.id, icon: clip(who.icon, 300), text, songs, img, battle, quote, parent: parentId, at: Date.now(), rc: 0, qc: 0 };
  await store.setJSON('po/' + pid, p);
  await store.setJSON('prl/' + who.id, Date.now());
  const excerpt = text || songs[0]?.title || '写真';
  if (parent) {
    const rp = await readJson(store, 'rp/' + parentId, []); rp.push(pid); await store.setJSON('rp/' + parentId, rp.slice(-500));
    parent.rc = (parent.rc || 0) + 1; await store.setJSON('po/' + parentId, parent);
    await notify(store, parent.byId, { t: 'preply', kind: 'm', id: parentId, title: parent.text || parent.songs?.[0]?.title || '', from: who.name, fromId: who.id, text: excerpt });
    // everyone else who joined this thread hears about the new reply too
    const ppl = await readJson(store, 'rpu/' + parentId, []);
    for (const id of ppl.slice(-30)) if (id !== who.id && id !== parent.byId) await notify(store, id, { t: 'thread', kind: 'm', id: parentId, title: parent.text || parent.songs?.[0]?.title || '', from: who.name, fromId: who.id, text: excerpt });
    if (!ppl.includes(who.id)) await store.setJSON('rpu/' + parentId, [...ppl, who.id].slice(-200));
  } else {
    const tl = await readJson(store, 'tl', []);
    tl.unshift({ pid, at: p.at, byId: who.id }); await store.setJSON('tl', tl.slice(0, MAX_TL));
  }
  if (q) {
    q.qc = (q.qc || 0) + 1; await store.setJSON('po/' + quote, q);
    await notify(store, q.byId, { t: 'quote', kind: 'm', id: pid, title: q.text || q.songs?.[0]?.title || '', from: who.name, fromId: who.id, text: excerpt });
  }
  return json({ ok: true, item: await view(store, p, who.id) });
}

async function remove(req, url) {
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: 'ログインしてください' }, 401);
  const store = db(), pid = url.searchParams.get('pid') || '';
  const p = PID_RE.test(pid) ? await readJson(store, 'po/' + pid, null) : null;
  if (!p || p.deleted) return json({ error: '見つかりません' }, 404);
  if (p.byId !== who.id) return json({ error: '自分の投稿だけ削除できます' }, 403);
  await store.setJSON('po/' + pid, { pid, deleted: true, at: p.at, parent: p.parent || '' }); // kept as a stub so quotes/replies still make sense
  if (p.img) { try { await getStore('covers').delete(p.img); } catch { /* ignore */ } }
  if (p.parent) {
    const parent = await readJson(store, 'po/' + p.parent, null);
    if (parent && !parent.deleted) { parent.rc = Math.max(0, (parent.rc || 1) - 1); await store.setJSON('po/' + p.parent, parent); }
    await store.setJSON('rp/' + p.parent, (await readJson(store, 'rp/' + p.parent, [])).filter((x) => x !== pid));
  } else await store.setJSON('tl', (await readJson(store, 'tl', [])).filter((x) => x.pid !== pid));
  return json({ ok: true });
}

async function react(req) {
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: 'リアクションするにはログインしてください' }, 401);
  if (await isBanned(db(), who.id)) return json({ error: BANNED_MSG }, 403);
  const b = await req.json().catch(() => ({}));
  if (!PID_RE.test(b.pid || '') || !REACTIONS.includes(b.r)) return json({ error: 'bad request' }, 400);
  const store = db(), p = await readJson(store, 'po/' + b.pid, null);
  if (!p || p.deleted || p.hidden) return json({ error: '見つかりません' }, 404);
  const rx = await readJson(store, 'pr/' + b.pid, {});
  const mine = new Set(rx[who.id] || []);
  const on = !mine.has(b.r);
  if (on) mine.add(b.r); else mine.delete(b.r);
  if (mine.size) rx[who.id] = [...mine]; else delete rx[who.id];
  await store.setJSON('pr/' + b.pid, rx);
  if (on) await notify(store, p.byId, { t: 'react', kind: 'm', id: b.pid, title: p.text || p.songs?.[0]?.title || '', r: b.r, from: who.name, fromId: who.id });
  return json({ ok: true, item: await view(store, p, who.id) });
}

async function vote(req) {
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: '投票するにはログインしてください' }, 401);
  if (await isBanned(db(), who.id)) return json({ error: BANNED_MSG }, 403);
  const b = await req.json().catch(() => ({}));
  if (!PID_RE.test(b.pid || '') || ![0, 1].includes(b.side)) return json({ error: 'bad request' }, 400);
  const store = db(), p = await readJson(store, 'po/' + b.pid, null);
  if (!p || p.deleted || p.hidden || !p.battle) return json({ error: '見つかりません' }, 404);
  const votes = await readJson(store, 'pv/' + b.pid, {});
  votes[who.id] = b.side;
  await store.setJSON('pv/' + b.pid, votes);
  return json({ ok: true, item: await view(store, p, who.id) });
}

async function upload(req) {
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: 'ログインしてください' }, 401);
  if (await isBanned(db(), who.id)) return json({ error: BANNED_MSG }, 403);
  const type = (req.headers.get('content-type') || '').split(';')[0];
  if (!['image/jpeg', 'image/webp', 'image/png'].includes(type)) return json({ error: 'JPEG・PNG・WebP の画像を選んでください' }, 415);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 900 * 1024) return json({ error: '画像が大きすぎます' }, 413);
  const store = db();
  const day = new Date().toISOString().slice(0, 10), key = 'piq/' + who.id;
  const q = await readJson(store, key, {});
  if ((q[day] || 0) >= 20) return json({ error: '今日はこれ以上写真を投稿できません' }, 429);
  await store.setJSON(key, { [day]: (q[day] || 0) + 1 });
  const k = `pi_${(await sha('u:' + who.id)).slice(0, 8)}_${(await sha(who.id + Date.now() + Math.random())).slice(0, 16)}`;
  await getStore('covers').set(k, buf, { metadata: { type, by: who.id } });
  return json({ key: k });
}

async function photo(url) {
  const k = url.searchParams.get('k') || '';
  if (!IMG_RE.test(k)) return new Response('bad', { status: 400 });
  const got = await getStore('covers').getWithMetadata(k, { type: 'arrayBuffer' });
  if (!got) return new Response('not found', { status: 404 });
  return new Response(got.data, { headers: { 'content-type': got.metadata?.type || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
}

export default async (req) => {
  const url = new URL(req.url), path = url.pathname;
  try {
    if (path === '/api/posts' && req.method === 'GET') return await timeline(req, url);
    if (path === '/api/posts' && req.method === 'POST') return await create(req);
    if (path === '/api/posts' && req.method === 'DELETE') return await remove(req, url);
    if (path === '/api/post') return await one(req, url);
    if (path === '/api/post-react' && req.method === 'POST') return await react(req);
    if (path === '/api/post-vote' && req.method === 'POST') return await vote(req);
    if (path === '/api/post-img' && req.method === 'POST') return await upload(req);
    if (path === '/api/pimg') return await photo(url);
  } catch (e) {
    console.error(e);
    return json({ error: 'サーバーでエラーが起きました' }, 500);
  }
  return json({ error: 'not found' }, 404);
};

export const config = { path: ['/api/posts', '/api/post', '/api/post-react', '/api/post-vote', '/api/post-img', '/api/pimg'] };

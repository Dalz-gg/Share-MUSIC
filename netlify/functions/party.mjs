/* Listening parties: one host plays a queue, everyone in the room hears the same song at the same moment
 * (each person's own YouTube player is kept in step), with live chat and reactions.
 *   GET  /api/parties                    -> { items }  rooms that are live now
 *   POST /api/party                      create (logged in)   body: { title, songs[] } -> { rid, k }
 *   POST /api/party-join   { rid }       -> { k, host }  (logged in = named member; otherwise an anonymous listener)
 *   GET  /api/party?rid=&k=&since=       -> { room, now, chat, seq, people }   polled every few seconds
 *   POST /api/party-ctl    { rid, k, op, ... }   host: sync (idx/playing/pos), remove, close, open; members: add
 *   POST /api/party-chat   { rid, k, text | r }  chat message or a reaction burst
 * Member keys ("k") are random per person per room, so polling never needs a Google call. */
import { getStore } from '@netlify/blobs';
import { isBanned, BANNED_MSG } from './social.mjs';

const db = () => getStore({ name: 'gallery', consistency: 'strong' });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store' } });
const readJson = async (store, key, def) => (await store.get(key, { type: 'json' })) ?? def;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
const enc = new TextEncoder();
async function rnd(s) { const d = await crypto.subtle.digest('SHA-256', enc.encode('pty:' + s + Math.random() + Date.now())); return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join(''); }
const RID_RE = /^[a-f0-9]{10}$/, K_RE = /^[a-f0-9]{16}$/, VID_RE = /^[\w-]{11}$/;
const RX = ['heart', 'fire', 'cry', 'loop', 'emo'];
const LIVE_MS = 10 * 60e3, SEEN_MS = 45e3, MAX_QUEUE = 200;
const imgOk = (u) => (/^https:\/\/(i\.ytimg\.com|is\d+-ssl\.mzstatic\.com)\//.test(u || '') ? clip(u, 400) : '');
const song = (s, by) => ({ id: s.id, title: clip(s.title, 120), artist: clip(s.artist, 80), thumb: imgOk(s.thumb) || `https://i.ytimg.com/vi/${s.id}/mqdefault.jpg`, art: imgOk(s.art), d: Math.max(0, Math.min(+s.d || 0, 36000)), by: clip(by, 60) });

async function me(auth) {
  if (!/^Bearer\s+\S+/.test(auth || '')) return null;
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const c = (await r.json()).items?.[0];
  return c ? { id: c.id, name: c.snippet?.title || '', icon: c.snippet?.thumbnails?.default?.url || '' } : null;
}
const pub = (room) => ({ rid: room.rid, title: room.title, host: room.host, hostId: room.hostId, hostIcon: room.hostIcon || '', queue: room.queue, idx: room.idx, playing: room.playing, pos: room.pos, at: room.at, open: room.open, closed: !!room.closed, created: room.created, updated: room.updated });
/** where the song is now (seconds) */
const posNow = (room, now = Date.now()) => (room.playing ? room.pos + (now - room.at) / 1000 : room.pos);

async function live(store) {
  const ids = await readJson(store, 'parties', []), items = [], keep = [];
  for (const rid of ids) {
    const room = await readJson(store, 'pty/' + rid, null);
    if (!room || room.closed || Date.now() - room.updated > LIVE_MS) continue;
    keep.push(rid);
    const pres = await readJson(store, 'ptp/' + rid, {});
    const people = Object.values(pres).filter((p) => Date.now() - p.seen < SEEN_MS);
    const cur = room.queue[room.idx];
    items.push({ rid, title: room.title, host: room.host, hostId: room.hostId, now: cur ? { title: cur.title, artist: cur.artist, art: cur.art || cur.thumb } : null, listeners: people.length, faces: people.filter((p) => p.uid).slice(0, 5).map((p) => ({ id: p.uid, name: p.name })), created: room.created });
  }
  if (keep.length !== ids.length) await store.setJSON('parties', keep);
  return items;
}

export default async (req) => {
  const url = new URL(req.url), path = url.pathname, store = db();
  try {
    if (path === '/api/parties') return json({ items: await live(store) });

    if (path === '/api/party' && req.method === 'POST') {
      const who = await me(req.headers.get('authorization'));
      if (!who) return json({ error: 'パーティーを開くにはログインしてください' }, 401);
      if (await isBanned(store, who.id)) return json({ error: BANNED_MSG }, 403);
      const b = await req.json().catch(() => ({}));
      const queue = (Array.isArray(b.songs) ? b.songs : []).filter((s) => VID_RE.test(s?.id || '')).slice(0, MAX_QUEUE).map((s) => song(s, who.name));
      // one live room per host: reopening replaces the old one
      const ids = await readJson(store, 'parties', []);
      for (const rid of ids) { const r = await readJson(store, 'pty/' + rid, null); if (r && r.hostId === who.id && !r.closed) await store.setJSON('pty/' + rid, { ...r, closed: true }); }
      const rid = (await rnd(who.id)).slice(0, 10), k = await rnd(rid);
      const now = Date.now();
      const room = { rid, title: clip(b.title, 60) || `${who.name}のリスニングパーティー`, host: clip(who.name, 60), hostId: who.id, hostIcon: clip(who.icon, 300), queue, idx: 0, playing: false, pos: 0, at: now, open: true, created: now, updated: now };
      await store.setJSON('pty/' + rid, room);
      await store.setJSON('ptm/' + rid, { [k]: { uid: who.id, name: who.name, icon: who.icon, host: true } });
      await store.setJSON('parties', [rid, ...ids.filter((x) => x !== rid)].slice(0, 100));
      return json({ rid, k, room: pub(room), now });
    }

    const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const rid = url.searchParams.get('rid') || b.rid || '';
    if (!RID_RE.test(rid)) return json({ error: 'bad room' }, 400);
    const room = await readJson(store, 'pty/' + rid, null);
    if (!room) return json({ error: 'このパーティーは見つかりませんでした' }, 404);
    const members = await readJson(store, 'ptm/' + rid, {});
    const k = url.searchParams.get('k') || b.k || '';
    const mem = K_RE.test(k) ? members[k] : null;

    if (path === '/api/party-join' && req.method === 'POST') {
      if (room.closed) return json({ error: 'このパーティーは終了しました' }, 410);
      const auth = req.headers.get('authorization');
      const who = auth ? await me(auth) : null;
      const nk = await rnd(rid + (who?.id || 'guest'));
      members[nk] = who ? { uid: who.id, name: who.name, icon: who.icon, host: who.id === room.hostId } : { uid: '', name: 'ゲスト', icon: '' };
      const keys = Object.keys(members); if (keys.length > 500) delete members[keys[0]];
      await store.setJSON('ptm/' + rid, members);
      return json({ k: nk, host: !!members[nk].host, named: !!who });
    }

    if (path === '/api/party' && req.method === 'GET') {
      const now = Date.now();
      // presence: written at most every ~20s per person to keep database writes low
      if (mem) {
        const pres = await readJson(store, 'ptp/' + rid, {});
        if (!pres[k] || now - pres[k].seen > 20e3) {
          pres[k] = { uid: mem.uid, name: mem.name, icon: mem.icon || '', seen: now };
          for (const [kk, p] of Object.entries(pres)) if (now - p.seen > 5 * 60e3) delete pres[kk];
          await store.setJSON('ptp/' + rid, pres);
          if (mem.host && now - room.updated > 30e3) await store.setJSON('pty/' + rid, { ...room, updated: now }); // keeps the room listed as live
        }
      }
      const pres = await readJson(store, 'ptp/' + rid, {});
      const people = Object.values(pres).filter((p) => now - p.seen < SEEN_MS);
      const since = +url.searchParams.get('since') || 0;
      const all = await readJson(store, 'ptc/' + rid, []);
      const chat = all.filter((m) => m.seq > since);
      return json({ room: pub(room), now, seq: all.length ? all[all.length - 1].seq : 0, chat, people: { count: people.length, list: people.filter((p) => p.uid).slice(0, 30).map((p) => ({ id: p.uid, name: p.name, icon: p.icon })) }, me: mem ? { host: !!mem.host, named: !!mem.uid } : null });
    }

    if (path === '/api/party-ctl' && req.method === 'POST') {
      if (!mem) return json({ error: 'パーティーに参加してください' }, 403);
      if (room.closed) return json({ error: 'このパーティーは終了しました' }, 410);
      const now = Date.now(), op = b.op;
      if (op === 'add') {
        if (!mem.host && (!room.open || !mem.uid)) return json({ error: room.open ? '曲を追加するにはログインしてください' : 'いまは主催者だけが曲を追加できます' }, 403);
        if (mem.uid && await isBanned(store, mem.uid)) return json({ error: BANNED_MSG }, 403);
        const add = (Array.isArray(b.songs) ? b.songs : []).filter((s) => VID_RE.test(s?.id || '')).slice(0, 50).map((s) => song(s, mem.name));
        if (!add.length) return json({ error: '曲を選んでください' }, 400);
        room.queue = [...room.queue, ...add].slice(0, MAX_QUEUE);
        await sysMsg(store, room, `${mem.name}さんが「${add[0].title}」${add.length > 1 ? `ほか${add.length - 1}曲` : ''}を追加しました`);
      } else {
        if (!mem.host) return json({ error: '主催者だけが操作できます' }, 403);
        if (op === 'sync') {
          const idx = Math.max(0, Math.min(+b.idx || 0, room.queue.length - 1));
          room.idx = idx; room.playing = !!b.playing; room.pos = Math.max(0, +b.pos || 0); room.at = now;
        } else if (op === 'remove') {
          const i = +b.i; if (!(i >= 0 && i < room.queue.length) || i === room.idx) return json({ error: '再生中の曲は外せません' }, 400);
          room.queue.splice(i, 1); if (i < room.idx) room.idx--;
        } else if (op === 'open') room.open = !!b.open;
        else if (op === 'close') { room.closed = true; await sysMsg(store, room, 'パーティーは終了しました'); }
        else return json({ error: 'bad op' }, 400);
      }
      room.updated = now;
      await store.setJSON('pty/' + rid, room);
      return json({ ok: true, room: pub(room), now });
    }

    if (path === '/api/party-chat' && req.method === 'POST') {
      if (!mem || !mem.uid) return json({ error: 'チャットするにはログインしてください' }, 403);
      if (room.closed) return json({ error: 'このパーティーは終了しました' }, 410);
      if (await isBanned(store, mem.uid)) return json({ error: BANNED_MSG }, 403);
      const text = clip(b.text, 200), r = RX.includes(b.r) ? b.r : '';
      if (!text && !r) return json({ error: 'メッセージを入力してください' }, 400);
      const rl = await readJson(store, 'ptr/' + k, 0);
      if (Date.now() - rl < (r ? 400 : 1200)) return json({ error: '少しゆっくり送ってください' }, 429);
      await store.setJSON('ptr/' + k, Date.now());
      const seq = await push(store, room, { uid: mem.uid, name: mem.name, icon: mem.icon || '', ...(r ? { r } : { text }) });
      if (Date.now() - room.updated > 30e3) await store.setJSON('pty/' + rid, { ...(await readJson(store, 'pty/' + rid, room)), updated: Date.now() });
      return json({ ok: true, seq });
    }
  } catch (e) {
    console.error(e);
    return json({ error: 'サーバーでエラーが起きました' }, 500);
  }
  return json({ error: 'not found' }, 404);
};

/** chat lives in its own record, numbered from the last message (so room updates never lose messages) */
async function push(store, room, m) {
  const list = await readJson(store, 'ptc/' + room.rid, []);
  const seq = (list.length ? list[list.length - 1].seq : 0) + 1;
  list.push({ ...m, seq, at: Date.now() });
  await store.setJSON('ptc/' + room.rid, list.slice(-120));
  return seq;
}
const sysMsg = (store, room, text) => push(store, room, { sys: true, text });

export const config = { path: ['/api/parties', '/api/party', '/api/party-join', '/api/party-ctl', '/api/party-chat'] };
export { posNow };

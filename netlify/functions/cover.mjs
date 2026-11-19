/* Custom playlist cover images, stored in Netlify Blobs.
 *   GET    /api/cover-info?id=<playlistId>  -> { v } (version) or {}       (public)
 *   GET    /api/cover?id=<playlistId>       -> the image                   (public)
 *   POST   /api/cover?id=<playlistId>       -> body: image/jpeg|png, header Authorization: Bearer <Google token>
 *   DELETE /api/cover?id=<playlistId>       -> header Authorization: Bearer <Google token>
 * Writes are allowed only for the YouTube channel that owns the playlist (checked with the caller's own token). */
import { getStore } from '@netlify/blobs';

const MAX = 3 * 1024 * 1024;
const ID_RE = /^[\w-]{10,64}$/;
const json = (obj, status = 200, cdn = 'no-store') => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': cdn },
});

async function ownsPlaylist(auth, id) {
  if (!/^Bearer\s+\S+/.test(auth || '')) return false;
  const h = { Authorization: auth };
  const [pl, me] = await Promise.all([
    fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(id)}`, { headers: h }).then((r) => (r.ok ? r.json() : null)),
    fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', { headers: h }).then((r) => (r.ok ? r.json() : null)),
  ]);
  const owner = pl?.items?.[0]?.snippet?.channelId, mine = me?.items?.[0]?.id;
  return !!owner && owner === mine;
}

/* Link-preview card of a recommended song (1200x630, drawn by the app), stored as "og:<sid>".
 *   GET  /api/og-img?sid=&info=1 -> { v, k } ; GET /api/og-img?sid= -> the image ; POST (image/jpeg|png) by one of its recommenders */
async function ogImg(req, url) {
  const sid = url.searchParams.get('sid') || '';
  if (!/^[\w-]{6,40}$/.test(sid)) return json({ error: 'bad id' }, 400);
  const store = getStore('covers'), key = 'og:' + sid;
  if (req.method === 'GET') {
    if (url.searchParams.get('info')) { const m = await store.getMetadata(key); return json(m?.metadata?.v ? { v: m.metadata.v, k: m.metadata.k || '' } : {}); }
    const got = await store.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!got) return new Response('not found', { status: 404 });
    return new Response(got.data, { headers: { 'content-type': got.metadata?.type || 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) return json({ error: 'ログインしてください' }, 401);
  const me = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', { headers: { Authorization: auth } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const myId = me?.items?.[0]?.id; if (!myId) return json({ error: 'ログインし直してください' }, 401);
  const songs = (await getStore({ name: 'gallery', consistency: 'strong' }).get('songs', { type: 'json' })) || [];
  const so = songs.find((x) => x.sid === sid);
  if (!so || !(so.byId === myId || (so.also || []).some((a) => a.id === myId))) return json({ error: 'おすすめした人だけが設定できます' }, 403);
  const type = (req.headers.get('content-type') || '').split(';')[0];
  if (!/^image\/(jpeg|png)$/.test(type)) return json({ error: 'bad type' }, 415);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 1024 * 1024) return json({ error: 'too large' }, 413);
  const v = Date.now(), k = String(url.searchParams.get('k') || '').slice(0, 300);
  await store.set(key, buf, { metadata: { type, v, k } });
  return json({ ok: true, v });
}

export default async (req) => {
  const url = new URL(req.url);
  if (url.pathname === '/api/og-img') return ogImg(req, url);
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400);
  const store = getStore('covers');

  if (url.pathname === '/api/cover-info') {
    const meta = await store.getMetadata(id);
    return json(meta?.metadata?.v ? { v: meta.metadata.v } : {}, 200, 'public, s-maxage=20, stale-while-revalidate=60');
  }

  if (req.method === 'GET') {
    const got = await store.getWithMetadata(id, { type: 'arrayBuffer' });
    if (!got) return new Response('not found', { status: 404, headers: { 'netlify-cdn-cache-control': 'public, s-maxage=20' } });
    const versioned = url.searchParams.get('v') === String(got.metadata?.v);
    return new Response(got.data, {
      headers: {
        'content-type': got.metadata?.type || 'image/jpeg',
        'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
        'netlify-cdn-cache-control': versioned ? 'public, durable, s-maxage=31536000, immutable' : 'public, s-maxage=20',
      },
    });
  }

  if (req.method === 'POST' || req.method === 'DELETE') {
    if (!(await ownsPlaylist(req.headers.get('authorization'), id))) return json({ error: 'このプレイリストの持ち主だけが変更できます' }, 403);
    if (req.method === 'DELETE') { await store.delete(id); return json({ ok: true }); }
    const type = (req.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return json({ error: '画像ファイル（JPEG / PNG / WebP）を選んでください' }, 415);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX) return json({ error: '画像が大きすぎます（3MBまで）' }, 413);
    const v = Date.now();
    await store.set(id, buf, { metadata: { type, v } });
    return json({ ok: true, v });
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: ['/api/cover', '/api/cover-info'] };

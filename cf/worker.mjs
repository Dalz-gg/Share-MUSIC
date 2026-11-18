/* Cloudflare Pages advanced-mode worker (_worker.js): routes requests to the same handlers that ran on Netlify.
 * Static files come from env.ASSETS. Responses that the handlers mark cacheable (netlify-cdn-cache-control
 * s-maxage) are kept in D1 so YouTube / Apple lookups are not repeated. */
import og from '../netlify/functions/og.mjs';
import api from '../netlify/functions/api.mjs';
import cover from '../netlify/functions/cover.mjs';
import gallery from '../netlify/functions/gallery.mjs';
import community from '../netlify/functions/community.mjs';
import auth from '../netlify/functions/auth.mjs';
import social from '../netlify/functions/social.mjs';
import posts from '../netlify/functions/posts.mjs';
import party from '../netlify/functions/party.mjs';
import spread from '../netlify/functions/spread.mjs';
import reactions from '../netlify/functions/reactions.mjs';
import topics from '../netlify/functions/topics.mjs';
import { ASSETS as EMBEDDED } from './static-server.mjs';

const ROUTES = [
  [(p) => p.startsWith('/p/') || p.startsWith('/s/') || p === '/c' || p.startsWith('/c/') || p === '/party' || p.startsWith('/party/') || p === '/topic' || p.startsWith('/topic/') || p.startsWith('/u/') || p === '/search', og],
  [(p) => p === '/api/mv' || p === '/api/ja', api],
  [(p) => p === '/api/cover' || p === '/api/cover-info', cover],
  [(p) => p === '/api/gallery' || p === '/api/gallery-status' || p === '/api/bookmarks', gallery],
  [(p) => ['/api/like', '/api/comments', '/api/songs', '/api/song-search', '/api/song-match', '/api/profile'].includes(p) || p.startsWith('/api/admin/'), community],
  [(p) => p.startsWith('/api/auth/'), auth],
  [(p) => ['/api/notifs', '/api/notifs/read', '/api/follows', '/api/report'].includes(p), social],
  [(p) => ['/api/posts', '/api/post', '/api/post-react', '/api/post-vote', '/api/post-img', '/api/pimg'].includes(p), posts],
  [(p) => ['/api/parties', '/api/party', '/api/party-join', '/api/party-ctl', '/api/party-chat'].includes(p), party],
  [(p) => p === '/api/spread', spread],
  [(p) => p === '/api/song-react' || p === '/api/song-reacts', reactions],
  [(p) => ['/api/topic', '/api/topics', '/api/topic-admin'].includes(p), topics],
];
const SPA = (p) => p === '/me' || p === '/picks' || p === '/search' || p === '/bookmarks' || p === '/share' || p.startsWith('/share/') || p === '/notifs' || p === '/c' || p.startsWith('/c/') || p === '/party' || p.startsWith('/party/') || p === '/admin' || p.startsWith('/u/');
const CACHEABLE = (p) => p.startsWith('/p/') || p.startsWith('/s/') || p.startsWith('/c/') || p.startsWith('/party/') || p.startsWith('/u/') || ['/api/mv', '/api/ja', '/api/song-search', '/api/song-match', '/api/gallery', '/api/songs', '/api/cover-info'].includes(p);

async function cached(req, env, handler, ctx) {
  const key = 'cache:' + new URL(req.url).toString();
  try {
    const row = await env.DB.prepare('SELECT v, exp FROM kv WHERE store = ?1 AND k = ?2').bind('cache', key).first();
    if (row && row.exp > Date.now()) {
      const { body, type } = JSON.parse(row.v);
      return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-store', 'x-cache': 'HIT' } });
    }
  } catch { /* cache is best effort */ }
  const res = await handler(req, ctx);
  const rule = res.headers.get('netlify-cdn-cache-control') || '';
  const m = /s-maxage=(\d+)/.exec(rule);
  const type = res.headers.get('content-type') || '';
  if (res.status === 200 && m && +m[1] > 0 && /json|html/.test(type)) {
    const body = await res.clone().text();
    if (body.length < 400000) {
      const exp = Date.now() + Math.min(+m[1], 30 * 86400) * 1000;
      ctx.waitUntil(env.DB.prepare('INSERT INTO kv (store, k, v, exp, updated) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(store, k) DO UPDATE SET v = excluded.v, exp = excluded.exp, updated = excluded.updated')
        .bind('cache', key, JSON.stringify({ body, type }), exp, Date.now()).run().catch(() => {}));
    }
  }
  return res;
}

export default {
  async fetch(req, env, ctx) {
    const assets = EMBEDDED; // static files are embedded in this worker (see cf/gen-static.mjs)
    globalThis.__env = env;
    globalThis.__ASSETS = assets;
    globalThis.process = globalThis.process || { env: {} };
    globalThis.process.env = { GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || '', ADMIN_PASSWORD: env.ADMIN_PASSWORD || '' };
    const url = new URL(req.url), p = url.pathname;
    const hctx = { ip: req.headers.get('cf-connecting-ip') || '', waitUntil: (x) => ctx.waitUntil(x) };
    for (const [match, handler] of ROUTES) {
      if (!match(p)) continue;
      const res = req.method === 'GET' && CACHEABLE(p) ? await cached(req, env, handler, hctx) : await handler(req, hctx);
      // a write changes the public lists: drop their cached copies
      if (req.method !== 'GET' && res.status < 400 && /^\/api\/(gallery|like|songs|comments|bookmarks|song-react|admin\/act|cover|posts|profile|party-ctl)/.test(p)) {
        ctx.waitUntil(env.DB.prepare("DELETE FROM kv WHERE store = 'cache' AND (k LIKE '%/api/gallery%' OR k LIKE '%/api/songs%' OR k LIKE '%/api/cover-info%' OR k LIKE '%/p/%' OR k LIKE '%/s/%' OR k LIKE '%/c/%' OR k LIKE '%/u/%' OR k LIKE '%/party/%')").run().catch(() => {}));
      }
      const h = new Headers(res.headers); h.delete('netlify-cdn-cache-control');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }
    if (SPA(p)) return assets.fetch(new Request(new URL('/index.html', url.origin), req));
    return assets.fetch(req);
  },
};

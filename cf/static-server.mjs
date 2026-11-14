/* Serves the embedded site files (see gen-static.mjs) — a stand-in for env.ASSETS. */
import FILES from './static.gen.mjs';
const bytes = new Map();
const body = (f, rel) => {
  if (!f.bin) return f.b;
  if (!bytes.has(rel)) { const s = atob(f.b), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); bytes.set(rel, a); }
  return bytes.get(rel);
};
function resolve(pathname) {
  if (pathname === '/') return '/index.html';
  if (FILES[pathname]) return pathname;
  if (FILES[pathname + '.html']) return pathname + '.html';
  if (pathname.endsWith('/') && FILES[pathname + 'index.html']) return pathname + 'index.html';
  return null;
}
export const ASSETS = {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith('.html') && url.pathname !== '/index.html' && FILES[url.pathname]) {
      return Response.redirect(new URL(url.pathname.replace(/\.html$/, ''), url.origin).toString(), 308); // pretty URLs
    }
    const rel = resolve(url.pathname);
    if (!rel) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const f = FILES[rel];
    const cache = /\.html$|\/sw\.js$|\/config\.js$|webmanifest$/.test(rel) ? 'no-cache'
      : /\.(js|css)$/.test(rel) ? 'public, max-age=300' : 'public, max-age=86400';
    return new Response(req.method === 'HEAD' ? null : body(f, rel), { headers: { 'content-type': f.t, 'cache-control': cache } });
  },
};

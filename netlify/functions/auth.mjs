/* Long-lived login: Google "authorization code" flow with a refresh token kept on the server.
 *   GET  /api/auth/token     -> { configured, access_token?, expires_in? }  (refreshes with the session cookie)
 *   POST /api/auth/login     -> body { code } from Google's code client (popup, redirect_uri=postmessage)
 *   POST /api/auth/logout    -> forget the session and revoke the refresh token
 * The refresh token never reaches the browser: it lives in Netlify Blobs, keyed by a random session id that is
 * stored in an HttpOnly cookie. Requires the GOOGLE_CLIENT_SECRET environment variable (set in Netlify). */
import { getStore } from '@netlify/blobs';

const CLIENT_ID = '882593954030-5s8vatlfhdasdfv181qugv9kbj36pngo.apps.googleusercontent.com';
const COOKIE = 'ps_sid';
const MAX_AGE = 180 * 86400;

const secret = () => (globalThis.Netlify?.env?.get?.('GOOGLE_CLIENT_SECRET')) || process.env.GOOGLE_CLIENT_SECRET || '';
const db = () => getStore({ name: 'sessions', consistency: 'strong' });
const json = (obj, status = 200, cookie) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) },
});
const cookieOf = (req) => (/(?:^|;\s*)ps_sid=([A-Za-z0-9_-]{20,})/.exec(req.headers.get('cookie') || '') || [])[1];
const setCookie = (sid) => `${COOKIE}=${sid}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
const clearCookie = `${COOKIE}=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const newSid = () => { const a = new Uint8Array(32); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

async function google(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: secret(), ...params }),
  });
  return { ok: r.ok, body: await r.json().catch(() => ({})) };
}

export default async (req) => {
  const path = new URL(req.url).pathname;
  const configured = !!secret();
  try {
    if (path === '/api/auth/token') {
      if (!configured) return json({ configured: false });
      const sid = cookieOf(req); if (!sid) return json({ configured: true }, 401);
      const store = db(); const s = await store.get('s/' + sid, { type: 'json' });
      if (!s?.rt) return json({ configured: true }, 401, clearCookie);
      const g = await google({ grant_type: 'refresh_token', refresh_token: s.rt });
      if (!g.ok) {
        if (g.body.error === 'invalid_grant') { await store.delete('s/' + sid); return json({ configured: true, error: 'expired' }, 401, clearCookie); }
        return json({ configured: true, error: 'google' }, 502);
      }
      await store.setJSON('s/' + sid, { ...s, used: Date.now() });
      return json({ configured: true, access_token: g.body.access_token, expires_in: g.body.expires_in }, 200, setCookie(sid)); // sliding expiry
    }

    if (path === '/api/auth/login' && req.method === 'POST') {
      if (!configured) return json({ configured: false, error: 'not configured' }, 501);
      const { code } = await req.json().catch(() => ({}));
      if (!code) return json({ error: 'no code' }, 400);
      const g = await google({ grant_type: 'authorization_code', code, redirect_uri: 'postmessage' });
      if (!g.ok) return json({ error: g.body.error_description || g.body.error || 'login failed' }, 400);
      const t = g.body;
      if (!t.refresh_token) {
        // Google only hands out a refresh token on a fresh consent; this login works for an hour only.
        return json({ access_token: t.access_token, expires_in: t.expires_in, persistent: false });
      }
      const old = cookieOf(req); if (old) await db().delete('s/' + old);
      const sid = newSid();
      await db().setJSON('s/' + sid, { rt: t.refresh_token, created: Date.now(), used: Date.now() });
      return json({ access_token: t.access_token, expires_in: t.expires_in, persistent: true }, 200, setCookie(sid));
    }

    if (path === '/api/auth/logout' && req.method === 'POST') {
      const sid = cookieOf(req);
      if (sid) {
        const store = db(); const s = await store.get('s/' + sid, { type: 'json' });
        if (s?.rt) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(s.rt), { method: 'POST' }).catch(() => {});
        await store.delete('s/' + sid);
      }
      return json({ ok: true }, 200, clearCookie);
    }
  } catch (e) {
    console.error(e);
    return json({ error: 'server error' }, 500);
  }
  return json({ error: 'not found' }, 404);
};

export const config = { path: ['/api/auth/token', '/api/auth/login', '/api/auth/logout'] };

/* Stage 3 — 今週のお題: one weekly theme, one song per person.
 *   GET  /api/topic            current theme + answers           (to be built in stage 3)
 *   POST /api/topic            answer / replace my answer (logged in)
 *   GET  /api/topics           past themes
 *   POST /api/topic-admin      set the theme (admin token) */
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store' } });
export default async () => json({ error: 'not implemented yet' }, 501);
export const config = { path: ['/api/topic', '/api/topics', '/api/topic-admin'] };

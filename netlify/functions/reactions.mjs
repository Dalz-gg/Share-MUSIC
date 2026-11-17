/* Stage 2 — reactions on recommended songs: 刺さった (= existing like) / わかる / ありがとう, and ありがとう便.
 *   POST /api/song-react   { sid, r: 'get' | 'thx' }   toggle (logged in)       (to be built in stage 2)
 *   GET  /api/song-reacts?sids=a,b,c                   counts (+ mine when logged in) */
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store' } });
export default async () => json({ error: 'not implemented yet' }, 501);
export const config = { path: ['/api/song-react', '/api/song-reacts'] };
